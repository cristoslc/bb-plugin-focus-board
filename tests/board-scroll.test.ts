// @vitest-environment jsdom
// Pure bring-into-view geometry (components/board-scroll.ts). The board's
// scroll corrections run on DOM rects inside the component, but jsdom has no
// layout — every rect reads 0 and any wiring bug would hide as a no-op — so
// the deltas are split out and pinned here with hand-built rects.
import { describe, expect, it } from "vitest";
import { containerSlideX, listScrollY } from "../components/board-scroll";

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