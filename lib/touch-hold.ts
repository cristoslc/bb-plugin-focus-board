// The touch hold-drag gesture's clock, as pure state (issue #330).
//
// The board's interaction contract on a touch surface:
//
//   slide anywhere          → the board (or the lane under the finger) pans
//   touch, hold, slide      → the touched card is picked up and dragged
//   touch, hold, lift       → the pickup cancels; nothing moves, no link opens
//
// The two gestures share one beginning, so the ONLY thing that can tell them
// apart is time plus movement. This module owns that decision and nothing
// else: no DOM, no React, no timers. The wiring (components/touch-hold-drag.ts)
// runs the timers and dispatches the drag; tests drive this machine directly.
//
// The durations, and why:
//
// - `TOUCH_HOLD_ARM_MS = 180`. The band this must respect is "very short, but
//   long enough to distinguish a pan from a pickup". A finger that means to pan
//   moves within the first few frames, so it crosses the slop below long before
//   any arm deadline; 180ms sits far under the platform long-press (500ms on
//   iOS, ~400ms on Android), so the pickup feels immediate, and well over the
//   ~100ms a resting tap can last by accident.
// - `TOUCH_HOLD_CANCEL_SLOP_PX = 10`. Movement past this BEFORE the deadline
//   means the finger is panning, and the arm never happens. It is a hair above
//   the browser's own touch slop (8-10px), so an accidental 1px jitter during a
//   hold still arms while a real drag cancels immediately.
// - `TOUCH_HOLD_RELEASE_MIN_PX = 12`. After arming, a release that never left
//   the pickup point is a cancel, not a drop: the card was lifted, then put
//   back. A release that moved is a drop at where the finger let go. Twelve
//   pixels is the smallest motion that could plausibly be aimed at another
//   slot; below it there is no target the operator could have meant.

/** How long a finger must rest on a card before the card is picked up. */
export const TOUCH_HOLD_ARM_MS = 180;

/** Movement before the arm deadline that turns the gesture into a pan. */
export const TOUCH_HOLD_CANCEL_SLOP_PX = 10;

/** Smallest travel after arming that counts as aiming at a target. */
export const TOUCH_HOLD_RELEASE_MIN_PX = 12;

/**
 * The gesture's phase:
 *   idle    — no finger down on a drag source, or the gesture already resolved
 *   pending — a finger is down on a drag source, waiting out the arm deadline
 *   armed   — the card is picked up; movement drags it
 */
export type TouchHoldPhase = "idle" | "pending" | "armed";

export interface TouchHoldState {
  readonly phase: TouchHoldPhase;
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
}

/** No gesture in flight. */
export function idleHold(): TouchHoldState {
  return { phase: "idle", startX: 0, startY: 0, x: 0, y: 0 };
}

/** A finger landed on a drag source: start the clock. */
export function beginHold(x: number, y: number): TouchHoldState {
  return { phase: "pending", startX: x, startY: y, x, y };
}

/** How far the finger is from where it landed. */
export function holdTravel(state: TouchHoldState): number {
  return Math.hypot(state.x - state.startX, state.y - state.startY);
}

/**
 * What a movement does to the gesture:
 *   "none"  — too small to matter yet (and, while pending, the arm may still
 *             happen)
 *   "pan"   — the finger moved past the slop while the arm was still pending:
 *             the arm is off, and the gesture is a plain pan from here on
 *   "drag"  — armed already; the movement is the drag following the finger
 */
export type TouchHoldMoveEffect = "none" | "pan" | "drag";

export interface TouchHoldMove {
  readonly state: TouchHoldState;
  readonly effect: TouchHoldMoveEffect;
}

/** Track the finger. Movement before the deadline cancels the arm. */
export function moveHold(
  state: TouchHoldState,
  x: number,
  y: number,
): TouchHoldMove {
  if (state.phase === "idle") return { state, effect: "none" };
  const moved: TouchHoldState = { ...state, x, y };
  if (state.phase === "armed") return { state: moved, effect: "drag" };
  if (holdTravel(moved) > TOUCH_HOLD_CANCEL_SLOP_PX) {
    // The pan wins: idle, so no later arm can resurrect the gesture.
    return { state: idleHold(), effect: "pan" };
  }
  return { state: moved, effect: "none" };
}

/** The deadline elapsed with the finger still down: pick the card up. */
export function armHold(state: TouchHoldState): TouchHoldState {
  if (state.phase !== "pending") return state;
  return { ...state, phase: "armed" };
}

/**
 * What a release means:
 *   "drop"   — the card was picked up and moved; release writes the move
 *   "cancel" — the card was picked up but never moved: a safe cancel — no
 *              write, and no tap-through either (the operator asked to drag,
 *              so the card must not open under them)
 *   "tap"    — the gesture never armed: it is an ordinary tap and the browser
 *              goes on to open the card
 */
export type TouchHoldRelease = "drop" | "cancel" | "tap";

export function releaseHold(state: TouchHoldState): TouchHoldRelease {
  if (state.phase === "pending") return "tap";
  if (state.phase === "idle") return "tap";
  return holdTravel(state) >= TOUCH_HOLD_RELEASE_MIN_PX ? "drop" : "cancel";
}
