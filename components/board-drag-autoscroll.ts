// The drag autoscroll's DOM wiring (issue #350): one rAF loop, shared by both
// drag paths, that turns the last dragover's pointer position into scrolls
// while a drag is live. lib/board-drag-autoscroll.ts owns the math (zone,
// ramp, ownership); this file feeds it and applies the deltas.
//
// How the pieces map onto what already ships:
//
// - The pointer position arrives as `dragover` events on the board's own
//   scroller. BOTH drag paths speak that event: a mouse drag raises real
//   `dragover`s (the browser keeps firing them while the pointer rests), and
//   the touch hold-drag (components/touch-hold-drag.ts) dispatches one at
//   every finger move, at the same clientX/clientY. One listener, both paths
//   — no second coordinate source to drift.
// - The lane list under the pointer is resolved from the event target with
//   the same walk the pan router uses for a gesture's origin lane
//   (components/board-pan.ts): the walk starts from a lane HEADER strip too,
//   whose card list is a sibling, not an ancestor.
// - The loop is armed and stopped by the board's own drag lifecycle
//   (`rankDragLifecycle`), so it runs for card drags, group-box unit drags,
//   the Pinned lane's drags, and an escaped dot — and never for a plain
//   hover (no lifecycle, no arm) or a plain dot drag (which stays in
//   `dotDraggingRef` and never enters the lifecycle).
// - A `dragleave` whose pointer left the scroller's subtree (the toolbar
//   above the lanes, the banner row, out of the window) parks the position:
//   the loop idles until a fresh dragover re-parks it, so a stale
//   in-board coordinate can never keep scrolling from the toolbar.
// - `drop` and `dragend` stop the loop outright. The listeners never
//   preventDefault a dragover: the edge zone scrolls, it does not swallow —
//   the drop still lands wherever the pointer is.
//
// The scroll is applied straight onto the scroller (`scrollLeft`/`scrollTop`),
// never scrollIntoView: scrollIntoView would scroll every ancestor including
// the host page, the exact escape the pan router exists to prevent.

import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
  dragEdgeOwnersFor,
  dragEdgeStep,
  dragEdgeVelocity,
  type DragEdgeBox,
} from "@/lib/board-drag-autoscroll";
import type { PanAxis } from "@/lib/board-pan";
import { panScrollBox } from "@/components/board-pan";

interface LoopState {
  armed: boolean;
  point: { x: number; y: number } | null;
  lane: Element | null;
  raf: number;
  lastTs: number | null;
  start: () => void;
  halt: () => void;
}

/** Project one scroller onto the axis it autoscrolls. */
function edgeBox(el: HTMLElement, axis: PanAxis): DragEdgeBox | null {
  const rect = el.getBoundingClientRect();
  // No layout (a hidden scroller, or jsdom with no rects stubbed): no zone to
  // stand in, so the loop must read as idle rather than as a zero-width one.
  if (rect.width === 0 && rect.height === 0) return null;
  const box = panScrollBox(el);
  return {
    lo: axis === "x" ? rect.left : rect.top,
    hi: axis === "x" ? rect.right : rect.bottom,
    canScroll: axis === "x" ? box.canScrollX : box.canScrollY,
  };
}

/** Apply one frame's worth of commanded pan to the board and its lane. */
function applyFrame(
  scroller: HTMLElement,
  lane: Element | null,
  laneDirection: "vertical" | "horizontal",
  point: { x: number; y: number },
  dtMs: number,
): void {
  const owners = dragEdgeOwnersFor(laneDirection);
  const boardPointer = owners.board === "x" ? point.x : point.y;
  const boardV = dragEdgeVelocity(edgeBox(scroller, owners.board), boardPointer);
  if (boardV !== 0) {
    const step = dragEdgeStep(boardV, dtMs);
    if (owners.board === "x") scroller.scrollLeft += step;
    else scroller.scrollTop += step;
  }
  if (lane === null || !lane.isConnected || !(lane instanceof HTMLElement)) return;
  const lanePointer = owners.lane === "x" ? point.x : point.y;
  const laneV = dragEdgeVelocity(edgeBox(lane, owners.lane), lanePointer);
  if (laneV !== 0) {
    const step = dragEdgeStep(laneV, dtMs);
    if (owners.lane === "x") lane.scrollLeft += step;
    else lane.scrollTop += step;
  }
}

