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
} from "@get-bb/plugin-sdk/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { findTicketRefs, resolveRepoSlug } from "./lib/tickets";
import type { rpcContract } from "./server";
import { Board } from "./components/board";
import { BoardToolbar } from "./components/board-toolbar";
import { ThreadPane } from "./components/thread-pane";
import type { ThreadPaneThread } from "./components/thread-pane";
import type { CardMenuAction } from "./components/thread-card-menu";
import type { FilterState, GroupBy, ThreadState } from "./components/grouping";
import {
  buildColumns,
  columnFor,
  matchesFilter,
} from "./components/grouping";
import {
  buildFamilyIndex,
  filterFamilies,
  filterIndividually,
  assembleBoard,
} from "./components/nesting";
import { buildParentLanes } from "./components/parent-lanes";
import { ParentLaneBoard } from "./components/parent-lane-board";
import { doneAtToEpochMs } from "./lib/done-metadata";
import {
  paneSubPathFor,
  paneThreadIdFromSubPath,
} from "./lib/pane-route";
import { applyMoveVisible, orderForColumn, type RankStore } from "./lib/rank";
import {
  DEFAULT_DONE_ARCHIVE_DAYS,
  DEFAULT_IDLE_ARCHIVE_DAYS,
  armSweep,
  confirmSweep,
  sweepCandidatesForDoneColumn,
  sweepCandidatesForIdleColumn,
  sweepColumnKind,
  type ArmedSweep,
  type DoneAgeSource,
} from "./lib/sweep";
import { useSweepClickAway } from "./components/board";
import {
  GROUP_BY_KEY,
  NEST_CHILDREN_KEY,
  nestStoredValue,
  parseNestStored,
  parseGroupStored,
} from "./components/preferences";
import { EmptyState } from "./components/empty-state";
import { WhatsNewModal } from "./components/whats-new-modal";
import {
  APP_VERSION,
  WHATS_NEW,
  compareVersions,
  entriesSince,
  readLastSeenVersion,
  writeLastSeenVersion,
  type WhatsNewEntry,
} from "./lib/whats-new";

