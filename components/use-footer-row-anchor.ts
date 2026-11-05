import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefCallback } from "react";

import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import {
  NEW_PROJECT_BUTTON_HEIGHT,
  NEW_PROJECT_BUTTON_WIDTH,
  measureFooterRowAnchor,
  type FooterRowPlacement,
} from "@/lib/composer-row-anchor";

/**
 * Anchor for the New project button onto the host composer's pickers row.
 * The shape (lib/composer-row-anchor carries the full reasoning): while the
 * dialog is open on a desktop viewport, the row inside the wrapper the
 * returned ref must sit on is measured live and re-measured whenever the
 * composer's layout moves it (prompt growth, banner fill, viewport-class
 * flips through the ResizeObserver); the placement puts the button's right
 * edge at the row's content start — zero overlap with the first picker's
 * click area — centered on the row's line.
 *
 * Timing (why three measure passes): the DialogContent portals its subtree
 * through Radix, and React attaches a portal subtree's refs around the
 * modal's own layout effects, so a first-pass measure from the modal's
 * layout effect can see the wrapper's ref still unset. The passes:
 *
 * - the wrapper's callback-ref attach (the wrapper is the row's ancestor,
 *   so every row has attached by then),
 * - a layout-effect pass and a post-paint passive pass (the passive pass
 *   is jsdom's only pass — no ResizeObserver there),
 * - the ResizeObserver, bound to the wrapper at attach: the browser
 *   delivers a fresh reading at the first frame after observe, and every
 *   later composer layout growth re-lands the placement inside that frame
 *   (before paint, so no stacked-shape frame ever shows).
 *
 * Null is the stacked-shape contract, never an error: at a compact viewport
 * the drawer shell's row starts ~4px (the row's own `max-md:px-1`) from the
 * drawer's edge, which cannot hold a 28px button beside the pickers without
 * covering the first picker's click area, so the button stays in the stacked
 * flow shape below the composer there. jsdom (no layout, and the tests'
 * stub composers render no row) measures to null the same way, which the
 * suite pins as the fallback's DOM contract.
 */
export function useFooterRowAnchor(enabled: boolean): {
  setWrapperElement: RefCallback<HTMLDivElement | null>;
  placement: FooterRowPlacement | null;
} {
  const wrapperElementRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [placement, setPlacement] = useState<FooterRowPlacement | null>(null);
  const isCompactViewport = useIsCompactViewport();

  const measure = useCallback(() => {
    const wrapper = wrapperElementRef.current;
    if (wrapper === null) return;
    const next =
      enabled && !isCompactViewport
        ? measureFooterRowAnchor(wrapper, NEW_PROJECT_BUTTON_WIDTH, NEW_PROJECT_BUTTON_HEIGHT)
        : null;
    // No-change updates stay silent: the passes and the observer fire on
    // every composer box change, and each would otherwise re-render the
    // modal with an equal placement object.
    setPlacement((previous) =>
      previous !== null &&
      next !== null &&
      previous.top === next.top &&
      previous.left === next.left
        ? previous
        : next,
    );
  }, [enabled, isCompactViewport]);
  const measureRef = useRef(measure);
  measureRef.current = measure;

  // The wrapper's callback ref: the row is this wrapper's descendant, so by
  // the wrapper's own ref attach every host row has attached too — the
  // measure here always sees the row. The ResizeObserver binds to the
  // element's lifetime right here, out of the effects' path entirely: the
  // browser's first RO reading arrives before the first paint, and every
  // later layout change re-lands the placement in its frame.
  const setWrapperElement = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === wrapperElementRef.current) return;
      wrapperElementRef.current = element;
      if (observerRef.current !== null) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (element === null) return;
      if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(() => measureRef.current());
        observer.observe(element);
        observerRef.current = observer;
      }
      if (enabled) measureRef.current();
    },
    [enabled],
  );

  useLayoutEffect(() => {
    measure();
  }, [measure]);
  useEffect(() => {
    measure();
  }, [measure]);

  return { setWrapperElement, placement };
}
