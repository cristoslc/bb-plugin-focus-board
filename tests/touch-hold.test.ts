// The touch hold-drag clock (issue #330): the arm deadline, the pan that
// cancels it, and what a release means.
//
// The operator's contract is exactly one sentence long, and every case here is
// a clause of it: "sliding a finger anywhere pans the board. Tap-hold-slide on
// card drags the card. Hold duration should be very short but still long
// enough to distinguish touch-to-pan-board from touch-to-drag-card."
import { describe, expect, it } from "vitest";
import {
  armHold,
  beginHold,
  holdTravel,
  idleHold,
  moveHold,
  releaseHold,
  TOUCH_HOLD_ARM_MS,
  TOUCH_HOLD_CANCEL_SLOP_PX,
  TOUCH_HOLD_RELEASE_MIN_PX,
  type TouchHoldState,
} from "../lib/touch-hold";

/** A hold armed at (100, 100), then moved to a point: the drag's own order. */
function armedAt(x: number, y: number): TouchHoldState {
  return moveHold(armHold(beginHold(100, 100)), x, y).state;
}

describe("the hold threshold", () => {
  it("is short enough to feel immediate and long enough not to catch a tap", () => {
    // The band the operator named is 150-250ms. A tap is over in ~100ms; the
    // platform long press is 400-500ms.
    expect(TOUCH_HOLD_ARM_MS).toBeGreaterThanOrEqual(150);
    expect(TOUCH_HOLD_ARM_MS).toBeLessThanOrEqual(250);
  });

  it("arms only after the deadline, and only once", () => {
    const pending = beginHold(100, 100);
    expect(pending.phase).toBe("pending");
    const armed = armHold(pending);
    expect(armed.phase).toBe("armed");
    // Arming a gesture that already resolved is a no-op, never a resurrection.
    expect(armHold(idleHold()).phase).toBe("idle");
  });
});

describe("a finger that moves before the deadline", () => {
  it("cancels the arm and leaves the gesture a plain pan", () => {
    const start = beginHold(100, 100);
    const moved = moveHold(start, 100 + TOUCH_HOLD_CANCEL_SLOP_PX + 1, 100);
    expect(moved.effect).toBe("pan");
    expect(moved.state.phase).toBe("idle");
    // Armed after a pan cancel would eat the scroll the finger asked for.
    expect(armHold(moved.state).phase).toBe("idle");
    expect(releaseHold(moved.state)).toBe("tap");
  });

  it("tolerates a resting finger's jitter under the slop", () => {
    const moved = moveHold(beginHold(100, 100), 100 + TOUCH_HOLD_CANCEL_SLOP_PX, 100);
    expect(moved.effect).toBe("none");
    expect(moved.state.phase).toBe("pending");
    expect(armHold(moved.state).phase).toBe("armed");
  });

  it("reads travel from the pickup point, not from the last move", () => {
    // Gliding 6px three times is 18px of travel: still a pan, even though no
    // single move crossed the slop.
    let state = beginHold(100, 100);
    let effect = "none";
    for (const x of [106, 112, 118]) {
      const moved = moveHold(state, x, 100);
      state = moved.state;
      effect = moved.effect;
      if (effect === "pan") break;
    }
    expect(effect).toBe("pan");
    expect(state.phase).toBe("idle");
  });
});

describe("a release", () => {
  it("drops where the finger travelled after the arm", () => {
    const state = armedAt(100 + TOUCH_HOLD_RELEASE_MIN_PX, 100);
    expect(holdTravel(state)).toBe(TOUCH_HOLD_RELEASE_MIN_PX);
    expect(releaseHold(state)).toBe("drop");
  });

  it("cancels a pickup that was lifted and put back in place", () => {
    // The safe cancel: no write, and no tap-through either — the card must not
    // open under the finger that meant to drag it.
    expect(releaseHold(armedAt(100, 100))).toBe("cancel");
    expect(releaseHold(armedAt(100 + TOUCH_HOLD_RELEASE_MIN_PX - 1, 100))).toBe("cancel");
  });

  it("lets a gesture that never armed be an ordinary tap", () => {
    expect(releaseHold(beginHold(100, 100))).toBe("tap");
    expect(releaseHold(idleHold())).toBe("tap");
  });
});
