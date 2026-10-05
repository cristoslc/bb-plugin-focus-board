import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSdk,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { findTicketRefs, resolveRepoSlug } from "./lib/tickets";
import { installHostLinkGlue } from "./components/host-link-glue";
import { FocusBoardAppIcon } from "./components/ui/icon";
import type { rpcContract } from "./server";
import { Board } from "./components/board";
import { BoardToolbar } from "./components/board-toolbar";
import { ThreadPane } from "./components/thread-pane";
import type { ThreadPaneThread } from "./components/thread-pane";
import { NewThreadModal } from "./components/new-thread-modal";
import type { SpawnedThread } from "./components/new-thread-modal";
import type { CardMenuAction } from "./components/thread-card-menu";
import type { FilterState, GroupBy, ThreadState } from "./components/grouping";
import {
  buildColumns,
  columnFor,
  matchesFilter,
} from "./components/grouping";
import {
  buildFamilyIndex,
  familiesToAutoExpand,
  familiesWithUrgentChildren,
  filterFamilies,
  filterIndividually,
  assembleBoard,
} from "./components/nesting";
import { buildParentLanes } from "./components/parent-lanes";
import { ParentLaneBoard } from "./components/parent-lane-board";
import { doneAtToEpochMs } from "./lib/done-metadata";
import { SnoozeDialog } from "./components/snooze-dialog";
import {
  snoozeMenuActions,
  snoozeWakeAtMs,
  type SnoozeMenuAction,
  type SnoozeRecord,
} from "./lib/snooze";
import {
  applyInteractionFlags,
  interactionFlagChangeFromEvent,
  pendingFromInteractionRows,
  type InteractionFlagStore,
} from "./lib/interaction-sync";
import {
  paneSubPathFor,
  paneThreadIdFromSubPath,
} from "./lib/pane-route";
import { applyMoveVisible, orderForColumn, type RankStore } from "./lib/rank";
import { pinStateChangeFromEvent, readStateChangeFromEvent } from "./lib/pin-park";
import {
  DEFAULT_DONE_ARCHIVE_MS,
  DEFAULT_IDLE_ARCHIVE_MS,
  SWEEP_SETTLED_WORDS,
  armSweep,
  confirmSweep,
  runSweep,
  sweepArmPreselects,
  sweepCandidatesForDoneColumn,
  sweepCandidatesForIdleColumn,
  sweepColumnKind,
  sweepDestination,
  toggleSweepSelection,
  type ArmedSweep,
  type DoneAgeSource,
  type SweepDestination,
  type SweepNotice,
  type SweepRunView,
} from "./lib/sweep";
import { useSweepClickAway } from "./components/board";
import {
  COLLAPSED_FAMILIES_KEY,
  GROUP_BY_KEY,
  NEST_CHILDREN_KEY,
  PARENT_LANE_ORDER_KEY,
  collapsedFamiliesStoredValue,
  escStopsRunningFromSetting,
  nestStoredValue,
  parseCollapsedFamiliesStored,
  parseNestStored,
  parseGroupStored,
  parseParentLaneOrderStored,
  type ParentLaneOrder,
} from "./components/preferences";
import { EmptyState } from "./components/empty-state";
import { WhatsNewModal } from "./components/whats-new-modal";
import {
  APP_VERSION,
  CURRENT_UNRELEASED_FINGERPRINT,
  hasUnseenWhatsNew,
  readLastSeenUnreleased,
  readLastSeenVersion,
  whatsNewEntriesFor,
  writeLastSeenUnreleased,
  writeLastSeenVersion,
  type WhatsNewEntry,
} from "./lib/whats-new";

const FILTER_KEY = "focus-board:filter";
const SEARCH_KEY = "focus-board:search";
/** This panel's own registered route path, for pane-history pushes. */
const PANEL_PATH = "board";

/** The nesting map when there is none (flat board, parent grouping): a stable
 *  empty, so the auto-expand effect's inputs never churn identity per render. */
const EMPTY_NESTED: ReadonlyMap<string, readonly PluginSidebarThread[]> = new Map();

/**
 * `toPluginPanel` is typed `void`, but the host may return `false` when it
 * could not push the route (no history owner on this surface) — or throw on
 * one. Either way the push did not happen: report it as rejected so the pane
 * falls back to local state instead of dying with the click.
 */
function pushRejected(push: () => void): boolean {
  try {
    return (push() as unknown as boolean | undefined) === false;
  } catch {
    return true;
  }
}

/** Adapt metadata records ({doneAt: ISO, keep?}) into the sweep's extras
 *  shape ({doneAt: epoch-ms, keep?}). */
function recordsAsExtras(
  records: Record<string, { doneAt?: number | string; keep?: boolean }>,
): Record<string, { doneAt?: number; keep?: boolean }> {
  const out: Record<string, { doneAt?: number; keep?: boolean }> = {};
  for (const [id, record] of Object.entries(records)) {
    out[id] = {
      ...(typeof record.doneAt === "string"
        ? { doneAt: doneAtToEpochMs(record.doneAt) ?? undefined }
        : record.doneAt !== undefined
          ? { doneAt: record.doneAt }
          : {}),
      ...(record.keep === true ? { keep: true } : {}),
    };
  }
  return out;
}

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
  } catch {
    // localStorage can throw in embedded contexts; fall through to default.
  }
  return fallback;
}

function readStoredText(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    // localStorage can throw in embedded contexts; fall through to default.
  }
  return fallback;
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort only; the board still works without persistence.
  }
}

function readStoredList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((entry): entry is string => typeof entry === "string");
      }
    }
  } catch {
    // localStorage can throw in embedded contexts; fall through to default.
  }
  return [];
}

