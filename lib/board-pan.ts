// Which scroller owns a finger's pan (issue #330).
//
// The board's pan contract, from the operator's report:
//
//   "Expected: sliding a finger anywhere pans the board."
//
// and the two failures it named: a slide in the header scrolled the PAGE, and a
// slide in a lane scrolled the LANE sideways with nothing to its right.
//
// The rule this module encodes:
//
//   A slide scrolls the nearest scroller that actually HAS OVERFLOW in the
//   gesture's direction, chaining outward (lane → board → nothing else). A
//   scroller with no overflow in the axis must not consume, bounce, or trap
//   the pan, and no gesture inside the board may ever reach the page.
//
// The browser already implements the middle of that chain natively: a finger
// on a card reaches the lane list, and past it the board. What the browser
// cannot do is the two ends:
//
// - an origin OUTSIDE every scroller (the toolbar above the board, a lane's
//   header strip beside its card list) chains straight past the board to the
//   document, because no intermediate element owns the axis;
// - a scroller with zero overflow (an accidental cross-axis scroll container)
//   either traps the gesture or rubber-bands it instead of chaining.
//
// So this module answers one question per axis, and the wiring
// (components/board-pan.ts) does the rest: hand a native owner the gesture,
// scroll a non-ancestor owner by hand, or swallow it.
//
// Pure on purpose: the geometry arrives as plain flags, so the decision is
// testable without a layout engine (jsdom has none).

export type PanAxis = "x" | "y";

/**
 * What one element can natively scroll: its axis can be scrolled AND it has
 * range left on it. `overflow: hidden`/`clip` is never a pan owner — it can be
 * scrolled by script, never by a finger.
 */
export interface PanScrollBox {
  readonly canScrollX: boolean;
  readonly canScrollY: boolean;
}

export const NO_SCROLL: PanScrollBox = { canScrollX: false, canScrollY: false };

export function canScrollAxis(box: PanScrollBox | null, axis: PanAxis): boolean {
  if (box === null) return false;
  return axis === "x" ? box.canScrollX : box.canScrollY;
}

/**
 * Who takes the pan:
 *   "native" — an element between the finger and the board (the board
 *              included) can scroll this axis; leave the gesture to the
 *              browser, which chains it out to the board by itself
 *   "lane"   — the lane the finger started in owns the axis but is NOT an
 *              ancestor of the finger (a lane header strip beside its card
 *              list): scroll that list by hand
 *   "board"  — nothing between the finger and the board can take it, but the
 *              board can (a slide on the toolbar): scroll the board by hand
 *   "none"   — nothing inside the board has overflow in this direction:
 *              swallow the pan so it can never reach the page
 */
export type PanOwner = "native" | "lane" | "board" | "none";

export interface PanOwnerInput {
  readonly axis: PanAxis;
  /** The axis can be scrolled by an ancestor at or below the board. */
  readonly ancestor: boolean;
  /** The origin lane's own card list (null outside a lane). */
  readonly lane: PanScrollBox | null;
  readonly board: PanScrollBox;
}

export function panOwnerFor(input: PanOwnerInput): PanOwner {
  if (input.ancestor) return "native";
  if (canScrollAxis(input.lane, input.axis)) return "lane";
  if (canScrollAxis(input.board, input.axis)) return "board";
  return "none";
}
