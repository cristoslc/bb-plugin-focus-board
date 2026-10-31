// Touch hold-drag: pick a card up with a short hold, then drag it (issue #330).
//
// The operator's contract:
//
//   "sliding a finger anywhere pans the board. Tap-hold-slide on card drags
//    the card. Hold duration should be very short but still long enough to
//    distinguish touch-to-pan-board from touch-to-drag-card"
//
// The board arms no native HTML5 drag source on a coarse pointer (issue #328):
// on iOS Safari `draggable` does nothing under a finger, and on Chrome Android
// the platform's long-press lift is an uncontrolled gesture that fights the
// pan. So the pickup is this module's own, and it feeds the SAME drag pipeline
// the mouse uses by dispatching the drag events the board already handles:
//
//   touch holds still TOUCH_HOLD_ARM_MS  → the card is armed (lifted, marked
//                                          `data-touch-drag-armed`) and the
//                                          board's drag lifecycle starts
//   every finger move after that         → a `dragover` at the finger, so the
//                                          lane's insertion line, the nest
//                                          ring, the family join, and every
//                                          drop rule behave exactly as they
//                                          do under a mouse
//   the finger lifts                     → a final `dragover` (the target the
//                                          release actually points at) and, if
//                                          that target claims the drag, a
//                                          `drop` — one shared write path, no
//                                          parallel reorder logic to drift
//   no drop, or a lift without movement  → the drag lifecycle ends exactly as
//                                          a `dragend` would, and nothing is
//                                          written (see lib/touch-hold.ts for
//                                          the release rule)
//
// The gesture never eats a pan: the arm only happens if the finger has not
// crossed `TOUCH_HOLD_CANCEL_SLOP_PX` before the deadline, and the whole
// gesture is `preventDefault`-free until it arms, so the browser's own scroll
// has the first claim on a moving finger. Once armed, every move is
// `preventDefault`ed (with a non-passive listener installed at mount) so a
// pickup cannot start scrolling the board under the card, and the release's
// click is suppressed so the card does not open after the drop.
//
// Out of scope, deliberately: the collapsed dot rows. A dot drag reorders one
// family tier and carries its own drag type and refusal rules; the touch
// contract asks for cards, nested rows, and group units, and every one of
// those is reachable here. The dots keep the mouse gesture (and Alt+Arrow).

import { useEffect, useRef, type RefObject } from "react";
import { DRAG_ID_KEY, rankDragType } from "@/lib/rank";
import {
  armHold,
  beginHold,
  idleHold,
  moveHold,
  releaseHold,
  TOUCH_HOLD_ARM_MS,
  type TouchHoldState,
} from "@/lib/touch-hold";

/** The attribute the picked-up card (or group frame) wears while it drags. */
export const TOUCH_DRAG_ARMED_ATTR = "data-touch-drag-armed";

/** DOM id of the injected lift stylesheet; the idempotency key and the test
 *  handle, the same shape as the dot pulse's stylesheet. */
export const TOUCH_HOLD_STYLE_ID = "focus-board-touch-hold";

/**
 * The pickup's look: the card lifts off the lane (a small scale, a real
 * shadow, the z-index that keeps it above its neighbours) while the insertion
 * line shows where it would land. The transform system is the same one the
 * mouse's transport animations use (no layout change), and it is static —
 * there is no animation frame per move, only the finger's own dragover.
 */
export const TOUCH_HOLD_STYLE_TEXT =
  `[${TOUCH_DRAG_ARMED_ATTR}] { ` +
  `transform: scale(1.02); transform-origin: center; ` +
  `box-shadow: 0 10px 24px rgb(0 0 0 / 0.38); ` +
  `opacity: 0.92; position: relative; z-index: 30; }`;