function BoardPage({ subPath }: { subPath: string }) {
  const { status, threads: sidebarThreads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const { providers } = experimental_useProviders();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  // Host-declared plugin settings (the detail page's config panel), reactive.
  const { values: settingValues } = useSettings();
  // The thread pane's Escape behavior: only a stored false turns the setting
  // off; loading or an unavailable settings surface keeps the ON default.
  const escStopsRunningThread = escStopsRunningFromSetting(
    settingValues?.escStopsRunningThread,
  );

  // The board's "needs you" state rides the sidebar's `hasPendingInteraction`
  // flag, but the sidebar cache can lag behind an answered question: the
  // server clears its flag the moment the interaction settles, while the
  // cached board row keeps the stale one until some unrelated change
  // refetches the list (observed 2026-09-29, thr_6fzk5sjz79). Guard: verify
  // every `interactions-changed` event below and overlay the verified flag
  // on the sidebar rows until the sidebar row agrees again
  // (lib/interaction-sync).
  const [interactionFlags, setInteractionFlags] = useState<InteractionFlagStore>(
    () => new Map(),
  );
  useEffect(() => {
    let disposed = false;
    const record = (threadId: string, hasPendingInteraction: boolean) => {
      setInteractionFlags((current) => {
        const next = new Map(current);
        next.set(threadId, hasPendingInteraction);
        return next;
      });
    };
    try {
      const unsubscribe = sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          const change = interactionFlagChangeFromEvent(event);
          if (change === null) return;
          if (change.hasPendingInteraction !== null) {
            // The host attached the new flag on the event; it is the server
            // truth for this change.
            record(change.threadId, change.hasPendingInteraction);
            return;
          }
          // A host that omits the flag on the event must be verified
          // against the interaction rows instead.
          void sdk.threads.interactions
            .list({ threadId: change.threadId })
            .then(
              (rows) => {
                if (disposed) return;
                record(change.threadId, pendingFromInteractionRows(rows));
              },
              () => {}, // A lost verify keeps the sidebar value; the next event corrects it.
            );
        },
      });
      return () => {
        disposed = true;
        unsubscribe();
      };
    } catch {
      // Embedded contexts (screenshot harness) have no subscribe; the board
      // falls back to the sidebar's flags with no overlay.
      return undefined;
    }
  }, [sdk]);
  // Sidebar rows with the verified flags overlaid; everything downstream —
  // grouping, nesting, lanes, cards, the pane lookup — renders from this.
  const threads = useMemo(
    () => applyInteractionFlags(sidebarThreads, interactionFlags),
    [sidebarThreads, interactionFlags],
  );

  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  // Pinned-pin parks: a lane-exit unpin parks the pin (thread metadata via
  // RPC) so the writes that bring the card back to the operator — Mark Not
  // Done, Mark Unread — can restore it. Local optimistic state drives the
  // restore decisions; the server record is the cross-reload truth.
  const [parkIds, setParkIds] = useState<ReadonlySet<string>>(new Set());
  // Done ages + sweep overrides come from the per-thread plugin-metadata
  // records: doneAt is the ISO stamp, keep the sweep override. The epoch
  // adapter (lib/done-metadata) feeds the sweep's injected `now` contract.
  const [doneExtras, setDoneExtras] = useState<Record<string, { doneAt?: number; keep?: boolean }>>({});
  const [sweepConfig, setSweepConfig] = useState({
    doneArchiveMs: DEFAULT_DONE_ARCHIVE_MS,
    idleArchiveMs: DEFAULT_IDLE_ARCHIVE_MS,
  });
  useEffect(() => {
    rpc.call("done_list").then(
      (result) => {
        setDoneIds(new Set(result.doneIds));
        setDoneExtras(recordsAsExtras(result.records));
      },
      () => {}, // Done marking is optional state; the board works without it.
    );
    rpc.call("pin_parks_list").then(
      (result) => setParkIds(new Set(Object.keys(result.parks))),
      () => {}, // Parks gate nothing; an unloadable park list loses no pin.
    );
    rpc.call("sweep_config_get").then(
      (result) =>
        setSweepConfig({
          doneArchiveMs: result.doneArchiveMs,
          idleArchiveMs: result.idleArchiveMs,
        }),
      () => {}, // Settings are optional; defaults apply when unreachable.
    );
  }, [rpc]);
  useRealtime("done-changed", () => {
    rpc.call("done_list").then(
      (result) => {
        setDoneIds(new Set(result.doneIds));
        setDoneExtras(recordsAsExtras(result.records));
      },
      () => {},
    );
    // Parks refetch on the same signal: another panel (or the CLI path)
    // may have parked or consumed a pin this panel has not mirrored.
    rpc.call("pin_parks_list").then(
      (result) => setParkIds(new Set(Object.keys(result.parks))),
      () => {},
    );
    rpc.call("sweep_config_get").then(
      (result) =>
        setSweepConfig({
          doneArchiveMs: result.doneArchiveMs,
          idleArchiveMs: result.idleArchiveMs,
        }),
      () => {},
    );
  });
  // The board's snapshot is the DoneAgeSource implementation: stamps for
  // Done ages, keep flags as the sweep override.
  const doneAgeSource: DoneAgeSource = useMemo(
    () => ({
      doneMarkedAt: (threadId) => doneExtras[threadId]?.doneAt ?? null,
      kept: (threadId) => doneExtras[threadId]?.keep === true,
    }),
    [doneExtras],
  );
  const idleKept = useCallback(
    (threadId: string) => doneExtras[threadId]?.keep === true,
    [doneExtras],
  );
  // Thread id → epoch-ms done stamp, feeding the Done column's default sort
  // (newest done first). Threads without a record (or the whole map, if
  // done_list never answered) fall back to the board's derived order.
  const doneTimes = useMemo(() => {
    const times = new Map<string, number>();
    for (const [threadId, extra] of Object.entries(doneExtras)) {
      if (extra.doneAt !== undefined) times.set(threadId, extra.doneAt);
    }
    return times;
  }, [doneExtras]);

  // Snoozed threads: per-thread plugin metadata ({ wakeAt, setAt }) surfaced
  // through the snooze RPCs. The board only mirrors the records — dimming,
  // the wake chip, menu entries, and sweep skipping all derive from them;
  // the wake itself (markUnread at the target time) is server-side.
  const [snoozeRecords, setSnoozeRecords] = useState<Record<string, SnoozeRecord>>({});
  const refetchSnoozes = useCallback(() => {
    rpc.call("snooze_list").then(
      (result) => setSnoozeRecords(result.snoozes),
      () => {}, // Snoozing is optional state; the board works without it.
    );
  }, [rpc]);
  useEffect(() => {
    refetchSnoozes();
  }, [refetchSnoozes]);
  useRealtime("snooze-changed", refetchSnoozes);
  const snoozedIds = useMemo(
    () => new Set(Object.keys(snoozeRecords)),
    [snoozeRecords],
  );
  /** Wake epoch-ms for a thread, null when it is not snoozed. */
  const snoozeFor = useCallback(
    (threadId: string): number | null => {
      const record = snoozeRecords[threadId];
      return record === undefined ? null : snoozeWakeAtMs(record);
    },
    [snoozeRecords],
  );
  // A snooze set by any surface (this panel's menu, the CLI, another panel)
  // lands here through the snooze-changed refetch; the optimistic write
  // below only smooths this panel's own gesture.
  const snoozeUntil = useCallback(
    (threadId: string, wakeAt: Date) => {
      const wakeAtIso = wakeAt.toISOString();
      setSnoozeRecords((current) => ({
        ...current,
        [threadId]: { wakeAt: wakeAtIso, setAt: new Date().toISOString() },
      }));
      rpc.call("snooze_set", { threadId, wakeAt: wakeAtIso }).catch(() => refetchSnoozes());
    },
    [rpc, refetchSnoozes],
  );
  // Current-intent: lifting a snooze explicitly (Unsnooze, or any later
  // state-changing gesture on the card). Optimistic removal; a rejected
  // write settles the truth back through a refetch.
  const clearSnooze = useCallback(
    (threadId: string) => {
      setSnoozeRecords((current) => {
        if (current[threadId] === undefined) return current;
        const next = { ...current };
        delete next[threadId];
        return next;
      });
      rpc.call("snooze_clear", { threadId }).catch(() => refetchSnoozes());
    },
    [rpc, refetchSnoozes],
  );
  // "Pick a time…" dialog target: the thread id waiting on a custom wake
  // time, null when no dialog is open.
  const [snoozeDialogFor, setSnoozeDialogFor] = useState<string | null>(null);

  // Manual column orders, keyed by columnRankKey. A column with no stored
  // order stays in the derived order and shows no drag affordance, so the
  // board never implies a reorder it will silently drop.
  const [ranks, setRanks] = useState<RankStore>({});
  const refetchRanks = useCallback(() => {
    rpc.call("rank_list").then(
      // Guarded, not trusted: the zod contract says `orders` is there, but a
      // host running a different plugin build could answer without it, and
      // an unvalidated `undefined` would throw during render and take the
      // whole board down over an optional feature.
      (result) => {
        const orders = (result as { orders?: unknown }).orders;
        if (orders !== undefined && orders !== null && typeof orders === "object") {
          setRanks(orders as RankStore);
        }
      },
      () => {}, // Ranking is optional state; the board works without it.
    );
  }, [rpc]);
  useEffect(() => {
    refetchRanks();
  }, [refetchRanks]);
  useRealtime("rank-changed", refetchRanks);

  // The sidebar view refreshes over its own realtime subscription, but
  // archive/unarchive changes also bump the pane's button state and the
  // archived lookup that keeps the pane usable after archiving. Only the
  // pane needs archived threads (the board's columns exclude them; archived
  // children render only as rows under their live parent), so a minimal shape
  // from the SDK list is enough.
  const [archiveTick, setArchiveTick] = useState(0);
  const [archivedThreads, setArchivedThreads] = useState<
    readonly {
      id: string;
      title: string | null;
      titleFallback: string | null;
      href: string | null;
    }[]
  >([]);
  useEffect(() => {
    const unsubscribe = sdk.subscribe({
      event: "thread:changed",
      callback: (event) => {
        if (event.entity === "thread" && event.changes.includes("archived-changed")) {
          setArchiveTick((tick) => tick + 1);
        }
      },
    });
    return unsubscribe;
  }, [sdk]);
  useEffect(() => {
    let cancelled = false;
    sdk.threads
      .list({ archived: true, limit: 200 })
      .then(
        (result) => {
          if (!cancelled) {
            setArchivedThreads(
              result.map((thread) => ({
                id: thread.id,
                title: thread.title,
                titleFallback: thread.titleFallback,
                // The pane's open menu reuses the row href for its
                // new-window and copy-link destinations; archived rows from
                // older SDK views may not carry one.
                href: "href" in thread && typeof thread.href === "string" ? thread.href : null,
              })),
            );
          }
        },
        () => {}, // Archived lookup is best-effort; the board works without it.
      );
    return () => {
      cancelled = true;
    };
  }, [sdk, archiveTick]);

  const [groupBy, setGroupBy] = useState<GroupBy>(() =>
    // "section"/"environment" were dropped in 0.1.4; stale stored values fall
    // back to the default below. The new "parent" grouping is added in this
    // sashay and validated by parseGroupStored.
    parseGroupStored(
      readStored(
        GROUP_BY_KEY,
        ["none", "status", "recency", "project", "provider", "machine", "parent"],
        "status",
      ),
    ),
  );
  // GitHub repo base per project, for ticket-chip link-outs. Best-effort:
  // a failed or non-GitHub lookup just means chips render without links.
  // Re-runs when the sidebar project list changes (new project, or a
  // late-arriving remote) so the map is never a stale one-shot snapshot.
  const [repoBaseByProject, setRepoBaseByProject] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    sdk.projects
      .list()
      .then(
        (projectList) => {
          if (cancelled) return;
          const next: Record<string, string> = {};
          for (const project of projectList) {
            const slug = resolveRepoSlug(project.gitRemoteUrl);
            if (slug !== null) next[project.id] = `https://github.com/${slug}`;
          }
          setRepoBaseByProject(next);
        },
        () => {}, // Link-out is optional; the board works without it.
      );
    return () => {
      cancelled = true;
    };
  }, [sdk, projects]);
  const repoBaseFor = useCallback(
    (projectId: string): string | null => repoBaseByProject[projectId] ?? null,
    [repoBaseByProject],
  );
  const [filter, setFilter] = useState<FilterState>(() => ({
    projects: new Set(readStoredList(`${FILTER_KEY}:projects`)),
    providers: new Set(readStoredList(`${FILTER_KEY}:providers`)),
    states: new Set(
      readStoredList(`${FILTER_KEY}:states`).filter((state): state is ThreadState =>
        (["working", "attention", "unread", "idle"] as const).includes(state as ThreadState),
      ),
    ),
  }));
  const [search, setSearch] = useState<string>(() => readStoredText(SEARCH_KEY, ""));
  // R3 "Nest child threads" toggle, default ON, persisted like groupBy.
  const [nestChildren, setNestChildren] = useState<boolean>(() =>
    parseNestStored(readStored(NEST_CHILDREN_KEY, ["on", "off"], "on")),
  );
  // D5a parent-lane board lane order: recency (default) or project grouping.
  const [parentLaneOrder, setParentLaneOrder] = useState<ParentLaneOrder>(() =>
    parseParentLaneOrderStored(readStored(PARENT_LANE_ORDER_KEY, ["recency", "project"], "recency")),
  );
  // Collapsed family cards: the parent ids whose nested rows are collapsed,
  // persisted like every other board preference. Anything absent renders
  // expanded — the stored list only ever records deliberate collapses, so a
  // reload re-opens exactly the families the operator folded.
  const [collapsedFamilies, setCollapsedFamilies] = useState<ReadonlySet<string>>(() =>
    parseCollapsedFamiliesStored(readStoredText(COLLAPSED_FAMILIES_KEY, "")),
  );
  // The open pane lives in the panel's URL subPath (`t/<threadId>`), not in
  // component state, so bb's back arrow, a reload, and deep links all land on
  // the pane the user left. The ref mirrors the last pushed thread id; sync
  // and push use it to tell an external route change from an echo of our own.
  const paneThreadId = paneThreadIdFromSubPath(subPath);
  const pushedThreadIdRef = useRef<string | null>(null);
  // Fallback pane id for hosts whose toPluginPanel cannot push (returns
  // false): pane state then lives in component state alone — no back-arrow
  // restoration, but the board stays fully usable.
  const [fallbackPaneThreadId, setFallbackPaneThreadId] = useState<string | null>(null);
  const openThreadId = paneThreadId ?? fallbackPaneThreadId;
  // Sweep arm state: at most one armed column at a time. The candidate id
  // list is captured at arm time and frozen — late arrivals never join.
  const [armedSweep, setArmedSweep] = useState<ArmedSweep | null>(null);
  // A confirmed sweep in flight: sequential archives with per-card progress
  // (throbber on the active card, highlight kept on the rest). Null when idle.
  const [sweepRun, setSweepRun] = useState<SweepRunView | null>(null);
  // Cancel flag for the live run: read by the runner between archives.
  // A ref, not state — cancelling must not re-render the loop's inputs.
  const sweepCancelRef = useRef(false);
  // A finished sweep's summary ("3 failed: ...", or a cancelled run's undo
  // offer). Null when nothing needs saying.
  const [sweepNotice, setSweepNotice] = useState<SweepNotice | null>(null);
  // Stable dismiss: the Board's auto-dismiss timer effect keys on it.
  const clearSweepNotice = useCallback(() => setSweepNotice(null), []);
  const disarmSweep = useCallback(() => setArmedSweep(null), []);
  // Click-away and Escape disarm only an idle arm — and only from outside
  // the armed column: its cards' clicks toggle the sweep selection, so the
  // hook needs the column id to spare them. A running sweep is not armed
  // for this hook at all; it cannot be dismissed out from under itself.
  useSweepClickAway(
    armedSweep !== null && sweepRun === null ? armedSweep.columnId : null,
    disarmSweep,
  );
  // Sweep mode is manual from here: arming pre-selects the past-threshold
  // candidates (armSweepFor), then every card click in the column flips its
  // membership. Live-child parents are refused by the Board itself and
  // never reach this toggle.
  const toggleSweepSelectionFor = useCallback((threadId: string) => {
    setArmedSweep((current) =>
      current === null ? current : toggleSweepSelection(current, threadId),
    );
  }, []);
  // The sweep's way out: during a run, stop before the next archive; in an
  // idle armed mode, exit. One X button serves both, labeled per state.
  const cancelSweepFor = useCallback(() => {
    if (sweepRun !== null) {
      sweepCancelRef.current = true;
      return;
    }
    setArmedSweep(null);
  }, [sweepRun]);
  // What's new: two "seen" models, picked by the running build. A stable
  // build compares versions: a fresh install (nothing stored) is stamped
  // silently — everything is new, so nothing counts as new — and an upgrade
  // pulses until the modal is opened. A prerelease build (dev's
  // "0.6.0-dev") keys "seen" to the [Unreleased] group's content instead:
  // its fingerprint is stamped silently on first load, and the button pulses
  // again whenever the group's bullets change (each merge to dev). Opening
  // marks seen; the button itself never leaves.
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(
    () => readLastSeenVersion(),
  );
  const [lastSeenUnreleased, setLastSeenUnreleased] = useState<string | null>(
    () => readLastSeenUnreleased(),
  );
  useEffect(() => {
    if (lastSeenVersion === null) {
      writeLastSeenVersion(APP_VERSION);
      setLastSeenVersion(APP_VERSION);
    }
  }, [lastSeenVersion]);
  // The unreleased fingerprint is NOT stamped at load: a fresh dev build
  // pulses its standing group until opened (see hasUnseenWhatsNew); only
  // opening the modal records it as seen (openWhatsNew).
  const whatsNewUnseen = hasUnseenWhatsNew({
    runningVersion: APP_VERSION,
    lastSeenVersion,
    unreleasedFingerprint: CURRENT_UNRELEASED_FINGERPRINT,
    lastSeenUnreleasedFingerprint: lastSeenUnreleased,
  });
  // The delta is captured at load (before opening marks it seen): a dev
  // build leads with its unreleased group; stable builds show entries since
  // the stored version when one is pending, all recent entries otherwise.
  const whatsNewEntries: readonly WhatsNewEntry[] = useMemo(
    () => whatsNewEntriesFor(APP_VERSION, whatsNewUnseen, lastSeenVersion),
    [whatsNewUnseen, lastSeenVersion],
  );
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const openWhatsNew = useCallback(() => {
    writeLastSeenUnreleased(CURRENT_UNRELEASED_FINGERPRINT);
    setLastSeenUnreleased(CURRENT_UNRELEASED_FINGERPRINT);
    writeLastSeenVersion(APP_VERSION);
    setLastSeenVersion(APP_VERSION);
    setWhatsNewOpen(true);
  }, []);
  // The selected thread's column is captured when it is opened and held until
  // it is deselected, so live state/age changes cannot slide the card.
  const [frozenColumn, setFrozenColumn] = useState<{
    threadId: string;
    column: { id: string; label: string };
  } | null>(null);

  const persistGroupBy = useCallback((value: GroupBy) => {
    setGroupBy(value);
    writeStored(GROUP_BY_KEY, value);
  }, []);
  const persistFilter = useCallback((next: FilterState) => {
    setFilter(next);
    writeStored(`${FILTER_KEY}:projects`, JSON.stringify([...next.projects]));
    writeStored(`${FILTER_KEY}:providers`, JSON.stringify([...next.providers]));
    writeStored(`${FILTER_KEY}:states`, JSON.stringify([...next.states]));
  }, []);
  const persistSearch = useCallback((value: string) => {
    setSearch(value);
    writeStored(SEARCH_KEY, value);
  }, []);
  const persistNestChildren = useCallback((enabled: boolean) => {
    setNestChildren(enabled);
    writeStored(NEST_CHILDREN_KEY, nestStoredValue(enabled));
  }, []);
  const persistParentLaneOrder = useCallback((value: ParentLaneOrder) => {
    setParentLaneOrder(value);
    writeStored(PARENT_LANE_ORDER_KEY, value);
  }, []);
  // Single writer for the collapsed set: every mutation lands in state, this
  // effect serializes it. The mount run writes the parsed value back — a
  // harmless round-trip that also repairs a corrupt stored list.
  useEffect(() => {
    writeStored(COLLAPSED_FAMILIES_KEY, collapsedFamiliesStoredValue(collapsedFamilies));
  }, [collapsedFamilies]);
  const setFamilyCollapsed = useCallback((parentId: string, collapsed: boolean) => {
    setCollapsedFamilies((current) => {
      const next = new Set(current);
      if (collapsed) next.add(parentId);
      else next.delete(parentId);
      return next;
    });
  }, []);

  // The sidebar view pushes fresh thread data continuously; this signal
  // additionally fires on host-side changes so cards never sit stale.
  useRealtime("thread-list-changed", () => {});

  // The family pipeline runs on the NON-HIDDEN set. Archived threads are
  // included here but are hidden by the pipeline itself: buildFamilyIndex —
  // the single authoritative hide — drops them, so an archived child renders
  // nowhere (in either board view) and a child of an archived parent
  // re-roots. assembleBoard keeps them out of the columns in both modes.
  const nonHiddenThreads = useMemo(
    () => threads.filter((thread) => !thread.isHidden),
    [threads],
  );
  const liveThreads = useMemo(
    () => nonHiddenThreads.filter((thread) => !thread.isArchived),
    [nonHiddenThreads],
  );

  const filterOptions = useMemo(() => {
    const projectIds = new Set<string>();
    const providerIds = new Set<string>();
    for (const thread of liveThreads) {
      projectIds.add(thread.projectId);
      providerIds.add(thread.providerId);
    }
    return { projectIds, providerIds };
  }, [liveThreads]);

  // Family-aware filtering replaces per-thread filtering when nesting is ON:
  // a family passes when any member matches, non-matching members render
  // dimmed (archived members are hidden outright by the family index, so
  // they never appear here at all).
  // Nesting OFF means a fully flat board — per-thread filtering again. The
  // "parent" grouping overrides that (D11): the nesting toggle is inert
  // there, and lane mode always filters family-first (D10 keep-and-dim).
  const familyIndex = useMemo(() => buildFamilyIndex(nonHiddenThreads), [nonHiddenThreads]);
  const familyFiltered = useMemo(
    () =>
      nestChildren || groupBy === "parent"
        ? filterFamilies(nonHiddenThreads, familyIndex, filter, search.trim())
        : filterIndividually(nonHiddenThreads, filter, search.trim()),
    [nestChildren, groupBy, nonHiddenThreads, familyIndex, filter, search],
  );
  const filtered = familyFiltered.kept;

  const searchActive = search.trim() !== "";
  // Search runs inside filterFamilies (it keeps the whole family on a hit and
  // dims non-matching members), so `searched` is just the kept set.
  const searched = filtered;

  const frozenColumns = useMemo(() => {
    const frozen = new Map<string, { id: string; label: string }>();
    if (openThreadId !== null && frozenColumn !== null && frozenColumn.threadId === openThreadId) {
      frozen.set(frozenColumn.threadId, frozenColumn.column);
    }
    return frozen;
  }, [openThreadId, frozenColumn]);

  // Single assembly: buildColumns → nestUnderParents. The nesting result's
  // map (not the raw family index) drives which children render as nested
  // rows, so a promoted or cross-axis child appears only as its standalone
  // card — never both standalone AND nested. `doneChildrenByParent` drives
  // the Done projection cards. The chip counts come from the assembly too,
  // counted per card's own space (live children on a live card; done rows on
  // a Done card). With nesting OFF the board is flat: no rows, no chips.
  const isParentGroupBy = groupBy === "parent";
  const parentLanes = useMemo(
    () => (isParentGroupBy ? buildParentLanes(searched, doneIds, Date.now(), doneTimes) : null),
    [isParentGroupBy, searched, doneIds, doneTimes],
  );
  const parentLaneChildrenByParent = useMemo(
    () => (isParentGroupBy ? familyIndex.childrenByParent : new Map<string, readonly PluginSidebarThread[]>()),
    [isParentGroupBy, familyIndex],
  );
  const assembly = useMemo(
    () =>
      isParentGroupBy
        ? null
        : assembleBoard(searched, groupBy, { projects, providers }, frozenColumns, doneIds, Date.now(), {
            nestingEnabled: nestChildren,
            ranks,
            doneTimes,
          }),
    [isParentGroupBy, searched, groupBy, projects, providers, frozenColumns, doneIds, nestChildren, ranks, doneTimes],
  );
  const columns = assembly?.columns ?? [];
  // The map that actually renders as nested rows (nesting rules applied, so a
  // promoted or cross-axis child is absent — expanding the card could never
  // reveal it). Stable across renders: the auto-expand effect keys on it.
  const nestedChildrenByParent = assembly?.nestedChildrenByParent ?? EMPTY_NESTED;

  // Collapsed-family auto-expand: a folded card must open when one of its
  // nested children enters an "unread+" state — unread activity, or needs-you
  // (components/nesting.ts `familiesWithUrgentChildren` for the exact member
  // rule). The decision is a TRANSITION, not a state: the first snapshot
  // after load is a seed pass only, so a family collapsed while a child was
  // already unread stays collapsed across reloads, and the rule answers live
  // changes ("a child just went unread under a folded card") without fighting
  // the operator's collapse gesture on every refresh. Expanding clears the
  // persisted collapsed id: the opened state is the state that persists.
  const urgentFamiliesRef = useRef<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const current = familiesWithUrgentChildren(nestedChildrenByParent, doneIds);
    const previous = urgentFamiliesRef.current;
    urgentFamiliesRef.current = current;
    if (previous === null) return; // seed pass: observe, never act
    const toExpand = familiesToAutoExpand(previous, current, collapsedFamilies);
    if (toExpand.length === 0) return;
    setCollapsedFamilies((currentCollapsed) => {
      const next = new Set(currentCollapsed);
      for (const id of toExpand) next.delete(id);
      return next;
    });
  }, [nestedChildrenByParent, doneIds, collapsedFamilies]);

  // Sweep eligibility per sweepable column, computed from the current board
  // data. Arming (in armSweepFor) captures this list at arm time; while a
  // sweep is armed the FROZEN list is what Board displays and what confirm
  // applies — the live recompute is only for the next arm. Only the
  // aged-out arms (Done, A-while-ago) pre-select their past-threshold
  // candidates; Pinned, Unread, and the fresher idle buckets arm empty
  // (sweepArmPreselects) and the operator curates by clicking cards.
  //
  // Sweep-family contract: a thread with ≥1 live (non-archived) child is
  // never sweep-eligible in either aged-out arm; children stay eligible
  // independently. The parent set comes from the full live list, not the
  // column, so cross-column and flat-mode families are covered alike.
  const liveChildParentIds = useMemo(() => {
    const parents = new Set<string>();
    for (const thread of liveThreads) {
      if (thread.parentThreadId !== null) parents.add(thread.parentThreadId);
    }
    return parents;
  }, [liveThreads]);

  const sweepCandidatesFor = useCallback(
    (columnId: string): readonly string[] => {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (column === undefined || sweepColumnKind(columnId) === null) return [];
      const now = Date.now();
      // A snoozed thread sleeps through sweeps too: the wake is the whole
      // point of the snooze, so its card is not a sweep candidate — on any
      // arm, aged-out or manually curated (the server-side sweep skips
      // snoozed facts the same way).
      const sweepable = column.threads.filter(
        (candidate) => !snoozedIds.has(candidate.id),
      );
      const kind = sweepColumnKind(columnId);
      switch (kind) {
        case "done":
          return sweepCandidatesForDoneColumn(
            sweepable,
            doneIds,
            doneAgeSource,
            { doneArchiveMs: sweepConfig.doneArchiveMs },
            now,
            liveChildParentIds,
          );
        case "idle-bucket":
          return sweepArmPreselects(columnId)
            ? sweepCandidatesForIdleColumn(
                sweepable,
                doneIds,
                { idleArchiveMs: sweepConfig.idleArchiveMs, kept: idleKept },
                now,
                liveChildParentIds,
              )
            : [];
        // Manual arms: arming enters sweep mode with nothing selected; the
        // operator curates the sweep by clicking cards.
        case "pinned":
        case "unread":
          return [];
        default:
          return [];
      }
    },
    [columns, doneIds, doneAgeSource, idleKept, liveChildParentIds, snoozedIds, sweepConfig],
  );

  // A Done-column projection card (a live family's Done card) cannot join a
  // sweep either: it is a rendering of a live parent, not a done thread.
  const doneProjectionParentIds = useMemo(
    () => new Set(assembly?.doneChildrenByParent.keys() ?? []),
    [assembly],
  );
  const sweepBlockedIds = useMemo(
    () => new Set([...liveChildParentIds, ...doneProjectionParentIds]),
    [liveChildParentIds, doneProjectionParentIds],
  );

  const armSweepFor = useCallback(
    (columnId: string) => {
      // A running sweep owns the gesture: no re-arming mid-run. And a
      // non-sweepable column never arms — the pill is its only door, and
      // that pill exists only on sweepable lanes.
      if (sweepRun !== null) return;
      if (sweepColumnKind(columnId) === null) return;
      setArmedSweep(armSweep(columnId, sweepCandidatesFor(columnId)));
    },
    [sweepCandidatesFor, sweepRun],
  );

  // Live GitHub status for ticket chips. Batched: one RPC per visible-ref
  // snapshot (numeric refs grouped per repo), re-fetched when the thread
  // list changes — no interval, no per-card calls. Failures degrade to
  // "no status known"; the board never breaks on this path.
  const [ticketStatuses, setTicketStatuses] = useState<Record<string, Record<number, { kind: string; state: string }>>>({});
  // visibleRefKey is a sorted, comma-joined snapshot ("owner/repo#42,...").
  // Safe to join: repo slugs cannot contain commas or hashes. It doubles as
  // the effect dependency (cheap string equality) and is re-parsed below.
  const visibleRefKey = useMemo(
    () =>
      liveThreads
        .flatMap((thread) => {
          const repoBase = repoBaseByProject[thread.projectId];
          const repo = repoBase === undefined ? null : resolveRepoSlug(repoBase);
          if (repo === null) return [];
          const branch = thread.environment?.branchName ?? thread.host?.name ?? "";
          return findTicketRefs(thread.displayTitle, { extraText: branch })
            .filter((ref) => ref.number !== undefined)
            .map((ref) => `${repo}#${ref.number}`);
        })
        .sort()
        .join(","),
    [liveThreads, repoBaseByProject],
  );
  useEffect(() => {
    if (visibleRefKey === "") {
      setTicketStatuses({});
      return;
    }
    let cancelled = false;
    const wanted = new Map<string, Set<number>>();
    for (const entry of visibleRefKey.split(",")) {
      const at = entry.lastIndexOf("#");
      const repo = entry.slice(0, at);
      const num = Number(entry.slice(at + 1));
      const set = wanted.get(repo) ?? new Set<number>();
      set.add(num);
      wanted.set(repo, set);
    }
    // Replace the whole map per snapshot (not merge) so statuses mirror the
    // visible ref set exactly — no stale dots, no session-long growth.
    const next: Record<string, Record<number, { kind: string; state: string }>> = {};
    let pending = wanted.size;
    const settle = () => {
      if (!cancelled && pending === 0) setTicketStatuses(next);
    };
    for (const [repo, numbers] of wanted) {
      // The RPC caps input at 500 numbers; slice so an overflowing repo
      // degrades to partial dots instead of a rejected call (no dots at all).
      const batch = [...numbers].slice(0, 500);
      rpc
        .call("tracker_status", { repo, numbers: batch })
        .then(
          (result) => {
            if (!cancelled) {
              next[repo] = result.statuses;
              pending -= 1;
              settle();
            }
          },
          () => {
            // Status is optional decoration; chips render without it.
            if (!cancelled) {
              pending -= 1;
              settle();
            }
          },
        );
    }
    return () => {
      cancelled = true;
    };
  }, [visibleRefKey, rpc]);
  const statusFor = useCallback(
    (repo: string | null, number: number | undefined) => {
      if (repo === null || number === undefined) return undefined;
      return ticketStatuses[repo]?.[number];
    },
    [ticketStatuses],
  );

  const anyFilterActive =
    filter.projects.size > 0 || filter.providers.size > 0 || filter.states.size > 0 || searchActive;
  // When exactly one project is selected in the filter, new threads created
  // from the board land in that project. Stale ids (project deleted since
  // the filter was persisted) fall back to bb's default project pick.
  const newThreadProjectId = useMemo(() => {
    if (filter.projects.size !== 1) return undefined;
    const projectId = [...filter.projects][0];
    return projects.some((project) => project.id === projectId) ? projectId : undefined;
  }, [filter.projects, projects]);
  // The board's own new-thread composer: a modal over the board and pane, so
  // composing never leaves the surface and bb's new-thread window stays out
  // of the way. The nonce re-focuses the composer editor on every open.
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [composerFocusRequest, setComposerFocusRequest] = useState(0);
  const openNewThread = useCallback(() => {
    setComposerFocusRequest((nonce) => nonce + 1);
    setNewThreadOpen(true);
  }, []);
  // A freshly spawned thread is not in the sidebar cache on the tick the
  // pane route opens, and the pane only renders for a resolvable thread.
  // The spawn result stands in until the cache carries the thread (this row
  // then clears and the cached thread — with live status — wins).
  const [provisionalSpawn, setProvisionalSpawn] = useState<{
    id: string;
    displayTitle: string;
    status: ThreadPaneThread["status"];
  } | null>(null);
  useEffect(() => {
    if (
      provisionalSpawn !== null &&
      sidebarThreads.some((thread) => thread.id === provisionalSpawn.id)
    ) {
      setProvisionalSpawn(null);
    }
  }, [sidebarThreads, provisionalSpawn]);
  // "Personal" is the board card's label for a thread whose project is not in
  // the sidebar's project list (bb's default personal project).
  const projectNameFor = useCallback(
    (projectId: string) =>
      projects.find((project) => project.id === projectId)?.name ?? "Personal",
    [projects],
  );
  // Archived riders sit in `searched` when nesting is ON (they stay under
  // their parent); board-level counts stay live-thread counts.
  const boardCount = useMemo(
    () => searched.filter((thread) => !thread.isArchived).length,
    [searched],
  );
  const emptyBecauseFiltered = liveThreads.length > 0 && boardCount === 0 && anyFilterActive;
  const dimmedIds = familyFiltered.dimmedIds;

  // The open pane's thread can vanish from the active view (archived,
  // deleted); the archived list keeps it resolvable so the pane stays open
  // with an Unarchive button. Only deletion closes the pane.
  // The open pane's thread can vanish from the active view (archived,
  // deleted); the archived list keeps it resolvable so the pane stays open
  // with an Unarchive button. Only deletion closes the pane.
  const openThreadActive = threads.find((thread) => thread.id === openThreadId) ?? null;
  const openThreadArchived =
    openThreadActive === null && openThreadId !== null
      ? (archivedThreads.find((thread) => thread.id === openThreadId) ?? null)
      : null;
  const openThread: ThreadPaneThread | null =
    openThreadActive !== null
      ? {
          id: openThreadActive.id,
          displayTitle: openThreadActive.displayTitle,
          status: openThreadActive.status,
          isUnread: openThreadActive.isUnread,
          isPinned: openThreadActive.isPinned,
          href: openThreadActive.href,
        }
      : openThreadArchived !== null
        ? {
            id: openThreadArchived.id,
            displayTitle:
              openThreadArchived.title ?? openThreadArchived.titleFallback ?? openThreadArchived.id,
            status: "idle",
            isUnread: false,
            isPinned: false,
            // Older stored archived rows predate href; the app-relative
            // thread route is the same URL the sidebar row carries.
            href: openThreadArchived.href ?? `/threads/${openThreadArchived.id}`,
          }
        : provisionalSpawn !== null && provisionalSpawn.id === openThreadId
          ? {
              id: provisionalSpawn.id,
              displayTitle: provisionalSpawn.displayTitle,
              status: provisionalSpawn.status,
              isUnread: false,
              isPinned: false,
              href: `/threads/${provisionalSpawn.id}`,
            }
          : null;

  const openThreadIsArchived =
    openThreadId === null
      ? false
      : (threads.some(
          (thread) => thread.id === openThreadId && !thread.isArchived,
        )
          ? false
          : archivedThreads.some((thread) => thread.id === openThreadId));

  // Opening (or switching) a pane pushes a panel route, so every pane is one
  // history entry and the back arrow walks back through the cards the user
  // opened — reopening a trail of panes they lost track of. Closing replaces
  // instead, so × / Escape do not multiply entries. A failed push (host route
  // owner unavailable — older bb, exotic embeds) falls back to the pane still
  // opening locally, which keeps the board usable without URL state.
  const openThreadCard = useCallback(
    (threadId: string) => {
      pushedThreadIdRef.current = threadId;
      const rejected = pushRejected(() =>
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: paneSubPathFor(threadId),
        }),
      );
      const thread = threads.find((candidate) => candidate.id === threadId);
      setFrozenColumn(
        thread === undefined || groupBy === "parent"
          ? null
          : {
              threadId,
              column: columnFor(thread, groupBy, { projects, providers }),
            },
      );
      if (rejected && openThreadId !== threadId) {
        // Without a working history integration the subPath never changes, so
        // open locally: the pane opens now and closes via onClose below.
        setFallbackPaneThreadId(threadId);
      }
    },
    [navigate, openThreadId, threads, groupBy, projects, providers],
  );

  // The composer modal resolved a spawn: file the provisional row, then open
  // the new thread in the pane (route push + frozen column as usual).
  const handleSpawnedThread = useCallback(
    (thread: SpawnedThread) => {
      setProvisionalSpawn({
        id: thread.id,
        displayTitle: thread.title ?? thread.titleFallback ?? thread.id,
        status: thread.status,
      });
      openThreadCard(thread.id);
    },
    [openThreadCard],
  );

  const closeThreadPane = useCallback(() => {
    pushedThreadIdRef.current = null;
    const rejected = pushRejected(() => navigate.toPluginPanel(PANEL_PATH, { subPath: "" }));
    if (rejected && openThreadId !== null) {
      setFallbackPaneThreadId(null);
    }
  }, [navigate, openThreadId]);

  // The URL is the source of truth for the pane. A subPath change that our
  // own push did not cause — bb's back arrow, a shared deep link, a reload —
  // must move the pane, including closing it. The pushed-id ref identifies
  // echoes: a push is only settled once the subPath prop actually carries the
  // pushed id, so a dropped push (route owner said no) leaves no stale marker
  // and the next back navigation still wins.
  useEffect(() => {
    if (paneThreadId === pushedThreadIdRef.current) {
      if (paneThreadId !== null) pushedThreadIdRef.current = null;
      return;
    }
    // External navigation onto a thread the board has open elsewhere in its
    // history: adopt the URL's thread so the pane follows the route owner.
    // The freeze is captured once per adopted thread — live thread updates
    // must never re-freeze, or a thread that moved columns would slide the
    // card after the fact (the same contract a click-opened pane has).
    if (paneThreadId !== null) {
      setFallbackPaneThreadId(null);
      setFrozenColumn((current) => {
        if (current !== null && current.threadId === paneThreadId) return current;
        const thread = threads.find((candidate) => candidate.id === paneThreadId);
        return thread === undefined || groupBy === "parent"
          ? current
          : {
              threadId: paneThreadId,
              column: columnFor(thread, groupBy, { projects, providers }),
            };
      });
    } else {
      setFallbackPaneThreadId(null);
      setFrozenColumn(null);
    }
  }, [paneThreadId, threads, groupBy, projects, providers]);

  // Project creation needs a host checkout path; the personal workspace's
  // host hosts every project, so create under the first known host.
  const createProject = useCallback(
    async (name: string) => {
      const hosts = await sdk.hosts.list();
      if (hosts.length === 0) {
        throw new Error("No connected host to create the project checkout on.");
      }
      const host = hosts.find((candidate) => candidate.lifecycle?.phase === "active") ?? hosts[0];
      await sdk.projects.create({
        name,
        source: {
          type: "local_path",
          hostId: host.id,
          path: `~/bb-projects/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        },
      });
    },
    [sdk],
  );

  // One-shot lane-reveal claims (menu moves). Every menu action that
  // relocates a card — Pin/Unpin, Mark Done/Not Done, Mark Read/Unread —
  // moves a card the pane never opened, and the destination lane (Pinned
  // far left, Done far right) can sit offscreen in a scrolled board: the
  // action reads as the card silently vanishing from where it was.
  //
  // The board only follows the OPEN card (its keep-in-view effect), and it
  // must not follow the DATA (passive status flips and host-side changes
  // would yank the user's place) — so the board gets an intent CLAIM
  // instead. Pin/Read ride the host bridge: the state (with it, the
  // relocation) lands in a later render than the click, so rather than fire
  // the reveal at click time, the run arms a pending claim that the effect
  // below consumes the moment the thread's observable state matches — landing
  // the reveal request in the same commit the card relocates. Done/Unread
  // are local and optimistic: their runs fire the reveal directly, batched
  // with the state change (Board processes it post-relocation).
  //
  // A claim that outlives its action (the host never applies the requested
  // state) fires later, on the next state match — still the user's intent.
  const [revealRequest, setRevealRequest] = useState<{
    threadId: string;
    seq: number;
  } | null>(null);
  const revealSeqRef = useRef(0);
  const requestReveal = useCallback((threadId: string) => {
    revealSeqRef.current += 1;
    setRevealRequest({ threadId, seq: revealSeqRef.current });
  }, []);
  const pendingStateClaimsRef = useRef<
    Map<string, { field: "isPinned" | "isUnread"; value: boolean }>
  >(new Map());
  useEffect(() => {
    const claims = pendingStateClaimsRef.current;
    if (claims.size === 0) return;
    for (const [threadId, claim] of claims) {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (thread === undefined || thread[claim.field] !== claim.value) continue;
      claims.delete(threadId);
      requestReveal(threadId);
    }
    // Consumes per threads update while claims are armed; the deletion (and
    // requestReveal's own setState) is the re-run trigger.
  }, [threads, requestReveal]);

  // The Pinned lane-exit rule. A pinned card leaving the Pinned lane (a
  // cross-column drop or the menu's Mark Done) un-pins as part of the
  // gesture — column placement derives from the pin, so the pin must go
  // with it or the card bounces straight back into Pinned on the next
  // grouping pass. But the un-pinned pin is PARKED, not destroyed: the park
  // marker rides board-owned thread metadata (lib/pin-park), and the state
  // writes that bring the card back to the operator — Mark Not Done, Mark
  // Unread — restore the pin exactly as it stood before the gesture. A
  // same-lane reorder (including within Pinned) is claimed by the card's
  // reorder path and never reaches any of these helpers.
  const parkPin = useCallback(
    (threadId: string) => {
      setParkIds((current) => new Set(current).add(threadId));
      rpc
        .call("pin_park_set", { threadId, parked: true })
        .catch(() => {
          // Roll the optimistic park back when the server rejects: a pin
          // the server never parked must not be restorable.
          setParkIds((current) => {
            const next = new Set(current);
            next.delete(threadId);
            return next;
          });
        });
    },
    [rpc, setParkIds],
  );
  const clearParkPin = useCallback(
    (threadId: string) => {
      // An explicit board pin write expresses current intent and beats any
      // parked value, so every Pin/Unpin wipe clears it. No park, no write.
      if (!parkIds.has(threadId)) return;
      setParkIds((current) => {
        const next = new Set(current);
        next.delete(threadId);
        return next;
      });
      void rpc.call("pin_park_set", { threadId, parked: false }).catch(() => {});
    },
    [parkIds, rpc],
  );
  const restoreParkedPin = useCallback(
    (threadId: string) => {
      if (!parkIds.has(threadId)) return;
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (thread === undefined) return;
      // Already pinned (the operator re-pinned before the restore ran, or a
      // foreign surface did): the park is stale — consume quietly, never
      // double-pin.
      if (thread.isPinned) {
        clearParkPin(threadId);
        return;
      }
      // The restore itself, then the park dies — one gesture, once. The
      // reveal claim rides along: the card moves back to Pinned (far left,
      // offscreen in a scrolled board) when the write lands, not when this
      // function runs, so the consumed-when-applied claim is what keeps the
      // board following it.
      pendingStateClaimsRef.current.set(threadId, {
        field: "isPinned",
        value: true,
      });
      void actions.setPinned(threadId, true);
      clearParkPin(threadId);
    },
    [actions, clearParkPin, parkIds, threads],
  );
  const exitPinnedLane = useCallback(
    (threadId: string): Promise<unknown> => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (thread === undefined || !thread.isPinned) return Promise.resolve();
      // The unpin is the gesture; the park is a side record, never a
      // substitute for removing the pin itself. The unpin's promise returns
      // so the sweep's sequential runner can await the write (the fire-and-
      // forget drag paths ignore it).
      const unpin = actions.setPinned(threadId, false);
      parkPin(threadId);
      return unpin;
    },
    [actions, parkPin, threads],
  );

  // Confirm a sweep: apply the arm's per-thread gesture to the captured
  // selection, strictly one at a time (the runner's contract — the host's
  // sidebar writes run one row at a time, so an unawaited loop applies only
  // the last candidate; observed 2026-10-01: a 4-thread sweep archived one).
  // Side effects stay out of the state updater: read the armed snapshot,
  // clear it, then sweep. React may re-invoke updaters; an action call must
  // never run twice. Lives below exitPinnedLane/parkPin because the Pinned
  // arm exits through the lane exit (unpin, pin parked).
  const confirmSweepFor = useCallback(
    (columnId: string) => {
      const current = armedSweep;
      if (current === null || current.columnId !== columnId) return;
      if (sweepRun !== null) return; // one run at a time
      const threadIds = confirmSweep(current, true);
      const destination = sweepDestination(columnId);
      if (destination === null) {
        // Not a sweepable column: a confirm here is a caller bug. Refuse —
        // never default to archiving — and drop the arm.
        setArmedSweep(null);
        return;
      }
      if (threadIds.length === 0) {
        setArmedSweep(null);
        return;
      }
      // The idle arm's exit is staged: mark Done (the same recipe as a drop
      // on the Done column), never archive a quiet-but-not-done thread. The
      // fresh doneAt stamp starts the Done arm's archive clock, so swept
      // threads resurface there in doneArchiveDays instead of vanishing.
      const markDone = async (threadId: string): Promise<void> => {
        await rpc.call("done_set", { threadId, done: true });
        setDoneIds((currentDone) => {
          const next = new Set(currentDone);
          next.add(threadId);
          return next;
        });
        // Done implies read: the card must not land in Done still claiming
        // unread (the same rule the drop-on-Done path applies).
        const thread = threads.find((candidate) => candidate.id === threadId);
        if (thread !== undefined && thread.isUnread) {
          void actions.setRead(threadId, true);
        }
      };
      // The Pinned arm exits through the lane exit: unpin, pin parked, so a
      // swept thread returns to Pinned the next time it calls for attention.
      const sweepOne = (threadId: string): Promise<unknown> => {
        switch (destination) {
          case "done":
            return markDone(threadId);
          case "unpinned":
            return exitPinnedLane(threadId);
          case "read":
            // The catch-up gesture: mark read, nothing else. Marking read
            // carries no state-truth reactions (parks ride unread, not read).
            return actions.setRead(threadId, true);
          default:
            return sdk.threads.archive({ threadId });
        }
      };
      const settledWord = SWEEP_SETTLED_WORDS[destination];
      setSweepNotice(null);
      setSweepRun({ columnId, total: threadIds.length, done: 0, activeId: null });
      sweepCancelRef.current = false;
      void runSweep(threadIds, {
        act: sweepOne,
        onActive: (activeId) =>
          setSweepRun((run) => (run === null ? run : { ...run, activeId })),
        onSettled: () =>
          setSweepRun((run) =>
            run === null ? run : { ...run, done: run.done + 1, activeId: null },
          ),
        // Cancel between actions; the one in flight always finishes.
        shouldContinue: () => !sweepCancelRef.current,
      }).then((result) => {
        setSweepRun(null);
        const failedIds = result.failures.map((failure) => failure.threadId);
        // A cancelled run keeps whatever was never swept armed (plus any
        // failures) so it can be inspected, retried, or explicitly exited;
        // the pill flipping back to its count is the cancellation feedback.
        // Undo is OFFERED, never automatic: cancel means "stop", undo is a
        // deliberate second click.
        const stayArmed = result.cancelled
          ? [...failedIds, ...result.remaining]
          : failedIds;
        setArmedSweep(stayArmed.length > 0 ? { columnId, threadIds: stayArmed } : null);
        if (result.cancelled) {
          if (result.swept.length === 0 && result.failures.length === 0) return;
          const failedCopy =
            result.failures.length > 0
              ? ` ${result.failures.length} failed: ${result.failures
                  .map((failure) => failure.message)
                  .join(", ")}.`
              : "";
          setSweepNotice({
            message: `Sweep stopped. ${result.swept.length} ${settledWord}, ${result.remaining.length} not attempted.${failedCopy}`,
            undo: { ids: result.swept, destination },
          });
          return;
        }
        if (result.failures.length === 0) return;
        // Fail loud: the failed candidates stay armed (highlight) for a
        // one-click retry, and a banner says what happened.
        const failedTitles = result.failures.map((failure) => {
          const match = threads.find((candidate) => candidate.id === failure.threadId);
          return `"${match?.displayTitle ?? match?.titleFallback ?? failure.threadId}" (${failure.message})`;
        });
        const attempted = threadIds.length - result.remaining.length;
        setSweepNotice({
          message: `Sweep ${settledWord} ${attempted - result.failures.length} of ${threadIds.length}; ${result.failures.length} failed: ${failedTitles.join(", ")}. The failed cards stay highlighted. Click the broom to retry.`,
        });
      });
    },
    [actions, armedSweep, exitPinnedLane, rpc, sdk, sweepRun, threads],
  );

  // Undo a cancelled run, reversing exactly what it settled: unarchive the
  // Done arm's ids, unmark Done the idle arm's ids (the thread was never
  // archived; a done_set(false) returns it to its column), re-pin the
  // Pinned arm's ids (consuming the park the sweep's lane exit wrote — a
  // re-pin supersedes it), and mark the Unread arm's ids unread again (the
  // write's own echo carries the state-truth reactions, as for any
  // deliberate mark-unread). Top-level selections only, never the server's
  // whole archivedThreadIds subtree, because a child already archived
  // before the sweep must stay archived. Sequential like the run itself;
  // failures surface in the banner, the successes quietly return to their
  // columns.
  const undoSweepFor = useCallback(
    (threadIds: readonly string[], destination: SweepDestination) => {
      void (async () => {
        const failed: string[] = [];
        for (const threadId of threadIds) {
          try {
            if (destination === "done") {
              await rpc.call("done_set", { threadId, done: false });
              setDoneIds((current) => {
                const next = new Set(current);
                next.delete(threadId);
                return next;
              });
            } else if (destination === "unpinned") {
              await actions.setPinned(threadId, true);
              clearParkPin(threadId);
            } else if (destination === "read") {
              await actions.setRead(threadId, false);
            } else {
              await sdk.threads.unarchive({ threadId });
            }
          } catch (error) {
            failed.push(
              error instanceof Error ? `${threadId} (${error.message})` : threadId,
            );
          }
        }
        if (failed.length === 0) {
          setSweepNotice(null);
          return;
        }
        setSweepNotice({
          message: `Undo restored ${threadIds.length - failed.length} of ${threadIds.length}; ${failed.length} could not be restored: ${failed.join(", ")}.`,
        });
      })();
    },
    [actions, clearParkPin, rpc, sdk],
  );

  // The state-truth reaction to a thread BECOMING unread — fired by our own
  // gesture paths (card menu, pane toggle, the non-exit drag onto Unread)
  // and, with the suppression token below, by the native feed when a
  // foreign surface marks the thread unread. The card's state, not the
  // actor, decides what happens beside the mark itself:
  //  - a parked pin returns — the operator is calling the card back up the
  //    attention ladder, and the pin it had before the exit comes with it;
  //  - done is undone — unread and done contradict on the card (the same
  //    ladder rule that lets attention outrank working placement), so a
  //    Done card the operator marks unread comes back un-done.
  // Every check is on CURRENT state, so the reaction is idempotent: our
  // gestures compose it directly for an immediate response, and the feed
  // echo of the same write re-runs it as a no-op. The one non-idempotent
  // case is the drag exit itself — marking unread there must not restore
  // the park the very gesture just wrote — which is what the suppression
  // token (consumed by the write's own echo) is for.
  const applyUnreadStateEffects = useCallback(
    (threadId: string, options: { suppressParkRestore?: boolean } = {}) => {
      if (options.suppressParkRestore !== true) restoreParkedPin(threadId);
      if (doneIds.has(threadId)) {
        setDoneIds((current) => {
          const next = new Set(current);
          next.delete(threadId);
          return next;
        });
        rpc.call("done_set", { threadId, done: false }).catch(() => {});
      }
    },
    [doneIds, restoreParkedPin, rpc, setDoneIds],
  );
  /**
   * Suppression token for the drag exit's own read echo: consumed by the
   * feed's first read-state-changed event for the thread, so the gesture
   * that parks does not immediately restore its own park. It guards only
   * the restore — the un-done path cannot fire for a card the exit never
   * marked done — and any foreign surfaced write racing into the same echo
   * slot would be consumed with it; the residual races are milliseconds
   * in scale, bounded by the echo latency rather than a timer.
   */
  const unreadEchoSuppressRef = useRef<ReadonlySet<string>>(new Set());

  // Park reconciliation over the same native cross-surface feed
  // (`sdk.subscribe`, "thread:changed"): EVERY pin write — bb's sidebar,
  // another panel instance, the CLI — publishes `pin-state-changed`, which
  // closes the one gap a park marker alone cannot see. A pin that some other
  // writer takes back supersedes the parked value; without this, a later
  // Mark Not Done / Mark Unread would resurrect a pin against that intent.
  // Attribution is not needed, because the rule keys on the RESULTING pin
  // state read fresh at reconcile time: pinned → supersede (clear the park;
  // this board's own restore echo lands here too, but its park is consumed
  // synchronously with its own pin write, so the clear is the same
  // idempotent no-op either way); unpinned → the lane exit's own unpin
  // echo — the write that CAUSED the park — leaves the park alone. Threads
  // without a park are never fetched. A foreign pin+unpin cycle landing
  // entirely inside one reconcile's fresh-read latency is the residual
  // race: milliseconds, versus the previous gap's "until whenever".
  const parkIdsRef = useRef(parkIds);
  parkIdsRef.current = parkIds;
  const clearParkPinRef = useRef(clearParkPin);
  clearParkPinRef.current = clearParkPin;
  useEffect(() => {
    let disposed = false;
    try {
      const unsubscribe = sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          const threadId = pinStateChangeFromEvent(event);
          if (threadId === null || !parkIdsRef.current.has(threadId)) return;
          void sdk.threads
            .get({ threadId })
            .then(
              (row) => {
                if (disposed) return;
                if (row.pinnedAt !== null) clearParkPinRef.current(threadId);
              },
              () => {}, // A thread deleted while parked is a dead park; parks refetch prunes it.
            );
        },
      });
      return () => {
        disposed = true;
        unsubscribe();
      };
    } catch {
      // Embedded contexts (screenshot harness) have no subscribe; parks live
      // until their own gesture consumes them.
      return undefined;
    }
  }, [sdk]);

  // The surfaced read-write listener: `read-state-changed` reaches here for
  // a mark-unread landing from any surface — the native thread menu is the
  // case this exists for, and our own pane/menu gestures' echoes converge
  // idempotently. The drag exit's own echo is what the suppression token
  // is for: consumed, never decided-on. The direction is decided by a
  // fresh read, keyed on the single-writer fact (lib/pin-park): only the
  // deliberate mark-unread route writes `lastReadAt = null`; ambient
  // attention-after-last-read unread never publishes and never nulls, so
  // a park never fires on ordinary thread noise.
  useEffect(() => {
    let disposed = false;
    try {
      const unsubscribe = sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          const threadId = readStateChangeFromEvent(event);
          if (threadId === null) return;
          if (unreadEchoSuppressRef.current.has(threadId)) {
            unreadEchoSuppressRef.current = new Set([
              ...unreadEchoSuppressRef.current,
            ].filter((id) => id !== threadId));
            return;
          }
          void sdk.threads
            .get({ threadId })
            .then(
              (row) => {
                if (disposed) return;
                // Deliberately marked unread, from any surface: the state
                // truth applies, whatever the actor.
                if (row.lastReadAt === null) {
                  applyUnreadStateEffects(threadId);
                }
              },
              () => {}, // Deleted while processing: nothing to react to.
            );
        },
      });
      return () => {
        disposed = true;
        unsubscribe();
      };
    } catch {
      // Embedded contexts (screenshot harness) have no subscribe; the
      // gestures carry the effects alone.
      return undefined;
    }
  }, [applyUnreadStateEffects, sdk]);

  const menuActionsFor = useCallback(
    (thread: PluginSidebarThread): CardMenuAction[] => {
      const isThreadDone = doneIds.has(thread.id);
      // Current intent: any state-changing gesture on a snoozed card lifts
      // the snooze first — the wake recipe (read → unread later) would fire
      // under a read/pin/done/archive write that has already superseded it.
      const liftSnooze = () => {
        if (snoozedIds.has(thread.id)) clearSnooze(thread.id);
      };
      const snoozeEntries: SnoozeMenuAction[] = snoozeMenuActions({
        snoozed: snoozedIds.has(thread.id),
        clearSnooze: () => clearSnooze(thread.id),
        openPicker: () => setSnoozeDialogFor(thread.id),
      });
      return [
        {
          id: "open-new-window",
          label: "Open in new window",
          icon: "NewTab",
          run: () => {
            // noopener: the opened tab must not reach back through
            // window.opener into this board.
            window.open(
              new URL(thread.href, window.location.origin).toString(),
              "_blank",
              "noopener",
            );
          },
        },
        {
          id: "pin",
          label: thread.isPinned ? "Unpin" : "Pin",
          icon: thread.isPinned ? "PinOff" : "Pin",
          run: () => {
            liftSnooze();
            // Live intent beats the parked value: a park this gesture's
            // write supersedes must not resurrect on a later Mark Not Done
            // or Mark Unread.
            clearParkPin(thread.id);
            // Arm the reveal claim first, then ask the host: the applied
            // pin (and the card's relocation into or out of the Pinned
            // lane) lands in a later commit, so the claim's consumption
            // effect timing is what makes the reveal land AFTER the move.
            pendingStateClaimsRef.current.set(thread.id, {
              field: "isPinned",
              value: !thread.isPinned,
            });
            void actions.setPinned(thread.id, !thread.isPinned);
          },
        },
        {
          id: "read",
          label: thread.isUnread ? "Mark Read" : "Mark Unread",
          icon: thread.isUnread ? "MailOpen" : "Mail",
          run: () => {
            liftSnooze();
            // Arm the reveal claim first — setRead also rides the host
            // bridge, and the requested observable state is the toggle's
            // flipped value (the applied result), not the arg passed
            // through.
            pendingStateClaimsRef.current.set(thread.id, {
              field: "isUnread",
              value: !thread.isUnread,
            });
            // Marking unread carries the state-truth effects (a parked pin
            // returns; a Done card un-does); marking read leaves the park in
            // place — a card read now that the operator marks unread later
            // still finds its pin.
            if (thread.isUnread) {
              void actions.setRead(thread.id, true);
            } else {
              applyUnreadStateEffects(thread.id);
              void actions.setRead(thread.id, false);
            }
          },
        },
        {
          id: "done",
          label: isThreadDone ? "Mark Not Done" : "Mark Done",
          icon: isThreadDone ? "CircleCheck" : "Check",
          run: () => {
            liftSnooze();
            setDoneIds((current) => {
              const next = new Set(current);
              if (isThreadDone) next.delete(thread.id);
              else next.add(thread.id);
              return next;
            });
            rpc.call("done_set", { threadId: thread.id, done: !isThreadDone }).catch(() => {});
            // Local and optimistic: the card relocates to the Done lane (or
            // back out of it) in the same commit as this batch, so the
            // one-shot reveal can fire now — Board's layout effect
            // processes it after the move, minimally (an already-visible
            // destination lane scrolls nothing).
            requestReveal(thread.id);
            if (!isThreadDone) {
              // Done implies read: a Done card must not still claim unread
              // (and a later Mark Not Done hands the card back read).
              if (thread.isUnread) {
                void actions.setRead(thread.id, true);
              }
              // The same lane-exit rule the drops compose: marking a pinned
              // card done parks its pin as it leaves the Pinned lane.
              exitPinnedLane(thread.id);
            } else {
              // Mark Not Done is the undo; a parked pin comes back with the
              // card.
              restoreParkedPin(thread.id);
            }
          },
        },
        ...snoozeEntries,
        {
          id: "sweep-keep",
          label: doneAgeSource.kept(thread.id) ? "Allow sweep" : "Keep from sweep",
          icon: doneAgeSource.kept(thread.id) ? "Archive" : "Pin",
          run: () => {
            const nextKeep = !doneAgeSource.kept(thread.id);
            setDoneExtras((current) => ({
              ...current,
              [thread.id]: { ...current[thread.id], keep: nextKeep },
            }));
            rpc
              .call("sweep_keep_set", { threadId: thread.id, keep: nextKeep })
              .catch(() => {
                // Roll the optimistic update back when the server
                // rejects; the board must not show a keep the server
                // never recorded.
                setDoneExtras((current) => ({
                  ...current,
                  [thread.id]: { ...current[thread.id], keep: !nextKeep },
                }));
              });
          },
        },
        {
          id: "archive",
          label: thread.isArchived ? "Unarchive" : "Archive",
          icon: thread.isArchived ? "ArchiveRestore" : "Archive",
          dividerAbove: true,
          run: () => {
            liftSnooze();
            if (thread.isArchived) {
              sdk.threads.unarchive({ threadId: thread.id }).catch(() => {});
            } else {
              actions.archive(thread.id);
            }
          },
        },
        {
          id: "delete",
          label: "Delete…",
          icon: "Trash2",
          danger: true,
          run: () => actions.requestDelete(thread.id),
        },
      ];
    },
    [actions, applyUnreadStateEffects, clearParkPin, clearSnooze, doneAgeSource, doneIds, exitPinnedLane, requestReveal, restoreParkedPin, rpc, setDoneExtras, setDoneIds, setSnoozeDialogFor, snoozeUntil, snoozedIds, sdk],
  );

  if (status === "loading" && threads.length === 0) {
    return (
      <div className="p-4">
        <EmptyState>Loading threads…</EmptyState>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="p-4">
        <EmptyState>Could not load threads. Reload the panel to retry.</EmptyState>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0" data-focus-board-panel="">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <BoardToolbar
          groupBy={groupBy}
          onGroupByChange={persistGroupBy}
          filter={filter}
          onFilterChange={persistFilter}
          search={search}
          onSearchChange={persistSearch}
          projectIds={filterOptions.projectIds}
          providerIds={filterOptions.providerIds}
          projects={projects}
          providers={providers}
          onCreateProject={createProject}
          totalCount={boardCount}
          onClearFilters={() => {
            persistFilter({ projects: new Set(), providers: new Set(), states: new Set() });
            persistSearch("");
          }}
          anyFilterActive={anyFilterActive}
          onNewThread={openNewThread}
          whatsNewUnseen={whatsNewUnseen}
          onOpenWhatsNew={openWhatsNew}
          nestChildren={nestChildren}
          onNestChildrenChange={persistNestChildren}
          nestingLocked={isParentGroupBy}
        />
        {groupBy === "parent" ? (
          <ParentLaneBoard
            lanes={parentLanes ?? []}
            activeThreadId={openThreadId}
            doneIds={doneIds}
            dimmedIds={dimmedIds}
            childrenByParent={parentLaneChildrenByParent}
            projectNameFor={projectNameFor}
            repoBaseFor={repoBaseFor}
            statusFor={statusFor}
            parentLaneOrder={parentLaneOrder}
            onParentLaneOrderChange={persistParentLaneOrder}
            onOpenThread={openThreadCard}
            onClosePane={closeThreadPane}
            onNewTask={openNewThread}
            menuActionsFor={menuActionsFor}
            snoozeFor={snoozeFor}
          />
        ) : boardCount === 0 ? (
          <div className="p-4">
            <EmptyState>
              {emptyBecauseFiltered
                ? "No threads match the current group, filter, and search."
                : "No threads to show yet."}
            </EmptyState>
          </div>
        ) : (
          <Board
            columns={columns}
            groupBy={groupBy}
            activeThreadId={openThreadId}
            doneIds={doneIds}
            nestedChildrenByParent={nestedChildrenByParent}
            childCountByParent={assembly?.childCountByParent ?? new Map()}
            doneChildrenByParent={assembly?.doneChildrenByParent ?? new Map()}
            collapsedFamilyIds={collapsedFamilies}
            onFamilyCollapsedChange={setFamilyCollapsed}
            dimmedIds={dimmedIds}
            projectNameFor={projectNameFor}
            repoBaseFor={repoBaseFor}
            statusFor={statusFor}
            onOpenThread={openThreadCard}
            onClosePane={closeThreadPane}
            onNewTask={openNewThread}
            snoozeFor={snoozeFor}
            sweepCandidatesFor={sweepCandidatesFor}
            armedSweep={armedSweep}
            sweepRun={sweepRun}
            sweepNotice={sweepNotice}
            onDismissSweepNotice={clearSweepNotice}
            onSweepUndo={undoSweepFor}
            onSweepToggle={toggleSweepSelectionFor}
            sweepBlockedIds={sweepBlockedIds}
            onSweepArm={armSweepFor}
            onSweepDisarm={disarmSweep}
            onSweepConfirm={confirmSweepFor}
            onSweepCancel={cancelSweepFor}
            onDropDone={(threadId) => {
              const thread = threads.find((candidate) => candidate.id === threadId);
              const next = new Set(doneIds);
              next.add(threadId);
              setDoneIds(next);
              rpc.call("done_set", { threadId, done: true }).catch(() => {});
              // Done implies read: the card must not land in Done still
              // claiming unread (or come back from Mark Not Done unread).
              if (thread !== undefined && thread.isUnread) {
                void actions.setRead(threadId, true);
              }
              exitPinnedLane(threadId);
            }}
            onDropUnread={(threadId) => {
              const thread = threads.find((candidate) => candidate.id === threadId);
              if (thread === undefined) return;
              if (thread.isPinned) {
                // The exit: unpin + park, and register the echo suppression
                // BEFORE the gesture's own read write lands — the fresh park
                // must not be restored by the very gesture that parked it.
                unreadEchoSuppressRef.current = new Set(
                  unreadEchoSuppressRef.current,
                ).add(threadId);
                exitPinnedLane(threadId);
              } else {
                // Marking unread on an unpinned card is the attention
                // signal: state-truth effects apply — a parked pin rides
                // the mark back into Pinned, and a Done card un-does.
                applyUnreadStateEffects(threadId);
              }
              if (!thread.isUnread) {
                void actions.setRead(threadId, false);
              }
            }}
            // Drop on Pinned pins, unless the card is already pinned: a
            // pinned card's drop is a same-lane reorder (claimed by the card
            // or lane handler) and never reaches this path.
            onDropPinned={(threadId) => {
              const thread = threads.find((candidate) => candidate.id === threadId);
              if (thread !== undefined && !thread.isPinned) {
                void actions.setPinned(threadId, true);
              }
            }}
            rankStore={ranks}
            onRankMove={(columnKey, threadId, beforeId, toEnd, visibleIds) => {
              // Optimistic: the card snaps to its slot immediately, and the
              // rank-changed refetch confirms. A rejected write settles back
              // to the stored order on the next refetch rather than sticking.
              setRanks((prev) => ({
                ...prev,
                [columnKey]: applyMoveVisible(
                  orderForColumn(prev, columnKey),
                  visibleIds,
                  threadId,
                  beforeId,
                  toEnd,
                ),
              }));
              rpc
                .call("rank_move", {
                  columnKey,
                  threadId,
                  beforeId,
                  toEnd,
                  visibleIds: [...visibleIds],
                })
                .catch(() => refetchRanks());
            }}
            menuActionsFor={menuActionsFor}
            reveal={revealRequest}
          />
        )}
      </div>
      {openThread === null ? null : (
        <ThreadPane
          thread={openThread}
          isArchived={openThreadIsArchived}
          isDone={doneIds.has(openThreadId ?? "")}
          snoozeWakeAt={openThreadId === null ? null : snoozeFor(openThreadId)}
          onToggleDone={(done) => {
            if (openThreadId === null) return;
            // Current intent: a state change lifts any snooze first.
            if (snoozedIds.has(openThreadId)) clearSnooze(openThreadId);
            setDoneIds((current) => {
              const next = new Set(current);
              if (done) next.add(openThreadId);
              else next.delete(openThreadId);
              return next;
            });
            rpc.call("done_set", { threadId: openThreadId, done }).catch(() => {});
          }}
          onToggleArchived={() => {
            if (openThreadId === null) return;
            if (openThreadIsArchived) {
              sdk.threads.unarchive({ threadId: openThreadId }).catch(() => {});
            } else {
              actions.archive(openThreadId);
            }
          }}
          onTogglePinned={() => {
            if (openThreadId === null || openThreadActive === null) return;
            // Same semantics as the card menu's pin: a state change lifts any
            // snooze first, and a live intent beats the parked value.
            if (snoozedIds.has(openThreadId)) clearSnooze(openThreadId);
            clearParkPin(openThreadId);
            // Arm the reveal claim first, then ask the host: the applied pin
            // (and the card's relocation into or out of the Pinned lane) lands
            // in a later commit, so the claim's consumption effect timing is
            // what makes the reveal land AFTER the move.
            pendingStateClaimsRef.current.set(openThreadId, {
              field: "isPinned",
              value: !openThreadActive.isPinned,
            });
            void actions.setPinned(openThreadId, !openThreadActive.isPinned);
          }}
          snoozeMenuItems={snoozeMenuActions({
            snoozed: snoozedIds.has(openThread.id),
            clearSnooze: () => clearSnooze(openThread.id),
            openPicker: () => setSnoozeDialogFor(openThread.id),
          })}
          onToggleUnread={() => {
            if (openThreadId === null || openThreadActive === null) return;
            // Current intent: a state change lifts any snooze first.
            if (snoozedIds.has(openThreadId)) clearSnooze(openThreadId);
            if (openThreadActive.isUnread) {
              void actions.setRead(openThreadId, true);
            } else {
              // Same state-truth effects as every other mark-unread path:
              // a parked pin returns, a Done card un-does.
              applyUnreadStateEffects(openThreadId);
              void actions.setRead(openThreadId, false);
            }
          }}
          onRename={(title) => actions.rename(openThread.id, title)}
          onMaximize={() => navigate.toThread(openThread.id)}
          onClose={closeThreadPane}
          escapeSuppressed={newThreadOpen}
          escStopsRunningThread={escStopsRunningThread}
        />
      )}
      <NewThreadModal
        open={newThreadOpen}
        onOpenChange={setNewThreadOpen}
        defaultProjectId={newThreadProjectId}
        focusRequest={composerFocusRequest}
        onSpawned={handleSpawnedThread}
      />
      <WhatsNewModal
        open={whatsNewOpen}
        onOpenChange={setWhatsNewOpen}
        entries={whatsNewEntries}
      />
      {snoozeDialogFor === null ? null : (() => {
        const dialogThread = threads.find((candidate) => candidate.id === snoozeDialogFor);
        if (dialogThread === undefined) {
          // The thread left the board while the picker was open: close quietly.
          setSnoozeDialogFor(null);
          return null;
        }
        return (
          <SnoozeDialog
            threadTitle={dialogThread.displayTitle}
            currentWakeAt={snoozeFor(dialogThread.id)}
            onConfirm={(wakeAt) => {
              snoozeUntil(dialogThread.id, wakeAt);
              setSnoozeDialogFor(null);
            }}
            onRemove={() => {
              clearSnooze(dialogThread.id);
              setSnoozeDialogFor(null);
            }}
            onCancel={() => setSnoozeDialogFor(null)}
          />
        );
      })()}
    </div>
  );
}

export default definePluginApp((app) => {
  // The brand mark joins the host's app-wide icon registry under the name
  // "FocusBoard", so every host-rendered surface that takes a `BbIconName`
  // — the sidebar nav row and the pane's title-bar tab — can draw the same
  // mark the manifest's branding.icon shows on the Tools pages, instead of
  // the Columns2 placeholder this registration used to hardcode.
  app.experimental_icons.register({
    name: "FocusBoard",
    component: FocusBoardAppIcon,
  });
  app.slots.navPanel({
    id: "board",
    title: "Focus Board",
    icon: "FocusBoard",
    path: PANEL_PATH,
    // The pane's thread arrives through the `subPath` prop (`t/<id>`), so
    // the open pane participates in browser history — bb's back arrow
    // reopens the pane state the user left, and deep links restore it.
    component: BoardPage,
  });
  // A gear icon in the sidebar footer (beside the built-in Settings and
  // bug-report buttons) that jumps to this plugin's detail page in Tools,
  // where its declarative settings — including the pane's Escape behavior —
  // render. bb's sidebar entry context menu is host-owned with no plugin
  // extension point, so this footer gear is the plugin's own shortcut to
  // the configuration panel.
  app.slots.sidebarFooterAction({
    id: "open-settings",
    title: "Focus Board settings",
    icon: "Settings",
    run: (context) => context.openSettings(),
  });
  // The host paints its own ExternalLink glyph inside linkified anchors
  // rendered in this panel's pane (ThreadChat's markdown) — an atomic
  // inline that can wrap onto its own line at wrap widths. Fix it where
  // it is ours, in the app shell, by fusing glyph and last character
  // (components/host-link-glue.ts). The host's own main-thread windows
  // stay untouched here; that is filed upstream.
  app.contentScripts.register({
    id: "host-link-glue",
    mount: (context) => installHostLinkGlue(context),
  });
});
