import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  columnRankKey,
  compareByRank,
  orderForColumn,
  type ColumnOrder,
  type RankStore,
} from "../lib/rank";

export type GroupBy =
  | "none"
  | "status"
  | "recency"
  | "project"
  | "provider"
  | "machine";

export const GROUP_BY_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "status", label: "Attention" },
  { value: "recency", label: "Last activity" },
  { value: "project", label: "Project" },
  { value: "provider", label: "Provider" },
  { value: "machine", label: "Machine" },
  { value: "none", label: "None" },
];

export type ThreadState = "working" | "attention" | "unread" | "idle";

export type FilterState = {
  /** Empty set means all projects; a non-empty set restricts to those ids. */
  projects: ReadonlySet<string>;
  /** Empty set means all providers; a non-empty set restricts to those ids. */
  providers: ReadonlySet<string>;
  /** Empty set means all states; a non-empty set restricts to those states. */
  states: ReadonlySet<ThreadState>;
};

export interface BoardColumn {
  id: string;
  label: string;
  threads: PluginSidebarThread[];
}

export interface GroupingContext {
  projects: readonly PluginSidebarProject[];
  providers: readonly { id: string; displayName?: string }[];
}

export function threadState(thread: PluginSidebarThread): ThreadState {
  // Attention outranks working: a turn that is paused waiting on the operator
  // (a pending interaction such as a secret request, or an unread error) still
  // reports a running status, but the card belongs in "Needs you" until the
  // operator acts.
  if (thread.hasPendingInteraction || thread.indicator === "unread-error") {
    return "attention";
  }
  if (
    thread.status === "active" ||
    thread.status === "starting" ||
    thread.status === "stopping" ||
    thread.status === "pending"
  ) {
    return "working";
  }
  if (thread.isUnread) {
    return "unread";
  }
  return "idle";
}

