// The pan-owner decision (issue #330): which scroller takes a finger's slide.
//
// The contract: "a slide scrolls the nearest scroller that actually has overflow
// in the gesture direction, chaining outward (lane to board to nothing else); a
// scroller without overflow in the axis must not consume, bounce, or trap the
// pan." These cases are that sentence, one row of the matrix at a time.
import { describe, expect, it } from "vitest";
import {
  NO_SCROLL,
  canScrollAxis,
  panOwnerFor,
  type PanScrollBox,
} from "../lib/board-pan";
import { PAN_ROUTER_SLOP_PX, panGestureAxis } from "../components/board-pan";

const X_ONLY: PanScrollBox = { canScrollX: true, canScrollY: false };
const Y_ONLY: PanScrollBox = { canScrollX: false, canScrollY: true };

describe("a scroller with no overflow in the axis", () => {
  it("never owns it", () => {
    expect(canScrollAxis(NO_SCROLL, "x")).toBe(false);
    expect(canScrollAxis(NO_SCROLL, "y")).toBe(false);
    expect(canScrollAxis(Y_ONLY, "x")).toBe(false);
    expect(canScrollAxis(X_ONLY, "y")).toBe(false);
    expect(canScrollAxis(null, "x")).toBe(false);
  });
});

describe("the owner of a pan", () => {
  it("is the browser when something between the finger and the board scrolls", () => {
    // A finger on a card: the lane list (or the board) is an ancestor, so
    // native scrolling, momentum and all, stays the browser's.
    expect(panOwnerFor({ axis: "x", ancestor: true, lane: Y_ONLY, board: X_ONLY })).toBe(
      "native",
    );
    expect(panOwnerFor({ axis: "y", ancestor: true, lane: Y_ONLY, board: X_ONLY })).toBe(
      "native",
    );
  });

  it("is the origin lane when the lane owns the axis but is not the finger's ancestor", () => {
    // A lane HEADER strip: the card list sits beside it, not above it, so the
    // browser would chain past it. The lane still owns the slide.
    expect(panOwnerFor({ axis: "y", ancestor: false, lane: Y_ONLY, board: X_ONLY })).toBe(
      "lane",
    );
  });

  it("is the board when nothing nearer owns the axis but the board does", () => {
    // The toolbar above the lanes: not in any lane, outside every scroller,
    // and only the board has range in the finger's direction.
    expect(panOwnerFor({ axis: "x", ancestor: false, lane: null, board: X_ONLY })).toBe(
      "board",
    );
    // The rows read: a vertical slide on the toolbar scrolls the rows.
    expect(panOwnerFor({ axis: "y", ancestor: false, lane: null, board: Y_ONLY })).toBe(
      "board",
    );
  });

  it("is nobody when no scroller inside the board has range", () => {
    // The columns read has no vertical range anywhere: a vertical slide must
    // be swallowed, never handed to the page (the operator's report).
    expect(panOwnerFor({ axis: "y", ancestor: false, lane: NO_SCROLL, board: X_ONLY })).toBe(
      "none",
    );
  });

  it("prefers the lane to the board on the lane's own axis", () => {
    expect(
      panOwnerFor({ axis: "x", ancestor: false, lane: X_ONLY, board: { canScrollX: true, canScrollY: true } }),
    ).toBe("lane");
  });
});

describe("the gesture's axis", () => {
  it("is the axis the finger travelled furthest along", () => {
    expect(panGestureAxis(-40, 3)).toBe("x");
    expect(panGestureAxis(3, -40)).toBe("y");
    // A perfect diagonal is horizontal: the board's long axis wins, which is
    // what a thumb swiping across a phone actually means.
    expect(panGestureAxis(20, 20)).toBe("x");
  });
});

describe("the router's slop", () => {
  it("commits to an axis before the browser can start a page scroll", () => {
    // The browser's own scroll slop is 8-10px; the decision (and its
    // preventDefault) has to land before that.
    expect(PAN_ROUTER_SLOP_PX).toBeGreaterThan(0);
    expect(PAN_ROUTER_SLOP_PX).toBeLessThan(8);
  });
});
