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
  /** The lane's parent thread. */
  parent: PluginSidebarThread;
  label: string;
  /** Visible children of the parent (archived are hidden outright). */
  childCount: number;
  rows: ParentLaneRow[];
}

/** A project section of family lanes, with the Standalone lane always trailing. */
export interface ParentLaneSection {
  id: string;
  label: string;
  lanes: ParentLane[];
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

/** A lane's recency is the most recent touch across its non-archived members
 *  (done children included — a just-done child is the family's last touch).
 *  Archived members are excluded so stale archived noise cannot vault a lane. */
function laneRecency(lane: ParentLane): number {
  let best = 0;
  if (lane.parent !== null && !lane.parent.isArchived) {
    best = Math.max(best, lane.parent.updatedAt);
  }
  for (const row of lane.rows) {
    for (const thread of row.threads) {
      // Row cards are already non-archived; done children count as a touch.
      best = Math.max(best, thread.updatedAt);
    }
  }
  return best;
}

/** Tiebreak representative for a lane. Family lanes use the parent so a pinned
 *  parent floats leftmost; Standalone uses its most-derived thread. */
function laneRepresentative(lane: ParentLane): PluginSidebarThread | null {
  if (lane.parent !== null) return lane.parent;
  const all = lane.rows.flatMap((row) => row.threads);
  if (all.length === 0) return null;
  return [...all].sort(derivedCompare)[0];
}

function recencyCompare(a: ParentLane, b: ParentLane): number {
  const diff = laneRecency(b) - laneRecency(a);
  if (diff !== 0) return diff;
  const repA = laneRepresentative(a);
  const repB = laneRepresentative(b);
  if (repA === null || repB === null) return 0;
  return derivedCompare(repA, repB);
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



/**
 * Build the parent-lane model: vertical lanes are parent threads, horizontal
 * rows are the pivoted Attention ladder. Only level-1 children render as
 * cards; the parent is a lane header. Done children sit in the bottom Done
 * row; archived children are hidden outright — they render nowhere, and a
 * family whose every child is archived renders no lane at all. Loose
 * (unparented) threads render no lane either — they stay in the Attention
 * view.
 *
 * Lane order defaults to family recency: the most recent touch or response
 * across the family (max `updatedAt` over the parent and its non-archived
 * members, done children included), most recently touched at the left (D5).
 * Ties break by the parent's derived order, so a pinned parent still floats
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
    // The index drops archived members, so an archived child is not a child
    // here (it renders nowhere) and an archived parent leaves its children
    // rootless (they stay loose, in the Attention view).
    const allChildren = familyIndex.childrenByParent.get(rootId) ?? [];
    if (allChildren.length === 0) continue;
    const parent = threadById.get(rootId);
    if (parent === undefined || parent.isArchived) continue;

    lanes.push({
      id: rootId,
      parent,
      label: parent.displayTitle,
      childCount: allChildren.length,
      rows: buildRows(allChildren, doneIds, now, doneTimes),
    });
  }

  lanes.sort(recencyCompare);
  return lanes;
}

/**
 * Section family lanes by the parent's `projectId` (D5a). Sections order by
 * their most recent lane; lanes within a section keep the same recency order.
 */
export function sectionParentLanes(
  lanes: readonly ParentLane[],
  projectNameFor: (projectId: string) => string,
): ParentLaneSection[] {
  const byProject = new Map<string, ParentLane[]>();
  for (const lane of lanes) {
    const projectId = lane.parent.projectId;
    const list = byProject.get(projectId);
    if (list === undefined) {
      byProject.set(projectId, [lane]);
    } else {
      list.push(lane);
    }
  }

  const sections: ParentLaneSection[] = [];
  for (const [projectId, sectionLanes] of byProject) {
    sectionLanes.sort(recencyCompare);
    sections.push({
      id: projectId === "" ? "none" : projectId,
      label: projectNameFor(projectId),
      lanes: sectionLanes,
    });
  }

  sections.sort((a, b) => {
    const diff = laneRecency(b.lanes[0]!) - laneRecency(a.lanes[0]!);
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label);
  });

  return sections;
}
