// bb-plugin-focus-board — a BB plugin backend entry.
//
// The board reads bb's live thread view through the frontend sidebar hooks.
// Server state is: (1) the set of threads the user marked "Done" — one record
// per thread in the board's plugin-metadata namespace (key "done" →
// { doneAt: ISO-8601, keep? }), exposed over RPC and broadcast over realtime
// so every open board updates; (2) per-thread sweep keep flags in their own
// KV store (a long-idle thread that was never marked Done can be protected
// too); (3) the sweep thresholds, from plugin settings.
//
// Plugin metadata writes emit no thread realtime event, so the explicit
// done-changed publish stays.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import {
  PluginCliError,
  cliCommand,
  defineCli,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  DONE_METADATA_KEY,
  doneAtToEpochMs,
  parseDoneRecord,
  stampDone,
  type DoneRecord,
} from "./lib/done-metadata";
import {
  LINK_METADATA_KEY,
  clearLinkedIssues,
  linkHref,
  makeExternalLink,
  parseGithubItemUrl,
  parseLinkedIssues,
  stampLinkedIssues,
  type ThreadLink,
} from "./lib/link-metadata";
import {
  ARCHIVE_UNITS,
  DEFAULT_ARCHIVE_UNIT,
  DEFAULT_ARCHIVE_VALUE,
  archiveThresholdMs,
} from "./lib/duration";
import {
  PIN_PARK_METADATA_KEY,
  parsePinParkRecord,
  stampPinPark,
  type PinParkRecord,
} from "./lib/pin-park";
import {
  SNOOZE_METADATA_KEY,
  parseSnoozeRecord,
  parseWhenArg,
  snoozeWakeAtMs,
  stampSnooze,
  type SnoozeRecord,
} from "./lib/snooze";
import { reparentRefusal } from "./lib/reparent";
import {
  RANK_KV_KEY,
  applyMoveVisible,
  orderForColumn,
  parseRankStore,
  rankRowFromStore,
  type RankStore,
} from "./lib/rank";
import {
  sweepCliEligible,
  type SweepEligible,
  type SweepFact,
} from "./lib/sweep-cli";
import { readGitHubStatuses } from "./lib/tracker-status";
import { resolveRepoSlug } from "./lib/tickets";
import { resolveWithinRoot } from "./lib/workspace-paths";
import {
	createWorkspaceOpenTargetsCache,
	openWorkspaceInTarget,
	probeLocalDaemon,
	resolveWorkspaceOpenState,
	daemonPortsFromSystemConfig,
	type HostDaemonProbe,
	type WorkspaceOpenState,
} from "./lib/workspace-open";
import {
  autotitleTargets,
  buildAutotitlePrompt,
  cleanGeneratedTitle,
  promptTextFromHistory,
  resolveTitleSelection,
  resolveTitleTarget,
  type AutotitleHistoryEntry,
} from "./lib/autotitle";
import {
  assistantTextFromTimeline,
  buildAutotitleProbePrompt,
  firstUserPromptFromTimeline,
  probeSettled,
  type AutotitleTimelineRow,
} from "./lib/autotitle-thread-model";
import type { JsonValue } from "@get-bb/plugin-sdk";

/**
 * A rank store column key: a bare lane name ("pinned", "done") or
 * `${groupBy}:${columnId}` with a host id (project, provider). The shape
 * guards reject the two things that are never legitimate but are dangerous
 * as a computed object key on the KV store write (`__proto__` reassigns
 * the store object's prototype) and control characters (invisible
 * pollution of the KV row and realtime payloads). Everything real passes:
 * host ids, colons, dots.
 */
const COLUMN_KEY_SCHEMA = z
  .string()
  .min(1)
  .max(200)
  .regex(/^(?!__proto__$)[^\x00-\x1f\x7f]+$/, "not a column key");

/**
 * One board-linked tracker item, exactly the lib/link-metadata ThreadLink
 * round-trip. The github variant's tracker is optional so records written
 * before the external variant existed still pass the output contract; new
 * writes always carry it.
 */
const GITHUB_LINK_RECORD = z.object({
  tracker: z.literal("github").optional(),
  repo: z.string().min(1),
  issue: z.number().int().positive(),
  kind: z.enum(["issue", "pull"]),
  href: z.string().refine((value) => /^https:\/\/github\.com\//.test(value), "GitHub URL"),
  createdAt: z.string(),
  source: z.enum(["agent", "operator", "auto"]),
});

/** Non-GitHub tracker item (Jira, Linear, Forgejo, anything with a URL). */
const EXTERNAL_LINK_RECORD = z.object({
  tracker: z.literal("external"),
  url: z.string().startsWith("https://"),
  hostname: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  createdAt: z.string(),
  source: z.enum(["agent", "operator", "auto"]),
});

const LINK_RECORD_SCHEMA = z.union([GITHUB_LINK_RECORD, EXTERNAL_LINK_RECORD]);

export const rpcContract = defineRpcContract({
  done_list: {
    input: z.null(),
    output: z.object({
      doneIds: z.array(z.string()),
      records: z.record(
        z.string(),
        z.object({ doneAt: z.string().optional(), keep: z.boolean().optional() }),
      ),
    }),
  },
  done_set: {
    input: z.object({ threadId: z.string().min(1), done: z.boolean() }),
    output: z.object({ done: z.boolean() }),
  },
  /**
   * Board-linked GitHub items (issue #13): per-thread plugin metadata key
   * "linkedIssues" → ThreadLink[], first entry primary (lib/link-metadata).
   * The builtin GitHub plugin persists its own thread↔issue links in bb.db
   * rows under another plugin's namespace, which focus-board cannot read
   * (no cross-plugin surface in BbPluginApi), so the board keeps its own
   * record and renders chips from title/branch text refs merged with these.
   */
  link_list: {
    input: z.null(),
    output: z.object({ links: z.record(z.string(), z.array(LINK_RECORD_SCHEMA)) }),
  },
  link_set: {
    input: z
      .object({
        threadId: z.string().min(1),
        // Exactly one of: repo+number (GitHub form), url (GitHub or
        // external). `kind` applies to the number form only; `label` to the
        // external form only.
        repo: z.string().min(1).optional(),
        number: z.number().int().positive().optional(),
        kind: z.enum(["issue", "pull"]).optional(),
        url: z.string().startsWith("https://", "https url").optional(),
        label: z.string().min(1).max(80).optional(),
        source: z.enum(["agent", "operator", "auto"]),
      })
      .superRefine((input, ctx) => {
        const hasNumber = input.number !== undefined;
        const hasUrl = input.url !== undefined;
        if (hasNumber === hasUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "give exactly one of url or number",
            path: hasUrl ? ["url"] : ["number"],
          });
        }
        if (hasNumber && input.repo === undefined) {
          // Allowed: the handler resolves the repo from the thread's project
          // remote. Nothing to check here; the comment keeps the contract
          // readable.
        }
        if (input.repo !== undefined && hasUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "repo applies to the number form only",
            path: ["repo"],
          });
        }
        if (input.kind !== undefined && hasUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "kind applies to the number form only (the URL carries its own)",
            path: ["kind"],
          });
        }
        if (input.label !== undefined && hasNumber) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "label applies to the external-url form only",
            path: ["label"],
          });
        }
      }),
    output: z.object({ threadId: z.string(), link: LINK_RECORD_SCHEMA }),
  },
  link_clear: {
    input: z.object({
      threadId: z.string().min(1),
      number: z.number().int().positive().optional(),
    }),
    output: z.object({ threadId: z.string(), cleared: z.boolean() }),
  },
  // Parked-pin record store: the lane-exit unpin writes a park marker here
  // (see lib/pin-park.ts), and the state writes that bring the card back to
  // the operator — Mark Not Done, Mark Unread — read it to restore the pin.
  // A dumb record store on purpose: the composition (who unpins, who
  // restores) lives with the sidebar-action caller, where the writes stream.
  pin_parks_list: {
    input: z.null(),
    output: z.object({
      parks: z.record(z.string(), z.object({ parkedAt: z.string() })),
    }),
  },
  pin_park_set: {
    input: z.object({ threadId: z.string().min(1), parked: z.boolean() }),
    output: z.object({ threadId: z.string(), parked: z.boolean() }),
  },
  /**
   * Snooze: read now, unread later. The record map rides off the live
   * thread list (no metadata scan in the SDK); a snooze on a thread that
   * has left the list is dormant until it returns, and its record is
   * dropped by the wake when the thread is gone.
   */
  snooze_list: {
    input: z.null(),
    output: z.object({
      snoozes: z.record(
        z.string(),
        z.object({ wakeAt: z.string(), setAt: z.string() }),
      ),
    }),
  },
  // (Re-)snooze a thread until `wakeAt` (epoch-parseable; past times are
  // rejected by the handler — the contract cannot inject `now`).
  snooze_set: {
    input: z.object({
      threadId: z.string().min(1),
      wakeAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    }),
    output: z.object({
      threadId: z.string().min(1),
      wakeAt: z.string(),
    }),
  },
  snooze_clear: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ threadId: z.string().min(1), cleared: z.boolean() }),
  },
  tracker_status: {
    input: z.object({
      repo: z.string().min(1),
      // Batch cap: one board view's visible refs stay well under 500; the
      // cap bounds the SQL IN-list built in readGitHubStatuses (SQLite's
      // default parameter limit is 999) and rejects runaway input.
      numbers: z.array(z.number().int().positive()).max(500),
    }),
    output: z.object({
      statuses: z.record(z.number().int(), z.object({ kind: z.string(), state: z.string() })),
    }),
  },

  // ✨ auto-rename: generate a thread title from its first user prompt with
  // whatever AI service bb's thread-title task is set to (Settings → AI
  // services). bb has no plugin-facing invocation for its AI services, so
  // the title rides the cross-plugin RPC bridge into the selected service's
  // own `complete` method; lib/autotitle.ts owns the pure pieces.
  thread_autotitle: {
    input: z.object({
      threadId: z.string().min(1),
      // Override target from the fallback modal: generate with an
      // alternative service instead of the failing selected one. Both or
      // neither — a half-given pair is refused in the handler.
      pluginId: z.string().min(1).optional(),
      serviceId: z.string().min(1).optional(),
      // Generate with the thread's own provider/model instead (the hidden
      // probe path). Exclusive with the service override.
      useThreadModel: z.boolean().optional(),
    }),
    output: z.object({ title: z.string() }),
  },

  // The fallback modal's menu: every registered service that can serve a
  // thread title (with readiness), the current selection, and whether the
  // thread's own model is probeable.
  thread_autotitle_services: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      selected: z
        .object({ pluginId: z.string(), serviceId: z.string() })
        .nullable(),
      services: z.array(
        z.object({
          pluginId: z.string(),
          serviceId: z.string(),
          displayName: z.string(),
          ready: z.boolean(),
          message: z.string().nullable(),
          // ✨ bridge classification: whether the service's plugin answers
          // the `complete` RPC at all (probed with invalid input, cached).
          bridge: z.boolean(),
          bridgeReason: z.string().nullable(),
        }),
      ),
      threadModel: z.object({
        available: z.boolean(),
        reason: z.string().nullable(),
      }),
    }),
  },

  // Existence check behind the thread pane's inline-code file links: the
  // pane only decorates code spans whose path really exists in the
  // thread's workspace (the host linkifier is string-only and will paint
  // dead links). Paths are workspace-relative and resolved against the
  // environment root here; the check runs on the environment's own host.
  workspace_files_exist: {
    input: z.object({
      threadId: z.string().min(1),
      // One visible pane's candidate paths stay well under this cap; it
      // bounds each RPC fan-out to the host daemon.
      paths: z.array(z.string().min(1)).max(200),
    }),
    output: z.object({ existence: z.record(z.string(), z.boolean()) }),
  },

  // Workspace-open discovery for the pane header's open menu: which local
  // apps can open the thread's workspace folder. The plugin server asks
  // the loopback host daemon (the same authority bb's own thread header
  // uses), so the verdict also covers the remote-browser case — the app
  // opens where the workspace lives. Unavailable always carries a reason.
  workspace_open_targets: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      status: z.enum(["available", "unavailable"]),
      reason: z.string().nullable(),
      root: z.string().nullable(),
      targets: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          kind: z.string().nullable(),
          icon: z
            .object({ kind: z.string() })
            .passthrough()
            .nullable(),
          capabilities: z.object({
            openDirectory: z.boolean(),
            openFile: z.boolean(),
            openFileAtLine: z.boolean(),
            openFileAtColumn: z.boolean().nullable(),
          }),
        }),
      ),
    }),
  },
  // Open the thread's workspace folder in one of the discovered targets.
  // Errors come back as { ok: false, message } — the menu shows them
  // inline rather than dying silently.
  workspace_open_in_target: {
    input: z.object({
      threadId: z.string().min(1),
      targetId: z.string().min(1),
    }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },

  sweep_config_get: {
    input: z.null(),
    /**
     * Thresholds resolved to exact epoch ms from the operator's value+unit
     * settings (lib/duration owns the conversion). The board stays
     * unit-ignorant; the CLI reads the raw settings for display.
     */
    output: z.object({
      doneArchiveMs: z.number().int().min(1),
      idleArchiveMs: z.number().int().min(1),
    }),
  },
  sweep_keep_set: {
    input: z.object({ threadId: z.string().min(1), keep: z.boolean() }),
    output: z.object({ threadId: z.string().min(1), keep: z.boolean() }),
  },

  /**
   * Re-parenting: drop a card onto a card (nest it), or detach a card back
   * to top level (`parentThreadId: null`). The handler re-checks
   * lib/reparent's rules against its own fresh thread rows — the board's map
   * is stale the moment any other surface moves a family — and a loop write
   * (a card under its own child) would corrupt bb's own sidebar tree, so a
   * refused gesture throws and the board says why on screen.
   */
  thread_reparent: {
    input: z.object({
      threadId: z.string().min(1),
      parentThreadId: z.string().min(1).nullable(),
    }),
    output: z.object({
      threadId: z.string().min(1),
      parentThreadId: z.string().min(1).nullable(),
    }),
  },

  rank_list: {
    input: z.null(),
    output: z.object({ orders: z.record(z.string(), z.array(z.string())) }),
  },
  /**
   * A single move, not a whole-column write: two boards open on the same
   * column each lose only their own move, instead of the second write
   * clobbering every rank the first one established. Concurrent moves are
   * serialized server-side (withRankWriteLock), so an interleave can never
   * revert the other writer's column.
   */
  rank_move: {
    input: z.object({
      columnKey: COLUMN_KEY_SCHEMA,
      threadId: z.string().min(1),
      /** The card to land in front of; null means the top of the column. */
      beforeId: z.string().nullable(),
      /** Drop below the last ranked card instead of at an anchor. */
      toEnd: z.boolean(),
      /**
       * The column's displayed order at drop time. The move ranks every card
       * above the drop point from this list — a first drop into an unranked
       * column otherwise ranks one card and reorders nothing, because the
       * sparse comparator sorts all ranked cards above unranked ones.
       */
      visibleIds: z.array(z.string()),
    }),
    output: z.object({ columnKey: COLUMN_KEY_SCHEMA, order: z.array(z.string()) }),
  },
});

