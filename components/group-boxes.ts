// Feature-group boxes: the assembly layer that turns group members into the
// dashed "family box" the decided design defines.
//
// The rules, all derived here so the board renders and the RPC/tests share
// one source of truth:
//
// - A group exists on the board while AT LEAST ONE of its assigned threads
//   is visible, live, not done, and not pinned. A group of one renders its
//   dashed box too (one card inside) — the outline is the drag-into target,
//   so the group stays visible and joinable until its last candidate leaves
//   (the record itself only GCs when every assignment clears). A group whose
//   members drift into Pinned or Done simply loses those members from the
//   box — they keep their own lanes, the same way a family's done children
//   leave the nest.
// - SPLIT DEFAULT (the 2026-10-12 behavior change, issue #86): a group does
//   NOT gather into its most attention-deserving lane. Members keep their
//   own lanes and the dashed frame wraps each lane's slice — the frame
//   appears in EVERY lane holding at least one live member, a slice of one
//   included (the frame is still the drag-into target there). The plan
//   emits no column overrides: buildColumns places each member by its own
//   data, and a growing group dilutes into lanes instead of occupying one.
//   The operator re-gathers the group's footprint on demand: clicking a
//   member or a frame amber-highlights every lane's frame of that group.
//   "Parent" is the one exclusion: its lanes are family projections, not
//   thread lanes, so a box around a family's lanes has no meaning —
//   families are their own unit system there.
// - A box owns its members' placement: members leave the flat list
//   whenever the box does, and the runs pass below keeps them contiguous,
//   in the column's own display order. An insert between members (a card
//   landing mid-run) splits the run instead — one frame per adjacent
//   slice, never a gather across the gap.
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
import { groupFilterMisses, matchesFilter, stateFilterPasses } from "./grouping";
import { STATUS_COLUMN_ORDER } from "./grouping";
import type { MoveTarget } from "../lib/rank";
import type { TicketRef } from "../lib/tickets";

/**
 * The grouping under which boxes are OFF (see the module comment): the
 * parent/family lane view. Every per-thread-column grouping — status, none,
 * recency, project, provider, machine — boxes, so this is an exclusion
 * list: a future per-thread-column GroupBy boxes by default.
 */