export interface DragAutoscrollController {
  /** A drag went live (the board's lifecycle armed a card or a unit). */
  arm(): void;
  /** The drag is over: the loop halts and forgets the pointer. */
  stop(): void;
}

/**
 * Wire the autoscroll onto the board's scroller. One listener set, installed
 * once per (scroller, layout, enabled); the arm/stop handle is stable, so the
 * drag lifecycle can call it from any closure without re-wiring anything.
 */
export function useBoardDragAutoscroll(
  scrollerRef: RefObject<HTMLElement | null>,
  laneDirection: "vertical" | "horizontal",
  enabled: boolean,
): DragAutoscrollController {
  const stateRef = useRef<LoopState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = {
      armed: false,
      point: null,
      lane: null,
      raf: 0,
      lastTs: null,
      start: () => {},
      halt: () => {},
    };
  }
  const state = stateRef.current;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || !enabled) return;
    // The board scroller, narrowed once: the hoisted tick/schedule below
    // capture this binding rather than the ref (which re-widens to null).
    const board: HTMLElement = scroller;

    const useRaf = typeof requestAnimationFrame === "function";
    function schedule(): number {
      return useRaf
        ? requestAnimationFrame(tick)
        : (setTimeout(tick, 16) as unknown as number);
    }
    function unschedule(id: number): void {
      if (useRaf) cancelAnimationFrame(id);
      else clearTimeout(id);
    }
    function tick(ts: number): void {
      state.raf = 0;
      if (!state.armed) return;
      const point = state.point;
      if (point === null) {
        // Parked outside the board (a dragleave) or not yet over it: idle
        // this frame and reset the clock, so a return to the board never
        // scrolls for time that did not elapse over it.
        state.lastTs = null;
      } else {
        const dt = state.lastTs === null ? 0 : ts - state.lastTs;
        state.lastTs = ts;
        applyFrame(board, state.lane, laneDirection, point, dt);
      }
      state.raf = schedule();
    }
    function halt(): void {
      state.armed = false;
      state.point = null;
      state.lane = null;
      state.lastTs = null;
      if (state.raf !== 0) {
        unschedule(state.raf);
        state.raf = 0;
      }
    }

    const onDragOver = (event: DragEvent): void => {
      // Drag-gated: a dragover is only a position feed while a drag is live.
      // A plain hover near an edge never arms, so it never scrolls.
      if (!state.armed) return;
      const x = event.clientX;
      const y = event.clientY;
      // Missing or NaN coordinates are UNKNOWN, never inside a zone (the
      // same read the dot-drag escape makes for simulated events).
      if (typeof x !== "number" || typeof y !== "number") return;
      if (Number.isNaN(x) || Number.isNaN(y)) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      state.point = { x, y };
      // The lane under the pointer, origin-lane style: the walk also starts
      // from a lane's header strip, whose card list is a sibling.
      state.lane =
        target.closest("[data-column-id]")?.querySelector("[data-card-list]") ??
        null;
    };

    const onDragLeave = (event: DragEvent): void => {
      if (!state.armed) return;
      const to = event.relatedTarget;
      // Null relatedTarget: the drag left the window. Anything outside the
      // scroller's subtree (the toolbar, the banner row): out of the board.
      // Either way the position parks and the loop idles.
      if (to === null || !(to instanceof Element) || !board.contains(to)) {
        state.point = null;
        state.lane = null;
      }
    };

    const onStop = (): void => {
      // A drop lands first, then the dragend: both stop the loop. Stopping
      // on the drop itself matters — the commit that follows must not race
      // a pan still running under it.
      halt();
    };

    state.start = () => {
      if (state.raf === 0) state.raf = schedule();
    };
    state.halt = halt;
    board.addEventListener("dragover", onDragOver);
    board.addEventListener("dragleave", onDragLeave);
    board.addEventListener("drop", onStop);
    board.addEventListener("dragend", onStop);
    return () => {
      board.removeEventListener("dragover", onDragOver);
      board.removeEventListener("dragleave", onDragLeave);
      board.removeEventListener("drop", onStop);
      board.removeEventListener("dragend", onStop);
      halt();
      state.start = () => {};
      state.halt = () => {};
    };
  }, [scrollerRef, laneDirection, enabled, state]);

  return useMemo(
    () => ({
      arm: () => {
        state.armed = true;
        state.lastTs = null;
        state.start();
      },
      stop: () => {
        state.halt();
      },
    }),
    [state],
  );
}
