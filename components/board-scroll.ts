/**
 * Pure board geometry: the bring-into-view scroll corrections and the drag
 * drop-zone edges. Split out so the deltas can be unit-tested (jsdom has no
 * layout: every rect reads 0, so inside the component they would always
 * no-op).
 *
 * The scroll functions return a single delta — or 0 when the target is
 * already in view — so applying it is always safe and never a scroll if
 * nothing moved.
 */

import type { TransportAxis } from "./card-transport";

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

/**
 * A lane's flow axis: `vertical` reads lanes as columns (cards stack
 * downward — the shipped default), `horizontal` reads lanes as rows (cards
 * flow left-to-right). The same lane direction the lane-direction preference
 * names; the type lives in card-transport beside the axis-aware keyframes.
 */

/**
 * Vertical twin of containerSlideX, for the horizontal-lane board: there the
 * lanes row scrolls vertically, so a lane row beyond the board's visible
 * range slides that scroll instead. A lane taller than the board wins its
 * top edge (the same ordered-checks read as containerSlideX).
 */
export function containerSlideY(container: DOMRect, target: DOMRect): number {
  if (target.top < container.top) return -(container.top - target.top);
  if (target.bottom > container.bottom) return target.bottom - container.bottom;
  return 0;
}

/**
 * Horizontal twin of listScrollY, for the horizontal-lane board: there the
 * lane's own list scrolls its cards horizontally, so a card outside its
 * row's visible range slides the row's scrollLeft.
 */
export function listScrollX(list: DOMRect, card: DOMRect): number {
  if (card.left < list.left) return -(list.left - card.left);
  if (card.right > list.right) return card.right - list.right;
  return 0;
}

/**
 * The drop-zone a pointer lands on over one card slot, read per lane
 * direction: the before/after halves are the insertion edges the board
 * always had (top/bottom in a vertical lane, left/right in a horizontal
 * one); the middle third is the nest zone — `nestAllowed` false (the
 * caller's guard refuses the family edge) returns the plain insertion edge
 * exactly as the "no middle third" falls back today. The point's other
 * coordinate is ignored on purpose: a horizontal lane's drop never splits on
 * the pointer's y, and vice versa.
 */
export function dropZoneForPoint(
  axis: TransportAxis,
  rect: DOMRect,
  x: number,
  y: number,
  nestAllowed: boolean = false,
): "before" | "after" | "onto" {
  const flowLength = axis === "horizontal" ? rect.width : rect.height;
  const flowStart = axis === "horizontal" ? x - rect.left : y - rect.top;
  if (flowStart < flowLength / 3) return "before";
  if (flowStart > (flowLength * 2) / 3) return "after";
  return nestAllowed ? "onto" : flowStart < flowLength / 2 ? "before" : "after";
}