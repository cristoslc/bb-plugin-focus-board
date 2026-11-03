// Edge autoscroll for a live card drag (issue #350).
//
// The operator's report: "dragging cards horizontally doesn't scroll
// horizontally." A card drag that parks against a scroller's edge should pan
// that scroller, so a card can be dropped on a lane that was OFFSCREEN when
// the drag started — the same interaction the touch hold-drag grounded itself
// in (PR #337's Trello research): hold at an edge mid-drag and the view pans;
// move back in and it stops.
//
// The rule this module encodes:
//
//   While a drag is LIVE, sustained pointer presence inside an edge zone of
//   the scroller that OWNS the drag's position pans that scroller toward the
//   edge, at a rate that ramps linearly from 0 at the zone's outer edge to
//   DRAG_EDGE_MAX_SPEED_PX_S at the scroller's border. Outside a live drag
//   the answer is always 0 — a plain hover near an edge scrolls nothing.
//
// The numbers, and why:
//
// - `DRAG_EDGE_ZONE_PX = 48`. Wide enough that a cursor pushed hard against
//   the window's edge lands well inside it (a window edge often stops a few
//   pixels short of the scroller's border), narrow enough that a normal drag
//   across the board never grazes it by accident. Same order as the edge
//   zones every mainstream kanban ships (Trello ~40px, Notion ~56px).
// - `DRAG_EDGE_MAX_SPEED_PX_S = 420`. The speed AT the border, 7px/frame at
//   60fps: fast enough to cross a 1920px board in under 5s of holding, slow
//   enough that a lane revealed mid-pan stays droppable. The ramp is LINEAR
//   in the depth inside the zone, so the pan eases in as the cursor digs
//   toward the border and eases out as it retreats — no threshold snap, no
//   acceleration curve to tune.
//
// Which scroller owns which axis per lane layout is the board-pan vocabulary
// (lib/board-pan.ts) read backwards for a drag: in the column read the BOARD
// scrolls X and each lane's card list scrolls Y; in the rows read the BOARD
// scrolls Y and each lane's row scrolls X. One scroller per axis — the two
// zones can both fire in a corner (board X and lane Y together), which is
// the correct two-axis behaviour, not a conflict.
//
// Pure on purpose: geometry arrives as plain numbers, so the zone math, the
// ramp, the ownership rule and the frame integration are testable without a
// layout engine (jsdom has none). The wiring (components/board-drag-
// autoscroll.ts) runs the loop.

import type { PanAxis } from "./board-pan";

/** Width of the edge zone, measured inward from a scroller's edge. */
export const DRAG_EDGE_ZONE_PX = 48;

/** Scroll speed (px/s) at the scroller's border; 0 at the zone's outer edge. */
export const DRAG_EDGE_MAX_SPEED_PX_S = 420;

/**
 * A scroller projected onto the one axis it autoscrolls: its viewport edges
 * on that axis, and whether it has range left there (`panScrollBox`'s
 * read, components/board-pan.ts). A scroller with no range cannot pan —
 * applying a delta to it would be a silent no-op anyway, and the false
 * "I am autoscrolling" reading is what the tests must not see.
 */
export interface DragEdgeBox {
  readonly lo: number;
  readonly hi: number;
  readonly canScroll: boolean;
}

/** Which scroller autoscrolls which axis for a lane layout. */
export interface DragEdgeOwners {
  /** The axis the BOARD scroller pans while a drag holds an edge. */
  readonly board: PanAxis;
  /** The axis each lane's card list pans while a drag holds an edge. */
  readonly lane: PanAxis;
}

/**
 * The ownership rule per lane direction (the layout read in
 * components/board.tsx, mirrored here): the columns board is one
 * horizontally scrolling row of vertically scrolling lanes; the rows board is
 * one vertically scrolling stack of horizontally scrolling rows.
 */
export function dragEdgeOwnersFor(
  laneDirection: "vertical" | "horizontal",
): DragEdgeOwners {
  return laneDirection === "horizontal"
    ? { board: "y", lane: "x" }
    : { board: "x", lane: "y" };
}

/**
 * Signed velocity (px/s) the pointer commands on one scroller's owned axis:
 * negative pans toward `lo` (scrollLeft/scrollTop decrease), positive toward
 * `hi`. Zero unless the pointer sits inside the edge zone AND the scroller
 * has range left — so a pointer resting in a zone at the end of a scroller's
 * range commands nothing, exactly as it should read.
 */
export function dragEdgeVelocity(
  box: DragEdgeBox | null,
  pointer: number,
  zone: number = DRAG_EDGE_ZONE_PX,
  maxSpeed: number = DRAG_EDGE_MAX_SPEED_PX_S,
): number {
  if (box === null || !box.canScroll) return 0;
  if (!(pointer >= box.lo && pointer <= box.hi)) return 0;
  const depthLo = (box.lo + zone - pointer) / zone;
  if (depthLo > 0) return -maxSpeed * Math.min(1, depthLo);
  const depthHi = (pointer - (box.hi - zone)) / zone;
  if (depthHi > 0) return maxSpeed * Math.min(1, depthHi);
  return 0;
}

/**
 * Pixels to apply this frame: the commanded velocity integrated over the
 * frame's own duration. The frame length is capped at 250ms so a stalled
 * tab (a backgrounded drag, a paused debugger) cannot convert its whole
 * stall into one leap across the board — the pan loses that time instead.
 */
export function dragEdgeStep(velocityPxS: number, dtMs: number): number {
  if (velocityPxS === 0 || !(dtMs > 0)) return 0;
  return (velocityPxS * Math.min(dtMs, 250)) / 1000;
}
