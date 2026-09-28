import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  IDLE_BUCKETS,
  STATUS_COLUMN_ORDER,
  THREAD_STATE_LABELS,
  columnFor,
  derivedCompare,
  doneRecencyCompare,
  threadState,
  type GroupBy,
  type GroupingContext,
  type ThreadState,
} from "./grouping";
import { buildFamilyIndex } from "./nesting";

export type { GroupBy };

/** Horizontal row order for the parent-lane board: the Attention ladder,
 *  most attention-needing at the top, with Done appended at the bottom. */
export const PARENT_LANE_ROW_ORDER: readonly string[] = [...STATUS_COLUMN_ORDER, "done"];

export interface ParentLaneRow {
  id: string;
  label: string;
  threads: PluginSidebarThread[];
}

export interface ParentLane {
  id: string;
  /** The lane's parent thread, or null for the catch-all Standalone lane. */
  parent: PluginSidebarThread | null;
  label: string;
  /** Total children of the parent (archived included); zero for Standalone. */
  childCount: number;
  /** Thread that drives the lane header's state dot and click target. */
  headerThread: PluginSidebarThread | null;
  rows: ParentLaneRow[];
  /** Archived children render under the family lane header (R2/D7). */
  archivedChildren: PluginSidebarThread[];
}

const EMPTY_CONTEXT: GroupingContext = { projects: [], providers: [] };

function rowFor(
  thread: PluginSidebarThread,
  doneIds: ReadonlySet<string>,
  now: number,
): { id: string; label: string } {
  if (doneIds.has(thread.id)) return { id: "done", label: "Done" };
  return columnFor(thread, "status", EMPTY_CONTEXT, now);
}

function isLive(thread: PluginSidebarThread, doneIds: ReadonlySet<string>): boolean {
  return !thread.isArchived && !doneIds.has(thread.id);
}

function stateRank(state: ThreadState | string): number {
  const index = STATUS_COLUMN_ORDER.indexOf(state);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Label for a row id, even when the row is empty. */
export function parentLaneRowLabel(id: string): string {
  if (id === "done") return "Done";
  const state = id as ThreadState;
  if (THREAD_STATE_LABELS[state] !== undefined) return THREAD_STATE_LABELS[state];
  return IDLE_BUCKETS.find((bucket) => bucket.id === id)?.label ?? id;
}

function sortActiveRow(threads: readonly PluginSidebarThread[]): PluginSidebarThread[] {
  return [...threads].sort((a, b) => {
    const aUrgent = threadState(a) === "attention" ? 0 : 1;
    const bUrgent = threadState(b) === "attention" ? 0 : 1;
    if (aUrgent !== bUrgent) return aUrgent - bUrgent;
    return derivedCompare(a, b);
  });
}

function buildRows(
  cards: readonly PluginSidebarThread[],
  doneIds: ReadonlySet<string>,
  now: number,
  doneTimes: ReadonlyMap<string, number>,
): ParentLaneRow[] {
  const buckets = new Map<string, { label: string; threads: PluginSidebarThread[] }>();
  for (const card of cards) {
    const target = rowFor(card, doneIds, now);
    const bucket = buckets.get(target.id);
    if (bucket === undefined) {
      buckets.set(target.id, { label: target.label, threads: [card] });
    } else {
      bucket.threads.push(card);
    }
  }

  return PARENT_LANE_ROW_ORDER.map((id) => {
    const bucket = buckets.get(id);
    const label = bucket?.label ?? parentLaneRowLabel(id);
    const source = bucket?.threads ?? [];
    const threads = id === "done" ? [...source].sort(doneRecencyCompare(doneTimes)) : sortActiveRow(source);
    return { id, label, threads };
  });
}

function walkLiveFamilyRank(
  rootId: string,
  familyIndex: ReturnType<typeof buildFamilyIndex>,
  threadById: ReadonlyMap<string, PluginSidebarThread>,
  doneIds: ReadonlySet<string>,
): number {
  let best = Number.MAX_SAFE_INTEGER;
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const member = threadById.get(id);
    if (member !== undefined && isLive(member, doneIds)) {
      best = Math.min(best, stateRank(threadState(member)));
    }
    for (const child of familyIndex.childrenByParent.get(id) ?? []) {
      visit(child.id);
    }
  };
  visit(rootId);
  return best;
}

