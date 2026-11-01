// The attention freeze: a card or family the operator is attending to holds
// its rendered placement until attention releases.
//
// "Attending to" means the pointer hovers the card, or the card is open in
// the thread pane; "released" means the mouse moved away or the pane closed.
// While attention holds, live data churn (age buckets, family recency,
// sibling activity) re-sorts the board AROUND the attended placement instead
// of moving it; the board's own placement rules run again
// the moment attention releases. The codebase has been here before: the
// retired sweep gather re-sorted cards mid-gesture and was removed precisely
// because a moving card under a working pointer reads as a board that
// shuffles itself — this module is the general version of that lesson.
//
// One churn is NOT held: under the status grouping a lane names the thread's
// STATE (Needs you, Working, Unread), so a state flip re-lanes the attended
// card at once and the capture re-anchors on the next build. A working thread
// parked in Unread for as long as its pane stayed open is the board lying
// about the one signal it exists to carry (issue #338). The capture still
// records the lane it saw — the slot pin is keyed by lane plus thread — and
// components/grouping.ts `frozenLaneHolds` is the single place that decides
// whether that lane claim still holds.
//
// Two capture shapes, one module:
//
// - AttentionCapture — the column board: the attended card's rendered lane
//   and slot index, its family root's card, and (when it is a nested row) its
//   row slot — plus the "does not un-nest" set for an attended child.
// - LaneCapture — the parent lane view: the attended card's lane order slot
//   and the row bucket the card sits in, since a lane's whole order there is
//   recency-derived and moves under live data.
//
// Pure module: no host, no SDK, no React. app.tsx captures at attention
// events (mouse enter/leave, pane open/close) and calls compile the plan the
// assembly consumes; the assembly applies lanes first, slots last.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn, GroupBy } from "./grouping";
import type { ParentLane } from "./parent-lanes";

/** What opened a freeze: the pointer, the open thread pane, or an open
 *  card context menu (the popover is a portal outside the card's DOM, so
 *  pointing at the menu is not a pointer-exit; its own open/close reports
 *  capture and release). */
export type AttentionOrigin = "hover" | "selection" | "menu";

/** One pinned card's captured placement in the column board. */
export interface AttentionSlot {
  threadId: string;
  columnId: string;
  label: string;
  /** The card's slot index in that column's rendered list at capture. */
  index: number;
}

/**
 * One capture on the column board: every card the freeze pins while the
 * focus thread is attended — the focus card itself, its family root's card
 * (the family's lane holds against churn while its member is attended; see
 * `frozenLaneHolds`), and the attended child's row slot. Feature-group
 * members are NOT covered: under
 * the split default the group renders across lanes on purpose, so only the
 * attended card's own placement pins (its group's other members re-place
 * freely, each in its own lane).
 */
export interface AttentionCapture {
  origin: AttentionOrigin;
  /** The thread the operator's attention is on. */
  focusId: string;
  /** The grouping the capture was taken under (a grouping switch re-lanes
   *  the board; a capture from another grouping must not pin into it). */
  view: GroupBy;
  slots: readonly AttentionSlot[];
  /** The focus renders as a nested row: pin it under this parent's rows. */
  rowPin: { parentId: string; childId: string; index: number } | null;
  /** The capture's epoch ms; the freshest capture wins a conflict. */
  capturedAt: number;
}

/**
 * One capture on the parent lane view: the lane order slot and row bucket
 * the attended card held at capture time.
 */
export interface LaneCapture {
  origin: AttentionOrigin;
  focusId: string;
  /** The lane (family root id) the card sat in. */
  laneId: string;
  /** The lane's order index in the lane list at capture. */
  laneIndex: number;
  /** The row bucket the focus card sat in; null when the focus IS the parent. */
  row: { id: string; index: number } | null;
  capturedAt: number;
}

/**
 * User-initiated placements win over the pin: strips every slot, lane claim,
 * and row pin the capture held for these thread ids. The caller re-captures
 * (or releases) once the gesture's write lands — see the recapture effect.
 */
