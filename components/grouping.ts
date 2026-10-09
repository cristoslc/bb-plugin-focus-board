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
  | "machine"
  | "parent";

export const GROUP_BY_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "status", label: "Attention" },
  { value: "parent", label: "Parent thread" },
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

export const IDLE_BUCKETS = AGE_BUCKETS.map((bucket) => ({
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

/**
 * Search predicate for the toolbar's filter box. Matches the thread's own
 * fields (title and id) PLUS the two fields the card's footer line renders
 * (ThreadCard's `{projectName} · {branch}` strip): the project's display
 * name and the branch. Branch derives the same way ThreadCard derives it —
 * the environment's branch, falling back to the host's name when the thread
 * has no branch to show. All matches are case-insensitive. Family filtering
 * runs this over children too, so a hit on a child (title, project, or
 * branch) keeps the whole family.
 */
export function matchesFilter(
  thread: PluginSidebarThread,
  query: string,
  projectNameFor?: (projectId: string) => string,
): boolean {
  const q = query.toLowerCase();
  const project = (projectNameFor?.(thread.projectId) ?? "").toLowerCase();
  const branch = (thread.environment?.branchName ?? thread.host?.name ?? "").toLowerCase();
  return (
    thread.displayTitle.toLowerCase().includes(q) ||
    thread.id.toLowerCase().includes(q) ||
    (project !== "" && project.includes(q)) ||
    (branch !== "" && branch.includes(q))
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
 * Most recently done first: the done-children rows under a done parent's
 * card, and the parent-lane board's Done row (D9). The main board's Done
 * column does not sort this way — its default is the board's derived order
 * (activity recency), because the idle sweep stamps a fresh `doneAt` on
 * long-idle threads and a stamp-based order would vault those quiet threads
 * to the top of the column.
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

  // "Working" never leaves the attention board: a board whose every thread
  // has gone idle still carries the lane, empty, where the UI reads
  // "No work in progress". Every other lane keeps the "columns exist only
  // while they hold cards" rule, so the lane is inserted where a populated
  // working bucket would sit — before the idle buckets.
  if (groupBy === "status" && !columns.some((column) => column.id === "working")) {
    const idleStart = columns.findIndex((column) => column.id.startsWith("idle-"));
    columns.splice(idleStart === -1 ? columns.length : idleStart, 0, {
      id: "working",
      label: THREAD_STATE_LABELS.working,
      threads: [],
    });
  }

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
  // Default order is the board's derived order — pinned first, then most
  // recently active at top — matching every other column, rather than the
  // done stamp: the idle sweep marks long-idle threads Done with a fresh
  // stamp, and a stamp-based order would vault those quiet threads above
  // recently active ones. A stored drag order (rank key "done") rides on top
  // of that default, exactly as in every other column.
  if (done.length > 0) {
    columns.push({
      id: "done",
      label: "Done",
      threads: sorted(done, orderForColumn(ranks, columnRankKey(groupBy, "done"))),
    });
  }
  // A grouping with no buckets at all still shows the flat column.
  if (groupBy === "none" && columns.length === 0) {
    return [{ id: "all", label: "Threads", threads: [] }];
  }
  return columns;
}

// RETIRED 2026-10-01: `withSweepGather` (selected cards sorted to the top
// while a sweep is armed) is gone. With manual click-to-toggle selection,
// re-sorting on every toggle made cards jump around the column — deselecting
// sent a card back down the list mid-gesture, which read as disorienting
// shuffling. Sweep state never reorders the column now; the highlight and
// the selected count carry the blast radius.
/**
 * Swimlanes: a second, horizontal grouping axis that splits the board into
 * rows. Columns keep the Group-by dimension; every lane carries the SAME
 * column set (empty cells included) so the cells line up under one shared
 * header row. "parent" is not a lane axis — it has its own board.
 */
export type SwimlaneBy = "none" | "status" | "recency" | "project" | "provider" | "machine";

export const SWIMLANE_BY_OPTIONS: readonly { value: SwimlaneBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "project", label: "Project" },
  { value: "provider", label: "Provider" },
  { value: "machine", label: "Machine" },
  { value: "status", label: "Attention" },
  { value: "recency", label: "Last activity" },
];

export interface Swimlane {
  id: string;
  label: string;
  /** Same ids, labels, and order as the board's columns; threads are the lane's share. */
  columns: BoardColumn[];
  count: number;
}

/**
 * Swimlanes only apply on the column board, and only when they split along a
 * different axis than the columns do.
 */
export function swimlanesActive(groupBy: GroupBy, swimlaneBy: SwimlaneBy): boolean {
  return swimlaneBy !== "none" && groupBy !== "parent" && groupBy !== swimlaneBy;
}

/**
 * Partition already-assembled columns into lanes. Each card's lane comes from
 * `columnFor` on the lane axis, so it reads exactly like the matching Group-by
 * (a project lane is labelled like a project column). Column order inside a
 * lane is the global column order filtered, so a hand-ordered column stays in
 * the operator's order in every lane. Lanes holding no cards are omitted.
 */
export function buildSwimlanes(
  columns: readonly BoardColumn[],
  swimlaneBy: SwimlaneBy,
  context: GroupingContext,
  now: number = Date.now(),
): Swimlane[] {
  if (swimlaneBy === "none") {
    const count = columns.reduce((sum, column) => sum + column.threads.length, 0);
    return [{ id: "all", label: "Threads", columns: [...columns], count }];
  }
  const lanes = new Map<string, { label: string; cells: Map<string, PluginSidebarThread[]> }>();
  for (const column of columns) {
    for (const thread of column.threads) {
      const lane = columnFor(thread, swimlaneBy, context, now);
      let entry = lanes.get(lane.id);
      if (entry === undefined) {
        entry = { label: lane.label, cells: new Map() };
        lanes.set(lane.id, entry);
      }
      const cell = entry.cells.get(column.id);
      if (cell === undefined) entry.cells.set(column.id, [thread]);
      else cell.push(thread);
    }
  }
  return [...lanes.entries()]
    .sort((a, b) => {
      // Unassigned buckets ("No machine", an empty project) trail the board.
      const aNone = a[0] === "none" ? 1 : 0;
      const bNone = b[0] === "none" ? 1 : 0;
      if (aNone !== bNone) return aNone - bNone;
      const keyDiff = columnSortKey(swimlaneBy, a[0]) - columnSortKey(swimlaneBy, b[0]);
      if (keyDiff !== 0) return keyDiff;
      return a[1].label.localeCompare(b[1].label);
    })
    .map(([id, entry]) => {
      const laneColumns = columns.map((column) => ({
        id: column.id,
        label: column.label,
        threads: entry.cells.get(column.id) ?? [],
      }));
      const count = laneColumns.reduce((sum, column) => sum + column.threads.length, 0);
      return { id, label: entry.label, columns: laneColumns, count };
    });
}