function standaloneRepresentative(
  lane: ParentLane,
  doneIds: ReadonlySet<string>,
): PluginSidebarThread | null {
  let best: PluginSidebarThread | null = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const row of lane.rows) {
    if (row.id === "done") continue;
    for (const thread of row.threads) {
      if (!isLive(thread, doneIds)) continue;
      const rank = stateRank(threadState(thread));
      if (
        best === null ||
        rank < bestRank ||
        (rank === bestRank && derivedCompare(thread, best) < 0)
      ) {
        best = thread;
        bestRank = rank;
      }
    }
  }
  if (best !== null) return best;
  const all = lane.rows.flatMap((row) => row.threads);
  if (all.length === 0) return null;
  return [...all].sort(derivedCompare)[0];
}

/**
 * Build the parent-lane model: vertical lanes are parent threads, horizontal
 * rows are the pivoted Attention ladder. Only level-1 children render as
 * cards; the parent is a lane header. Threads with no family land in the
 * Standalone lane. Done children sit in the bottom Done row; archived children
 * ride as dimmed riders under the family header (R2/D7).
 *
 * Lane order derives from the family's most attention-requiring live member
 * (D5); ties break by the parent's derived order, so a pinned parent floats
 * its lane leftmost (D13). Within a row, urgent ("attention") children float
 * to the top, then the derived order (D6). The Done row sorts by done
 * recency (D9).
 */
export function buildParentLanes(
  threads: readonly PluginSidebarThread[],
  doneIds: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
  doneTimes: ReadonlyMap<string, number> = new Map(),
): ParentLane[] {
  const familyIndex = buildFamilyIndex(threads);
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const lanes: ParentLane[] = [];

  for (const rootId of familyIndex.rootIds) {
    const allChildren = familyIndex.childrenByParent.get(rootId) ?? [];
    if (allChildren.length === 0) continue;
    const parent = threadById.get(rootId);
    if (parent === undefined) continue;

    const archivedChildren = allChildren.filter((child) => child.isArchived);
    const rowCards = allChildren.filter((child) => !child.isArchived);

    lanes.push({
      id: rootId,
      parent,
      label: parent.displayTitle,
      childCount: allChildren.length,
      headerThread: parent,
      rows: buildRows(rowCards, doneIds, now, doneTimes),
      archivedChildren: [...archivedChildren].sort(derivedCompare),
    });
  }

  const standaloneIds = [...familyIndex.rootIds].filter(
    (id) => (familyIndex.childrenByParent.get(id)?.length ?? 0) === 0,
  );
  const standaloneThreads = standaloneIds
    .map((id) => threadById.get(id))
    .filter((t): t is PluginSidebarThread => t !== undefined && !t.isArchived);

  lanes.push({
    id: "standalone",
    parent: null,
    label: "Standalone",
    childCount: 0,
    headerThread: null,
    rows: buildRows(standaloneThreads, doneIds, now, doneTimes),
    archivedChildren: [],
  });

  const ranked = lanes.map((lane) => {
    const rank =
      lane.parent !== null
        ? walkLiveFamilyRank(lane.parent.id, familyIndex, threadById, doneIds)
        : standaloneLaneRank(lane, doneIds);
    const representative = lane.parent ?? standaloneRepresentative(lane, doneIds);
    return { lane, rank, representative };
  });

  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.representative === null || b.representative === null) return 0;
    return derivedCompare(a.representative, b.representative);
  });

  return ranked.map((entry) => entry.lane);
}

function standaloneLaneRank(lane: ParentLane, doneIds: ReadonlySet<string>): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const row of lane.rows) {
    if (row.id === "done") continue;
    for (const thread of row.threads) {
      if (isLive(thread, doneIds)) {
        best = Math.min(best, stateRank(threadState(thread)));
      }
    }
  }
  return best;
}