export function stripCapturedIds(
  capture: AttentionCapture,
  removedIds: ReadonlySet<string>,
): AttentionCapture {
  const slots = capture.slots.filter((slot) => !removedIds.has(slot.threadId));
  const rowPin =
    capture.rowPin !== null && removedIds.has(capture.rowPin.childId) ? null : capture.rowPin;
  if (slots.length === capture.slots.length && rowPin === capture.rowPin) return capture;
  return { ...capture, slots: slots as readonly AttentionSlot[], rowPin };
}

/**
 * Deep equality of captures, ignoring the capture timestamp (a rebuild's
 * `capturedAt` always differs; equality must NOT churn state on it).
 */
export function capturesEqual(
  a: AttentionCapture | null,
  b: AttentionCapture | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.origin !== b.origin || a.focusId !== b.focusId || a.view !== b.view) return false;
  if (a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i += 1) {
    const left = a.slots[i]!;
    const right = b.slots[i]!;
    if (
      left.threadId !== right.threadId ||
      left.columnId !== right.columnId ||
      left.index !== right.index
    ) {
      return false;
    }
  }
  const leftRow = a.rowPin;
  const rightRow = b.rowPin;
  if (leftRow === null || rightRow === null) return leftRow === rightRow;
  return (
    leftRow.parentId === rightRow.parentId &&
    leftRow.childId === rightRow.childId &&
    leftRow.index === rightRow.index
  );
}

/**
 * The per-build plan the assembly consumes: attention lanes win over every
 * lane claim (family R4 overrides, group-box overrides, the pane's own
 * natural-lane capture), slots pin the final rendered lists, and
 * stayNested/rowSlots hold attended children in place.
 */