export const THREAD_STATE_LABELS: Record<ThreadState, string> = {
  working: "Working",
  attention: "Needs you",
  unread: "Unread",
  idle: "Idle",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Age buckets for idle threads (Attention grouping) and for all
// threads (Last activity grouping). Ordered oldest-first for lookup; the
// column orders below reverse them so boards read newest-leftmost.
const AGE_BUCKETS: { id: string; label: string; minAge: number; maxAge: number }[] = [
  { id: "awhile", label: "A while ago", minAge: 7 * DAY, maxAge: Number.POSITIVE_INFINITY },
  { id: "earlier", label: "Earlier", minAge: DAY, maxAge: 7 * DAY },
  { id: "today", label: "Today", minAge: HOUR, maxAge: DAY },
  { id: "recent", label: "Recent", minAge: 0, maxAge: HOUR },
];

// Column display order per grouping, left to right, derived from AGE_BUCKETS
// (most recent leftmost, least recent rightmost) so the board reads in order
// of attention/focus: Pinned (prepended in buildColumns), then lanes wanting
// the operator, then lanes to catch up on, then running, then recency buckets.
// Done (appended in buildColumns) trails far right.
const RECENCY_COLUMN_ORDER: readonly string[] = [...AGE_BUCKETS]
  .reverse()
  .map((bucket) => bucket.id);
export const STATUS_COLUMN_ORDER: readonly string[] = [
  "attention",
  "unread",
  "working",
  ...RECENCY_COLUMN_ORDER.map((id) => `idle-${id}`),
];

const IDLE_BUCKETS = AGE_BUCKETS.map((bucket) => ({
  ...bucket,
  id: `idle-${bucket.id}`,
  label: `Idle · ${bucket.label}`,
}));

function ageBucketFor(
  age: number,
  buckets: typeof AGE_BUCKETS,
): { id: string; label: string } {
  const match = buckets.find((candidate) => age >= candidate.minAge && age < candidate.maxAge);
  return match ?? buckets[buckets.length - 1];
}

export function matchesFilter(thread: PluginSidebarThread, query: string): boolean {
  const q = query.toLowerCase();
  return (
    thread.displayTitle.toLowerCase().includes(q) ||
    thread.id.toLowerCase().includes(q)
  );
}

export function filterThreads(
  threads: readonly PluginSidebarThread[],
  filter: FilterState,
): PluginSidebarThread[] {
  return threads.filter((thread) => {
    if (filter.projects.size > 0 && !filter.projects.has(thread.projectId)) return false;
    if (filter.providers.size > 0 && !filter.providers.has(thread.providerId)) return false;
    if (filter.states.size > 0 && !filter.states.has(threadState(thread))) return false;
    return true;
  });
}

/** The board's derived order: pinned first, then newest-first. This is the
 *  tiebreak under a manual rank AND the whole order for an unranked column.
 *  Exported so the nesting pass sorts a family in the same order its column
 *  does — a parent honouring a rank with children that ignore it is a lie. */
export function derivedCompare(
  a: PluginSidebarThread,
  b: PluginSidebarThread,
): number {
  const aPinned = a.isPinned ? 0 : 1;
  const bPinned = b.isPinned ? 0 : 1;
  if (aPinned !== bPinned) return aPinned - bPinned;
  return b.updatedAt - a.updatedAt;
}

function sorted(
  threads: readonly PluginSidebarThread[],
  order: ColumnOrder = [],
  derived: (a: PluginSidebarThread, b: PluginSidebarThread) => number = derivedCompare,
): PluginSidebarThread[] {
  return [...threads].sort(compareByRank(order, derived));
}

/**
 * The Done column's derived order: most recently done first. A thread with no
 * recorded doneAt (marked done but the record is missing, e.g. a fresh board
 * over legacy state) cannot be placed on the done timeline, so it sorts below
 * every recorded one, in the board's derived order — assuming "just now" for
 * an unknown stamp would vault it over cards the operator watched get done.
 */
export function doneRecencyCompare(
  doneTimes: ReadonlyMap<string, number>,
): (a: PluginSidebarThread, b: PluginSidebarThread) => number {
  return (a, b) => {
    const aDone = doneTimes.get(a.id);
    const bDone = doneTimes.get(b.id);
    if (aDone !== undefined && bDone !== undefined) return bDone - aDone;
    if (aDone !== undefined) return -1;
    if (bDone !== undefined) return 1;
    return derivedCompare(a, b);
  };
}

/**
 * Which column a thread naturally belongs to under the current grouping.
 * Single source of truth: buildColumns groups by it, and a selected thread's
 * column is frozen by remembering this value when it was selected.
 */
export function columnFor(
  thread: PluginSidebarThread,
  groupBy: GroupBy,
  context: GroupingContext,
  now: number = Date.now(),
): { id: string; label: string } {
  if (groupBy === "none") return { id: "all", label: "Threads" };
  if (groupBy === "status") {
    const state = threadState(thread);
    if (state !== "idle") return { id: state, label: THREAD_STATE_LABELS[state] };
    const age = now - thread.updatedAt;
    return ageBucketFor(age, IDLE_BUCKETS);
  }
  if (groupBy === "recency") {
    const age = now - thread.updatedAt;
    return ageBucketFor(age, AGE_BUCKETS);
  }
  // Machine comes from the thread payload itself: the SDK resolves the host's
  // display name for us, so no context lookup is needed.
  if (groupBy === "machine") {
    return thread.host
      ? { id: thread.host.id, label: thread.host.name }
      : { id: "none", label: "No machine" };
  }
  const key = groupBy === "project" ? thread.projectId : thread.providerId;
  const label = labelFor(groupBy, key, context);
  return { id: key === "" ? "none" : key, label };
}

function labelFor(groupBy: GroupBy, key: string, context: GroupingContext): string {
  if (groupBy === "project") {
    return context.projects.find((project) => project.id === key)?.name ?? "Unknown project";
  }
  return context.providers.find((entry) => entry.id === key)?.displayName ?? key;
}

/** Column display order: fixed lanes first (where applicable), then others. */
function columnSortKey(groupBy: GroupBy, columnId: string): number {
  const fixedOrder =
    groupBy === "status"
      ? STATUS_COLUMN_ORDER
      : groupBy === "recency"
        ? RECENCY_COLUMN_ORDER
        : groupBy === "none"
          ? ["all"]
          : []
  const index = fixedOrder.indexOf(columnId);
  return index === -1 ? fixedOrder.length : index;
}

export function buildColumns(
  threads: readonly PluginSidebarThread[],
  groupBy: GroupBy,
  context: GroupingContext,
  frozenColumns: ReadonlyMap<string, { id: string; label: string }> = new Map(),
  doneIds: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
  ranks: RankStore = {},
  doneTimes: ReadonlyMap<string, number> = new Map(),
  columnOverrides: ReadonlyMap<string, { id: string; label: string }> = new Map(),
): BoardColumn[] {
  // Threads marked Done form their own column, always farthest right on the
  // Attention board and present (dimmed) on every other grouping.
  const active = threads.filter((thread) => !doneIds.has(thread.id));
  const done = threads.filter((thread) => doneIds.has(thread.id));

  // Pinned threads (bb's own pin state) lead every board in a far-left
  // column, exactly as they lead bb's own sidebar list.
  const unpinned = active.filter((thread) => !thread.isPinned);
  const pinned = active.filter((thread) => thread.isPinned);

  // A thread whose column was frozen at selection time (because it is open in
  // the pane) keeps that column until it is deselected — state or age changes
  // must not slide the card the user is looking at to another column. R4:
  // next the family-column override (the family lands in its most
  // attention-requiring member's column), then the thread's own assignment.
  const assignments = new Map<string, { id: string; label: string }>();
  for (const thread of unpinned) {
    const frozen = frozenColumns.get(thread.id);
    assignments.set(
      thread.id,
      frozen ?? columnOverrides.get(thread.id) ?? columnFor(thread, groupBy, context, now),
    );
  }

  const buckets = new Map<string, { label: string; threads: PluginSidebarThread[] }>();
  for (const thread of unpinned) {
    const target = assignments.get(thread.id);
    if (target === undefined) continue;
    const bucket = buckets.get(target.id);
    if (bucket === undefined) {
      buckets.set(target.id, { label: target.label, threads: [thread] });
    } else {
      bucket.threads.push(thread);
    }
  }

  const columns: BoardColumn[] = [...buckets.entries()]
    .sort((a, b) => {
      const keyDiff = columnSortKey(groupBy, a[0]) - columnSortKey(groupBy, b[0]);
      if (keyDiff !== 0) return keyDiff;
      return a[1].label.localeCompare(b[1].label);
    })
    .map(([id, bucket]) => ({
      id,
      label: bucket.label,
      threads: sorted(bucket.threads, orderForColumn(ranks, columnRankKey(groupBy, id))),
    }));

  // The Pinned column renders whenever a card has entered it, at the far
  // left, before every other column.
  if (pinned.length > 0) {
    columns.unshift({
      id: "pinned",
      label: "Pinned",
      threads: sorted(pinned, orderForColumn(ranks, columnRankKey(groupBy, "pinned"))),
    });
  }

  // The Done column renders whenever a card has entered it, at the far right.
  // Default order is by the done stamp, newest done first; a stored drag
  // order (rank key "done") rides on top of that default, exactly as in
  // every other column.
  if (done.length > 0) {
    columns.push({
      id: "done",
      label: "Done",
      threads: sorted(
        done,
        orderForColumn(ranks, columnRankKey(groupBy, "done")),
        doneRecencyCompare(doneTimes),
      ),
    });
  }
  // A grouping with no buckets at all still shows the flat column.
  if (groupBy === "none" && columns.length === 0) {
    return [{ id: "all", label: "Threads", threads: [] }];
  }
  return columns;
}

/**
 * While a column's sweep is armed, its captured cards gather at the top so
 * the blast radius reads at a glance. Armed order (newest-first from the
 * eligibility functions) leads; the rest keep their relative order. Unknown
 * ids are ignored and duplicates collapse — every card stays present once.
 */
export function withSweepGather(
  threads: readonly PluginSidebarThread[],
  armedThreadIds: readonly string[],
): PluginSidebarThread[] {
  if (armedThreadIds.length === 0) return [...threads];
  const armedSet = new Set(armedThreadIds);
  const gathered = threads.filter((thread) => armedSet.has(thread.id));
  const rest = threads.filter((thread) => !armedSet.has(thread.id));
  return [...gathered, ...rest];
}