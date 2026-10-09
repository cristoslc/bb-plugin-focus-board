// Feature-group boxes: the assembly layer that turns group members into the
// dashed "family box" the decided design defines.
//
// The rules, all derived here so the board renders and the RPC/tests share
// one source of truth:
//
// - A group exists on the board ONLY while at least two of its assigned
//   threads are visible, live, not done, and not pinned. A group of one
//   renders as a plain card with no box (the box is withheld, the record
//   is the assignment that remains); a group whose members drift into
//   Pinned or Done simply loses those members from the box — they keep
//   their own lanes, the same way a family's done children leave the nest.
// - The whole box lands in ONE column: the lane of its most
//   attention-needing member (status grouping), or — under recency — the
//   recency bucket of that member. This is the family placement rule
//   (familyColumnOverrides) re-derived for groups, so "behaves like a
//   family for column selection" is literally the same algorithm.
// - Groupings that split members by their own axis (project, provider,
//   machine) deactivate boxes entirely: the axis IS that board's grouping,
//   and wrapping members from several axis columns is a placement the
//   board cannot honour. Under "parent", the parent lanes are the
//   grouping; boxes stay off there too.
// - A box owns its members' placement: members leave the flat list
//   whenever the box does, and the runs pass below keeps them contiguous,
//   in the column's own display order.
//
// Pure module: no host, no SDK, no React. The board's drag layer and the
// rank store read the runs; lib/rank carries the unit-move write.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type {
  BoardColumn,
  FilterState,
  GroupBy,
  GroupingContext,
  ThreadState,
} from "./grouping";
import { columnFor, matchesFilter, threadState } from "./grouping";
import { STATUS_COLUMN_ORDER } from "./grouping";
import type { MoveTarget } from "../lib/rank";

/** The groupings under which boxes are active (see the module comment). */
const BOX_GROUPINGS: ReadonlySet<GroupBy> = new Set(["status", "none", "recency"]);

export interface GroupBox {
  /** The registry id; the name rides along for label rendering. */
  groupId: string;
  name: string;
  /** The box's members in the column display order, ready to render. */
  members: PluginSidebarThread[];
}

/** One display run in a column: a standalone card or a whole box. */
export type GroupRunItem =
  | { kind: "single"; thread: PluginSidebarThread }
  | { kind: "box"; box: GroupBox };

export interface GroupBoxPlan {
  /**
   * Thread id → the box it renders in. Holds EXACTLY the threads inside
   * boxes; a thread absent from it renders standalone even when assigned
   * (group of one, pinned/done member, axis grouping).
   */
  groupBoxOf: ReadonlyMap<string, GroupBox>;
  /**
   * Member id → the column the member's box lands in, shaped like the
   * columnOverrides entries buildColumns already accepts. Empty when no
   * grouping has boxes active.
   */
  columnOverrides: ReadonlyMap<string, { id: string; label: string }>;
  /** True when `planGroupBoxes` found at least one box. */
  active: boolean;
}

/**
 * Plan the boxes for a visible (non-archived) thread set. `groupIdByThread`
 * carries the raw assignments from the plugin-metadata scan (absent =
 * unassigned); `groupNames` the registry names. Threads whose group has no
 * registry record (a race the RPCs' GC makes near-impossible, but a
 * metadata survivor of a manual KV write) are ignored — fail-quiet HERE is
 * the one allowed silence: a nameless box cannot render.
 */
export function planGroupBoxes(
  threads: readonly PluginSidebarThread[],
  groupIdByThread: ReadonlyMap<string, string>,
  groupNames: ReadonlyMap<string, string>,
  groupBy: GroupBy,
  context: GroupingContext,
  doneIds: ReadonlySet<string>,
  now: number = Date.now(),
): GroupBoxPlan {
  const groupBoxOf = new Map<string, GroupBox>();
  const columnOverrides = new Map<string, { id: string; label: string }>();
  if (!BOX_GROUPINGS.has(groupBy)) {
    return { groupBoxOf, columnOverrides, active: false };
  }
  // Candidates: live members only — done members keep the Done lane's
  // placement, pinned members keep the Pinned lane's, archived never pass
  // through here. A group below two candidates stays unassigned-looking:
  // that is the "group of one renders plain" rule.
  const candidatesByGroup = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.isArchived || doneIds.has(thread.id) || thread.isPinned) continue;
    const groupId = groupIdByThread.get(thread.id);
    if (groupId === undefined || !groupNames.has(groupId)) continue;
    const members = candidatesByGroup.get(groupId);
    if (members === undefined) candidatesByGroup.set(groupId, [thread]);
    else members.push(thread);
  }
  for (const [groupId, members] of candidatesByGroup) {
    if (members.length < 2) continue;
    const box: GroupBox = { groupId, name: groupNames.get(groupId) as string, members: [] };
    // The box lands in the most attention-needing member's lane — the same
    // smallest-state rule the family overrides run. Idle members tie on
    // state; their freshest member breaks the tie (the box is as current as
    // its freshest member). Under recency the bucket IS the age, so the
    // freshest member's bucket wins outright.
    let best: PluginSidebarThread | undefined;
    for (const member of members) {
      if (
        best === undefined ||
        memberIsElevated(memberPriority(member, groupBy), memberPriority(best, groupBy))
      ) {
        best = member;
      }
    }
    if (best === undefined) continue;
    const column = columnFor(best, groupBy, context, now);
    for (const member of members) {
      groupBoxOf.set(member.id, box);
      columnOverrides.set(member.id, column);
      box.members.push(member);
    }
  }
  return { groupBoxOf, columnOverrides, active: groupBoxOf.size >= 2 };
}