export interface AttentionFreezePlan {
  columns: ReadonlyMap<string, { id: string; label: string }>;
  /** Slot index per pinned card, keyed `slotPinKey(columnId, threadId)` —
   *  a thread can render in two lanes (a family's live card plus its Done
   *  projection twin), so a thread-only key moved both. */
  slots: ReadonlyMap<string, number>;
  stayNested: ReadonlySet<string>;
  rowSlots: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export const EMPTY_ATTENTION_FREEZE: AttentionFreezePlan = {
  columns: new Map(),
  slots: new Map(),
  stayNested: new Set(),
  rowSlots: new Map(),
};

export function isAttentionFreezeEmpty(plan: AttentionFreezePlan): boolean {
  return (
    plan.columns.size === 0 &&
    plan.slots.size === 0 &&
    plan.stayNested.size === 0 &&
    plan.rowSlots.size === 0
  );
}

/** The slot pin's map key: the pin holds COLUMN and thread, because a
 *  thread renders twice when its family projects a Done card and a
 *  thread-only key moved the twin into the live slot's index (Defect 2 of
 *  the derived ruleset). */
export function slotPinKey(columnId: string, threadId: string): string {
  return `${columnId}\u0000${threadId}`;
}

/**
 * Merge captures into one per-build plan. Captures may overlap (a hovered
 * open card is pinned by both origins): the freshest capture wins each
 * thread, so attention that captured after the pane reflects the latest
 * rendered placement.
 */
export function compileAttentionFreezes(
  captures: readonly AttentionCapture[],
): AttentionFreezePlan {
  const columns = new Map<string, { id: string; label: string }>();
  const slots = new Map<string, number>();
  const stayNested = new Set<string>();
  const rowSlots = new Map<string, Map<string, number>>();
  const ordered = [...captures].sort((a, b) => a.capturedAt - b.capturedAt);
  for (const capture of ordered) {
    for (const slot of capture.slots) {
      columns.set(slot.threadId, { id: slot.columnId, label: slot.label });
      slots.set(slotPinKey(slot.columnId, slot.threadId), slot.index);
    }
    if (capture.rowPin !== null) {
      const parentSlots = rowSlots.get(capture.rowPin.parentId);
      const pins =
        parentSlots === undefined
          ? new Map<string, number>()
          : new Map(parentSlots);
      pins.set(capture.rowPin.childId, capture.rowPin.index);
      rowSlots.set(capture.rowPin.parentId, pins);
      stayNested.add(capture.rowPin.childId);
    }
  }
  return { columns, slots, stayNested, rowSlots };
}

/** Where a thread's card renders in the assembled columns, or null. */
export function columnPlacementOf(
  columns: readonly BoardColumn[],
  threadId: string,
): AttentionSlot | null {
  for (const column of columns) {
    const index = column.threads.findIndex((thread) => thread.id === threadId);
    if (index !== -1) {
      return { threadId, columnId: column.id, label: column.label, index };
    }
  }
  return null;
}

/**
 * Where a thread's card renders on the parent lane board, or null. A lane
 * parent has no row pin — its card IS the lane header; a row card pins its
 * row bucket and slot.
 */
export function laneCaptureOf(
  lanes: readonly ParentLane[],
  threadId: string,
  options: { origin: AttentionOrigin; capturedAt: number },
): LaneCapture | null {
  for (const [laneIndex, lane] of lanes.entries()) {
    if (lane.parent.id === threadId) {
      return { ...options, focusId: threadId, laneId: lane.id, laneIndex, row: null };
    }
    for (const row of lane.rows) {
      const index = row.threads.findIndex((card) => card.id === threadId);
      if (index !== -1) {
        return {
          ...options,
          focusId: threadId,
          laneId: lane.id,
          laneIndex,
          row: { id: row.id, index },
        };
      }
    }
  }
  return null;
}

/**
 * The bridge the caller builds once per render and the capture reads at
 * attention-event time (app.tsx's `attentionInputRef` shape, stated
 * structurally so this module never imports the board assembly type).
 */
export interface ColumnAttentionInput {
  /** True only on the parent lane view, whose captures are LaneCaptures. */
  parent: boolean;
  /** The grouping the capture is taken under; a capture from another
   *  grouping must not pin into this one. */
  view: GroupBy;
  /** The assembled column board (columns plus nesting maps), null on the
   *  parent lane view. */
  assembly: {
    columns: readonly BoardColumn[];
    nestedChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
    doneChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  } | null;
  parentOf: ReadonlyMap<string, string>;
}

/**
 * Capture one attention on the column board: a pure statement of the slot
 * set an attended placement must pin (app.tsx reads this at attention-event
 * time). The slots cover:
 *
 * - the focus card itself (absent when the focus renders as a nested row —
 *   the caller pins its row slot instead),
 * - its family root's card — the family's lane holds against churn while its
 *   member is attended (components/grouping.ts `frozenLaneHolds`: a state
 *   flip still re-lanes it, an age bucket still does not).
 *
 * Feature-group members are deliberately absent: under the split default
 * (issue #86) the group renders across lanes on purpose, so a half-frozen
 * group is the intended render, not a defect — the attended member holds its
 * own placement and the rest re-place freely.
 *
 * Returns null when nothing renders (no assembly, parent view, a focus a
 * column and no row both miss).
 */
export function captureColumnAttention(
  focusId: string,
  input: ColumnAttentionInput,
  origin: AttentionOrigin,
  capturedAt: number = Date.now(),
): AttentionCapture | null {
  if (input.parent) return null;
  const assembly = input.assembly;
  if (assembly === null) return null;
  const slots: AttentionSlot[] = [];
  const pinThread = (threadId: string): void => {
    const slot = columnPlacementOf(assembly.columns, threadId);
    if (slot !== null) slots.push(slot);
  };
  pinThread(focusId);
  // The family root's card: the family's lane holds against churn while its
  // member is attended (components/grouping.ts `frozenLaneHolds` decides
  // whether the captured lane still holds; a state flip re-lanes it).
  let rootId = focusId;
  while (input.parentOf.has(rootId)) rootId = input.parentOf.get(rootId) as string;
  if (rootId !== focusId) pinThread(rootId);
  let rowPin: AttentionCapture["rowPin"] = null;
  const focusSlot = slots.find((slot) => slot.threadId === focusId);
  if (focusSlot === undefined) {
    // Not rendered standalone: a nested child row (or a done child under
    // the family's Done projection card). Pin its row slot instead.
    const parentId = input.parentOf.get(focusId);
    if (parentId === undefined) return null;
    for (const rows of [assembly.nestedChildrenByParent.get(parentId), assembly.doneChildrenByParent.get(parentId)]) {
      if (rows === undefined) continue;
      const index = rows.findIndex((card) => card.id === focusId);
      if (index === -1) continue;
      rowPin = { parentId, childId: focusId, index };
      break;
    }
  }
  if (slots.length === 0 && rowPin === null) return null;
  return { origin, view: input.view, focusId, slots, rowPin, capturedAt };
}

/**
 * Re-pin a rendered list: remove every pinned card, then reinsert each at
 * its captured index (ascending, clamped to the list's length). Cards the
 * board would have sorted above the pinned slot stay above — nothing but
 * the pinned cards' positions change.
 */
export function applySlotPins<T extends { id: string }>(
  threads: readonly T[],
  slots: ReadonlyMap<string, number>,
): T[] {
  if (slots.size === 0) return [...threads];
  const entries = [...slots.entries()].sort((a, b) => a[1] - b[1]);
  const rest = threads.filter((thread) => !slots.has(thread.id));
  const out = [...rest];
  for (const [threadId, index] of entries) {
    const thread = threads.find((card) => card.id === threadId);
    if (thread === undefined) continue;
    const at = Math.max(0, Math.min(index, out.length));
    out.splice(at, 0, thread);
  }
  return out;
}

/** Pin nested rows to their captured indexes (same contract as slots). */
export function pinRowOrder(
  children: readonly PluginSidebarThread[],
  slots: ReadonlyMap<string, number>,
): PluginSidebarThread[] {
  return applySlotPins(children, slots);
}

/**
 * Apply the parent lane view's freezes to a freshly built lane list: each
 * attended lane returns to its captured order index, and each attended row
 * card returns to its captured row bucket and slot. Lanes pin in captured
 * order (ascending, clamped) so several freezes keep their relative order;
 * the row restorations run against the pinned lanes.
 */
export function applyLaneFreezes(
  lanes: readonly ParentLane[],
  captures: readonly LaneCapture[],
): ParentLane[] {
  if (captures.length === 0) return [...lanes];
  // One pin per lane: the open pane and a hovered card in the SAME lane both
  // capture that lane (origins selection + hover), and pinning it once per
  // capture spliced the entire lane into the board twice — a ghost copy of
  // the lane rendered beside (or past) the real one (issue #227's duplicated
  // card strip). Keep only the freshest capture of each lane, the same
  // "freshest capture wins a conflict" rule compileAttentionFreezes uses.
  const freshest = new Map<string, LaneCapture>();
  for (const capture of captures) {
    const current = freshest.get(capture.laneId);
    if (current === undefined || capture.capturedAt > current.capturedAt) {
      freshest.set(capture.laneId, capture);
    }
  }
  const frozen = [...freshest.values()].sort((a, b) => a.laneIndex - b.laneIndex);
  const pinnedIds = new Set(frozen.map((capture) => capture.laneId));
  const rest = lanes.filter((lane) => !pinnedIds.has(lane.id));
  const out = [...rest];
  for (const capture of frozen) {
    const lane = lanes.find((entry) => entry.id === capture.laneId);
    if (lane === undefined) continue; // the lane left the board; nothing to pin
    const at = Math.max(0, Math.min(capture.laneIndex, out.length));
    out.splice(at, 0, lane);
  }
  // Row restorations: the attended card returns to its captured row and
  // slot, wherever the live build would have landed it.
  for (const capture of frozen) {
    if (capture.row === null) continue; // the focus is the lane parent
    const laneIndex = out.findIndex((entry) => entry.id === capture.laneId);
    if (laneIndex === -1) continue;
    const capturedRow = capture.row;
    const card = findCardInLane(out[laneIndex]!, capture.focusId);
    if (card === undefined) continue; // the card left its lane; nothing to pin
    const rows = out[laneIndex]!.rows.map((row) => ({ ...row, threads: [...row.threads] }));
    for (const row of rows) {
      const at = row.threads.findIndex((entry) => entry.id === capture.focusId);
      if (at !== -1) row.threads.splice(at, 1);
    }
    const target = rows.find((row) => row.id === capturedRow.id);
    if (target === undefined) continue; // unknown row id: leave the build as is
    const at = Math.max(0, Math.min(capturedRow.index, target.threads.length));
    target.threads.splice(at, 0, card);
    out[laneIndex] = { ...out[laneIndex]!, rows };
  }
  return out;
}

function findCardInLane(lane: ParentLane, threadId: string): PluginSidebarThread | undefined {
  for (const row of lane.rows) {
    const found = row.threads.find((card) => card.id === threadId);
    if (found !== undefined) return found;
  }
  return undefined;
}