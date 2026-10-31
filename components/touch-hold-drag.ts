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
//   touch holds still TOUCH_HOLD_ARM_MS  → the card is armed (marked
//                                          `data-touch-drag-armed`, its slot
//                                          reading as the hole the pickup came
//                                          out of) and a floating SNAPSHOT of
//                                          it lifts under the finger (see
//                                          `createTouchDragGhost`), while the
//                                          board's drag lifecycle starts
//   every finger move after that         → the snapshot follows the finger 1:1,
//                                          plus a `dragover` at the finger, so the
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
//                                          the release rule); the snapshot
//                                          fades and leaves the document
//
// The gesture never eats a pan: the arm only happens if the finger has not
// crossed `TOUCH_HOLD_CANCEL_SLOP_PX` before the deadline, and the whole
// gesture is `preventDefault`-free until it arms, so the browser's own scroll
// has the first claim on a moving finger. Once armed, every move is
// `preventDefault`ed (with a non-passive listener installed at mount) so a
// pickup cannot start scrolling the board under the card, and the release's
// click is suppressed so the card does not open after the drop.
//
// Nothing else may open mid-gesture (issue #336). The arm fires at 180ms and
// the platform's own long press at ~500ms, so a resting finger would otherwise
// have a context menu pop over the drag a few hundred milliseconds after the
// pickup. This module refuses the browser's menu for the whole gesture, and
// `touchDragArmed()` is the predicate every menu surface consults before it
// opens: while a card is lifted, the drag owns the gesture.
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

/**
 * The attribute the floating snapshot wears (issue #336). It is the ghost's
 * whole identity, the way `data-transport-ghost` marks the dissolve's copies:
 * styled from one injected rule, found by the tests, and never a card — every
 * board lookup keys on `data-thread-card`, which the clone drops.
 */
export const TOUCH_DRAG_GHOST_ATTR = "data-touch-drag-ghost";

/** The released snapshot's fade marker: opacity 0, removed one beat later. */
export const TOUCH_DRAG_GHOST_RELEASED_ATTR = "data-touch-drag-ghost-released";

/**
 * How long the snapshot lingers while it fades out at the release. Short on
 * purpose: the card must already be back in its slot (or in its new lane, with
 * the transport's own dissolve playing), so a long tail would lie about where
 * the card ended up.
 */
export const TOUCH_GHOST_RELEASE_MS = 120;

/**
 * The lift's scale. The snapshot is the card's clone, so it scales from the
 * point under the finger (`transform-origin` is the grab offset): the content
 * the thumb landed on stays under the thumb, and the card reads as lifted off
 * the lane by the small ring of card that appears around it.
 */
export const TOUCH_GHOST_LIFT_SCALE = 1.04;

/** DOM id of the injected lift stylesheet; the idempotency key and the test
 *  handle, the same shape as the dot pulse's stylesheet. */
export const TOUCH_HOLD_STYLE_ID = "focus-board-touch-hold";

/**
 * The pickup's look, in two parts (issue #336).
 *
 * The card left behind is the HOLE the pickup came out of: still in the flow,
 * because the lane's geometry is what every drop rule reads, and dimmed so the
 * eye follows the snapshot instead of the slot. `-webkit-touch-callout` rides
 * here because iOS's link callout is not a `contextmenu` event and nothing else
 * refuses it: a long press must not offer to open the card mid-drag.
 *
 * The snapshot is the LIFT: fixed over the whole board (a lane clips its own
 * cross axis, so an in-place transform could never leave the lane), above every
 * scroll container, and never a hit target. Its motion is a transform on the
 * same system the transport animations use — no layout change per move.
 */