function ensureTouchHoldStyles(): void {
  if (document.getElementById(TOUCH_HOLD_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = TOUCH_HOLD_STYLE_ID;
  style.textContent = TOUCH_HOLD_STYLE_TEXT;
  document.head.append(style);
}

/**
 * The drag payload a touch pickup carries. It mirrors what the card's own
 * `onDragStart` writes: the moved id under `DRAG_ID_KEY`, plus the lane's rank
 * drag type (the marker every dragover reads mid-drag, since a real browser
 * keeps the payload write-only until the drop).
 *
 * A plain object, not `new DataTransfer()`: the drop handlers only read
 * `types`, `getData`, and write `dropEffect`, and jsdom (where the gesture's
 * tests run) has no DataTransfer at all.
 */
export interface TouchDragPayload {
  readonly types: string[];
  getData(format: string): string;
  setData(format: string, value: string): void;
  effectAllowed: string;
  dropEffect: string;
}

export function createTouchDragPayload(threadId: string, rankKey: string): TouchDragPayload {
  const data = new Map<string, string>();
  const payload: TouchDragPayload = {
    types: [],
    getData: (format) => data.get(format) ?? "",
    setData: (format, value) => {
      if (!payload.types.includes(format)) payload.types.push(format);
      data.set(format, value);
    },
    effectAllowed: "move",
    dropEffect: "none",
  };
  payload.setData(DRAG_ID_KEY, threadId);
  payload.setData(rankDragType(rankKey), "");
  return payload;
}

/** The drag source a touch landed on: the card id to move and the lane whose
 *  order the move belongs to. */
export interface TouchDragSource {
  /** The element that lifts (the card, the row, or the whole group frame). */
  readonly element: Element;
  readonly threadId: string;
  readonly rankKey: string;
  /** A group unit drags its members together, so the frame carries the lift. */
  readonly unit: boolean;
}

/** Controls whose own gesture outranks a pickup: a tap on them is theirs. */
const CONTROL_SELECTOR = "button, input, textarea, select, [role='checkbox'], [role='switch']";

/**
 * Resolve the pickup from the element under the finger, or null when this
 * touch is not a drag source at all (a button, a chip, empty lane space, a
 * snoozed card). The box's own label resolves to its lead member, exactly as
 * `beginBoxLabelDrag` does, and the frame carries the lift.
 */
export function resolveTouchDragSource(target: Element | null): TouchDragSource | null {
  if (target === null) return null;
  const control = target.closest(CONTROL_SELECTOR);
  // Controls inside a group frame keep their taps, but a HOLD on them is a
  // unit pickup: the frame's own label is a button when renaming is wired,
  // and the folded card's chips are buttons too.
  if (control !== null && control.closest("[data-group-box]") === null) return null;

  const box = target.closest("[data-group-box]");
  const card = target.closest("[data-thread-card]");
  const lane = (box ?? card)?.closest("[data-column-id]");
  const rankKey = lane?.getAttribute("data-rank-key") ?? null;
  if (rankKey === null) return null;

  // A card inside a group frame still resolves to the card; the unit move
  // treats its members as one, so either entry point writes the same box move.
  if (card !== null && (box === null || box.contains(card))) {
    const threadId = card.getAttribute("data-thread-card");
    if (threadId === null || threadId === "") return null;
    if (card.closest("[data-snoozed]") !== null) return null;
    return { element: card, threadId, rankKey, unit: false };
  }

  if (box !== null) {
    // The frame names its lead member (a folded frame renders no member
    // cards at all); the older expanded markup is read from its first card.
    const lead = box.getAttribute("data-group-box-lead") ?? box.querySelector("[data-thread-card]")?.getAttribute("data-thread-card") ?? null;
    if (lead === null || lead === "") return null;
    if (box.querySelector("[data-snoozed]") !== null) return null;
    return { element: box, threadId: lead, rankKey, unit: true };
  }

  return null;
}

/**
 * Dispatch one drag event at a viewport point. `dataTransfer`, `clientX`, and
 * `clientY` are defined on the event because a plain `Event` carries none of
 * them and React reads them off the native event; the constructor is chosen
 * from what the environment has (`DragEvent` in a browser, `Event` in jsdom),
 * so the same helper drives the product and its tests.
 */
export function dispatchTouchDrag(
  element: Element,
  type: "dragover" | "drop" | "dragleave",
  point: { x: number; y: number },
  payload: TouchDragPayload,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(event, key, { configurable: true, enumerable: true, value });
  };
  define("dataTransfer", payload);
  define("clientX", point.x);
  define("clientY", point.y);
  define("screenX", point.x);
  define("screenY", point.y);
  define("relatedTarget", null);
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

/** The element under a viewport point, falling back to the gesture's own
 *  target where the environment has no hit test (jsdom has no layout). */
function elementAt(point: { x: number; y: number }, fallback: Element): Element {
  if (typeof document.elementFromPoint !== "function") return fallback;
  return document.elementFromPoint(point.x, point.y) ?? fallback;
}

export interface TouchHoldDragOptions {
  /** Coarse pointer + ranking wired: only then is a pickup possible. */
  readonly enabled: boolean;
  /** The board's drag lifecycle starts: `rankDragLifecycle(id)`. */
  readonly onArm: (threadId: string) => void;
  /**
   * The gesture resolved. `dropped` means a drop event was dispatched,
   * `cancelled` means it was not (no target, no move, or the browser took the
   * gesture back); either way the board's lifecycle must end.
   */
  readonly onEnd: (outcome: "dropped" | "cancelled") => void;
  /** A pickup released without moving: the one outcome worth naming. */
  readonly onCancelledPickup?: () => void;
}

/**
 * Wire the hold-drag onto a scroll surface. One listener set, installed once
 * (non-passive `touchmove`, so an armed pickup can hold the scroll off).
 */
export function useTouchHoldDrag(
  scrollerRef: RefObject<HTMLElement | null>,
  options: TouchHoldDragOptions,
): void {
  // The callbacks change every render (they close over board state); the
  // listeners must not, or a re-render mid-gesture would drop them.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const enabled = options.enabled;

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || !enabled) return;
    ensureTouchHoldStyles();

    let hold: TouchHoldState = idleHold();
    let source: TouchDragSource | null = null;
    let payload: TouchDragPayload | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hovered: Element | null = null;
    let releaseTarget: Element | null = null;
    let point = { x: 0, y: 0 };
    let suppressClick = false;
    // Did the board's drag lifecycle actually start for this gesture? A pan
    // that never armed owns no lifecycle and no cancellation to report.
    let armed = false;

    const clearTimer = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const clearHover = (): void => {
      if (hovered !== null && payload !== null) {
        dispatchTouchDrag(hovered, "dragleave", point, payload);
      }
      hovered = null;
    };

    /**
     * End the gesture. `cancelledPickup` is the armed-then-released-in-place
     * case, the one outcome worth naming on screen; a gesture that never armed
     * is a pan or a tap and says nothing.
     */
    const settle = (
      outcome: "dropped" | "cancelled",
      cancelledPickup = false,
    ): void => {
      clearTimer();
      clearHover();
      if (source !== null) source.element.removeAttribute(TOUCH_DRAG_ARMED_ATTR);
      const wasArmed = armed;
      armed = false;
      hold = idleHold();
      source = null;
      payload = null;
      if (!wasArmed) return;
      optionsRef.current.onEnd(outcome);
      if (cancelledPickup) optionsRef.current.onCancelledPickup?.();
    };

    const arm = (): void => {
      timer = null;
      if (hold.phase !== "pending" || source === null) return;
      hold = armHold(hold);
      armed = true;
      payload = createTouchDragPayload(source.threadId, source.rankKey);
      source.element.setAttribute(TOUCH_DRAG_ARMED_ATTR, "");
      optionsRef.current.onArm(source.threadId);
      // The pickup lands at the finger's resting point: show the insertion
      // line under it immediately, before the finger moves again.
      const under = elementAt(point, source.element);
      hovered = under;
      dispatchTouchDrag(under, "dragover", point, payload);
    };

    const start = (event: TouchEvent): void => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (!(target instanceof Element)) return;
      const resolved = resolveTouchDragSource(target);
      if (resolved === null) return;
      point = { x: touch.clientX, y: touch.clientY };
      source = resolved;
      releaseTarget = null;
      hold = beginHold(point.x, point.y);
      clearTimer();
      timer = setTimeout(arm, TOUCH_HOLD_ARM_MS);
    };

    const move = (event: TouchEvent): void => {
      if (source === null) return;
      const touch = event.touches[0];
      if (touch === undefined) return;
      point = { x: touch.clientX, y: touch.clientY };
      const moved = moveHold(hold, point.x, point.y);
      hold = moved.state;
      if (moved.effect === "pan") {
        // The finger is panning: the arm is off and the browser owns the rest.
        settle("cancelled");
        return;
      }
      if (moved.effect !== "drag" || payload === null) return;
      // Armed: no scroll may start under the card.
      event.preventDefault();
      // Where the finger is now. Without a hit test (jsdom) the move event's
      // own target is the only reliable reading of the element underneath.
      const under = elementAt(
        point,
        event.target instanceof Element ? event.target : source.element,
      );
      releaseTarget = under;
      if (under !== hovered) {
        clearHover();
        hovered = under;
      }
      dispatchTouchDrag(under, "dragover", point, payload);
    };

    const end = (): void => {
      if (source === null) return;
      const decision = releaseHold(hold);
      if (decision === "tap") {
        // Never armed: this was a pan or a tap, and the browser's own click
        // goes on to open the card.
        hold = idleHold();
        source = null;
        payload = null;
        releaseTarget = null;
        clearTimer();
        return;
      }
      suppressClick = true;
      if (decision === "cancel") {
        settle("cancelled", true);
        return;
      }
      // A drop is only a drop where the surface claims it, exactly as a real
      // browser's: the final dragover re-reads the release point (the last
      // move's target can be stale), and an unclaimed release writes nothing.
      if (payload === null) {
        settle("cancelled");
        return;
      }
      const under = elementAt(point, releaseTarget ?? source.element);
      const claimed = dispatchTouchDrag(under, "dragover", point, payload);
      if (!claimed) {
        settle("cancelled");
        return;
      }
      hovered = null;
      dispatchTouchDrag(under, "drop", point, payload);
      settle("dropped");
    };

    const cancel = (): void => {
      if (source === null) return;
      if (armed) {
        settle("cancelled");
        return;
      }
      hold = idleHold();
      source = null;
      payload = null;
      clearTimer();
    };

    const preventDefault = (event: Event): void => {
      // While a pickup is armed the browser may try its own affordances (a
      // context menu, a text selection, a callout). None of them belong to a
      // drag.
      if (hold.phase === "armed") event.preventDefault();
    };

    const clickGuard = (event: Event): void => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    scroller.addEventListener("touchstart", start, { passive: true });
    scroller.addEventListener("touchmove", move, { passive: false });
    scroller.addEventListener("touchend", end, { passive: false });
    scroller.addEventListener("touchcancel", cancel, { passive: true });
    scroller.addEventListener("contextmenu", preventDefault);
    document.addEventListener("click", clickGuard, true);
    return () => {
      clearTimer();
      clearHover();
      if (source !== null) source.element.removeAttribute(TOUCH_DRAG_ARMED_ATTR);
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end);
      scroller.removeEventListener("touchcancel", cancel);
      scroller.removeEventListener("contextmenu", preventDefault);
      document.removeEventListener("click", clickGuard, true);
    };
  }, [scrollerRef, enabled]);
}