const FILTER_KEY = "focus-board:filter";
const SEARCH_KEY = "focus-board:search";
/** This panel's own registered route path, for pane-history pushes. */
const PANEL_PATH = "board";

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
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const { providers } = experimental_useProviders();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();

  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(new Set());
  // Done ages + sweep overrides come from the per-thread plugin-metadata
  // records: doneAt is the ISO stamp, keep the sweep override. The epoch
  // adapter (lib/done-metadata) feeds the sweep's injected `now` contract.
  const [doneExtras, setDoneExtras] = useState<Record<string, { doneAt?: number; keep?: boolean }>>({});
  const [sweepConfig, setSweepConfig] = useState({
    doneArchiveDays: DEFAULT_DONE_ARCHIVE_DAYS,
    idleArchiveDays: DEFAULT_IDLE_ARCHIVE_DAYS,
  });
  useEffect(() => {
    rpc.call("done_list").then(
      (result) => {
        setDoneIds(new Set(result.doneIds));
        setDoneExtras(recordsAsExtras(result.records));
      },
      () => {}, // Done marking is optional state; the board works without it.
    );
    rpc.call("sweep_config_get").then(
      (result) =>
        setSweepConfig({
          doneArchiveDays: result.doneArchiveDays,
          idleArchiveDays: result.idleArchiveDays,
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
    rpc.call("sweep_config_get").then(
      (result) =>
        setSweepConfig({
          doneArchiveDays: result.doneArchiveDays,
          idleArchiveDays: result.idleArchiveDays,
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
    readonly { id: string; title: string | null; titleFallback: string | null }[]
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
  const [search, setSearch] = useState<string>(() => readStored(SEARCH_KEY, [], ""));
  // R3 "Nest child threads" toggle, default ON, persisted like groupBy.
  const [nestChildren, setNestChildren] = useState<boolean>(() =>
    parseNestStored(readStored(NEST_CHILDREN_KEY, ["on", "off"], "on")),
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
  const disarmSweep = useCallback(() => setArmedSweep(null), []);
  useSweepClickAway(armedSweep !== null, disarmSweep);
  // What's new: the stored last-seen version vs the running build. A fresh
  // install (nothing stored) is stamped silently — everything is new, so
  // nothing counts as new. An upgrade leaves the gift button pulsing until
  // the modal is opened; opening marks seen, the button itself never leaves.
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(
    () => readLastSeenVersion(),
  );
  useEffect(() => {
    if (lastSeenVersion === null) {
      writeLastSeenVersion(APP_VERSION);
      setLastSeenVersion(APP_VERSION);
    }
  }, [lastSeenVersion]);
  const whatsNewUnseen =
    lastSeenVersion !== null && compareVersions(APP_VERSION, lastSeenVersion) > 0;
  // The delta is captured at load (before opening marks it seen): entries
  // since the stored version when one is pending, all recent entries when
  // the quiet button is used.
  const whatsNewEntries: readonly WhatsNewEntry[] = useMemo(
    () => (whatsNewUnseen ? entriesSince(lastSeenVersion) : WHATS_NEW),
    [whatsNewUnseen, lastSeenVersion],
  );
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const openWhatsNew = useCallback(() => {
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

  // The sidebar view pushes fresh thread data continuously; this signal
  // additionally fires on host-side changes so cards never sit stale.
  useRealtime("thread-list-changed", () => {});

  // R2: the family pipeline runs on the NON-HIDDEN set — archived threads
  // are included so an archived child stays under its parent. Archived
  // threads never render standalone; `assembleBoard` keeps them out of the
  // columns in both modes.
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
  // dimmed (archived riders always dim; they never contribute a match).
  // Nesting OFF means a fully flat board — per-thread filtering again.
  const familyIndex = useMemo(() => buildFamilyIndex(nonHiddenThreads), [nonHiddenThreads]);
  const familyFiltered = useMemo(
    () =>
      nestChildren
        ? filterFamilies(nonHiddenThreads, familyIndex, filter, search.trim())
        : filterIndividually(nonHiddenThreads, filter, search.trim()),
    [nestChildren, nonHiddenThreads, familyIndex, filter, search],
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
  // card — never both standalone AND nested. The raw index's counts drive the
  // parent card's child-count chip, which counts every child (archived
  // included). With nesting OFF the board is flat: no rows, no chips.
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

  // Sweep eligibility per sweepable column, computed from the current board
  // data. Arming (in armSweepFor) captures this list at arm time; while a
  // sweep is armed the FROZEN list is what Board displays and what confirm
  // archives — the live recompute is only for the next arm.
  //
  // Sweep-family contract: a thread with ≥1 live (non-archived) child is
  // never sweep-eligible in either arm; children stay eligible
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
      return sweepColumnKind(columnId) === "done"
        ? sweepCandidatesForDoneColumn(
            column.threads,
            doneIds,
            doneAgeSource,
            { doneArchiveDays: sweepConfig.doneArchiveDays },
            now,
            liveChildParentIds,
          )
        : sweepCandidatesForIdleColumn(
            column.threads,
            doneIds,
            { idleArchiveDays: sweepConfig.idleArchiveDays, kept: idleKept },
            now,
            liveChildParentIds,
          );
    },
    [columns, doneIds, doneAgeSource, idleKept, liveChildParentIds, sweepConfig],
  );

  const armSweepFor = useCallback(
    (columnId: string) => {
      setArmedSweep(armSweep(columnId, sweepCandidatesFor(columnId)));
    },
    [sweepCandidatesFor],
  );

  const confirmSweepFor = useCallback(
    (columnId: string) => {
      // Side effects stay out of the state updater: read the armed snapshot,
      // clear it, then archive. React may re-invoke updaters; an archive call
      // must never run twice.
      const current = armedSweep;
      if (current === null || current.columnId !== columnId) return;
      setArmedSweep(null);
      for (const threadId of confirmSweep(current, true)) actions.archive(threadId);
    },
    [actions, armedSweep],
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
  const openNewThread = useCallback(() => {
    actions.openNewThread({
      ...(newThreadProjectId === undefined ? {} : { projectId: newThreadProjectId }),
      focusPrompt: true,
    });
  }, [actions, newThreadProjectId]);
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
        }
      : openThreadArchived !== null
        ? {
            id: openThreadArchived.id,
            displayTitle:
              openThreadArchived.title ?? openThreadArchived.titleFallback ?? openThreadArchived.id,
            status: "idle",
            isUnread: false,
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

  const menuActionsFor = useCallback(
    (thread: PluginSidebarThread): CardMenuAction[] => {
      const isThreadDone = doneIds.has(thread.id);
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
          run: () => void actions.setPinned(thread.id, !thread.isPinned),
        },
        {
          id: "read",
          label: thread.isUnread ? "Mark Read" : "Mark Unread",
          icon: thread.isUnread ? "MailOpen" : "Mail",
          run: () => void actions.setRead(thread.id, thread.isUnread),
        },
        {
          id: "done",
          label: isThreadDone ? "Mark Not Done" : "Mark Done",
          icon: isThreadDone ? "CircleCheck" : "Check",
          run: () => {
            setDoneIds((current) => {
              const next = new Set(current);
              if (isThreadDone) next.delete(thread.id);
              else next.add(thread.id);
              return next;
            });
            rpc.call("done_set", { threadId: thread.id, done: !isThreadDone }).catch(() => {});
          },
        },
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
    [actions, doneAgeSource, doneIds, rpc, setDoneExtras, setDoneIds, sdk],
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
    <div className="flex h-full min-h-0">
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
        />
        {groupBy === "parent" ? (
          <ParentLaneBoard
            lanes={parentLanes ?? []}
            activeThreadId={openThreadId}
            doneIds={doneIds}
            dimmedIds={dimmedIds}
            childrenByParent={parentLaneChildrenByParent}
            projectNameFor={(projectId) =>
              projects.find((project) => project.id === projectId)?.name ?? "Personal"
            }
            repoBaseFor={repoBaseFor}
            statusFor={statusFor}
            onOpenThread={openThreadCard}
            onClosePane={closeThreadPane}
            onNewTask={openNewThread}
            menuActionsFor={menuActionsFor}
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
            nestedChildrenByParent={assembly?.nestedChildrenByParent ?? new Map()}
            childCountByParent={assembly?.childCountByParent ?? new Map()}
            dimmedIds={dimmedIds}
            projectNameFor={(projectId) =>
              projects.find((project) => project.id === projectId)?.name ?? "Personal"
            }
            repoBaseFor={repoBaseFor}
            statusFor={statusFor}
            onOpenThread={openThreadCard}
            onClosePane={closeThreadPane}
            onNewTask={openNewThread}
            sweepCandidatesFor={sweepCandidatesFor}
            armedSweep={armedSweep}
            onSweepArm={armSweepFor}
            onSweepDisarm={disarmSweep}
            onSweepConfirm={confirmSweepFor}
            onDropDone={(threadId) => {
              const next = new Set(doneIds);
              next.add(threadId);
              setDoneIds(next);
              rpc.call("done_set", { threadId, done: true }).catch(() => {});
            }}
            onDropUnread={(threadId) => {
              const thread = threads.find((candidate) => candidate.id === threadId);
              if (thread !== undefined && !thread.isUnread) {
                void actions.setRead(threadId, false);
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
          />
        )}
      </div>
      {openThread === null ? null : (
        <ThreadPane
          thread={openThread}
          isArchived={openThreadIsArchived}
          isDone={doneIds.has(openThreadId ?? "")}
          onToggleDone={(done) => {
            if (openThreadId === null) return;
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
          onToggleUnread={() => {
            if (openThreadId === null || openThreadActive === null) return;
            void actions.setRead(openThreadId, openThreadActive.isUnread);
          }}
          onRename={(title) => actions.rename(openThread.id, title)}
          onMaximize={() => navigate.toThread(openThread.id)}
          onClose={closeThreadPane}
        />
      )}
      <WhatsNewModal
        open={whatsNewOpen}
        onOpenChange={setWhatsNewOpen}
        entries={whatsNewEntries}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "board",
    title: "Focus Board",
    icon: "Columns2",
    path: PANEL_PATH,
    // The pane's thread arrives through the `subPath` prop (`t/<id>`), so
    // the open pane participates in browser history — bb's back arrow
    // reopens the pane state the user left, and deep links restore it.
    component: BoardPage,
  });
});