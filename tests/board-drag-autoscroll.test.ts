// The drag autoscroll's math (issue #350): zone detection, the ramp, the
// scroller-ownership rule per lane layout, and the frame integration.
//
// The contract: "while a drag is LIVE, sustained pointer presence inside an
// edge zone of the scroller that OWNS the drag's position pans that scroller
// toward the edge." These tests are that sentence row by row — the pure
// module answers every geometry question, the wiring (tests/board-drag-
// autoscroll-wiring.test.tsx) feeds it real dragover events.
import { describe, expect, it } from "vitest";
import {
  DRAG_EDGE_MAX_SPEED_PX_S,
  DRAG_EDGE_ZONE_PX,
  dragEdgeOwnersFor,
  dragEdgeStep,
  dragEdgeVelocity,
  type DragEdgeBox,
} from "../lib/board-drag-autoscroll";

const Z = DRAG_EDGE_ZONE_PX;
const MAX = DRAG_EDGE_MAX_SPEED_PX_S;

/** A 0..800 horizontal scroller with range, the board's column-read shape. */
const X_BOX: DragEdgeBox = { lo: 0, hi: 800, canScroll: true };
/** A 0..600 vertical scroller with range, the lane-list shape. */
const Y_BOX: DragEdgeBox = { lo: 0, hi: 600, canScroll: true };

describe("the edge zone", () => {
  it("pans toward the edge the pointer is parked against", () => {
    // Right/bottom zone: positive (scrollLeft/scrollTop grow).
    expect(dragEdgeVelocity(X_BOX, 800 - Z + 10)).toBeGreaterThan(0);
    expect(dragEdgeVelocity(Y_BOX, 600 - Z + 10)).toBeGreaterThan(0);
    // Left/top zone: negative (the pan reverses).
    expect(dragEdgeVelocity(X_BOX, Z - 10)).toBeLessThan(0);
    expect(dragEdgeVelocity(Y_BOX, Z - 10)).toBeLessThan(0);
  });

  it("is silent in the middle of the scroller", () => {
    expect(dragEdgeVelocity(X_BOX, 400)).toBe(0);
    // Exactly ON the zone's inner boundary: not yet inside it.
    expect(dragEdgeVelocity(X_BOX, 800 - Z)).toBe(0);
    expect(dragEdgeVelocity(X_BOX, Z)).toBe(0);
  });

  it("is silent outside the scroller entirely", () => {
    // Over the toolbar above the lanes, or off the window: no zone applies.
    expect(dragEdgeVelocity(X_BOX, 801)).toBe(0);
    expect(dragEdgeVelocity(X_BOX, -1)).toBe(0);
    expect(dragEdgeVelocity(X_BOX, 2000)).toBe(0);
  });

  it("is silent for a scroller with no range left or no box at all", () => {
    // End of the range already: the command must read as nothing, not as a
    // pan the scroller cannot perform.
    expect(dragEdgeVelocity({ lo: 0, hi: 800, canScroll: false }, 795)).toBe(0);
    expect(dragEdgeVelocity(null, 795)).toBe(0);
  });

  it("caps the command at the border instead of growing past it", () => {
    // A cursor pressed hard against (or reported just past) the border must
    // command the maximum, never more.
    expect(dragEdgeVelocity(X_BOX, 800)).toBe(MAX);
    expect(dragEdgeVelocity(X_BOX, 799)).toBeLessThan(MAX);
    expect(dragEdgeVelocity(X_BOX, 0)).toBe(-MAX);
  });
});

describe("the ramp", () => {
  it("runs linearly from 0 at the zone's outer edge to the max at the border", () => {
    // depth = how far into the zone the pointer sits, 0 at the zone's inner
    // boundary (no command) and 1 at the scroller's border (full speed).
    for (const depth of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const pointer = 800 - Z + Z * depth;
      expect(dragEdgeVelocity(X_BOX, pointer)).toBeCloseTo(MAX * depth, 6);
    }
    // Half a pixel inside the zone: the smallest command there is.
    expect(dragEdgeVelocity(X_BOX, 800 - Z + 0.5)).toBeCloseTo(MAX * (0.5 / Z), 6);
  });

  it("is symmetric on the left edge", () => {
    expect(dragEdgeVelocity(X_BOX, Z * 0.5)).toBeCloseTo(-MAX * 0.5, 6);
    expect(dragEdgeVelocity(Y_BOX, 600 - Z * 0.5)).toBeCloseTo(MAX * 0.5, 6);
  });
});

describe("which scroller owns which axis", () => {
  it("is the board's X and the lane's Y in the column read", () => {
    // Vertical lanes: the board is one horizontally scrolling row of
    // vertically scrolling lanes.
    const owners = dragEdgeOwnersFor("vertical");
    expect(owners.board).toBe("x");
    expect(owners.lane).toBe("y");
  });

  it("is the board's Y and the lane's X in the rows read", () => {
    // Horizontal lanes: rows stacked vertically, cards flowing sideways.
    const owners = dragEdgeOwnersFor("horizontal");
    expect(owners.board).toBe("y");
    expect(owners.lane).toBe("x");
  });
});

describe("the frame integration", () => {
  it("applies velocity over the frame's own duration", () => {
    // One 100ms frame at full speed: 10% of the per-second rate.
    expect(dragEdgeStep(MAX, 100)).toBeCloseTo(MAX / 10, 6);
    expect(dragEdgeStep(-MAX, 100)).toBeCloseTo(-MAX / 10, 6);
    expect(dragEdgeStep(MAX, 16)).toBeCloseTo(MAX * 0.016, 6);
  });

  it("moves nothing for an idle command or a stalled frame", () => {
    expect(dragEdgeStep(0, 100)).toBe(0);
    expect(dragEdgeStep(MAX, 0)).toBe(0);
    expect(dragEdgeStep(MAX, -5)).toBe(0);
  });

  it("caps a stalled frame so a paused tab cannot leap the board", () => {
    // A 5s stall integrates as 250ms of travel, never as 5s.
    expect(dragEdgeStep(MAX, 5000)).toBeCloseTo(MAX / 4, 6);
  });

  it("keeps the shipped numbers in the band the feel was tuned to", () => {
    // The zone must be wider than a casual drag's jitter but far narrower
    // than a lane; the top speed must cross a wide board in seconds, not
    // frames, and not minutes.
    expect(Z).toBeGreaterThanOrEqual(32);
    expect(Z).toBeLessThanOrEqual(64);
    expect(MAX).toBeGreaterThanOrEqual(240);
    expect(MAX).toBeLessThanOrEqual(720);
  });
});