/**
 * The unit select's stored value is typed plain `string`; the descriptor's
 * enum schema guarantees membership at write time — re-parse to narrow the
 * type (and to fail loud if a foreign value ever lands in the store).
 */
const ARCHIVE_UNIT_SCHEMA = z.enum(ARCHIVE_UNITS);

/** Realtime signal after every done/keep write. Payload is { threadId, done }
 *  (was { count } before the metadata migration); consumers refetch on the
 *  event rather than reading the payload. */
const DONE_CHANGED = "done-changed";
/** Realtime signal after every snooze set/clear/wake. Payload is
 *  { threadId }; consumers refetch the record map. */
const SNOOZE_CHANGED = "snooze-changed";
/** Realtime signal after every link set/clear. Payload is { threadIds };
 *  consumers refetch the record map. */
const LINK_CHANGED = "link-changed";
/** Realtime signal after a rank write. Payload names the column; boards
 *  refetch the whole store, so a stale payload cannot desync an order. */
const RANK_CHANGED = "rank-changed";
/** Legacy KV key written before the metadata migration. */
const LEGACY_DONE_KEY = "done-thread-ids";
/** Per-thread sweep keep flags, independent of Done marks. */
const KEEP_KEY = "sweep-keep-flags";
/**
 * Best-effort index of thread ids the board believes carry its `done`
 * metadata. The SDK has no metadata scan, so `bb focus-board done list`
 * and `sweep` use it to report marks on threads that have dropped out of
 * both the live and archived thread lists (deleted since their mark).
 * Metadata stays the source of truth; the index only widens reporting of
 * orphaned marks. Updated on every done write (board RPC, CLI, legacy
 * import).
 */
const DONE_INDEX_KV_KEY = "done-index";

// time ("mirror, don't integrate": read-only, degrade-to-empty access —
// see lib/tracker-status.ts).
const GITHUB_CACHE_DB = ".bb/plugins/github/data.db";

type KeepStore = Record<string, true>;

/**
 * The raw KV row shape for the keep store — the single encoding both
 * writeKept persists and readKept validates, so a written row round-trips.
 */
export function keepRowFromStore(store: KeepStore): Record<string, { keep: true }> {
  return Object.fromEntries(
    Object.keys(store).map((id) => [id, { keep: true as const }]),
  );
}

