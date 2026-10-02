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

  rank_list: {
    input: z.null(),
    output: z.object({ orders: z.record(z.string(), z.array(z.string())) }),
  },
  /**
   * A single move, not a whole-column write: two boards open on the same
   * column each lose only their own move, instead of the second write
   * clobbering every rank the first one established.
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
      label: "Sweep: archive long-idle threads after",
      description:
        "How long a thread stays quiet before the sweep offers to archive it — a count of the unit chosen below. Default 2 days.",
      experimental_schema: z.number().int().min(1).max(3650),
      default: DEFAULT_ARCHIVE_VALUE,
    },
    idleArchiveUnit: {
      type: "select",
      label: "Sweep: idle archive unit",
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
        "While a thread is running, Escape interrupts its turn instead of closing the pane; the pane closes with Escape once nothing is running.",
      default: true,
    },
    // Debug-mode scroll instrumentation for the pane's embedded chat
    // (docs/chat-click-jump-2026-09-29.md investigation). Ships OFF: the
    // committed default is off everywhere, so stable builds never
    // instrument; it is turned on in a developer environment through this
    // setting alone. While on, the pane wraps the transcript scroller's
    // scrollTop setter and logging session with a copyable export
    // (see components/scroll-debug.ts).
    scrollDebugInstrumentation: {
      type: "boolean",
      label: "Developer: instrument pane chat scrolling (debug)",
      description:
        "Logs the pane chat transcript's scroll writes with calling stacks, plus scroll/wheel/touch events, and adds a copyable debug log to the pane header. Debug use only; keep off otherwise.",
      default: false,
    },
  });

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
    rank_move: async ({ columnKey, threadId, beforeId, toEnd, visibleIds }) => {
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
    },
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

  const sweep = cliCommand({
    summary:
      "Show (or with --confirm, archive) Done-past-threshold and long-idle threads",
    description:
      "Without --confirm this is a dry-run: it prints the eligible set and exits 1 without archiving anything.",
    options: {
      confirm: {
        type: "boolean",
        description: "Actually archive the resolved eligible set",
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
            : `${lines.join("\n")}\n${eligible.length} thread(s) eligible; re-run with --confirm to archive.\n`;
        return { exitCode: 1, stdout };
      }

      const results: Array<{ id: string; archived: boolean }> = [];
      for (const entry of eligible) {
        await bb.sdk.threads.archive({ threadId: entry.id });
        results.push({ id: entry.id, archived: true });
      }
      const stdout = input.options.json
        ? JSON.stringify({ archived: results, count: results.length }, null, 2) + "\n"
        : results.length === 0
          ? "Nothing to archive.\n"
          : results.map((result) => `archived ${result.id}`).join("\n") + "\n";
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

  bb.cli.register(
    defineCli({
      name: "focus-board",
      summary: "Manage the Focus Board plugin's own state",
      description:
        "Done list/mark/clear, sweep (archive old Done + long-idle, dry-run by default), and the sweep thresholds.",
      commands: {
        "done list": doneList,
        "done mark": doneMark,
        "done clear": doneClear,
        sweep,
        "config show": configShow,
        "config set": configSet,
      },
    }),
  );

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}