export const TOUCH_HOLD_STYLE_TEXT =
  `[${TOUCH_DRAG_ARMED_ATTR}] { ` +
  `opacity: 0.35; -webkit-touch-callout: none; }` +
  `[${TOUCH_DRAG_GHOST_ATTR}] { ` +
  `position: fixed; z-index: 60; pointer-events: none; margin: 0; ` +
  // The lift has to read on a dark board where a black shadow nearly vanishes:
  // a hairline rim separates the snapshot from whatever it is crossing, and the
  // deeper shadow keeps it above the lane in a light theme.
  `box-shadow: 0 0 0 1px rgb(255 255 255 / 0.16), ` +
  `0 18px 40px rgb(0 0 0 / 0.55), 0 6px 14px rgb(0 0 0 / 0.35); ` +
  `opacity: 0.98; transform-origin: top left; ` +
  `transition: opacity ${TOUCH_GHOST_RELEASE_MS}ms ease-out; }` +
  `[${TOUCH_DRAG_GHOST_ATTR}][${TOUCH_DRAG_GHOST_RELEASED_ATTR}] { opacity: 0; }`;

function ensureTouchHoldStyles(): void {
  if (document.getElementById(TOUCH_HOLD_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = TOUCH_HOLD_STYLE_ID;
  style.textContent = TOUCH_HOLD_STYLE_TEXT;
  document.head.append(style);
}

/**
 * Is a touch pickup in flight right now (issue #336)? The drag owns the
 * gesture while it is armed: no menu, no selection, no callout. Every surface
 * that can open something on a press consults this first. It reads the marker
 * the gesture itself sets, so it is exact at event time with no React state to
 * lag behind a finger, and it costs one query in a press handler.
 */
export function touchDragArmed(): boolean {
  return document.querySelector(`[${TOUCH_DRAG_ARMED_ATTR}]`) !== null;
}

/**
 * The snapshot's travel from where the finger grabbed it. A transform, never
 * left/top: the ghost is out of flow, and a finger-speed move must repaint it,
 * not relayout the card it copied. `transform-origin` sits at the grab point
 * (set at creation), so scaling keeps the content under the thumb fixed.
 */
export function touchGhostTransform(dx: number, dy: number): string {
  return `translate3d(${dx}px, ${dy}px, 0) scale(${TOUCH_GHOST_LIFT_SCALE})`;
}

/**
 * Where a snapshot may be parented so it keeps the card's look. The plugin's
 * Tailwind utilities are scoped to an ancestor (`[data-bb-plugin=…]` /
 * `[data-bb-plugin-root]`), so a clone hung off `document.body` resolves none
 * of them: no `bg-card`, no border radius, no muted text — the lift rendered as
 * bare floating text the first time this shipped. The nearest scope ancestor is
 * also the right place to escape the board's clipping: it sits outside the
 * board's scrollers, and the snapshot is `position: fixed`.
 */
export const TOUCH_GHOST_SCOPE_SELECTOR = "[data-bb-plugin], [data-bb-plugin-root]";

/**
 * Lift a floating snapshot of the dragged element (issue #336): the canonical
 * Trello-style pickup, and the piece the first cut of the gesture was missing.
 * A card that is only marked in its slot cannot be seen moving, so the finger
 * drags a promise with nothing attached to it.
 *
 * The snapshot is a deep clone, because it has to leave the lane: a lane clips
 * its own cross axis (`overflow-x-clip` on a vertical read), so transforming
 * the real card in place could never carry it to another lane. The clone hangs
 * off the plugin's own scope element at the element's viewport box, and the
 * finger moves it with a transform.
 *
 * The copy is decoration, never a second card: it answers to no
 * `data-thread-card` (every board lookup keys on that attribute — the reveal
 * effect, the keep-in-view correction, the drag-out-of-DOM safety), carries no
 * drag source, and sits outside the accessibility tree.
 */
export function createTouchDragGhost(
  element: Element,
  point: { x: number; y: number },
): HTMLElement {
  const rect = element.getBoundingClientRect();
  const ghost = element.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-thread-card");
  ghost.removeAttribute(TOUCH_DRAG_ARMED_ATTR);
  for (const nested of Array.from(ghost.querySelectorAll("[data-thread-card]"))) {
    nested.removeAttribute("data-thread-card");
  }
  for (const source of Array.from(ghost.querySelectorAll("[draggable]"))) {
    source.removeAttribute("draggable");
  }
  ghost.setAttribute(TOUCH_DRAG_GHOST_ATTR, "");
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  // The grab point, in the element's own coordinates: the thumb keeps the
  // content it landed on.
  ghost.style.transformOrigin = `${point.x - rect.left}px ${point.y - rect.top}px`;
  ghost.style.transform = touchGhostTransform(0, 0);
  (element.closest(TOUCH_GHOST_SCOPE_SELECTOR) ?? document.body).append(ghost);
  return ghost;
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
    // The floating snapshot the pickup lifts, and where the finger grabbed it
    // (the origin its travel is measured from).
    let ghost: HTMLElement | null = null;
    let ghostTimer: ReturnType<typeof setTimeout> | null = null;
    let ghostOrigin = { x: 0, y: 0 };
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

    /** Put the snapshot where the finger is: one transform, no layout. */
    const trackGhost = (): void => {
      if (ghost === null) return;
      ghost.style.transform = touchGhostTransform(
        point.x - ghostOrigin.x,
        point.y - ghostOrigin.y,
      );
    };

    /**
     * Resolve the snapshot. The card is already back in its slot (or has moved
     * lanes, with the transport's own dissolve playing), so the ghost fades
     * fast and leaves: a lingering snapshot would lie about where the card
     * went. Every release path — a committed drop, a safe cancel, a refused
     * drop, the browser taking the gesture back — resolves the same way.
     */
    const releaseGhost = (): void => {
      const lifted = ghost;
      ghost = null;
      if (lifted === null) return;
      lifted.setAttribute(TOUCH_DRAG_GHOST_RELEASED_ATTR, "");
      if (ghostTimer !== null) clearTimeout(ghostTimer);
      ghostTimer = setTimeout(() => {
        ghostTimer = null;
        lifted.remove();
      }, TOUCH_GHOST_RELEASE_MS);
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
      releaseGhost();
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
      // The visible lift: the snapshot is anchored at the finger, so the pickup
      // is legible before the finger has moved a pixel.
      ghostOrigin = { x: point.x, y: point.y };
      ghost = createTouchDragGhost(source.element, point);
      // Android can feel the lift. iOS Safari ships no Vibration API at all
      // (every iOS browser is WebKit), so the snapshot IS the feedback there —
      // which is why the lift has to be real rather than a marked slot.
      if (typeof navigator.vibrate === "function") navigator.vibrate(8);
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
      // Armed: no scroll may start under the card, and the snapshot goes where
      // the finger goes — before the dragover, so the card the eye follows is
      // never a frame behind the promise the drop rules paint.
      event.preventDefault();
      trackGhost();
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
      // For the whole gesture the browser may try its own affordances (a
      // context menu, a text selection, a callout). None of them belong to a
      // drag — and the platform's long press lands ~300ms AFTER the arm, so the
      // pending phase is part of the window too. This listener is on
      // `contextmenu` alone, so it can never eat a pan the pending phase still
      // owes the browser.
      if (hold.phase !== "idle") event.preventDefault();
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
      // A snapshot outliving its gesture would float over the board forever.
      if (ghostTimer !== null) clearTimeout(ghostTimer);
      ghostTimer = null;
      ghost?.remove();
      ghost = null;
      scroller.removeEventListener("touchstart", start);
      scroller.removeEventListener("touchmove", move);
      scroller.removeEventListener("touchend", end);
      scroller.removeEventListener("touchcancel", cancel);
      scroller.removeEventListener("contextmenu", preventDefault);
      document.removeEventListener("click", clickGuard, true);
    };
  }, [scrollerRef, enabled]);
}