export function keptFromRow(row: unknown): KeepStore | null {
  if (row === null || row === undefined) return null;
  if (typeof row !== "object" || Array.isArray(row)) return null;
  const entries = Object.entries(row as Record<string, unknown>);
  const valid = entries.every(([id, record]) =>
    typeof id === "string" &&
    typeof record === "object" &&
    record !== null &&
    !Array.isArray(record) &&
    (record as { keep?: unknown }).keep === true &&
    Object.keys(record).length === 1,
  );
  if (!valid) return null;
  return Object.fromEntries(entries.map(([id]) => [id, true as const]));
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    // Each sweep threshold is a value+unit pair: the number is a count of
    // the unit setting next to it (hours | days | weeks). Both arms
    // default to 2 days — the operator-tuned aggressive default. The
    // integer caps keep the old per-arm ranges as a garbage rail (365 for
    // Done, 3650 for idle) in whatever unit is configured.
    doneArchiveValue: {
      type: "number",
      label: "Sweep: archive Done threads after",
      description:
        "How long a thread stays Done before the sweep offers to archive it — a count of the unit chosen below. Default 2 days.",
      experimental_schema: z.number().int().min(1).max(365),
      default: DEFAULT_ARCHIVE_VALUE,
    },
    doneArchiveUnit: {
      type: "select",
      label: "Sweep: Done archive unit",
      options: [...ARCHIVE_UNITS],
      experimental_schema: ARCHIVE_UNIT_SCHEMA,
      default: DEFAULT_ARCHIVE_UNIT,
    },
    idleArchiveValue: {
      type: "number",
      label: "Sweep: mark long-idle threads Done after",
      description:
        "How long a thread stays quiet before the sweep offers to mark it Done — a count of the unit chosen below. Default 2 days.",
      experimental_schema: z.number().int().min(1).max(3650),
      default: DEFAULT_ARCHIVE_VALUE,
    },
    idleArchiveUnit: {
      type: "select",
      label: "Sweep: idle threshold unit",
      options: [...ARCHIVE_UNITS],
      experimental_schema: ARCHIVE_UNIT_SCHEMA,
      default: DEFAULT_ARCHIVE_UNIT,
    },
    // The thread pane's Escape behavior. Rendered as a toggle in the
    // plugin detail page's configuration panel; the board reads it
    // reactively through the frontend `useSettings()` hook (explicit
    // stored false is off — loading/unavailable keeps the default).
    escStopsRunningThread: {
      type: "boolean",
      label: "Thread pane: Escape stops a running thread first",
      description:
        "While a thread is running, Escape interrupts its turn instead of closing the pane; the pane closes with Escape once nothing is running, and a rapid double-tap never closes it.",
      default: true,
    },
    // Debug-mode scroll instrumentation for the pane's embedded chat
    // (docs/chat-click-jump-2026-09-29.md investigation). Ships OFF: the
    // committed default is off everywhere, so stable builds never
    // instrument; it is turned on in a developer environment through this
    // setting alone. While on, the pane wraps the transcript scroller's
    // scrollTop setter and logging session; the log reaches the browser
    // console and the `__focusBoardScrollDebug.dump()` window handle only
    // (see components/scroll-debug.ts) — the pane header carries no debug
    // button.
    scrollDebugInstrumentation: {
      type: "boolean",
      label: "Developer: instrument pane chat scrolling (debug)",
      description:
        "Logs the pane chat transcript's scroll writes with calling stacks, plus scroll/wheel/touch events, to the browser console with a __focusBoardScrollDebug.dump() window handle. Debug use only; keep off otherwise.",
      default: false,
    },
  });

  // Workspace-open state for the pane header's open menu. The local host
  // daemon is probed per call (cheap), while the per-root app discovery —
  // seconds on a cold daemon — is cached for the pane's lifetime here.
  const workspaceOpenTargetsCache = createWorkspaceOpenTargetsCache(5 * 60_000);

  async function requireLocalDaemon(): Promise<HostDaemonProbe | null> {
    const config = (await bb.sdk.system.config()) as {
      hostDaemonPort?: number | null;
      localHelperPorts?: number[] | null;
    };
    return probeLocalDaemon(daemonPortsFromSystemConfig(config), {
      fetchImpl: fetch,
      timeoutMs: 3_000,
    });
  }

  async function resolveThreadWorkspaceOpen(
    threadId: string,
  ): Promise<WorkspaceOpenState> {
    const thread = await bb.sdk.threads.get({ threadId });
    const environmentId =
      "environmentId" in thread ? thread.environmentId : null;
    if (environmentId === null) {
      return {
        status: "unavailable",
        reason: "This thread runs outside an environment, so it has no workspace to open.",
        root: null,
        targets: [],
      };
    }
    const environment = await bb.sdk.environments.get({ environmentId });
    return resolveWorkspaceOpenState({
      root: environment.path,
      environmentHostId: environment.hostId,
      systemConfig: (await bb.sdk.system.config()) as {
        hostDaemonPort?: number | null;
        localHelperPorts?: number[] | null;
      },
      deps: { fetchImpl: fetch, timeoutMs: 15_000 },
      targetsCache: workspaceOpenTargetsCache,
    });
  }

  async function readDoneRecord(
    threadId: string,
  ): Promise<DoneRecord | null> {
    // getPluginMetadata returns an untyped namespace record; cast to the
    // JsonValue contract parseDoneRecord validates.
    const namespace = await bb.sdk.threads.getPluginMetadata({ threadId });
    const value = (namespace as Record<string, JsonValue>)[DONE_METADATA_KEY];
    return parseDoneRecord(value);
  }

  async function readDoneIndex(): Promise<string[]> {
    const ids: unknown = await bb.storage.kv.get(DONE_INDEX_KV_KEY);
    if (!Array.isArray(ids)) return [];
    return ids.filter((id): id is string => typeof id === "string");
  }

  async function addToDoneIndex(threadId: string): Promise<void> {
    const ids = new Set(await readDoneIndex());
    if (ids.has(threadId)) return;
    ids.add(threadId);
    await bb.storage.kv.set(DONE_INDEX_KV_KEY, [...ids]);
  }

  async function removeFromDoneIndex(threadId: string): Promise<void> {
    const ids = await readDoneIndex();
    if (!ids.includes(threadId)) return;
    await bb.storage.kv.set(
      DONE_INDEX_KV_KEY,
      ids.filter((id) => id !== threadId),
    );
  }

  async function writeDoneRecord(threadId: string, done: boolean) {    const now = new Date();
    if (done) {
      const existing = await readDoneRecord(threadId);
      const record = stampDone(existing, now);
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { [DONE_METADATA_KEY]: record },
      });
      await addToDoneIndex(threadId);
    } else {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        remove: [DONE_METADATA_KEY],
      });
      await removeFromDoneIndex(threadId);
    }
  }

  async function readPinParkRecord(
    threadId: string,
  ): Promise<PinParkRecord | null> {
    // Same cast contract as readDoneRecord above: getPluginMetadata returns
    // an untyped namespace record; parsePinParkRecord validates the shape.
    const namespace = await bb.sdk.threads.getPluginMetadata({ threadId });
    const value = (namespace as Record<string, JsonValue>)[PIN_PARK_METADATA_KEY];
    return parsePinParkRecord(value);
  }

  /**
   * Park or clear the lane-exit pin marker. Parking refreshes the stamp —
   * a prior park never survives a newer gesture; clearing deletes the key.
   */
  async function writePinPark(threadId: string, parked: boolean): Promise<void> {
    if (parked) {
      const existing = await readPinParkRecord(threadId);
      const record = stampPinPark(existing, new Date());
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { [PIN_PARK_METADATA_KEY]: record },
      });
    } else {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        remove: [PIN_PARK_METADATA_KEY],
      });
    }
  }

  // Linked GitHub items (issue #13): the chip feed that works when neither
  // the title nor the branch name carries a text ticket ref.

  async function readLinkedIssues(threadId: string): Promise<ThreadLink[] | null> {
    // Same cast contract as readDoneRecord above: getPluginMetadata returns
    // an untyped namespace record; parseLinkedIssues validates the shape.
    const namespace = await bb.sdk.threads.getPluginMetadata({ threadId });
    const value = (namespace as Record<string, JsonValue>)[LINK_METADATA_KEY];
    return parseLinkedIssues(value);
  }

  async function writeLinkedIssues(threadId: string, links: ThreadLink[] | null): Promise<void> {
    if (links === null) {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        remove: [LINK_METADATA_KEY],
      });
      return;
    }
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      set: { [LINK_METADATA_KEY]: links },
    });
  }

  async function publishLinksChanged(threadIds: string[]): Promise<void> {
    bb.realtime.publish(LINK_CHANGED, { threadIds });
  }

  /**
   * Resolve the repo slug a link targets: an explicit `owner/repo` argument
   * wins, else the thread's project remote (fail loud when the project has
   * no GitHub remote — never link against a guessed repo).
   */
  async function resolveLinkRepo(threadId: string, repoArg: string | undefined): Promise<string> {
    if (repoArg !== undefined) return repoArg;
    const thread = await bb.sdk.threads.get({ threadId });
    const project = await bb.sdk.projects.get({
      projectId: thread.projectId,
    });
    const slug = resolveRepoSlug(project.gitRemoteUrl);
    if (slug === null) {
      throw new PluginCliError(
        `cannot resolve a GitHub repo for thread ${threadId}`,
        {
          code: "invalid_value",
          hint: `Project ${project.name} has no GitHub remote. Pass --repo owner/repo explicitly.`,
        },
      );
    }
    return slug;
  }

  /**
   * Legacy KV "done-thread-ids" held either a plain string[] (main's
   * original shape) or a per-thread record map with epoch-ms doneAt and an
   * optional keep flag (the sweep sibling's stopgap). Import both into
   * per-thread metadata, then delete the key: metadata is the only store
   * from here on. Checks each thread's existing record first, so a
   * partial import converges on the next read and the key is deleted only
   * once every entry is imported. Runs before both done_list and done_set:
   * a done=false written while the legacy value is still present must not
   * be resurrected by a later import.
   */
  async function importLegacyDone(): Promise<void> {
    const legacy: unknown = await bb.storage.kv.get(LEGACY_DONE_KEY);
    if (legacy === undefined || legacy === null) return;
    const keepFlag = (keep: unknown) =>
      typeof keep === "boolean" && keep ? { keep: true } : {};
    if (Array.isArray(legacy)) {
      // Main's shape: bare thread ids with no age data — stamp at import.
      const iso = new Date().toISOString();
      for (const id of legacy) {
        if (typeof id !== "string") {
          throw new Error(`legacy done ids: non-string entry ${JSON.stringify(id)}`);
        }
        await importOne(id, { doneAt: iso });
      }
    } else if (typeof legacy === "object") {
      // Sweep sibling's shape: record map with epoch-ms doneAt, keep flag.
      for (const [threadId, entry] of Object.entries(
        legacy as Record<string, unknown>,
      )) {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
          throw new Error(
            `legacy done records: malformed entry for ${JSON.stringify(threadId)}`,
          );
        }
        const record = entry as { doneAt?: unknown; keep?: unknown };
        if (
          !(
            (typeof record.doneAt === "number" &&
              Number.isFinite(record.doneAt)) ||
            (typeof record.doneAt === "string" &&
              !Number.isNaN(Date.parse(record.doneAt)))
          )
        ) {
          throw new Error(
            `legacy done records: invalid doneAt for ${JSON.stringify(threadId)}: ${JSON.stringify(record.doneAt)}`,
          );
        }
        const imported: DoneRecord =
          typeof record.doneAt === "number"
            ? {
                doneAt: new Date(record.doneAt).toISOString(),
                ...keepFlag(record.keep),
              }
            : // Epoch-free shape already; keep the ISO string as written,
              // carry keep only when true (DoneRecord's optional keep).
              { doneAt: record.doneAt, ...keepFlag(record.keep) };
        await importOne(threadId, imported);
      }
    } else {
      throw new Error(
        `legacy done store: unexpected shape ${JSON.stringify(legacy)}`,
      );
    }
    await bb.storage.kv.delete(LEGACY_DONE_KEY);
  }

  async function importOne(threadId: string, record: DoneRecord): Promise<void> {
    const existing = await readDoneRecord(threadId);
    if (existing !== null) {
      // Idempotent: never clobber live state; make sure the index knows.
      await addToDoneIndex(threadId);
      return;
    }
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      set: { [DONE_METADATA_KEY]: record },
    });
    await addToDoneIndex(threadId);
  }

  async function listDoneRecords(): Promise<{
    doneIds: string[];
    records: Record<string, { doneAt?: string; keep?: boolean }>;
  }> {
    await importLegacyDone();
    const live = await bb.sdk.threads.list({});
    const doneIds: string[] = [];
    const records: Record<string, { doneAt?: string; keep?: boolean }> = {};
    for (const thread of live) {
      const record = await readDoneRecord(thread.id);
      if (record !== null) {
        doneIds.push(thread.id);
        records[thread.id] = record;
      }
    }
    return { doneIds: doneIds.sort(), records };
  }

  async function readKept(): Promise<KeepStore> {
    const raw: unknown = await bb.storage.kv.get<unknown>(KEEP_KEY);
    const kept = keptFromRow(raw);
    if (kept === null) {
      if (raw !== null && raw !== undefined) {
        bb.log.warn(`Sweep keep store under "${KEEP_KEY}" failed validation; resetting to empty.`);
      }
      return {};
    }
    return kept;
  }

  async function writeKept(store: KeepStore): Promise<void> {
    // Persist the exact row shape readKept validates, so a written row
    // round-trips instead of failing validation and being wiped.
    await bb.storage.kv.set(KEEP_KEY, keepRowFromStore(store));
  }

  async function readRanks(): Promise<RankStore> {
    return parseRankStore(await bb.storage.kv.get<unknown>(RANK_KV_KEY));
  }

  async function writeRanks(store: RankStore): Promise<void> {
    await bb.storage.kv.set(RANK_KV_KEY, rankRowFromStore(store));
  }

  /**
   * Rank writes are read-merge-write cycles over one KV row, and the SDK's
   * KV has no compare-and-swap: two moves interleaving between a read and
   * its write let the stale spread revert the other writer's column (a
   * pinned write came back undone under a gated interleave — proven red by
   * tests/rank-concurrent.test.ts before the lock existed). Every cycle
   * therefore runs serialized on this in-process queue: all rank writers
   * are board RPCs in this one server process, and the CLI never writes
   * ranks. The queue never rejects, so one failed move cannot wedge the
   * writers behind it.
   */
  let rankWriteChain: Promise<unknown> = Promise.resolve();
  function withRankWriteLock<T>(task: () => Promise<T>): Promise<T> {
    const run = rankWriteChain.then(task, task);
    rankWriteChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // --- Snooze: read now, unread later (docs/plans/2026-10-02-snooze.md) ---
  //
  // The record rides per-thread plugin metadata (key "snooze"), the same
  // store the Done and pin-park records use. The WAKE is the server's own
  // job: a setTimeout per snoozed thread re-checked against the fresh
  // record at fire time, re-armed at plugin load so a daemon restart
  // catches misses, and cleared on dispose. The wake itself is mark-unread
  // through bb's own write — every open board sees the resulting
  // read-state-changed event and applies its existing unread state truth
  // (parked pin returns, Done un-does) without any snooze-specific code.

  async function readSnoozeRecord(
    threadId: string,
  ): Promise<SnoozeRecord | null> {
    // Same cast contract as readDoneRecord above: getPluginMetadata returns
    // an untyped namespace record; parseSnoozeRecord validates the shape.
    const namespace = await bb.sdk.threads.getPluginMetadata({ threadId });
    const value = (namespace as Record<string, JsonValue>)[SNOOZE_METADATA_KEY];
    return parseSnoozeRecord(value);
  }

  /** Node's setTimeout ceiling (~24.8 days in ms); longer wakes re-arm. */
  const MAX_WAKE_TIMEOUT_MS = 0x7fffffff;

  const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Kill a thread's pending wake timer, if any (clear is the only killer). */
  function clearWakeTimer(threadId: string): void {
    const timer = wakeTimers.get(threadId);
    if (timer === undefined) return;
    clearTimeout(timer);
    wakeTimers.delete(threadId);
  }

  /**
   * The wake itself. Guards in order: the record must still exist (a
   * clear or a newer set owns this timer slot otherwise) and must still
   * carry THIS wake time (a re-snooze leaves the replaced timer stale
   * until its tick no-ops). A thread genuinely read since the snooze began
   * — "read" strictly later than the mark the set gesture itself caused —
   * consumes the snooze quietly: a reminder the operator already visited
   * must not re-alert them. A thread the SDK cannot resolve is treated the
   * same way (record drop, no unread mark).
   */
  async function fireWake(threadId: string, wakeAtMs: number): Promise<void> {
    // Self-catching end-to-end (audit 2026-10-05 finding 1): this runs on
    // setTimeout inside the bb server process, so any rejection here — a
    // record corrupted between read and wake, a failed metadata remove —
    // must land in the log, never as an unhandled rejection. The record
    // is left in place on failure: corrupt state stays fail-loud (the
    // board's snooze_list surfaces it), never coerced into silence.
    try {
      const record = await readSnoozeRecord(threadId);
      if (record === null) return; // cleared: nothing to wake
      const stamp = snoozeWakeAtMs(record);
      if (stamp === null || stamp !== wakeAtMs) return; // replaced; newer arm owns it
      let readSinceSet = false;
      let threadResolvable = true;
      try {
        const row = await bb.sdk.threads.get({ threadId });
        const lastReadAt = row.lastReadAt;
        readSinceSet = lastReadAt !== null && lastReadAt > Date.parse(record.setAt);
      } catch {
        threadResolvable = false;
      }
      if (!readSinceSet && threadResolvable) {
        try {
          await bb.sdk.threads.markUnread({ threadId });
        } catch (error) {
          // The unread write is the feature; failing it is logged, not
          // swallowed — but the snooze still consumed (no retry loop), so
          // the board at least stops dimming and the record cannot haunt
          // a later session.
          bb.log.warn(
            `snooze wake: markUnread failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        remove: [SNOOZE_METADATA_KEY],
      });
      bb.realtime.publish(SNOOZE_CHANGED, { threadId });
    } catch (error) {
      bb.log.warn(
        `snooze wake: failed for ${threadId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Arm (or replace) a thread's wake. A due-now wake fires with no timer
   * slot at all; a longer-than-ceiling wake sleeps full slots and re-arms
   * until the target is reachable. Every timer slot re-checks the fresh
   * record before acting, so a stale slot is always a no-op.
   */
  function armWakeAt(threadId: string, wakeAtMs: number): void {
    clearWakeTimer(threadId);
    const lag = wakeAtMs - Date.now();
    if (lag <= 0) {
      void fireWake(threadId, wakeAtMs);
      return;
    }
    const tick = (): void => {
      const remaining = wakeAtMs - Date.now();
      if (remaining > MAX_WAKE_TIMEOUT_MS) {
        // Longer than a slot can hold: sleep the slot and re-arm.
        wakeTimers.set(threadId, setTimeout(tick, MAX_WAKE_TIMEOUT_MS));
        return;
      }
      wakeTimers.delete(threadId);
      void fireWake(threadId, wakeAtMs);
    };
    wakeTimers.set(
      threadId,
      setTimeout(tick, Math.min(lag, MAX_WAKE_TIMEOUT_MS)),
    );
  }

  /**
   * Snooze a thread until wakeAt: mark read NOW (the card stops shouting),
   * stamp the record with setAt anchored at the read mark itself — the one
   * instant the wake's read-detection can compare against without racing
   * this gesture's own write — arm the wake, publish, return the record.
   * When the SDK cannot confirm the read mark, the wall clock remains the
   * anchor (it is strictly after the mark, so the wake comparison stays safe).
   */
  async function writeSnooze(
    threadId: string,
    wakeAt: Date,
  ): Promise<SnoozeRecord> {
    let anchor = new Date();
    try {
      await bb.sdk.threads.markRead({ threadId });
      const row = await bb.sdk.threads.get({ threadId });
      if (row.lastReadAt !== null) anchor = new Date(row.lastReadAt);
    } catch {
      // Best-effort anchoring; the record write below is the loud part.
    }
    const record = stampSnooze(anchor, wakeAt);
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      set: { [SNOOZE_METADATA_KEY]: record },
    });
    armWakeAt(threadId, wakeAt.getTime());
    bb.realtime.publish(SNOOZE_CHANGED, { threadId });
    return record;
  }

  /** Clear a snooze (idempotent): record gone, timer dead, signal out. */
  async function clearSnooze(threadId: string): Promise<boolean> {
    const existing = await readSnoozeRecord(threadId);
    if (existing === null) return false;
    await bb.sdk.threads.updatePluginMetadata({
      threadId,
      remove: [SNOOZE_METADATA_KEY],
    });
    clearWakeTimer(threadId);
    bb.realtime.publish(SNOOZE_CHANGED, { threadId });
    return true;
  }

  /**
   * The load-time wake scan: arm every snoozed live thread; past-due
   * records fire immediately ("arm" with lag ≤ 0 is a direct fire). Best-
   * effort with a log line, so one corrupted thread's record scan failure
   * cannot take the plugin down at load — the records themselves still
   * parse fail-loud per thread, and one corrupt row is skipped with a
   * warn (audit 2026-10-05 finding 2): it can never strand the wake set
   * behind it.
   */
  async function armAllSnoozes(): Promise<void> {
    const rows = await bb.sdk.threads.list({});
    for (const row of rows) {
      try {
        const record = await readSnoozeRecord(row.id);
        if (record === null) continue;
        const wakeAtMs = snoozeWakeAtMs(record);
        if (wakeAtMs === null) continue; // Unparseable stamps never wake.
        armWakeAt(row.id, wakeAtMs);
      } catch (error) {
        bb.log.warn(
          `snooze wake scan: skipping ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // ---- ✨ auto-rename's thread-model probe (useThreadModel path) ----
  // bb exposes no direct completion API for a thread's model; the route is
  // a hidden probe thread the plugin spawns on the same provider/model pair
  // (cloned with explicit provenance so bb actually honors it), reads the
  // reply off the timeline, and deletes. Helpers live here in `bb` scope.

  const PROBE_POLL_MS = 1000;
  // 120s: an acp-opencode provider turn can cold-start past 45s (observed
  // live — the earlier cap turned healthy probes into timeouts).
  const PROBE_TIMEOUT_MS = 120_000;

  const probeDelay = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // ---- ✨ bridge classification (thread_autotitle_services) ----
  // Only plugins implementing a `complete` RPC method can serve the ✨ at
  // all (the openrouter-inference fork does; bb's builtin cloud and
  // provider-codex do not — ready-but-unbridged services 404 on pick, the
  // "errors on all providers" shape). The capability probe calls `complete`
  // with a deliberately invalid prompt: without the method bb answers 404;
  // with it, the target contract's own validation rejects the input — and a
  // non-string prompt can never reach a model, so the probe is free.
  const BRIDGE_TTL_MS = 60_000;
  const bridgeStatus = new Map<string, { at: number; ok: boolean; reason: string | null }>();

  async function probeCompleteBridge(
    pluginId: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    try {
      await bb.sdk.plugins.callRpc({
        pluginId,
        method: "complete",
        input: { prompt: 1 } as never,
        outputSchema: z.object({ text: z.string() }).passthrough(),
        signal: AbortSignal.timeout(5_000),
      });
      return { ok: true, reason: null };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // This exact shape is what bb answers for a method the plugin lacks;
      // anything else is the target contract refusing the bad prompt —
      // proof the method exists.
      if (/no rpc method|\b404\b|not found/i.test(message)) {
        return {
          ok: false,
          reason: `${pluginId} does not expose the complete bridge focus-board calls (only plugins implementing one can serve the ✨)`,
        };
      }
      return { ok: true, reason: null };
    }
  }

  async function serviceBridgeState(
    pluginId: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    const cached = bridgeStatus.get(pluginId);
    if (cached !== undefined && Date.now() - cached.at < BRIDGE_TTL_MS) {
      return cached;
    }
    const fresh = await probeCompleteBridge(pluginId);
    bridgeStatus.set(pluginId, { at: Date.now(), ...fresh });
    return fresh;
  }

  /**
   * How a title probe spawns, in a 2-tier fallback chain — bb's
   * defaultExecutionOptions can return null live (its route fails
   * capability validation on empty input) even for threads that run fine,
   * so the chain keeps the probe meaningful:
   * 1. a resolved provider/model pair → clone both explicitly;
   * 2. nothing → a plain hidden child inherits bb's own spawn default
   *    chain (project remembered default → global), exactly what a new
   *    thread in the project gets.
   *
   * The old middle tier cloned the providerId alone, letting bb resolve
   * the model against the provider's catalog default — which here is an
   * openrouter model, the metered fall-through the metered gate had to
   * reject live (409 on a vikunja-pwa-fork title probe). Inheriting rides
   * the same core-resolved chain any new thread gets, so the probe never
   * lands on a catalog default the project's remembered default would
   * have avoided.
   */
  type ProbeSpawnPlan =
    | { spawnable: true; kind: "pair"; providerId: string; model: string }
    | { spawnable: true; kind: "inherit" }
    | { spawnable: false; reason: string };

  /**
   * The source thread row the plan carries back with it: `projectId` gates
   * the inherit tier, and `environmentId` rides along because both callers
   * need it for the spawn (the probe reuses the source thread's
   * environment) — so the callers never re-fetch the row themselves.
   */
  type ProbeSourceRow = {
    projectId?: unknown;
    environmentId?: unknown;
  };

  async function probeSpawnPlan(
    threadId: string,
  ): Promise<{ plan: ProbeSpawnPlan; source: ProbeSourceRow }> {
    const execution = (await bb.sdk.threads.defaultExecutionOptions({
      threadId,
    })) as unknown as { providerId?: unknown; model?: unknown } | null;
    // The single source-row fetch per probe invocation: every tier returns
    // it alongside the plan so callers validate/spawn from this one read.
    const source = (await bb.sdk.threads.get({ threadId })) as unknown as ProbeSourceRow;
    if (
      execution !== null &&
      typeof execution.providerId === "string" &&
      typeof execution.model === "string"
    ) {
      return {
        plan: {
          spawnable: true,
          kind: "pair",
          providerId: execution.providerId,
          model: execution.model,
        },
        source,
      };
    }
    if (typeof source?.projectId === "string") {
      return { plan: { spawnable: true, kind: "inherit" }, source };
    }
    return {
      plan: {
        spawnable: false,
        reason:
          "This thread has no resolved provider/model and no project to inherit a default model from",
      },
      source,
    };
  }

  /**
   * The thread's ORIGINATING prompt, the input the title should summarize.
   * Two live-found reasons make prompt history the FALLBACK, not the
   * source: bb's history carries composer turns only (spawn inputs never
   * land there) and pages newest-first. The source thread's timeline's
   * oldest user conversation row is the honest first read — but bb serves
   * the timeline in segment windows (the newest first), so the read walks
   * the older cursors and only trusts the result when the walk reached the
   * thread's beginning; a capped walk that never reaches the bottom uses
   * the paged history instead (a mid-thread row would mislabel the task).
   */
  const ORIGINATING_PROMPT_MAX_PAGES = 40;
  async function threadOriginatingPrompt(threadId: string): Promise<string | null> {
    const collected: AutotitleTimelineRow[] = [];
    let cursor: { anchorId: string; anchorSeq: number } | null = null;
    let reachedBeginning = false;
    for (let page = 0; page < ORIGINATING_PROMPT_MAX_PAGES; page += 1) {
      const timeline = (await bb.sdk.threads.timeline({
        threadId,
        // bb's sequence-anchored first read: afterSequence "0" = events
        // strictly above 0 (the bound is a string, like limit). The
        // parameterless call serves bb's latest-rows cache — live it
        // returned only seq 9066-10188 of a 10k-sequence thread, putting
        // the user's newest message in "first".
        afterSequence: "0",
        ...(cursor === null
          ? {}
          : { beforeAnchorId: cursor.anchorId, beforeAnchorSeq: String(cursor.anchorSeq) }),
      })) as {
        rows?: unknown;
        timelinePage?: {
          hasOlderRows?: boolean;
          olderCursor?: { anchorId: string; anchorSeq: number } | null;
        } | null;
      };
      collected.push(...((timeline.rows ?? []) as AutotitleTimelineRow[]));
      const page1 = timeline.timelinePage;
      if (page1 === undefined || page1 === null) {
        reachedBeginning = true; // no pager info: treat the page as complete
        break;
      }
      if (page1.hasOlderRows === true && page1.olderCursor != null) {
        cursor = page1.olderCursor;
        continue;
      }
      reachedBeginning = true;
      break;
    }
    const fromTimeline = reachedBeginning
      ? firstUserPromptFromTimeline(collected)
      : null;
    if (fromTimeline !== null) return fromTimeline;
    const history = (await bb.sdk.threads.promptHistory({
      threadId,
      // bb pages prompt history newest-first and types limit as a string;
      // the default page drops the thread's originating prompt on long
      // threads, so ask big and sort oldest-first locally
      // (promptTextFromHistory does).
      limit: "200",
    })) as unknown as readonly AutotitleHistoryEntry[];
    return promptTextFromHistory(history);
  }

  /** Can this thread's own model generate a title? Used by the fallback modal's menu. */
  async function threadModelAvailability(
    threadId: string,
  ): Promise<{ available: boolean; reason: string | null }> {
    try {
      const { plan, source } = await probeSpawnPlan(threadId);
      if (!plan.spawnable) return { available: false, reason: plan.reason };
      if (typeof source?.projectId !== "string") {
        return {
          available: false,
          reason: "This thread has no project to spawn a title probe into",
        };
      }
      if (typeof source?.environmentId !== "string") {
        return {
          available: false,
          reason: "This thread has no environment to spawn a title probe into",
        };
      }
      return { available: true, reason: null };
    } catch (error: unknown) {
      return {
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a title with the source thread's own provider/model: spawn a
   * hidden probe thread in the same project/environment, wait for it to
   * settle, read the last assistant line off its timeline, clean it into a
   * title. The probe is always deleted — best-effort, a delete failure is
   * only logged so it can never fail the rename itself.
   */
  async function probeThreadModelTitle(threadId: string): Promise<string> {
    const { plan, source } = await probeSpawnPlan(threadId);
    if (!plan.spawnable) {
      throw new Error(`thread_autotitle: ${plan.reason}`);
    }
    if (typeof source?.projectId !== "string") {
      throw new Error(
        `thread_autotitle: thread ${threadId} has no project to spawn a title probe into`,
      );
    }
    if (typeof source?.environmentId !== "string") {
      throw new Error(
        `thread_autotitle: thread ${threadId} has no environment to spawn a title probe into`,
      );
    }
    const threadPrompt = await threadOriginatingPrompt(threadId);
    if (threadPrompt === null) {
      throw new Error(
        `thread_autotitle: thread ${threadId} has no prompt text to title from`,
      );
    }
    // Per-tier spawn args: the pair clones both fields explicitly, the
    // inherit tier passes nothing and rides bb's own spawn default chain.
    const executionArgs: Record<string, unknown> =
      plan.kind === "pair"
        ? {
            providerId: plan.providerId,
            model: plan.model,
            executionInputSources: { providerId: "explicit", model: "explicit" },
          }
        : {};
    const execution =
      plan.kind === "pair"
        ? { providerId: plan.providerId, model: plan.model }
        : { providerId: "bb default chain", model: "bb default chain" };
    // Security residual (audit 2026-10-05, finding 3): bb's spawn contract
    // has no tools-disabled or readonly option — CreateThreadRequest's
    // permissionMode union is accept-edits|auto|full|workspace-write — so
    // the "No tools" guardrail below is promptual only. The probe's payload
    // is untrusted thread content, and an instruction-ignoring model could
    // act with the environment's ordinary tool access. Accepted for 1.0:
    // the probe is hidden, deleted on every path, and capped at one turn.
    const probe = (await bb.sdk.threads.spawn({
      projectId: source.projectId,
      environment: {
        type: "reuse" as const,
        environmentId: source.environmentId,
      },
      ...executionArgs,
      visibility: "hidden",
      title: "✨ title probe (auto-deleted)",
      prompt: buildAutotitleProbePrompt(threadPrompt),
    })) as unknown as { id?: unknown };
    if (typeof probe?.id !== "string") {
      throw new Error(
        "thread_autotitle: failed to spawn the title probe thread",
      );
    }
    const probeId = probe.id;
    // A failing probe turn may still be mid-run; stopping first keeps the
    // delete from racing bb's own teardown.
    const stopProbe = async () => {
      try {
        await bb.sdk.threads.stop({ threadId: probeId });
      } catch (error: unknown) {
        bb.log.warn(
          `title probe stop failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    const deleteProbe = async () => {
      try {
        await bb.sdk.threads.delete({
          threadId: probeId,
          childThreadsConfirmed: true,
        });
      } catch (error: unknown) {
        bb.log.warn(
          `title probe delete failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    try {
      for (;;) {
        const row = (await bb.sdk.threads.get({
          threadId: probeId,
        })) as unknown as { status?: unknown };
        if (probeSettled(String(row?.status))) {
          if (row?.status !== "idle") {
            throw new Error(
              `thread_autotitle: the title probe turn failed on ${execution.providerId}/${execution.model}`,
            );
          }
          break;
        }
        if (Date.now() >= deadline) {
          throw new Error(
            `thread_autotitle: the title probe turn did not finish within ${PROBE_TIMEOUT_MS / 1000}s on ${execution.providerId}/${execution.model}`,
          );
        }
        await probeDelay(PROBE_POLL_MS);
      }
      const timeline = (await bb.sdk.threads.timeline({
        threadId: probeId,
      })) as unknown as { rows?: readonly AutotitleTimelineRow[] };
      const reply = assistantTextFromTimeline(timeline.rows ?? []);
      if (reply === null) {
        throw new Error(
          `thread_autotitle: the title probe wrote no assistant reply on ${execution.providerId}/${execution.model}`,
        );
      }
      const title = cleanGeneratedTitle(reply);
      if (title === null) {
        throw new Error(
          `thread_autotitle: the title probe reply had no usable title on ${execution.providerId}/${execution.model}`,
        );
      }
      return title;
    } catch (error: unknown) {
      // A failing turn may still be mid-run: stop it so the delete below
      // (finally) does not race bb's own teardown.
      await stopProbe();
      throw error;
    } finally {
      await deleteProbe();
    }
  }

  /**
   * The ✨ diagnostic menu the fallback modal serves (thread_autotitle_services)
   * and the autotitle CLI prints: the selection, every registered
   * thread-title service bridge-classified, and the thread's probe
   * availability. One builder so the modal and the CLI cannot drift.
   */
  async function autotitleServicesMenu(threadId: string) {
    const state = (await bb.sdk.system.aiServices()) as Parameters<
      typeof resolveTitleTarget
    >[0];
    const selected = resolveTitleSelection(state);
    const threadModel = await threadModelAvailability(threadId);
    return {
      selected: selected.ok
        ? { pluginId: selected.pluginId, serviceId: selected.serviceId }
        : null,
      services: await Promise.all(
        autotitleTargets(state).map(async (target) => {
          if (!target.ready) {
            // A not-ready service is already blocked by its own message;
            // no need to spend a probe on it.
            return { ...target, bridge: false, bridgeReason: null };
          }
          const bridge = await serviceBridgeState(target.pluginId);
          return { ...target, bridge: bridge.ok, bridgeReason: bridge.reason };
        }),
      ),
      threadModel,
    };
  }

  bb.rpc.register(rpcContract, {
    done_list: async () => {
      const [{ doneIds, records }, kept] = await Promise.all([
        listDoneRecords(),
        readKept(),
      ]);
      // Keep flags for threads never marked Done still ride to the client —
      // the idle arm honors them (the sweep's per-arm kept() lookups read
      // this one merged map).
      for (const id of Object.keys(kept)) {
        if (records[id] === undefined) records[id] = { keep: true };
        else records[id] = { ...records[id], keep: true };
      }
      return { doneIds, records };
    },
    done_set: async ({ threadId, done }) => {
      // Consume any legacy KV state before the first metadata write, or a
      // later import could resurrect state this write just changed.
      await importLegacyDone();
      await writeDoneRecord(threadId, done);
      bb.realtime.publish(DONE_CHANGED, { threadId, done });
      return { done };
    },
    link_list: async () => {
      // The live list only, like pin_parks_list: a link on an archived
      // thread has no chip to drive (the card is not on the board).
      const rows = await bb.sdk.threads.list({});
      const links: Record<string, ThreadLink[]> = {};
      for (const row of rows) {
        const record = await readLinkedIssues(row.id);
        if (record !== null && record.length > 0) links[row.id] = record;
      }
      return { links };
    },
    link_set: async ({ threadId, repo, number, kind, url, label, source }) => {
      const now = new Date();
      const ghItem = url === undefined ? null : parseGithubItemUrl(url);
      let link: ThreadLink;
      if (url !== undefined && ghItem === null) {
        // Non-GitHub https URL → external tracker item; the hostname derives
        // from the URL (never from caller input).
        link = makeExternalLink(url, label, source, now);
      } else {
        // GitHub item: URL form parsed above, number form resolved against
        // the thread's project remote (or the explicit repo).
        const resolved =
          ghItem !== null
            ? ghItem
            : {
                repo: await resolveLinkRepo(threadId, repo),
                issue: number!,
                kind: kind ?? "issue",
              };
        link = {
          tracker: "github",
          repo: resolved.repo,
          issue: resolved.issue,
          kind: resolved.kind,
          href: linkHref(resolved.repo, resolved.kind, resolved.issue),
          createdAt: now.toISOString(),
          source,
        };
      }
      await writeLinkedIssues(threadId, stampLinkedIssues(await readLinkedIssues(threadId), link));
      await publishLinksChanged([threadId]);
      return { threadId, link };
    },
    link_clear: async ({ threadId, number }) => {
      const existing = await readLinkedIssues(threadId);
      await writeLinkedIssues(threadId, clearLinkedIssues(existing, number));
      await publishLinksChanged([threadId]);
      return { threadId, cleared: true };
    },
    pin_parks_list: async () => {
      // The live list only: a park on an archived thread has no consumer —
      // un-archiving returns the thread through done state, not a pin — and
      // the SDK scan the done CLI lacks is not needed here.
      const rows = await bb.sdk.threads.list({});
      const parks: Record<string, PinParkRecord> = {};
      for (const row of rows) {
        const record = await readPinParkRecord(row.id);
        if (record !== null) parks[row.id] = record;
      }
      return { parks };
    },
    pin_park_set: async ({ threadId, parked }) => {
      await writePinPark(threadId, parked);
      return { threadId, parked };
    },
    snooze_list: async () => {
      // The live list only, like pin_parks_list: a snooze record on an
      // archived thread has no board consumer (snoozed cards never leave
      // their column), and the wake scan below reads the same list.
      const rows = await bb.sdk.threads.list({});
      const snoozes: Record<string, SnoozeRecord> = {};
      for (const row of rows) {
        const record = await readSnoozeRecord(row.id);
        if (record !== null) snoozes[row.id] = record;
      }
      return { snoozes };
    },
    snooze_set: async ({ threadId, wakeAt }) => {
      const wakeMs = Date.parse(wakeAt);
      if (wakeMs <= Date.now()) {
        throw new PluginCliError(
          `wake time must be in the future, got ${wakeAt}`,
          {
            code: "invalid_value",
            hint: "Give an epoch-parseable timestamp strictly later than now.",
          },
        );
      }
      const record = await writeSnooze(threadId, new Date(wakeMs));
      return { threadId, wakeAt: record.wakeAt };
    },
    snooze_clear: async ({ threadId }) => {
      const cleared = await clearSnooze(threadId);
      return { threadId, cleared };
    },
    thread_autotitle: async ({ threadId, pluginId, serviceId, useThreadModel }) => {
      if (
        useThreadModel === true &&
        (pluginId !== undefined || serviceId !== undefined)
      ) {
        throw new Error(
          "thread_autotitle: useThreadModel and a pluginId/serviceId override are mutually exclusive",
        );
      }
      if (useThreadModel === true) {
        return { title: await probeThreadModelTitle(threadId) };
      }
      const servicesState = (await bb.sdk.system.aiServices()) as Parameters<
        typeof resolveTitleTarget
      >[0];
      const resolved = resolveTitleTarget(
        servicesState,
        pluginId === undefined && serviceId === undefined
          ? undefined
          : { pluginId, serviceId },
      );
      // Selection reason (not set to a plugin service) or override refusal
      // (unregistered, wrong task, not ready) both fail loud with the fix.
      if (!resolved.ok) throw new Error(resolved.reason);
      const selection = resolved;
      const threadPrompt = await threadOriginatingPrompt(threadId);
      if (threadPrompt === null) {
        throw new Error(
          `thread_autotitle: thread ${threadId} has no prompt text to title from`,
        );
      }
      // Any plugin service bb routes titles to must answer the same shape;
      // this is the bridge method the openrouter-inference fork serves.
      const reply = (await bb.sdk.plugins.callRpc({
        pluginId: selection.pluginId,
        method: "complete",
        input: { prompt: buildAutotitlePrompt(threadPrompt) },
        outputSchema: z.object({ text: z.string() }).passthrough(),
        signal: AbortSignal.timeout(20_000),
      })) as { text?: unknown };
      if (typeof reply?.text !== "string") {
        throw new Error(
          `thread_autotitle: AI service ${selection.pluginId} returned no text reply`,
        );
      }
      const title = cleanGeneratedTitle(reply.text);
      if (title === null) {
        throw new Error(
          `thread_autotitle: AI service ${selection.pluginId} returned no usable title`,
        );
      }
      return { title };
    },
    thread_autotitle_services: async ({ threadId }) => autotitleServicesMenu(threadId),
    tracker_status: async ({ repo, numbers }) => {
      const home = process.env.HOME ?? "";
      if (home === "") return { statuses: {} };
      const statuses = readGitHubStatuses(`${home}/${GITHUB_CACHE_DB}`, repo, numbers, bb.log);
      return { statuses };
    },
    workspace_files_exist: async ({ threadId, paths }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      const environmentId = "environmentId" in thread ? thread.environmentId : null;
      if (environmentId === null) return { existence: {} };
      const environment = await bb.sdk.environments.get({ environmentId });
      const root = environment.path;
      // A workspaceless environment has no files to verify against.
      if (root === null) return { existence: {} };
      // Dedupe first, then re-validate the untrusted relative paths; the
      // ones that escape the workspace (absolute, `~`, `..` escapes) are
      // reported missing instead of stat-ed on the host.
      const unique = [...new Set(paths)];
      const relative: string[] = [];
      const absolute: string[] = [];
      for (const path of unique) {
        const resolved = resolveWithinRoot(root, path);
        if (resolved === null) continue;
        relative.push(path);
        absolute.push(resolved);
      }
      if (absolute.length === 0) return { existence: {} };
      // The check runs on the environment's own host, so workspaces on
      // other machines verify correctly too.
      const result = await bb.sdk.hosts.pathsExist({
        hostId: environment.hostId,
        paths: absolute,
      });
      const out: Record<string, boolean> = {};
      for (const [index, path] of relative.entries()) {
        const verdict = result.existence[absolute[index]];
        if (typeof verdict === "boolean") out[path] = verdict;
      }
      return { existence: out };
    },
    workspace_open_targets: async ({ threadId }) => {
      const state = await resolveThreadWorkspaceOpen(threadId);
      return state;
    },
    workspace_open_in_target: async ({ threadId, targetId }) => {
      const state = await resolveThreadWorkspaceOpen(threadId);
      if (
        state.status !== "available" ||
        state.root === null ||
        !state.targets.some((target) => target.id === targetId)
      ) {
        return {
          ok: false,
          message: state.reason ?? "This workspace cannot be opened here.",
        };
      }
      try {
        const daemon = await requireLocalDaemon();
        if (daemon === null) {
          return { ok: false, message: "Local host daemon is unavailable." };
        }
        await openWorkspaceInTarget(daemon.port, state.root, targetId, {
          fetchImpl: fetch,
          timeoutMs: 10_000,
        });
        return { ok: true, message: null };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    sweep_config_get: async () => {
      const values = await settings.get();
      return {
        doneArchiveMs: archiveThresholdMs(
          values.doneArchiveValue,
          ARCHIVE_UNIT_SCHEMA.parse(values.doneArchiveUnit),
        ),
        idleArchiveMs: archiveThresholdMs(
          values.idleArchiveValue,
          ARCHIVE_UNIT_SCHEMA.parse(values.idleArchiveUnit),
        ),
      };
    },
    sweep_keep_set: async ({ threadId, keep }) => {
      // The keep flag applies to BOTH sweep arms (Done and long-idle), so it
      // is stored independently of Done marks: a long-idle thread that was
      // never marked Done can be protected too.
      const kept = await readKept();
      if (keep) {
        if (kept[threadId] === true) return { threadId, keep };
        await writeKept({ ...kept, [threadId]: true });
      } else {
        if (kept[threadId] !== true) return { threadId, keep };
        const { [threadId]: _removed, ...rest } = kept;
        await writeKept(rest);
      }
      // Keep changes feed the same refetch signal the board already
      // subscribes to; payload consumers refetch, so done:false is a dummy.
      bb.realtime.publish(DONE_CHANGED, { threadId, done: false });
      return { threadId, keep };
    },
    rank_list: async () => {
      const store = await readRanks();
      return { orders: rankRowFromStore(store) };
    },
    thread_reparent: async ({ threadId, parentThreadId }) => {
      // Validate against fresh rows, not the board's map — a family some
      // other surface moved between the dragover and the drop must not get
      // a second write on top. (list({}) returns live rows; an archived id
      // reads as a missing one, which refuses too.)
      const rows = await bb.sdk.threads.list({});
      // list({}) returns live rows; archivedAt is the row's archive stamp.
      const live = rows.map((row) => ({
        id: row.id,
        parentThreadId: row.parentThreadId,
        isArchived: (row as { archivedAt?: number | null }).archivedAt != null,
      }));
      const refusal = reparentRefusal(live, threadId, parentThreadId);
      if (refusal !== null) throw new PluginCliError(refusal);
      await bb.sdk.threads.update({ threadId, parentThreadId });
      return { threadId, parentThreadId };
    },
    rank_move: ({ columnKey, threadId, beforeId, toEnd, visibleIds }) =>
      withRankWriteLock(async () => {
        const store = await readRanks();
        const current = orderForColumn(store, columnKey);
        const next = applyMoveVisible(
          current,
          visibleIds,
          threadId,
          beforeId,
          toEnd,
        );
        // Skip the write (and the refetch) when the move changes nothing, so
        // a drop that lands where the card already sits is a no-op everywhere.
        if (next.join("\u0000") !== current.join("\u0000")) {
          await writeRanks({ ...store, [columnKey]: next });
          bb.realtime.publish(RANK_CHANGED, { columnKey });
        }
        return { columnKey, order: next };
      }),
  });

  // --- CLI: bb focus-board ---
  //
  // Manages plugin-owned state only (the standing rule from the CLI
  // musing): done list/mark/clear over the board's own metadata, the
  // sweep over the board's own eligibility rules and settings, and the
  // threshold config. It never re-spells `bb thread` commands.

  const settingsKeys = [
    "doneArchiveValue",
    "doneArchiveUnit",
    "idleArchiveValue",
    "idleArchiveUnit",
  ] as const;
  /** Count caps mirror the descriptor schemas (in the configured unit). */
  const settingsCaps = {
    doneArchiveValue: 365,
    idleArchiveValue: 3650,
  } as const;

  /** The SDK's thread row shape, as returned by `threads.list`. */
  type ThreadRow = Awaited<ReturnType<typeof bb.sdk.threads.list>>[number];

  /**
   * Every thread the board can currently see: the live list plus the
   * archived list. Ids from the board's own done index whose threads are
   * gone from both (deleted) round out the candidate set so `done list`
   * still reports their surviving marks.
   */
  async function listCandidateThreads(): Promise<{
    rows: ThreadRow[];
    liveIds: Set<string>;
  }> {
    const [live, archivedRows] = await Promise.all([
      bb.sdk.threads.list({}),
      bb.sdk.threads.list({ archived: true, limit: 200 }),
    ]);
    const byId = new Map<string, ThreadRow>();
    for (const thread of [...live, ...archivedRows]) byId.set(thread.id, thread);
    const liveIds = new Set(live.map((thread) => thread.id));
    return { rows: [...byId.values()], liveIds };
  }

  /** Index ids whose Done marks the live/archived lists cannot show. */
  async function listIndexOnlyIds(): Promise<string[]> {
    const [candidates, indexIds] = await Promise.all([
      listCandidateThreads(),
      readDoneIndex(),
    ]);
    const known = new Set(candidates.rows.map((row) => row.id));
    return indexIds.filter((id) => !known.has(id));
  }

  const doneList = cliCommand({
    summary: "List threads marked Done in the board's own metadata",
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(_input) {
      await importLegacyDone();
      const { rows: candidates, liveIds } = await listCandidateThreads();
      const kept = await readKept();
      const seen = new Set<string>();
      const records: Array<{
        id: string;
        title: string | null;
        doneAt: string;
        keep: boolean;
        inLiveList: boolean;
      }> = [];
      // Live + archived threads first, then the board's index-only ids
      // (threads deleted since their mark): the index is the only way to
      // see those, because the SDK has no metadata scan.
      for (const thread of candidates) {
        seen.add(thread.id);
        const record = await readDoneRecord(thread.id);
        if (record === null) continue;
        records.push({
          id: thread.id,
          title: thread.title ?? thread.titleFallback,
          doneAt: record.doneAt,
          keep: record.keep === true || kept[thread.id] === true,
          inLiveList: liveIds.has(thread.id),
        });
      }
      for (const threadId of await listIndexOnlyIds()) {
        if (seen.has(threadId)) continue;
        seen.add(threadId);
        const record = await readDoneRecord(threadId);
        if (record === null) continue;
        records.push({
          id: threadId,
          title: null,
          doneAt: record.doneAt,
          keep: record.keep === true || kept[threadId] === true,
          inLiveList: false,
        });
      }
      const stdout = _input.options.json
        ? JSON.stringify(records, null, 2) + "\n"
        : records.length === 0
          ? "No threads are marked Done.\n"
          : records
              .map((row) => {
                const flags = [
                  row.keep ? "keep" : null,
                  row.inLiveList ? null : "not in the live thread list",
                ]
                  .filter((flag) => flag !== null)
                  .join(", ");
                const suffix = flags.length > 0 ? ` (${flags})` : "";
                return `${row.id}\t${row.doneAt}\t${row.title ?? "(untitled)"}${suffix}`;
              })
              .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  const doneMark = cliCommand({
    summary: "Mark threads Done (stamps doneAt, idempotent)",
    positionals: [
      {
        name: "thread-id",
        description: "Thread id(s) to mark Done",
        required: true,
        variadic: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      await importLegacyDone();
      const marked: string[] = [];
      for (const threadId of input.positionals["thread-id"]) {
        await writeDoneRecord(threadId, true);
        bb.realtime.publish(DONE_CHANGED, { threadId, done: true });
        marked.push(threadId);
      }
      const stdout = input.options.json
        ? JSON.stringify({ marked }, null, 2) + "\n"
        : marked.map((id) => `marked ${id}`).join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  const doneClear = cliCommand({
    summary: "Clear the Done mark from threads (idempotent)",
    description:
      "Clearing the Done mark does not touch the sweep keep flag; a kept thread stays kept until 'Allow sweep' clears it.",
    positionals: [
      {
        name: "thread-id",
        description: "Thread id(s) to clear",
        required: true,
        variadic: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      await importLegacyDone();
      const cleared: string[] = [];
      for (const threadId of input.positionals["thread-id"]) {
        await writeDoneRecord(threadId, false);
        bb.realtime.publish(DONE_CHANGED, { threadId, done: false });
        cleared.push(threadId);
      }
      const stdout = input.options.json
        ? JSON.stringify({ cleared }, null, 2) + "\n"
        : cleared.map((id) => `cleared ${id}`).join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  // Board-linked GitHub items: list/set/clear over the linkedIssues
  // metadata key. The CLI is the operator's fallback when no agent tool is
  // in the session (issue #13's repro had no agent-side surface at all).
  const linkList = cliCommand({
    summary: "List threads with linked tracker items (GitHub issues/PRs, externals)",
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(_input) {
      const { rows: candidates } = await listCandidateThreads();
      const rows: Array<{
        id: string;
        title: string | null;
        links: ThreadLink[];
      }> = [];
      for (const thread of candidates) {
        const links = await readLinkedIssues(thread.id);
        if (links === null || links.length === 0) continue;
        rows.push({
          id: thread.id,
          title: thread.title ?? thread.titleFallback,
          links,
        });
      }
      const stdout = _input.options.json
        ? JSON.stringify(rows, null, 2) + "\n"
        : rows.length === 0
          ? "No threads carry linked tracker items.\n"
          : rows
              .map(
                (row) =>
                  `${row.id}\t${row.links
                    .map((link) =>
                      link.tracker === "external"
                        ? `${link.label ?? link.hostname} (${link.url})`
                        : `${link.repo}#${link.issue}${link.kind === "pull" ? " (pull)" : ""}`,
                    )
                    .join(", ")}\t${row.title ?? "(untitled)"}`,
              )
              .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  const linkSet = cliCommand({
    summary: "Link a thread to a tracker item (GitHub issue/PR, or any https URL)",
    description:
      "Give a full GitHub issue/PR URL (status dot included), a bare number (resolved against the thread's project remote, or an explicit --repo owner/repo; --pull marks a pull request), or any other https URL (external tracker item; --label sets the chip text).",
    positionals: [
      {
        name: "thread-id",
        description: "Thread to link",
        required: true,
      },
      {
        name: "number-or-url",
        description: "GitHub issue/PR URL, a bare issue number, or any https URL",
        required: true,
      },
    ],
    options: {
      repo: {
        type: "string",
        description: "Explicit owner/repo slug (bare-number form only)",
      },
      pull: {
        type: "boolean",
        description: "The number is a pull request, not an issue",
      },
      label: {
        type: "string",
        description: "Chip text for an external URL link (1-80 chars)",
      },
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const [threadId, target] = [
        input.positionals["thread-id"] as string,
        input.positionals["number-or-url"] as string,
      ];
      const now = new Date();
      const ghParsed = parseGithubItemUrl(target);
      let link: ThreadLink;
      if (ghParsed !== null) {
        link = {
          tracker: "github",
          repo: ghParsed.repo,
          issue: ghParsed.issue,
          kind: ghParsed.kind,
          href: linkHref(ghParsed.repo, ghParsed.kind, ghParsed.issue),
          createdAt: now.toISOString(),
          source: "operator",
        };
      } else if (/^https:\/\//.test(target)) {
        link = makeExternalLink(target, input.options.label, "operator", now);
      } else {
        const number = Number(/^#?(\d+)$/.exec(target)?.[1]);
        if (!(Number.isInteger(number) && number > 0)) {
          throw new PluginCliError(`invalid issue, PR, or URL '${target}'`, {
            code: "invalid_value",
            hint: "Pass a full https URL, or a positive integer (#12 or 12).",
          });
        }
        const repo = await resolveLinkRepo(threadId, input.options.repo);
        const kind = input.options.pull === true ? "pull" : "issue";
        link = {
          tracker: "github",
          repo,
          issue: number,
          kind,
          href: linkHref(repo, kind, number),
          createdAt: now.toISOString(),
          source: "operator",
        };
      }
      await writeLinkedIssues(
        threadId,
        stampLinkedIssues(await readLinkedIssues(threadId), link),
      );
      await publishLinksChanged([threadId]);
      const stdout = input.options.json
        ? JSON.stringify({ threadId, link }, null, 2) + "\n"
        : `linked ${threadId} → ${link.tracker === "external" ? link.url : linkHref(link.repo, link.kind, link.issue)}\n`;
      return { exitCode: 0, stdout };
    },
  });

  const linkClear = cliCommand({
    summary: "Clear a thread's linked GitHub issues/PRs",
    description:
      "With issue/PR numbers, clears exactly those links; without, clears every link on the thread. Idempotent either way.",
    positionals: [
      {
        name: "thread-id",
        description: "Thread to unlink",
        required: true,
      },
      {
        name: "number",
        description: "Issue/PR numbers to clear (all links when omitted)",
        variadic: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const threadId = input.positionals["thread-id"] as string;
      const numbers = (input.positionals["number"] ?? []).map((raw) => {
        const parsed = Number(/^#?(\d+)$/.exec(raw)?.[1]);
        if (!(Number.isInteger(parsed) && parsed > 0)) {
          throw new PluginCliError(`invalid issue or PR '${raw}'`, {
            code: "invalid_value",
            hint: "Pass positive integers (#12 or 12), or none to clear everything.",
          });
        }
        return parsed;
      });
      let links = await readLinkedIssues(threadId);
      if (numbers.length === 0) {
        links = null;
      } else {
        for (const number of numbers) links = clearLinkedIssues(links, number);
      }
      await writeLinkedIssues(threadId, links);
      await publishLinksChanged([threadId]);
      const stdout = input.options.json
        ? JSON.stringify({ threadId, cleared: numbers }, null, 2) + "\n"
        : `cleared links on ${threadId}\n`;
      return { exitCode: 0, stdout };
    },
  });

  const sweep = cliCommand({
    summary:
      "Show (or with --confirm, sweep) Done-past-threshold and long-idle threads",
    description:
      "Without --confirm this is a dry-run: it prints the eligible set and exits 1 without touching anything. With --confirm, Done-past-threshold threads are archived and long-idle threads are marked Done (the fresh doneAt stamp starts the Done arm's archive clock, so a swept idle thread resurfaces in the Done sweep).",
    options: {
      confirm: {
        type: "boolean",
        description:
          "Sweep the resolved eligible set: archive Done threads, mark long-idle threads Done",
      },
      ids: {
        type: "string",
        repeatable: true,
        split: ",",
        description:
          "Restrict the sweep to these thread ids (frozen-list semantics)",
      },
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      await importLegacyDone();
      const confirm = input.options.confirm === true;
      const ids = input.options.ids ?? [];
      const values = await settings.get();
      const thresholds = {
        doneArchiveMs: archiveThresholdMs(
          values.doneArchiveValue,
          ARCHIVE_UNIT_SCHEMA.parse(values.doneArchiveUnit),
        ),
        idleArchiveMs: archiveThresholdMs(
          values.idleArchiveValue,
          ARCHIVE_UNIT_SCHEMA.parse(values.idleArchiveUnit),
        ),
      };
      const { rows: candidates, liveIds } = await listCandidateThreads();
      const byId = new Map(candidates.map((row) => [row.id, row]));
      const kept = await readKept();

      // Sweep-family contract: a live (non-archived) thread row that names a
      // parent makes that parent never sweep-eligible, in either arm.
      const liveChildParentIds = new Set<string>();
      for (const row of candidates) {
        if (row.archivedAt === null && row.parentThreadId !== null && liveIds.has(row.id)) {
          liveChildParentIds.add(row.parentThreadId);
        }
      }

      const facts: SweepFact[] = await Promise.all(
        candidates.map(async (thread) => {
          const record = await readDoneRecord(thread.id);
          const snoozeRecord = await readSnoozeRecord(thread.id);
          return {
            id: thread.id,
            archived: thread.archivedAt !== null,
            pinned: thread.pinnedAt !== null,
            updatedAt: thread.updatedAt,
            doneAt:
              record === null
                ? null
                : doneAtToEpochMs(record.doneAt),
            keep: record?.keep === true || kept[thread.id] === true,
            snoozed: snoozeRecord !== null,
            status: thread.status,
            unread:
              thread.lastReadAt === null
                ? thread.latestAttentionAt > 0
                : thread.latestAttentionAt > thread.lastReadAt,
            hasLiveChildren: liveChildParentIds.has(thread.id),
          };
        }),
      );
      let eligible = sweepCliEligible(facts, thresholds, Date.now());
      if (ids.length > 0) {
        const idSet = new Set(ids);
        if (confirm) {
          // Frozen-list semantics: archive exactly the named ids that are
          // still live, even if they are not otherwise eligible, and never
          // archive anything else.
          eligible = facts
            .filter((fact) => idSet.has(fact.id) && !fact.archived)
            .map((fact) => ({
              id: fact.id,
              reason: fact.doneAt !== null ? ("done" as const) : ("idle" as const),
            }));
        } else {
          eligible = eligible.filter((entry) => idSet.has(entry.id));
        }
      }

      const describe = (entry: SweepEligible): string =>
        entry.reason === "done"
          ? `done longer than ${values.doneArchiveValue} ${values.doneArchiveUnit}`
          : `idle longer than ${values.idleArchiveValue} ${values.idleArchiveUnit}`;
      const titleOf = (id: string): string | null => {
        const thread = byId.get(id);
        return thread?.title ?? thread?.titleFallback ?? null;
      };

      if (!confirm) {
        const lines = eligible.map(
          (entry) =>
            `${entry.id}\t${describe(entry)}\t${titleOf(entry.id) ?? "(untitled)"}`,
        );
        const stdout = input.options.json
          ? JSON.stringify(
              {
                eligible: eligible.map((entry) => ({
                  id: entry.id,
                  reason: entry.reason,
                  title: titleOf(entry.id),
                })),
                count: eligible.length,
              },
              null,
              2,
            ) + "\n"
          : eligible.length === 0
            ? "No threads are sweep-eligible.\n"
            : `${lines.join("\n")}\n${eligible.length} thread(s) eligible; re-run with --confirm to sweep (Done threads archive; long-idle threads are marked Done).\n`;
        return { exitCode: 1, stdout };
      }

      const results: Array<{ id: string; action: "archived" | "marked-done" }> = [];
      for (const entry of eligible) {
        // The sweep's staged exit: Done-age threads archive; long-idle
        // threads are marked Done (operator decision 2026-10-01) — the
        // fresh doneAt stamp starts the Done arm's archive clock, so a
        // swept idle thread resurfaces in the Done sweep instead of
        // vanishing while it was never done.
        if (entry.reason === "idle") {
          await writeDoneRecord(entry.id, true);
          bb.realtime.publish(DONE_CHANGED, { threadId: entry.id, done: true });
          results.push({ id: entry.id, action: "marked-done" });
        } else {
          await bb.sdk.threads.archive({ threadId: entry.id });
          results.push({ id: entry.id, action: "archived" });
        }
      }
      const archivedIds = results
        .filter((result) => result.action === "archived")
        .map((result) => ({ id: result.id }));
      const markedDoneIds = results
        .filter((result) => result.action === "marked-done")
        .map((result) => ({ id: result.id }));
      const stdout = input.options.json
        ? JSON.stringify(
            {
              archived: archivedIds,
              markedDone: markedDoneIds,
              count: results.length,
            },
            null,
            2,
          ) + "\n"
        : results.length === 0
          ? "Nothing to sweep.\n"
          : results
              .map((result) =>
                result.action === "marked-done"
                  ? `marked Done ${result.id}`
                  : `archived ${result.id}`,
              )
              .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  // --- Snooze CLI: bb focus-board snooze ---
  //
  // Mirrors the done commands (board-owned state only; set is read-now +
  // record + arm wake, clear kills the timer). `snooze set` takes the wake
  // time FIRST so the thread ids can stay variadic at the end, matching
  // `done mark`'s shape.

  const snoozeList = cliCommand({
    summary: "List snoozed threads with their wake times",
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const rows = await bb.sdk.threads.list({});
      const records: Array<{
        id: string;
        title: string | null;
        wakeAt: string;
        overdue: boolean;
      }> = [];
      for (const thread of rows) {
        const record = await readSnoozeRecord(thread.id);
        if (record === null) continue;
        const wakeAtMs = snoozeWakeAtMs(record);
        records.push({
          id: thread.id,
          title: thread.title ?? thread.titleFallback,
          wakeAt: record.wakeAt,
          overdue: wakeAtMs === null ? false : wakeAtMs <= Date.now(),
        });
      }
      records.sort((a, b) => a.wakeAt.localeCompare(b.wakeAt));
      const stdout = input.options.json
        ? JSON.stringify(records, null, 2) + "\n"
        : records.length === 0
          ? "No threads are snoozed.\n"
          : records
              .map(
                (row) =>
                  `${row.id}\t${row.wakeAt}${row.overdue ? "\t(overdue)" : ""}\t${row.title ?? "(untitled)"}`,
              )
              .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  const snoozeSet = cliCommand({
    summary:
      "Snooze threads until <when>: marks read now, unread again at the wake",
    description:
      "<when> is a future epoch-parseable timestamp or a relative duration (+30m, +4h, +1d, +2w). The wake is server-armed: it fires after daemon restarts too.",
    positionals: [
      {
        name: "when",
        description: "+<N>m|h|d|w or a future ISO/parsable timestamp",
        required: true,
      },
      {
        name: "thread-id",
        description: "Thread id(s) to snooze",
        required: true,
        variadic: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const when = parseWhenArg(input.positionals.when, new Date());
      if (when === null) {
        throw new PluginCliError(
          `invalid wake time '${input.positionals.when}'`,
          {
            code: "invalid_value",
            hint: "Use +<N>m|h|d|w or a future timestamp (e.g. 2026-10-03T09:00).",
          },
        );
      }
      const snoozed: Array<{ id: string; wakeAt: string }> = [];
      for (const threadId of input.positionals["thread-id"]) {
        const record = await writeSnooze(threadId, when);
        snoozed.push({ id: threadId, wakeAt: record.wakeAt });
      }
      const stdout = input.options.json
        ? JSON.stringify({ snoozed }, null, 2) + "\n"
        : snoozed
            .map((entry) => `snoozed ${entry.id} until ${entry.wakeAt}`)
            .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  const snoozeClear = cliCommand({
    summary: "Cancel a snooze (keeps the thread's current read state)",
    positionals: [
      {
        name: "thread-id",
        description: "Thread id(s) to unsnooze",
        required: true,
        variadic: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const cleared: Array<{ id: string; cleared: boolean }> = [];
      for (const threadId of input.positionals["thread-id"]) {
        cleared.push({
          id: threadId,
          cleared: await clearSnooze(threadId),
        });
      }
      const stdout = input.options.json
        ? JSON.stringify({ cleared }, null, 2) + "\n"
        : cleared
            .map((entry) =>
              entry.cleared ? `cleared snooze ${entry.id}` : `not snoozed ${entry.id}`,
            )
            .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  // --- ✨ auto-rename diagnostics: bb focus-board autotitle ---
  //
  // The fallback modal owns the browser truth but cannot be observed from
  // the outside; these two commands print the same state (availability,
  // selection, bridge classification) and run the probe end-to-end, so the
  // live verdict is one CLI call away.

  const autotitleAvailability = cliCommand({
    summary:
      "Report the ✨ auto-rename menu for a thread: selection, bridges, thread-model probe availability",
    positionals: [
      {
        name: "thread-id",
        description: "Thread to report on",
        required: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const menu = await autotitleServicesMenu(input.positionals["thread-id"]);
      if (input.options.json) {
        return { exitCode: 0, stdout: JSON.stringify(menu, null, 2) + "\n" };
      }
      const lines: string[] = [];
      lines.push(
        menu.threadModel.available
          ? "thread model probe: available"
          : `thread model probe: not available — ${menu.threadModel.reason ?? "unknown reason"}`,
      );
      lines.push(
        menu.selected === null
          ? "selected service: none (task not set to a plugin service)"
          : `selected service: ${menu.selected.pluginId}/${menu.selected.serviceId}`,
      );
      for (const service of menu.services) {
        const at = `${service.displayName} (${service.pluginId}/${service.serviceId})`;
        if (!service.ready) {
          lines.push(`[not ready] ${at} — ${service.message ?? "not ready"}`);
        } else if (service.bridge === false) {
          lines.push(`[no bridge] ${at} — ${service.bridgeReason ?? "no bridge"}`);
        } else {
          lines.push(`[bridged] ${at}`);
        }
      }
      return { exitCode: 0, stdout: lines.join("\n") + "\n" };
    },
  });

  const autotitlePrompt = cliCommand({
    summary: "Print the originating prompt an ✨ auto-rename would title from",
    description:
      "Diagnostic for the ✨ auto-rename: the oldest user timeline row (the thread's spawn input), falling back to paged prompt history. `--json` prints { prompt: string | null }.",
    positionals: [
      {
        name: "thread-id",
        description: "The thread to read the originating prompt from.",
        required: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Print machine-readable JSON." },
    },
    async run(input) {
      const threadId = input.positionals["thread-id"];
      const timeline = (await bb.sdk.threads.timeline({
        threadId,
      })) as { rows?: unknown };
      const rows = (timeline.rows ?? []) as readonly AutotitleTimelineRow[];
      const prompt = await threadOriginatingPrompt(threadId);
      if (input.options.json === true) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify(
            {
              prompt,
              rows: rows.map((row) => ({
                SeqStart: row.sourceSeqStart ?? null,
                createdAt: row.createdAt ?? null,
                kind: row["kind"] ?? null,
                role: row["role"] ?? null,
                text: typeof row.text === "string" ? row.text.slice(0, 120) : null,
              })),
            },
            null,
            2,
          )}\n`,
        };
      }
      return {
        exitCode: 0,
        stdout:
          prompt === null
            ? "no originating prompt found (timeline and history both empty of user text)\n"
            : `${prompt}\n`,
      };
    },
  });

  const autotitleProbe = cliCommand({
    summary:
      "Run the ✨ thread-model probe end-to-end for a thread (spawns a hidden one-turn thread, prints the title, deletes it)",
    positionals: [
      {
        name: "thread-id",
        description: "Thread whose provider/model the probe clones",
        required: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const title = await probeThreadModelTitle(input.positionals["thread-id"]);
      const stdout = input.options.json
        ? JSON.stringify({ title }, null, 2) + "\n"
        : `probed title: ${title}\n`;
      return { exitCode: 0, stdout };
    },
  });

  const configShow = cliCommand({
    summary: "Show the sweep threshold settings and their defaults",
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const values = await settings.get();
      const defaults: Record<(typeof settingsKeys)[number], number | string> = {
        doneArchiveValue: DEFAULT_ARCHIVE_VALUE,
        doneArchiveUnit: DEFAULT_ARCHIVE_UNIT,
        idleArchiveValue: DEFAULT_ARCHIVE_VALUE,
        idleArchiveUnit: DEFAULT_ARCHIVE_UNIT,
      };
      const rows = (Object.keys(defaults) as Array<keyof typeof defaults>).map(
        (key) => ({
          key,
          value: values[key],
          default: defaults[key],
          overridden: values[key] !== defaults[key],
        }),
      );
      const stdout = input.options.json
        ? JSON.stringify(rows, null, 2) + "\n"
        : rows
            .map(
              (row) =>
                `${row.key}=${row.value} (default ${row.default}${row.overridden ? ", overridden" : ""})`,
            )
            .join("\n") + "\n";
      return { exitCode: 0, stdout };
    },
  });

  const configSet = cliCommand({
    summary: `Set a sweep threshold setting (${settingsKeys.join(" | ")})`,
    positionals: [
      {
        name: "key",
        description:
          "doneArchiveValue, doneArchiveUnit, idleArchiveValue, or idleArchiveUnit",
        required: true,
      },
      {
        name: "value",
        description:
          "Count for the value keys; hours | days | weeks for the unit keys",
        required: true,
      },
    ],
    options: {
      json: { type: "boolean", description: "Emit machine-readable JSON" },
    },
    async run(input) {
      const key = input.positionals.key;
      if (!(settingsKeys as readonly string[]).includes(key)) {
        throw new PluginCliError(`unknown setting '${key}'`, {
          code: "invalid_value",
          hint: `Valid keys: ${settingsKeys.join(", ")}`,
        });
      }
      const raw = input.positionals.value;
      let value: number | string;
      if (key === "doneArchiveUnit" || key === "idleArchiveUnit") {
        if (!(ARCHIVE_UNITS as readonly string[]).includes(raw)) {
          throw new PluginCliError(`invalid value '${raw}' for ${key}`, {
            code: "invalid_value",
            hint: `Expected one of: ${ARCHIVE_UNITS.join(", ")}.`,
          });
        }
        value = raw;
      } else {
        const cap = settingsCaps[key as keyof typeof settingsCaps];
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > cap) {
          throw new PluginCliError(`invalid value '${raw}' for ${key}`, {
            code: "invalid_value",
            hint: `Expected an integer between 1 and ${cap} (in the configured unit).`,
          });
        }
        value = parsed;
      }
      // The key is one of the four declared settings and `value` matches
      // that key's type (branch above), so the computed write is shape-safe.
      const next = await settings.experimental_set({
        [key]: value,
      } as Parameters<typeof settings.experimental_set>[0]);
      const effective = next[key as (typeof settingsKeys)[number]];
      const stdout = input.options.json
        ? JSON.stringify({ key, value: effective }, null, 2) + "\n"
        : `${key}=${effective}\n`;
      return { exitCode: 0, stdout };
    },
  });

  // Board-linked tracker items: the agent surface (issue #13). The tool's
  // `instructions` nudge — the AGENTS.md-style push — rides with the tool's
  // presence in the session's tool set, so any thread's agent learns to link
  // what it files or turns up, without text pasted into every repo's AGENTS.md.
  const LINK_AGENT_TOOL = "focus_board_link_issue";
  bb.agents.registerTool({
    name: LINK_AGENT_TOOL,
    description:
      "Link this bb thread to a tracker item so the Focus Board card shows a chip: a GitHub issue or pull request (live status dot), or any other https URL the conversation turns up (external tracker, chip reads the label or hostname). Call it right after you open or file the item, passing its URL.",
    instructions: [
      "Linking work to tracker items: whenever you open or file a GitHub issue",
      "or pull request for this thread's work, call focus_board_link_issue with",
      "the returned URL, and the Focus Board card carries its chip (number,",
      "kind, live status dot). External tracker URLs (Jira, Linear, Forgejo,",
      "anything https) link too: pass the URL, optionally with label for the",
      "chip text when the conversation turns such an item up. One call per",
      "item; prefer the URL form (a bare GitHub number needs a GitHub remote",
      "on the thread's project).",
    ].join("\n"),
    parameters: z
      .object({
        url: z
          .string()
          .startsWith("https://", "https url")
          .optional(),
        number: z.number().int().positive().optional(),
        kind: z.enum(["issue", "pull"]).optional(),
        label: z.string().min(1).max(80).optional(),
      })
      .superRefine((value, refineCtx) => {
        if ((value.url === undefined) === (value.number === undefined)) {
          refineCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Pass exactly one of url or number.",
          });
        }
        if (value.number !== undefined && value.label !== undefined) {
          refineCtx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "label applies to the url form only.",
            path: ["label"],
          });
        }
      }),
    execute: async (params, ctx) => {
      const linkError = (text: string) => ({
        content: [{ type: "text" as const, text }],
        isError: true as const,
      });
      const now = new Date();
      const parsed = params.url === undefined ? null : parseGithubItemUrl(params.url);
      let link: ThreadLink;
      if (parsed !== null) {
        link = {
          tracker: "github",
          repo: parsed.repo,
          issue: parsed.issue,
          kind: parsed.kind,
          href: linkHref(parsed.repo, parsed.kind, parsed.issue),
          createdAt: now.toISOString(),
          source: "agent",
        };
      } else if (params.url !== undefined) {
        // Non-GitHub https URL → external tracker item; the hostname derives
        // from the URL, the label (optional) rides caller input.
        link = makeExternalLink(params.url, params.label, "agent", now);
      } else {
        const number = params.number!;
        const kind = params.kind ?? "issue";
        // Repo from the thread's project remote only; never guessed. The
        // URL form is preferred precisely because bare numbers need this.
        const project = await bb.sdk.projects.get({ projectId: ctx.projectId });
        const slug = resolveRepoSlug(project.gitRemoteUrl);
        if (slug === null) {
          return linkError(
            `Cannot link to a GitHub item: project ${ctx.projectId} has no GitHub remote. Pass the full GitHub issue or PR URL instead.`,
          );
        }
        link = {
          tracker: "github",
          repo: slug,
          issue: number,
          kind,
          href: linkHref(slug, kind, number),
          createdAt: now.toISOString(),
          source: "agent",
        };
      }
      await writeLinkedIssues(
        ctx.threadId,
        stampLinkedIssues(await readLinkedIssues(ctx.threadId), link),
      );
      await publishLinksChanged([ctx.threadId]);
      return {
        content: [
          {
            type: "text" as const,
            text: `Linked this thread to ${link.tracker === "external" ? link.url : link.href}; the Focus Board card now carries the chip.`,
          },
        ],
      };
    },
  });

  bb.cli.register(
    defineCli({
      name: "focus-board",
      summary: "Manage the Focus Board plugin's own state",
      description:
        "Done list/mark/clear, linked tracker items (link list/set/clear), snooze list/set/clear, autotitle availability/probe diagnostics, sweep (archive old Done + long-idle, dry-run by default), and the sweep thresholds.",
      commands: {
        "done list": doneList,
        "done mark": doneMark,
        "done clear": doneClear,
        "link list": linkList,
        "link set": linkSet,
        "link clear": linkClear,
        "snooze list": snoozeList,
        "snooze set": snoozeSet,
        "snooze clear": snoozeClear,
        "autotitle availability": autotitleAvailability,
        "autotitle prompt": autotitlePrompt,
        "autotitle probe": autotitleProbe,
        sweep,
        "config show": configShow,
        "config set": configSet,
      },
    }),
  );

  // Arm every snoozed thread at load (fire-and-forget: scan failures log,
  // never block the plugin's other surfaces), and drop all timers on
  // dispose so a reload never leaves stale wakes ticking.
  void armAllSnoozes().catch((error: unknown) => {
    bb.log.warn(
      `snooze wake scan failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  bb.onDispose(() => {
    for (const timer of wakeTimers.values()) clearTimeout(timer);
    wakeTimers.clear();
    bb.log.info("disposed");
  });
}
