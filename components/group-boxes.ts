// Feature-group boxes: the assembly layer that turns group members into the
// dashed "family box" the decided design defines.
//
// The rules, all derived here so the board renders and the RPC/tests share
// one source of truth:
//
// - A group exists on the board while AT LEAST ONE of its assigned threads
//   is visible, live, and not done. A group of one renders its dashed box
//   too (one card inside) — the outline is the drag-into target, so the
//   group stays visible and joinable until its last candidate leaves (the
//   record itself only GCs when every assignment clears). A PINNED member
//   is a candidate like any other (the operator ruling 2026-10-30): the
//   Pinned lane is one of the board's lanes, so the split default frames
//   the group's slice there too, and a group whose only member is pinned
//   keeps its frame in the Pinned lane instead of vanishing. A group member
//   that drifts into Done loses its box, the same way a family's done
//   children leave the nest.
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
//   whenever the box does, and the runs pass below gathers each lane's
//   whole slice of a group into ONE box run at the first member's slot,
//   in the column's own display order.
//
// Pure module: no host, no SDK, no React. The board's drag layer and the
// rank store read the runs; lib/rank carries the unit-move write.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type {
  GroupBy,
  GroupingContext,
  ThreadState,
} from "./grouping";
import { STATUS_COLUMN_ORDER } from "./grouping";
import type { MoveTarget } from "../lib/rank";

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
   * (a done member, the parent grouping — a group of one boxes its lone
   * member these days, and a pinned member boxes in the Pinned lane).
   */
  groupBoxOf: ReadonlyMap<string, GroupBox>;
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
  if (NO_BOX_GROUPINGS.has(groupBy)) {
    return { groupBoxOf, active: false };
  }
  // Candidates: live members only — done members keep the Done lane's
  // placement, archived never pass through here. PINNED members stay
  // candidates: the Pinned lane is a lane, so its slice of the group gets
  // the same dashed frame every other lane's slice gets (and a group whose
  // only member is pinned therefore keeps its frame there). A group below
  // one candidate has no box: its members sit in their own lanes (the
  // record survives — the group returns when a member comes back).
  const candidatesByGroup = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (thread.isArchived || doneIds.has(thread.id)) continue;
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
  return { groupBoxOf, active: groupBoxOf.size >= 1 };
}

/** The state's index in the status lane order (unknown states sort last). */
function stateIndexOf(state: ThreadState): number {
  const index = STATUS_COLUMN_ORDER.indexOf(state);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Wrap each column's display order into runs: each lane's members of a
 * group gather into ONE box item at the position of the FIRST member in
 * the lane's own order (the one-frame-per-lane rule; a non-member card
 * between them renders after the frame), standalone cards keep their
 * slots. The frame appears in EVERY lane holding at least one live
 * member: a slice of one (a group of one, or a multi-member group's lone
 * member in a lane) yields a box run around its single member — role
 * "solo" downstream, so it drags as a plain card but keeps the frame (the
 * outline is the drag-into target, and it is the highlight carrier).
 */
