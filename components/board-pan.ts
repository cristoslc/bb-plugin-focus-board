// The board's pan router (issue #330): every slide inside the board surface
// pans the board, and none of them reaches the page.
//
// lib/board-pan.ts holds the decision; this file is the DOM wiring. It listens
// on the board REGION — the toolbar and the board scroller share one parent —
// because the operator's report is exactly about the region outside the
// scroller: "sliding a finger in the header scrolls the page".
//
// One gesture is decided once, on its first few pixels:
//
// - the browser keeps it when an element between the finger and the board (or
//   the board itself) can scroll in the gesture's direction, so native
//   scrolling, momentum, and the lane → board chain all stay the browser's;
// - otherwise the router calls `preventDefault` on every move, so the gesture
//   cannot escape to the page, and scrolls the owner by hand: the origin
//   lane's card list when the finger started in a lane (a lane's header strip
//   beside its cards), else the board scroller (the toolbar above the lanes);
// - when nothing inside the board has overflow in that direction, the gesture
//   is swallowed: nothing moves, and the page still never moves.
//
// A gesture another handler already claimed (`event.defaultPrevented`, e.g.
// the touch hold-drag once it arms) is left alone: a pickup must never also
// scroll the board under it.

import { useEffect, type RefObject } from "react";
import {
  NO_SCROLL,
  panOwnerFor,
  type PanAxis,
  type PanOwner,
  type PanScrollBox,
} from "@/lib/board-pan";

/**
 * How far the finger must travel before the router commits to an axis. It sits
 * under the browser's own scroll slop (8-10px) on purpose: the decision has to
 * be made, and `preventDefault` called, before the browser starts a page
 * scroll it would otherwise never give back.
 */
export const PAN_ROUTER_SLOP_PX = 4;

interface PanGesture {
  readonly target: Element;
  readonly board: HTMLElement | null;
  readonly laneList: HTMLElement | null;
  lastX: number;
  lastY: number;
  totalX: number;
  totalY: number;
  owner: PanOwner | null;
  axis: PanAxis | null;
}

/** Can this element be scrolled by a finger, and does it have range left? */
export function panScrollBox(element: Element | null): PanScrollBox {
  if (element === null) return NO_SCROLL;
  const style = getComputedStyle(element);
  const scrollable = (overflow: string): boolean => overflow === "auto" || overflow === "scroll";
  return {
    canScrollX:
      scrollable(style.overflowX) && element.scrollWidth - element.clientWidth > 1,
    canScrollY:
      scrollable(style.overflowY) && element.scrollHeight - element.clientHeight > 1,
  };
}

/** The axis the finger is actually travelling along. */
export function panGestureAxis(totalX: number, totalY: number): PanAxis {
  return Math.abs(totalX) >= Math.abs(totalY) ? "x" : "y";
}

/**
 * Whether an element between the finger and the region root can scroll this
 * axis natively. The walk stops AT the region (inclusive): the toolbar and the
 * lane headers live inside it, and the page scroller sits outside — a walk that
 * ran past the region would find the document's own scroll box and hand it a
 * gesture the board is supposed to keep.
 */
export function panAncestorOwnsAxis(
  target: Element,
  region: Element,
  axis: PanAxis,
): boolean {
  let node: Element | null = target;
  while (node !== null) {
    const box = panScrollBox(node);
    if (axis === "x" ? box.canScrollX : box.canScrollY) return true;
    if (node === region) return false;
    node = node.parentElement;
  }
  return false;
}

export function useBoardPanRouter(regionRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const region = regionRef.current;
    if (region === null) return;

    let gesture: PanGesture | null = null;

    const start = (event: TouchEvent): void => {
      if (event.touches.length !== 1) {
        gesture = null;
        return;
      }
      const touch = event.touches[0];
      const target = event.target;
      if (!(target instanceof Element)) {
        gesture = null;
        return;
      }
      gesture = {
        target,
        board: region.querySelector<HTMLElement>("[data-columns-board]"),
        // The origin lane's own list, whether the finger landed IN it (a card)
        // or beside it (the lane's header strip, which the browser has no
        // chain to because the list is a sibling, not an ancestor).
        laneList:
          target.closest("[data-column-id]")?.querySelector<HTMLElement>("[data-card-list]") ??
          null,
        lastX: touch.clientX,
        lastY: touch.clientY,
        totalX: 0,
        totalY: 0,
        owner: null,
        axis: null,
      };
    };

    const move = (event: TouchEvent): void => {
      const current = gesture;
      if (current === null || current.board === null) return;
      // A handler deeper in the tree already owns this gesture (the touch
      // hold-drag once it arms). Never scroll under a pickup.
      if (event.defaultPrevented) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      const dx = touch.clientX - current.lastX;
      const dy = touch.clientY - current.lastY;
      current.lastX = touch.clientX;
      current.lastY = touch.clientY;
      current.totalX += dx;
      current.totalY += dy;
      if (current.owner === null) {
        if (Math.hypot(current.totalX, current.totalY) < PAN_ROUTER_SLOP_PX) return;
        const axis = panGestureAxis(current.totalX, current.totalY);
        current.axis = axis;
        current.owner = panOwnerFor({
          axis,
          ancestor: panAncestorOwnsAxis(current.target, region, axis),
          lane: panScrollBox(current.laneList),
          board: panScrollBox(current.board),
        });
      }
      if (current.owner === "native") return;
      event.preventDefault();
      const horizontal = current.axis === "x";
      const delta = horizontal ? dx : dy;
      if (delta === 0) return;
      const owner =
        current.owner === "lane"
          ? current.laneList
          : current.owner === "board"
            ? current.board
            : null;
      if (owner === null) return;
      // A finger moving left reveals content to the right: scroll the scroller
      // the way the finger pushes, the same direction the browser would.
      if (horizontal) owner.scrollLeft -= delta;
      else owner.scrollTop -= delta;
    };

    const end = (): void => {
      gesture = null;
    };

    region.addEventListener("touchstart", start, { passive: true });
    region.addEventListener("touchmove", move, { passive: false });
    region.addEventListener("touchend", end, { passive: true });
    region.addEventListener("touchcancel", end, { passive: true });
    return () => {
      region.removeEventListener("touchstart", start);
      region.removeEventListener("touchmove", move);
      region.removeEventListener("touchend", end);
      region.removeEventListener("touchcancel", end);
    };
  }, [regionRef]);
}
