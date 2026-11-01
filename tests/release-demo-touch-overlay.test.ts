// @vitest-environment jsdom
// The touch overlay (issue: the released touch clips show an invisible
// finger). A touch gesture moves no mouse, so the recorder's arrow overlay
// stays parked while the board pans — the clip reads as a board moving on its
// own. These tests pin the second overlay: a fingertip marker that follows the
// exact coordinate of the last dispatched touch, and the rule that neither
// vocabulary ever appears on the other's clip.
import { beforeEach, describe, expect, it } from "vitest";
import {
  CURSOR_MARKER_ID,
  Stage,
  TOUCH_MARKER_ANCHOR,
  TOUCH_MARKER_ID,
} from "../scripts/screenshot/release-demos/runner.mjs";

type Point = { x: number; y: number };

/** A page stub: puppeteer's touch and mouse, plus an `evaluate` that runs the
 *  recorder's DOM writes against this file's jsdom document. The callback is
 *  rebuilt from its source first, because puppeteer serializes it into the
 *  page: a recorder that reaches for a module constant inside `evaluate`
 *  works here only if it would work there. */
function fakePage() {
  const touches: Point[] = [];
  const mouseMoves: Point[] = [];
  const page = {
    touches,
    mouseMoves,
    evaluate: async <T>(fn: (arg: T) => unknown, arg: T) => {
      const inPage = new Function(`return (${fn.toString()})`)() as (value: T) => unknown;
      return inPage(arg);
    },
    mouse: {
      move: async (x: number, y: number) => {
        mouseMoves.push({ x, y });
      },
    },
    touchscreen: {
      touchStart: async (x: number, y: number) => {
        touches.push({ x, y });
      },
      touchMove: async (x: number, y: number) => {
        touches.push({ x, y });
      },
      touchEnd: async () => {},
    },
  };
  return page;
}

function stageFor(options: { touch?: boolean } = {}) {
  const page = fakePage();
  const stage = new Stage(page as never, "/tmp/demo-frames", options);
  return { page, stage };
}

function marker(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id} overlay`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("touch overlay vocabulary", () => {
  it("a touch demo shows the finger and never the mouse arrow", async () => {
    const { stage } = stageFor({ touch: true });
    await stage.prepare();
    expect(document.getElementById(TOUCH_MARKER_ID)).not.toBeNull();
    expect(document.getElementById(CURSOR_MARKER_ID)).toBeNull();
  });

  it("a mouse demo keeps exactly the arrow it had, and no finger", async () => {
    const { stage } = stageFor();
    await stage.prepare();
    const cursor = marker(CURSOR_MARKER_ID);
    // The arrow is the pre-existing overlay: same id, same hotspot at 0,0.
    expect(cursor.tagName.toLowerCase()).toBe("svg");
    expect(cursor.style.position).toBe("fixed");
    expect(document.getElementById(TOUCH_MARKER_ID)).toBeNull();
  });

  it("the finger is hidden until the touch lands", async () => {
    const { stage } = stageFor({ touch: true });
    await stage.prepare();
    expect(marker(TOUCH_MARKER_ID).style.display).toBe("none");
  });
});

describe("the finger marks the exact touch coordinate", () => {
  it("centres the contact dot on the point that was dispatched", async () => {
    const { page, stage } = stageFor({ touch: true });
    await stage.prepare();
    const dot = marker(TOUCH_MARKER_ID);

    await stage.touchStart(120, 240);
    expect(dot.style.display).toBe("block");
    expect(dot.style.transform).toBe(
      `translate(${120 - TOUCH_MARKER_ANCHOR}px, ${240 - TOUCH_MARKER_ANCHOR}px)`,
    );
    expect(page.touches.at(-1)).toEqual({ x: 120, y: 240 });
  });

  it("follows every move with the dispatched coordinate, never a blend", async () => {
    const { page, stage } = stageFor({ touch: true });
    await stage.prepare();
    const dot = marker(TOUCH_MARKER_ID);
    await stage.touchStart(120, 240);

    const moves: Point[] = [
      { x: 108, y: 240 },
      { x: 84, y: 241 },
      { x: 60.5, y: 240 },
    ];
    for (const move of moves) {
      await stage.touchMove(move.x, move.y);
      // No easing: the marker sits on the point the finger reported, so a
      // frame captured after this move shows the hand where the pan is.
      expect(dot.style.transform).toBe(
        `translate(${move.x - TOUCH_MARKER_ANCHOR}px, ${move.y - TOUCH_MARKER_ANCHOR}px)`,
      );
      expect(page.touches.at(-1)).toEqual(move);
    }
  });

  it("lifts the finger when the touch ends", async () => {
    const { stage } = stageFor({ touch: true });
    await stage.prepare();
    await stage.touchStart(10, 20);
    await stage.touchEnd();
    expect(marker(TOUCH_MARKER_ID).style.display).toBe("none");
  });

  it("never moves the arrow on a touch demo", async () => {
    const { stage } = stageFor({ touch: true });
    await stage.prepare();
    await stage.touchStart(200, 300);
    await stage.touchMove(180, 300);
    // The arrow is not on a touch clip at all, so nothing can show a mouse
    // gesture that never happened.
    expect(document.getElementById(CURSOR_MARKER_ID)).toBeNull();
  });

  it("never shows the finger on a mouse demo", async () => {
    const { stage } = stageFor();
    await stage.prepare();
    await stage.syncCursor(42, 64);
    expect(marker(CURSOR_MARKER_ID).style.transform).toBe("translate(42px, 64px)");
    expect(document.getElementById(TOUCH_MARKER_ID)).toBeNull();
  });

  it("fails loud when a mouse demo tries to touch", async () => {
    const { stage } = stageFor();
    await stage.prepare();
    // Puppeteer's touchscreen needs a hasTouch viewport; a storyboard that
    // calls this on a mouse board has made a mistake no overlay can hide.
    await expect(stage.touchStart(4, 5)).rejects.toThrow(/touch/u);
  });
});
