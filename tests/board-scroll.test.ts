// @vitest-environment jsdom
// Pure board geometry: the bring-into-view scroll corrections
// (components/board-scroll.ts) and the drag drop-zone edge math. The board's
// corrections run on DOM rects inside the component, but jsdom has no
// layout — every rect reads 0 and any wiring bug would hide as a no-op — so
// the deltas are split out and pinned here with hand-built rects.
import { describe, expect, it } from "vitest";
import {
  containerSlideX,
  containerSlideY,
  dropZoneForPoint,
  listScrollX,
  listScrollY,
} from "../components/board-scroll";
import type { TransportAxis } from "../components/card-transport";

/** A DOMRect skeleton with just the fields the geometry reads. */
function rect(left: number, right: number, top = 0, bottom = 0): DOMRect {
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
  } as DOMRect;
}

describe("containerSlideX", () => {
  it("slides right (negative scroll delta) when the target sits left of the viewport", () => {
    // The container's viewport is screen x 0…1000; the target's left edge
    // hangs 100px off it. scrollLeft -= 100 brings the target's left edge
    // flush with the container's.
    expect(containerSlideX(rect(0, 1000), rect(-100, 400))).toBe(-100);
  });

  it("slides left (positive scroll delta) when the target runs past the right edge", () => {
    expect(containerSlideX(rect(0, 1000), rect(1100, 1280))).toBe(280);
  });

  it("is 0 when the target is already fully inside", () => {
    expect(containerSlideX(rect(0, 1000), rect(100, 500))).toBe(0);
  });

  it("prefers the left edge when the target is wider than the container", () => {
    // Both edges fail the fully-inside check; the ordered checks mean only
    // the left branch can fire, so the delta is unambiguous.
    expect(containerSlideX(rect(0, 1000), rect(-50, 1500))).toBe(-50);
  });
});

describe("containerSlideY (the horizontal-lane board's container axis)", () => {
  it("slides down (negative delta) when the lane row sits above the visible range", () => {
    expect(containerSlideY(rect(0, 1000, 0, 600), rect(0, 100, -40, 300))).toBe(-40);
  });

  it("slides up (positive delta) when the lane row runs past the bottom edge", () => {
    expect(containerSlideY(rect(0, 1000, 0, 600), rect(0, 100, 700, 950))).toBe(350);
  });

  it("is 0 when the lane row is fully inside", () => {
    expect(containerSlideY(rect(0, 1000, 0, 600), rect(0, 100, 50, 300))).toBe(0);
  });
});

describe("listScrollY", () => {
  it("pulls a card above the fold back down to the list's top edge", () => {
    // List scrollport y 0…600; the card's top edge is 40px above it.
    expect(listScrollY(rect(0, 800, 0, 600), rect(0, 200, -40, 60))).toBe(-40);
  });

  it("pushes a card back up when it falls below the fold", () => {
    expect(listScrollY(rect(0, 800, 0, 600), rect(0, 200, 650, 800))).toBe(200);
  });

  it("is 0 when the card is fully inside the list's viewport", () => {
    expect(listScrollY(rect(0, 800, 0, 600), rect(0, 200, 100, 300))).toBe(0);
  });
});

describe("listScrollX (a horizontal lane's own scroll axis)", () => {
  it("slides a card left of the list's scrollport back into view", () => {
    expect(listScrollX(rect(0, 900, 0, 600), rect(-80, 300, 0, 300))).toBe(-80);
  });

  it("slides a card past the right edge back into view", () => {
    expect(listScrollX(rect(0, 900, 0, 600), rect(950, 1200, 0, 300))).toBe(300);
  });

  it("is 0 when the card is fully inside", () => {
    expect(listScrollX(rect(0, 900, 0, 600), rect(100, 500, 0, 300))).toBe(0);
  });

  it("prefers the left edge when the card is wider than the list", () => {
    expect(listScrollX(rect(0, 900, 0, 600), rect(-30, 1000, 0, 300))).toBe(-30);
  });
});

describe("dropZoneForPoint (the drag drop-zone thirds, per lane direction)", () => {
  // Slot at x 0…200, y 0…100.
  const slot = (): DOMRect => rect(0, 200, 0, 100);

  it("a vertical lane splits before/after on the slot's top/bottom halves", () => {
    const axis: TransportAxis = "vertical";
    expect(dropZoneForPoint(axis, slot(), 10, 30)).toBe("before");
    expect(dropZoneForPoint(axis, slot(), 10, 70)).toBe("after");
  });

  it("a vertical lane offers the nest zone on the middle third", () => {
    const axis: TransportAxis = "vertical";
    expect(dropZoneForPoint(axis, slot(), 10, 10, true)).toBe("before");
    expect(dropZoneForPoint(axis, slot(), 10, 50, true)).toBe("onto");
    expect(dropZoneForPoint(axis, slot(), 10, 90, true)).toBe("after");
  });

  it("a horizontal lane splits before/after on the slot's left/right halves", () => {
    const axis: TransportAxis = "horizontal";
    expect(dropZoneForPoint(axis, slot(), 60, 10)).toBe("before");
    expect(dropZoneForPoint(axis, slot(), 160, 10)).toBe("after");
  });

  it("a horizontal lane offers the nest zone on the middle third across the width", () => {
    const axis: TransportAxis = "horizontal";
    expect(dropZoneForPoint(axis, slot(), 20, 10, true)).toBe("before");
    expect(dropZoneForPoint(axis, slot(), 100, 10, true)).toBe("onto");
    expect(dropZoneForPoint(axis, slot(), 190, 10, true)).toBe("after");
  });
});