/**
 * Member priority for the box's lane pick, compared as a tuple: smallest
 * primary, then largest secondary — the fresher idle (or, under recency,
 * newer) member carries the box. status ranks attention(0) < unread(1) <
 * working(2) < idle(3).
 */
function memberPriority(
  member: PluginSidebarThread,
  groupBy: GroupBy,
): readonly [number, number] {
  const state = threadState(member);
  if (groupBy === "recency") return [0, member.updatedAt];
  const primary = state === "idle" ? 3 : stateIndexOf(state);
  return [primary, state === "idle" ? member.updatedAt : 0];
}

function memberIsElevated(
  a: readonly [number, number],
  b: readonly [number, number],
): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  return a[1] > b[1];
}

function stateIndexOf(state: ThreadState): number {
  const index = STATUS_COLUMN_ORDER.indexOf(state);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Wrap each column's display order into runs: box members gather into one
 * contiguous box item at the position of the FIRST member in the column's
 * own order, preserving relative member order; standalone cards keep their
 * slots. A member that landed in a different column (a frozen selection,
 * or a caller that skipped the overrides) renders plain there — the box
 * renders in the column holding at least two of its members in this path.
 */
export function runsFromColumns(
  columns: readonly BoardColumn[],
  groupBoxOf: ReadonlyMap<string, GroupBox>,
): ReadonlyMap<string, readonly GroupRunItem[]> {
  const runs = new Map<string, readonly GroupRunItem[]>();
  for (const column of columns) {
    const items: GroupRunItem[] = [];
    const consumedThisColumn = new Set<string>();
    for (const thread of column.threads) {
      if (consumedThisColumn.has(thread.id)) continue;
      const box = groupBoxOf.get(thread.id);
      if (box === undefined) {
        items.push({ kind: "single", thread });
        continue;
      }
      const members = box.members.filter((member) =>
        column.threads.some((candidate) => candidate.id === member.id),
      );
      for (const member of members) consumedThisColumn.add(member.id);
      items.push({ kind: "box", box: { ...box, members } });
    }
    runs.set(column.id, items);
  }
  return runs;
}

/**
 * One card's box run membership within a single column's display list.
 * `role` is the card's position in ITS box's run — absent (`null`) when the
 * card renders plain (unassigned, or the group's lone member in this
 * column). `memberIds` lists the run's members in the column's own order
 * (self included when boxed): the unit a drag moves.
 */
export interface ColumnRunInfo {
  boxId: string;
  boxName: string;
  role: "first" | "mid" | "last" | "solo";
  /** The run's members in the column's flat order, self included. */
  memberIds: string[];
}

/** The box-ref shape columnRunInfo reads (the members field is display data). */
export type GroupBoxRef = Pick<GroupBox, "groupId" | "name">;

/**
 * Run membership per thread of ONE column: members of the same group that
 * landed (by the overrides or otherwise) in the same column take box roles
 * in display order; a member alone in its column renders plain (role
 * "solo", no decoration, no unit) — one box per render, never a box of
 * one card.
 */
export function columnRunInfo(
  columnThreads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<string, GroupBoxRef>,
): ReadonlyMap<string, ColumnRunInfo> {
  const info = new Map<string, ColumnRunInfo>();
  if (groupBoxOf.size === 0) return info;
  const byGroup = new Map<string, string[]>();
  for (const thread of columnThreads) {
    const box = groupBoxOf.get(thread.id);
    if (box === undefined) continue;
    const ids = byGroup.get(box.groupId);
    if (ids === undefined) byGroup.set(box.groupId, [thread.id]);
    else ids.push(thread.id);
  }
  for (const thread of columnThreads) {
    const box = groupBoxOf.get(thread.id);
    if (box === undefined) continue;
    const memberIds = byGroup.get(box.groupId) ?? [];
    if (memberIds.length < 2) continue; // a lone member in this column: plain card
    const at = memberIds.indexOf(thread.id);
    const role: ColumnRunInfo["role"] =
      memberIds.length === 1 ? "solo" : at === 0 ? "first" : at === memberIds.length - 1 ? "last" : "mid";
    info.set(thread.id, { boxId: box.groupId, boxName: box.name, role, memberIds });
  }
  return info;
}

/**
 * Where a drop anchored on `hoverId`'s `edge` lands when one or both sides
 * are box runs: the anchor moves to the run's EDGE (before its first
 * member, or after its last) so a box never splices into the middle of
 * another box. Same-run hovers return null (a box cannot land inside
 * itself); plain cards behave exactly like `moveTargetFor`. Callers then
 * hand the anchor — plus the dragged card's unit — to the unit-move write.
 */
export function unitMoveTarget(
  visibleIds: readonly string[],
  hoverId: string,
  edge: "before" | "after",
  draggedId: string,
  runInfo: ReadonlyMap<string, ColumnRunInfo>,
): MoveTarget | null {
  if (hoverId === "" || hoverId === draggedId) return null;
  const hoverRun = runInfo.get(hoverId);
  const draggedRun = runInfo.get(draggedId);
  if (
    hoverRun !== undefined &&
    draggedRun !== undefined &&
    hoverRun.role !== "solo" &&
    draggedRun.role !== "solo" &&
    hoverRun.boxId === draggedRun.boxId
  ) {
    return null;
  }
  if (edge === "before") {
    const anchorId =
      hoverRun !== undefined && hoverRun.role !== "solo" ? hoverRun.memberIds[0] : hoverId;
    if (draggedRun !== undefined && draggedRun.role !== "solo" && draggedRun.memberIds.includes(anchorId)) {
      return null; // anchor inside the dragged unit: it cannot land into itself
    }
    return { beforeId: anchorId, toEnd: false };
  }
  // edge === "after": the anchor is the card BELOW the hover — skipping the
  // hover run's whole span, then skipping the dragged unit's members (a
  // hover directly above the dragged box would otherwise anchor inside it).
  const afterOfHover =
    hoverRun !== undefined && hoverRun.role !== "solo"
      ? visibleIds[visibleIds.indexOf(hoverRun.memberIds[hoverRun.memberIds.length - 1]) + 1]
      : visibleIds[visibleIds.indexOf(hoverId) + 1];
  const ownUnit =
    draggedRun !== undefined && draggedRun.role !== "solo"
      ? new Set(draggedRun.memberIds)
      : new Set<string>();
  let cursor = afterOfHover;
  while (cursor !== undefined && ownUnit.has(cursor)) {
    cursor = visibleIds[visibleIds.indexOf(cursor) + 1];
  }
  if (cursor === undefined) return { beforeId: null, toEnd: true };
  return { beforeId: cursor, toEnd: false };
}

/** Flatten runs back to the visible order cards render in (drag anchors read this). */
export function flattenRuns(
  items: readonly GroupRunItem[],
): PluginSidebarThread[] {
  return items.flatMap((item) => (item.kind === "box" ? item.box.members : [item.thread]));
}

/**
 * Group-aware filtering, the family keep rule restricted to boxes: a box
 * passes when ANY member passes a filter or the search, whole — and
 * non-matching members of a passing box are recorded in `dimmedIds`. A
 * thread NOT in a box (even when assigned to a group of one) keeps its own
 * pass/fail. Apply AFTER the family/individual filter: input here is the
 * already-kept list, so a member a failed family dropped cannot keep its
 * box on the board.
 */
export function filterWithGroupBoxes(
  threads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<string, GroupBox>,
  filter: FilterState,
  searchQuery: string,
  projectNameFor?: (projectId: string) => string,
): { kept: PluginSidebarThread[]; dimmedIds: ReadonlySet<string> } {
  const passes = (thread: PluginSidebarThread): boolean => {
    if (thread.isArchived) return false;
    if (filter.projects.size > 0 && !filter.projects.has(thread.projectId)) return false;
    if (filter.providers.size > 0 && !filter.providers.has(thread.providerId)) return false;
    if (filter.states.size > 0 && !filter.states.has(threadState(thread))) return false;
    if (searchQuery.trim() !== "" && !matchesFilter(thread, searchQuery.trim(), projectNameFor)) {
      return false;
    }
    return true;
  };
  const kept: PluginSidebarThread[] = [];
  const dimmedIds = new Set<string>();
  const boxes = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const box = groupBoxOf.get(thread.id);
    if (box === undefined) {
      if (passes(thread)) kept.push(thread);
      continue;
    }
    const members = boxes.get(box.groupId);
    if (members === undefined) boxes.set(box.groupId, [thread]);
    else members.push(thread);
  }
  for (const members of boxes.values()) {
    const matching = members.filter(passes);
    if (matching.length === 0) continue;
    for (const thread of members) {
      kept.push(thread);
      if (!matching.includes(thread)) dimmedIds.add(thread.id);
    }
  }
  return { kept, dimmedIds };
}

export { stateIndexOf };