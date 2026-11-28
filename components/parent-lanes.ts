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
  errorAcks: ReadonlySet<string> = new Set<string>(),
): { id: string; label: string } {
  if (doneIds.has(thread.id)) return { id: "done", label: "Done" };
  return columnFor(thread, "status", EMPTY_CONTEXT, now, errorAcks);
}

function isLive(thread: PluginSidebarThread, doneIds: ReadonlySet<string>): boolean {
  return !thread.isArchived && !doneIds.has(thread.id);
}

/**
 * Every card of one row across every lane, in board display order (lane
 * order, then the row's own order inside each lane).
 *
 * This is one input to a row sweep: the sweep's eligibility law runs the same
 * predicates the Focus view's columns run (lib/sweep's candidate functions
 * take this list instead of a column's threads), so a thread sweepable in one
 * view is sweepable in the other, and one excluded for a reason (pinned,
 * attention, working, live children) is excluded identically.
 *
 * It is the row's MEMBERSHIP, not what the operator can inspect: a context
 * lane hides the tail of a band behind its "+N more" chip, so the cards here
 * can outnumber the cards on screen. A sweep's scope is the rendered subset
 * (`renderedRowThreads` in components/parent-lane-layout); this list is
 * filtered through it before any pill counts or any arm freezes.
 */
export function laneRowThreads(
  lanes: readonly ParentLane[],
  rowId: string,
): PluginSidebarThread[] {
  const out: PluginSidebarThread[] = [];
  for (const lane of lanes) {
    const row = lane.rows.find((candidate) => candidate.id === rowId);
    if (row !== undefined) out.push(...row.threads);
  }
  return out;
}

/** Label for a row id, even when the row is empty. */
export function parentLaneRowLabel(id: string): string {
  if (id === "done") return "Done";
  const state = id as ThreadState;
  if (THREAD_STATE_LABELS[state] !== undefined) return THREAD_STATE_LABELS[state];
  return IDLE_BUCKETS.find((bucket) => bucket.id === id)?.label ?? id;
}

function sortActiveRow(
  threads: readonly PluginSidebarThread[],
  errorAcks: ReadonlySet<string> = new Set<string>(),
): PluginSidebarThread[] {
  return [...threads].sort((a, b) => {
    const aUrgent = threadState(a, errorAcks) === "attention" ? 0 : 1;
    const bUrgent = threadState(b, errorAcks) === "attention" ? 0 : 1;
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
  errorAcks: ReadonlySet<string> = new Set<string>(),
): ParentLaneRow[] {
  const buckets = new Map<string, { label: string; threads: PluginSidebarThread[] }>();
  for (const card of cards) {
    const target = rowFor(card, doneIds, now, errorAcks);
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
    const threads = id === "done" ? [...source].sort(doneRecencyCompare(doneTimes)) : sortActiveRow(source, errorAcks);
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
  errorAcks: ReadonlySet<string> = new Set(),
): ParentLane[] {
  const familyIndex = buildFamilyIndex(threads);
  const threadById = new Map(threads.map((t) => [t.id, t]));
  const lanes: ParentLane[] = [];

  for (const rootId of familyIndex.rootIds) {
    // The index drops archived members, so an archived child is not a child
    // here (it renders nowhere) and an archived parent leaves its children
    // rootless (they stay loose, in the Attention view).
    // The lane box holds every family member as a card: the depth cap keeps
    // grandchild display edges to two row levels elsewhere, but the box is
    // the family's full surface — walk the whole subtree (archived excluded
    // by the index).
    const directChildren = familyIndex.childrenByParent.get(rootId) ?? [];
    const allChildren: PluginSidebarThread[] = [...directChildren];
    let queue = [...directChildren];
    while (queue.length > 0) {
      const next: PluginSidebarThread[] = [];
      for (const member of queue) {
        next.push(...(familyIndex.childrenByParent.get(member.id) ?? []));
      }
      allChildren.push(...next);
      queue = next;
    }
    if (allChildren.length === 0) continue;
    const parent = threadById.get(rootId);
    if (parent === undefined || parent.isArchived) continue;

    lanes.push({
      id: rootId,
      parent,
      label: parent.displayTitle,
      childCount: allChildren.length,
      rows: buildRows(allChildren, doneIds, now, doneTimes, errorAcks),
    });
  }

  lanes.sort(recencyCompare);
  return lanes;
}

/**
 * Section family lanes by the parent's `projectId` (D5a). Sections order by
 * their most recent lane; lanes within a section keep the ORDER THEY
 * ARRIVED IN — the sectioning is a stable grouping, never a re-sort, so a
 * lane freeze's on-screen pins (applied over the recency order upstream)
 * survive "By project" (Defect 3 of the derived ruleset: the re-sort here
 * snapped attended lanes back to recency).
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
    // No re-sort: the input order already carries recency and the freeze's
    // on-screen pins; sectioning is grouping only.
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