const NO_BOX_GROUPINGS: ReadonlySet<GroupBy> = new Set(["parent"]);

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
   * (pinned/done member, the parent grouping — a group of one boxes its lone
   * member these days).
   */
  groupBoxOf: ReadonlyMap<string, GroupBox>;
  /**
   * Always empty: the split default emits no lane claims (members render in
   * their own lanes, the frame wraps each lane's slice). The field stays so
   * callers can keep passing plan.columnOverrides to buildColumns without a
   * branch; it exists so a gather rule can return if the design ever
   * re-introduces one.
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
  if (NO_BOX_GROUPINGS.has(groupBy)) {
    return { groupBoxOf, columnOverrides, active: false };
  }
  // Candidates: live members only — done members keep the Done lane's
  // placement, pinned members keep the Pinned lane's, archived never pass
  // through here. A group below one candidate has no box: its members sit
  // in their own lanes (the record survives — the group returns when a
  // member comes back).
  const candidatesByGroup = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.isArchived || doneIds.has(thread.id) || thread.isPinned) continue;
    const groupId = groupIdByThread.get(thread.id);
    if (groupId === undefined || !groupNames.has(groupId)) continue;
    const members = candidatesByGroup.get(groupId);
    if (members === undefined) candidatesByGroup.set(groupId, [thread]);
    else members.push(thread);
  }
  // Split default: the plan claims NO lane for any member. Each member
  // renders where its own data places it (columnFor via buildColumns), and
  // the frame wraps this lane's slice of the group wherever it renders — so
  // a large group spreads across the lanes its members already occupy and
  // the attention lane keeps hosting whatever actually wants attention.
  for (const [groupId, members] of candidatesByGroup) {
    // A group of one keeps its box: the solitary dashed outline is the
    // drag-into target, so the group stays visible and joinable with a
    // single member (the "evaporates at last assignment cleared" rule
    // lives in the RPC GC, not the board render).
    const box: GroupBox = { groupId, name: groupNames.get(groupId) as string, members: [] };
    for (const member of members) {
      groupBoxOf.set(member.id, box);
      box.members.push(member);
    }
  }
  return { groupBoxOf, columnOverrides, active: groupBoxOf.size >= 1 };
}

/** The state's index in the status lane order (unknown states sort last). */
function stateIndexOf(state: ThreadState): number {
  const index = STATUS_COLUMN_ORDER.indexOf(state);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Wrap each column's display order into runs: box members gather into one
 * contiguous box item at the position of the FIRST member in the column's
 * own order, preserving relative member order — and only while the members
 * are adjacent (a non-member between them splits the run, one frame per
 * slice); standalone cards keep their slots. Under the split default the
 * frame appears in EVERY lane holding at least one live member: a slice of
 * one (a group of one, or a multi-member group's lone member in a lane)
 * yields a box run around its single member — role "solo" downstream, so it
 * drags as a plain card but keeps the frame (the outline is the drag-into
 * target, and it is the highlight carrier).
 */
export function runsFromColumns(
  columns: readonly BoardColumn[],
  groupBoxOf: GroupBoxMap,
): ReadonlyMap<string, readonly GroupRunItem[]> {
  const runs = new Map<string, readonly GroupRunItem[]>();
  for (const column of columns) {
    runs.set(column.id, columnRunItems(column, groupBoxOf));
  }
  return runs;
}

/** The column shape the run walk needs (BoardColumn satisfies it). */
export interface RunColumnLike {
  id: string;
  threads: readonly PluginSidebarThread[];
}

/**
 * One column's display order walked into runs: box members gather into one
 * contiguous box item at the position of the FIRST member in the column's
 * own order, preserving relative member order; standalone cards keep their
 * slots. Under the split default the frame appears in EVERY lane holding at
 * least one live member: a slice of one (a group of one, or a multi-member
 * group's lone member in a lane) yields a box run around its single member —
 * role "solo" downstream, so it drags as a plain card but keeps the frame
 * (the outline is the drag-into target, and it is the highlight carrier).
 *
 * A run never spans a non-member: when a foreign card sits BETWEEN two of
 * the group's members (an insert — a relocation landing between them, a
 * recency flip), the walk splits at the gap and renders one box item per
 * adjacent slice, each keeping the frame. Gathering across the gap instead
 * would render the whole group at the first member's slot and visually
 * reorder a bystander card the column's own order never moved, plus swallow
 * the member past the gap out of the lane's top-level card order (issue
 * #106: unpinning a card between two boxed members read the lane as having
 * lost the second member entirely).
 */
export function columnRunItems(
  column: RunColumnLike,
  groupBoxOf: GroupBoxMap,
): readonly GroupRunItem[] {
  const items: GroupRunItem[] = [];
  const consumedThisColumn = new Set<string>();
  for (let index = 0; index < column.threads.length; index += 1) {
    const thread = column.threads[index]!;
    if (consumedThisColumn.has(thread.id)) continue;
    const box = groupBoxOf.get(thread.id);
    if (box === undefined) {
      items.push({ kind: "single", thread });
      continue;
    }
    // The box's members in THIS COLUMN'S OWN DISPLAY ORDER — read off
    // `column.threads` as they appear, never from the plan's `box.members`
    // (which planGroupBoxes collected in recency-iteration order). The
    // rank contract keeps a boxed run contiguous in the column order, so
    // the walk reproduces that order exactly — and an in-box reorder,
    // whose write reorders the members inside the run's span, actually
    // STICKS: rendering from the plan's recency order instead un-renders
    // every in-box reorder the moment the store updates (reproduced live
    // 2026-10-10 — the box read reordered ranks and displayed the old
    // sequence, looking exactly like "reorder not working").
    // The gather stops at the first non-member: a split run keeps each
    // side's slice as its own frame at its own slot.
    const memberIds = new Set(box.members.map((member) => member.id));
    const members: PluginSidebarThread[] = [];
    for (let cursor = index; cursor < column.threads.length; cursor += 1) {
      const candidate = column.threads[cursor]!;
      if (!memberIds.has(candidate.id)) break;
      members.push(candidate);
      consumedThisColumn.add(candidate.id);
    }
    items.push({ kind: "box", box: { ...box, members } });
  }
  return items;
}

/**
 * One card's box run membership within a single column's display list.
 * `role` is the card's position in ITS box's run — absent (`null`) when the
 * card drags as plain (unassigned, or a multi-member box's split lone
 * member in this column; a group of one keeps its container but its member
 * drags as a plain card, since a run of one is no unit). `memberIds` lists
 * the run's members in the column's own order (self included when boxed):
 * the unit a drag moves.
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

/** The box map the board consumes: refs carrying their members in the visible order the plan collected them. */
export type GroupBoxMap = ReadonlyMap<string, GroupBoxRef & Pick<GroupBox, "members">>;

/**
 * The drop-into-the-box decision, shared by the container's dragover and
 * drop: a dragged card joins `targetGroupId` when it is unassigned, or a
 * member of ANOTHER group (one group per thread — joining moves it). The
 * refuse cases: dropping a thread back onto its own group (nothing to
 * change), and dragging a card that renders inside a MULTI-member run
 * (membership is per-thread; the unit keeps moving as an order unit, never
 * dissolves into a group). Under the split default the drag unit is the
 * LANE'S SLICE — a lone slice member is still a single named card, so it
 * may move; the caller reports whether such a run exists for the dragged
 * card (`draggedRendersUnit`), falling back to the whole-group membership
 * shape when only the plan map is known.
 */
export function canJoinGroup(
  droppedId: string,
  targetGroupId: string,
  groupBoxOf: GroupBoxMap,
  draggedRendersUnit?: boolean,
): boolean {
  const droppedRun = groupBoxOf.get(droppedId);
  if (droppedRun === undefined) return true;
  if (droppedRun.groupId === targetGroupId) return false;
  if (draggedRendersUnit !== undefined) return !draggedRendersUnit;
  return droppedRun.members.length <= 1;
}

/**
 * Run membership per thread of ONE column: members of the same group that
 * landed in the same column take box roles in display order; a member alone
 * in its column keeps role "solo" — the container decoration and its data
 * attributes stay (the frame is the join target and the highlight carrier),
 * and the member drags as a plain card (a run of one is no unit).
 */
export function columnRunInfo(
  columnThreads: readonly PluginSidebarThread[],
  groupBoxOf: GroupBoxMap,
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
    // Every boxed member keeps an entry: a slice of one (a lone member of a
    // multi-member group under the split default, or a group-of-one) is role
    // "solo" — the container decoration and its data attributes stay, and it
    // drags as a plain card (a run of one is no unit).
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

/**
 * Where a drop on the hovered member's `edge` lands when BOTH sides are
 * members of the SAME box: only the dragged member moves, into another slot
 * in its own run — the reorder-inside-a-family gesture. This is the one
 * insert `unitMoveTarget` must NOT answer: it anchors at the box's edge and
 * moves the whole run, by design, so a same-run hover returns null there.
 *
 * The target is a plain single-card anchor. A member stays inside its run's
 * span in every same-box edge case (the anchors are its siblings or the card
 * just past the box), so the box's contiguity survives the write and the
 * display keeps one box. Callers move WITHOUT the unit ids — the member
 * travels alone.
 */
export function inBoxMoveTarget(
  visibleIds: readonly string[],
  hoverId: string,
  edge: "before" | "after",
  draggedId: string,
  runInfo: ReadonlyMap<string, ColumnRunInfo>,
): MoveTarget | null {
  const dragRun = runInfo.get(draggedId);
  const hoverRun = runInfo.get(hoverId);
  if (
    dragRun === undefined ||
    hoverRun === undefined ||
    dragRun.role === "solo" ||
    hoverRun.role === "solo" ||
    dragRun.boxId !== hoverRun.boxId
  ) {
    return null;
  }
  if (draggedId === hoverId) return null;
  if (edge === "before") return { beforeId: hoverId, toEnd: false };
  // edge === "after": anchor on whatever renders below the hover — the next
  // member, or the card just past the box (the dragged member becomes the
  // run's new last member). Below the dragged member itself is the no-op
  // the board already re-anchors beside the hover.
  const below = visibleIds[visibleIds.indexOf(hoverId) + 1];
  if (below === undefined) return { beforeId: null, toEnd: true };
  if (below === draggedId) return { beforeId: hoverId, toEnd: false };
  return { beforeId: below, toEnd: false };
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
 * thread NOT in a box (pinned/done members, the parent grouping) keeps its own
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
  ticketRefsFor?: (thread: PluginSidebarThread) => readonly TicketRef[],
  groupNameFor?: (thread: PluginSidebarThread) => string,
  groupsByThread?: ReadonlyMap<string, string>,
  now: number = Date.now(),
): { kept: PluginSidebarThread[]; dimmedIds: ReadonlySet<string> } {
  const passes = (thread: PluginSidebarThread): boolean => {
    if (thread.isArchived) return false;
    if (filter.projects.size > 0 && !filter.projects.has(thread.projectId)) return false;
    if (filter.providers.size > 0 && !filter.providers.has(thread.providerId)) return false;
    if (!stateFilterPasses(thread, filter.states, now)) return false;
    if (groupFilterMisses(thread, filter, groupsByThread)) return false;
    if (
      searchQuery.trim() !== "" &&
      !matchesFilter(thread, searchQuery.trim(), projectNameFor, ticketRefsFor, groupNameFor)
    ) {
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