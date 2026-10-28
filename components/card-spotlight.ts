// The card spotlight's hand-written rule (issue #123 and its follow-ups).
//
// The compiled app.css is Tailwind over class tokens spelled out in the plugin
// source, and the old spotlight was three hand-copied arbitrary-variant class
// strings on the board roots (the arm, the 300ms delay, and the 300ms
// duration — same exemption chain repeated three times). One injected
// <style> element keeps the rule stated ONCE: the arm (`:has` a hovered card
// div), the recede target (card divs that are neither hovered nor immune),
// and the debounce live in a single block with a single exemption list.
//
// The recede never stacks on an existing dim: cards carrying
// `data-spotlight-immune` (components/card-status.ts — pane-open, sweep
// -highlighted, attention, or already-faded) are exempt, and the hovered card
// itself is exempt through `:hover`. Sweep-highlighted cards match the marker
// too, so the recede no longer names `data-sweep-highlighted` itself.

import { useEffect } from "react";

/**
 * DOM id of the injected spotlight `<style>` element. Doubles as the
 * idempotency key for `ensureCardSpotlightStyles` and the lookup handle for
 * tests; only one element with this id ever exists per document.
 */
export const CARD_SPOTLIGHT_STYLE_ID = "focus-board-card-spotlight";

/**
 * The full CSS text injected as one `<style>` block under
 * `CARD_SPOTLIGHT_STYLE_ID` by `ensureCardSpotlightStyles`. Its selector pair
 * must keep naming both board roots, and its exclusion list must stay aligned
 * with the immunity fields computed in components/card-status.ts;
 * tests/thread-card-hover-surface.test.tsx pins the selectors, the opacity,
 * and the debounce timings.
 */
export const CARD_SPOTLIGHT_RULE = `/* The card spotlight (issue #123): while ONE card is under the pointer, every
   other card recedes a step. Arms on a hovered card div; recedes only card
   divs that are NOT hovered and NOT immune (data-spotlight-immune, computed
   by components/card-status.ts). Debounce: a 300ms rest before the dim, then
   a 300ms ease in; the un-dim rides the card's own persistent 150ms
   zero-delay transition, so releasing the spotlight stays snappy. */
[data-columns-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover):not([data-spotlight-immune]),
[data-parent-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover):not([data-spotlight-immune]) {
  opacity: 0.7;
  transition-delay: 300ms;
  transition-duration: 300ms;
}
/* The focus arm: the thread pane holding one thread open is the same "focused
   on one thread" state the pointer arms. A card wearing data-focus-solid (the
   pane-held card, its family, or a parent-lane cell) lights the spotlight with
   no pointer in play; the marker also feeds data-spotlight-immune, and the
   marker is excluded here too, so the focused family never recedes. No
   debounce: a click cannot sweep, so the recede rides the card's own 150ms
   base transition in both directions. Nothing here is scoped down for a pane
   that covers the board: the marker itself is withheld instead (issue #310,
   components/pane-sheet-coverage.tsx), because this arm's cost is paid by
   every card's opacity changing, whoever selects them. */
[data-columns-board]:has(div[data-focus-solid]) div[data-thread-card]:not(:hover):not([data-focus-solid]):not([data-spotlight-immune]),
[data-parent-board]:has(div[data-focus-solid]) div[data-thread-card]:not(:hover):not([data-focus-solid]):not([data-spotlight-immune]) {
  opacity: 0.7;
}`;

/**
 * Inject the spotlight rule into `document.head` as a `<style>` element under
 * `CARD_SPOTLIGHT_STYLE_ID`. Side effect: mutates `document.head`. Idempotent:
 * a call is a no-op when that element already exists, so every board renderer
 * can call it. React surfaces should use `useCardSpotlightStyles` instead;
 * this is the direct entry point for non-React callers and tests.
 */
export function ensureCardSpotlightStyles(): void {
  if (document.getElementById(CARD_SPOTLIGHT_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = CARD_SPOTLIGHT_STYLE_ID;
  style.textContent = CARD_SPOTLIGHT_RULE;
  document.head.append(style);
}

/**
 * Mount the spotlight rule once, idempotently — both board renderers call
 * this, however many boards the app shows.
 */
export function useCardSpotlightStyles(): void {
  useEffect(() => {
    ensureCardSpotlightStyles();
  }, []);
}