export function runsFromColumns(
  columns: readonly RunColumnLike[],
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
 * One column's display order walked into runs: same-group members gather
 * into a box run while they are CONTIGUOUS in the column's own order, and a
 * card (or another box's member) landing between the members closes the run
 * and opens a new one — each slice keeps its frame at its own slot. Standalone
 * cards keep their slots. Under the split default the frame appears in EVERY
 * lane holding at least one live member: a slice of one (a group of one, or a
 * multi-member group's lone member in a lane) yields a box run around its
 * single member — role "solo" downstream, so it drags as a plain card but
 * keeps the frame (the outline is the drag-into target, and it is the
 * highlight carrier).
 *
 * The one-frame-per-lane rule keeps the lane's representation of a group
 * honest (the operator ruling 2026-10-13, reversing the edd35e8 slice-split):
 * every card a lane holds of one group renders INSIDE that group's single
 * dashed frame, so a card teleporting into a lane joins the frame already
 * there instead of painting a second instance of it. The frame sits at the
 * FIRST member's slot in the lane's own display order, its members read in
 * that order (never the plan's recency list — rendering from the plan's
 * order un-renders in-box reorders, reproduced live 2026-10-10 and pinned);
 * a non-member card that sat between two members renders after the frame.
 * Across LANES the split default still holds: each lane holding a member
 * frames its own slice.
 */
export function columnRunItems(
  column: RunColumnLike,
  groupBoxOf: GroupBoxMap,
): readonly GroupRunItem[] {
  return columnRunsOf(column.threads, groupBoxOf);
}

/**
 * The single group walk behind runs and run roles: pass one collects each
 * group's members in the column's own display order; pass two emits each
 * group as ONE box run at its first member's slot (later members of an
 * already-emitted group are consumed — they live inside the run they
 * gathered into), and every other thread as its own single slot.
 */
function columnRunsOf(
  columnThreads: readonly PluginSidebarThread[],
  groupBoxOf: GroupBoxMap,
): readonly GroupRunItem[] {
  if (groupBoxOf.size === 0) {
    return columnThreads.map(
      (thread): GroupRunItem => ({ kind: "single", thread }),
    );
  }
  const membersByGroup = new Map<string, PluginSidebarThread[]>();
  const boxByGroup = new Map<string, GroupBoxRef>();
  for (const thread of columnThreads) {
    const box = groupBoxOf.get(thread.id);
    if (box === undefined) continue;
    const members = membersByGroup.get(box.groupId);
    if (members === undefined) {
      membersByGroup.set(box.groupId, [thread]);
      boxByGroup.set(box.groupId, box);
    } else {
      members.push(thread);
    }
  }
  const items: GroupRunItem[] = [];
  const emitted = new Set<string>();
  for (const thread of columnThreads) {
    const box = groupBoxOf.get(thread.id);
    if (box === undefined) {
      items.push({ kind: "single", thread });
      continue;
    }
    if (emitted.has(box.groupId)) continue;
    // The box ref the walk read off the FIRST member keeps `columnRunItems`
    // and `columnRunInfo` on one identity per group per lane.
    emitted.add(box.groupId);
    items.push({
      kind: "box",
      box: {
        ...boxByGroup.get(box.groupId)!,
        members: membersByGroup.get(box.groupId)!,
      },
    });
  }
  return items;
}

/**
 * One card's box run membership within a single column's display list.
 * `role` is the card's position in ITS box's run — absent (`null`) when the
 * card drags as plain (unassigned, or a run of one: a group of one, or a
 * multi-member group's lone member in this lane — such a member keeps its
 * container but drags as a plain card, since a run of one is no unit).
 * `memberIds` lists the run's members in the column's own order (self
 * included when boxed): the unit a drag moves.
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
 * Run membership per thread of ONE column: the lane's members of a group
 * take box roles in the gathered run's display order — the same walk the
 * render uses, so roles, member ids, and the drawn frame never disagree.
 * The run's members gather through interposed cards (one frame per lane per
 * group), and a run of one keeps role "solo" — the container decoration and
 * its data attributes stay, the frame is the join target and the highlight
 * carrier, and the member drags as a plain card (a run of one is no unit).
 */
export function columnRunInfo(
  columnThreads: readonly PluginSidebarThread[],
  groupBoxOf: GroupBoxMap,
): ReadonlyMap<string, ColumnRunInfo> {
  const info = new Map<string, ColumnRunInfo>();
  if (groupBoxOf.size === 0) return info;
  for (const run of columnRunsOf(columnThreads, groupBoxOf)) {
    if (run.kind !== "box") continue;
    const memberIds = run.box.members.map((thread) => thread.id);
    run.box.members.forEach((thread, at) => {
      const role: ColumnRunInfo["role"] =
        memberIds.length === 1
          ? "solo"
          : at === 0
            ? "first"
            : at === memberIds.length - 1
              ? "last"
              : "mid";
      info.set(thread.id, {
        boxId: run.box.groupId,
        boxName: run.box.name,
        role,
        memberIds,
      });
    });
  }
  return info;
}

/**
 * Where a drop anchored on `hoverId`'s `edge` lands when one or both sides
 * are box runs: the anchor moves to the run's EDGE (before its first
 * member, or after its last) so a box never splices into the middle of
 * another box. Same-run hovers return null (a box cannot land inside
 * itself); plain cards behave exactly like `moveTargetFor`, its own-slot
 * refusals included: a release whose insertion slot already holds the
 * dragged unit refuses, so the drop says "no move" instead of jumping the
 * unit above the hover or writing the above-ranks a no-move must never
 * write. Callers then hand the anchor — plus the dragged card's unit — to
 * the unit-move write.
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
    // The anchored slot already holds the dragged unit when the unit ends
    // directly above the anchor — the slot above the hover is its own. A
    // move there is a no-op the release never promised (a jump above the
    // hover); refuse so the call can say so and write nothing. A dragged id
    // the lane does not hold (a cross-lane join's positioning pass) skips
    // the own-slot checks entirely.
    const unitEnd =
      draggedRun !== undefined && draggedRun.role !== "solo"
        ? visibleIds.indexOf(draggedRun.memberIds[draggedRun.memberIds.length - 1])
        : visibleIds.indexOf(draggedId);
    if (unitEnd !== -1 && visibleIds.indexOf(anchorId) === unitEnd + 1) return null;
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
  if (cursor === draggedId) {
    return null;
  }
  // A boxed unit anchored directly after its own span re-inserts at its own
  // position: the write changes nothing visible (it also ranks unrelated
  // cards above, the fresh-install rule firing for a gesture that moves
  // nothing). Refuse so the drop says so.
  if (draggedRun !== undefined && draggedRun.role !== "solo") {
    const spanEnd = visibleIds.indexOf(draggedRun.memberIds[draggedRun.memberIds.length - 1]);
    if (spanEnd !== -1 && visibleIds.indexOf(cursor) === spanEnd + 1) return null;
  }
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

export { stateIndexOf };