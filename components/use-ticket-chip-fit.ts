import { useLayoutEffect, useRef } from "react";

/**
 * Shrink a ticket chip's id text until its longest id fits one line (issue
 * #104, mock 5).
 *
 * The card's contract forbids an individual ticket name from breaking across
 * lines: ids are `white-space: nowrap` and reflow between each other, never
 * mid-token. A single id wider than the chip's room (a long external key, from
 * MOBDEVLONG-100323 up) therefore scales its text down instead. CSS has no
 * width-aware font size, so this measures the rendered ids and steps the flow's
 * font size down until the widest id fits.
 *
 * Layout-dependent: jsdom reports every box as 0, so the hook no-ops there and
 * the jsdom suite pins the DOM contract (nowrap, wrapped ids) while the UAT
 * suite pins the real geometry. The observer also re-fits on card resize, so a
 * lane narrowing or widening re-solves the size without a remount.
 */
export function useTicketChipFit(enabled: boolean) {
  const flowRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    if (!enabled) return;
    const flow = flowRef.current;
    if (flow === null) return;
    // jsdom (and any layout-less host) cannot answer these questions; the
    // render stays at the base size rather than guessing.
    if (typeof ResizeObserver === "undefined") return;
    const baseSize = Number.parseFloat(getComputedStyle(flow).fontSize) || 10;
    let applied = false;
    const fit = () => {
      // Always re-measure from the base size: the floor and the ceiling both
      // depend on the card's current width, not on the previous answer.
      if (applied) {
        flow.style.fontSize = "";
        applied = false;
      }
      const available = flow.clientWidth;
      if (available <= 0) return;
      let size = baseSize;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const widest = widestIdWidth(flow);
        if (widest <= available + 0.5) break;
        // Proportional step, floored so the text never disappears.
        const next = Math.max(MIN_ID_FONT_PX, Math.floor(size * (available / widest) * 10) / 10);
        if (next >= size - 0.05) break;
        size = next;
        flow.style.fontSize = `${size}px`;
      }
      applied = size !== baseSize;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(flow);
    return () => observer.disconnect();
  }, [enabled]);
  return flowRef;
}

/** The floor the fitter will not shrink an id below (legibility beats fit). */
const MIN_ID_FONT_PX = 6;

function widestIdWidth(flow: HTMLElement): number {
  let widest = 0;
  const ids = flow.querySelectorAll<HTMLElement>("[data-ticket-id]");
  for (let index = 0; index < ids.length; index += 1) {
    const width = ids[index].getBoundingClientRect().width;
    if (width > widest) widest = width;
  }
  return widest;
}
