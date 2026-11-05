// @vitest-environment jsdom
// The New project button's anchor onto the host composer's pickers row
// (lib/composer-row-anchor): the pure placement math and the DOM measure.
//
// The geometry this pins: the button's RIGHT edge meets the row's content
// start exactly — the boundary the first picker's click area begins at —
// and the button's box is vertically centered on the row's line. That is
// the jsdom half of the pointer-events audit; the probe
// (scripts/screenshot/repro-new-project-row.mjs) walks the same boundary
// with elementFromPoint in the real harness.
import { describe, expect, it } from "vitest";
import {
  COMPOSER_FOOTER_ROW_SELECTOR,
  composeFooterRowPlacement,
  measureFooterRowAnchor,
} from "../lib/composer-row-anchor";

describe("composeFooterRowPlacement (pure)", () => {
  it("centers the button on the row's line", () => {
    const placement = composeFooterRowPlacement(
      { top: 340, contentLeft: 38, height: 28 },
      28,
      28,
    );
    expect(placement.top).toBe(340); // (340 + (28-28)/2)
    expect(placement.left).toBe(10); // 38 - 28
  });

  it("a taller row centers the button inside it", () => {
    const placement = composeFooterRowPlacement(
      { top: 300, contentLeft: 38, height: 40 },
      28,
      28,
    );
    expect(placement.top).toBe(306); // 300 + (40 - 28)/2
  });

  it("the right edge equals the row's content start — the no-overlap invariant", () => {
    for (const contentLeft of [4, 14, 38]) {
      const placement = composeFooterRowPlacement(
        { top: 0, contentLeft, height: 28 },
        28,
        28,
      );
      expect(placement.left + 28).toBe(contentLeft);
      expect(placement.left).toBeLessThan(contentLeft);
    }
  });
});

describe("measureFooterRowAnchor (DOM)", () => {
  function buildWrapper(): { wrapper: HTMLElement; row: HTMLElement } {
    const wrapper = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-new-thread-footer", "");
    row.style.paddingLeft = "14px";
    wrapper.appendChild(row);
    document.body.appendChild(wrapper);
    return { wrapper, row };
  }

  /** jsdom has no layout, so the row's box is stubbed per element: offset
   *  values are own-property read-onlys and offsetParent is redirected to
   *  the wrapper so the primary (offset-based) branch runs. */
  function stubRowBox(
    row: HTMLElement,
    offsetParent: HTMLElement | null,
    box: { offsetTop: number; offsetLeft: number; offsetHeight: number },
  ): void {
    Object.defineProperty(row, "offsetParent", {
      configurable: true,
      value: offsetParent,
    });
    Object.defineProperty(row, "offsetTop", { configurable: true, value: box.offsetTop });
    Object.defineProperty(row, "offsetLeft", { configurable: true, value: box.offsetLeft });
    Object.defineProperty(row, "offsetHeight", { configurable: true, value: box.offsetHeight });
  }

  it("finds the footer row through bb's own hook inside the wrapper", () => {
    const { wrapper, row } = buildWrapper();
    stubRowBox(row, wrapper, { offsetTop: 350, offsetLeft: 0, offsetHeight: 28 });
    const placement = measureFooterRowAnchor(wrapper, 28, 28);
    expect(placement).not.toBeNull();
    // contentLeft = offsetLeft(0) + padding(14); button right edge there.
    expect(placement!.left).toBe(14 - 28);
    expect(placement!.top).toBe(350);
  });

  it("no footer row in the wrapper means no anchor (the stub-composer fallback)", () => {
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    expect(measureFooterRowAnchor(wrapper, 28, 28)).toBeNull();
  });

  it("zero geometry (jsdom-style no-layout through the rect fallback) keeps the stacked shape", () => {
    const { wrapper, row } = buildWrapper();
    // offsetParent null ≠ wrapper (jsdom) → the rect fallback branch, whose
    // zero-width guard then refuses to place.
    stubRowBox(row, null, { offsetTop: 350, offsetLeft: 0, offsetHeight: 28 });
    expect(measureFooterRowAnchor(wrapper, 28, 28)).toBeNull();
  });

  it("a positioned element between wrapper and row falls back to rect pairs", () => {
    const { wrapper, row } = buildWrapper();
    // A positioned intermediate (a future bb markup change) makes
    // offsetParent disagree with the wrapper: the measure falls back to
    // rect pairs relative to the wrapper with the same answer.
    const positioned = document.createElement("div");
    positioned.setAttribute("data-mock-positioned", "");
    wrapper.appendChild(positioned);
    positioned.appendChild(row);
    stubRowBox(row, positioned, { offsetTop: 0, offsetLeft: 0, offsetHeight: 0 });
    Object.defineProperty(positioned, "offsetParent", {
      configurable: true,
      value: positioned, // not the wrapper → rect branch
    });
    const rectFor = (left: number, top: number, width: number, height: number) => ({
      left,
      right: left + width,
      top,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => {},
    });
    Object.defineProperty(wrapper, "getBoundingClientRect", {
      configurable: true,
      value: () => rectFor(40, 100, 400, 300),
    });
    Object.defineProperty(row, "getBoundingClientRect", {
      configurable: true,
      value: () => rectFor(40, 400, 400, 28),
    });
    const placement = measureFooterRowAnchor(wrapper, 28, 28);
    expect(placement).not.toBeNull();
    // row.top - wrapper.top = 300; contentLeft = row.left - wrapper.left + 14.
    expect(placement!.top).toBe(300 + (28 - 28) / 2);
    expect(placement!.left).toBe((40 - 40 + 14) - 28);
  });

  it("the selector names bb's own row hook literally", () => {
    expect(COMPOSER_FOOTER_ROW_SELECTOR).toBe('[data-new-thread-footer=""]');
    const { wrapper } = buildWrapper();
    expect(wrapper.querySelector(COMPOSER_FOOTER_ROW_SELECTOR)).not.toBeNull();
  });
});
