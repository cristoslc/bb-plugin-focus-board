/**
 * Pure bring-into-view geometry for the board's scroll corrections, split out
 * so the deltas can be unit-tested (jsdom has no layout: every rect reads 0,
 * so inside the component they would always no-op).
 *
 * Both functions return a single delta — or 0 when the target is already in
 * view — so applying it is always safe and never a scroll if nothing moved.
 */

/**
 * Horizontal delta that slides `target` fully inside the scroll container's
 * viewport. When the target is wider than the container, the left edge wins:
 * the checks are ordered, so only one branch can fire (the same left-edge
 * preference the inline if/else chain this replaces honoured).
 */
export function containerSlideX(container: DOMRect, target: DOMRect): number {
  if (target.left < container.left) return -(container.left - target.left);
  if (target.right > container.right) return target.right - container.right;
  return 0;
}

/**
 * Vertical delta for a card against its lane list's own scrollport (a lane
 * taller than the board scrolls its content; the board itself does not
 * scroll vertically). Applying it directly on the list — never
 * scrollIntoView — is deliberate: scrollIntoView would scroll every ancestor
 * including the host page.
 */
export function listScrollY(list: DOMRect, card: DOMRect): number {
  if (card.top < list.top) return -(list.top - card.top);
  if (card.bottom > list.bottom) return card.bottom - list.bottom;
  return 0;
}