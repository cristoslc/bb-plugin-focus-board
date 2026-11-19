// @vitest-environment jsdom
// Regression for the phone report "opening a card from unread moves it to its
// idle lane but does not recenter the view on the active card, so it seems to
// disappear" (2026-11-18).
//
// Board's keep-active-card-in-view effect records `activeCardLaneId` as a
// dependency precisely so the board re-fits when the OPEN card relocates to a
// lane that may be offscreen, and its own comment says so. The effect body
// only ever fitted on the mount pass and on a WIDTH-changing resize, so a
// re-run from a lane change observed the container, read the same width, and
// did nothing: the card stayed where it landed, offscreen, with its pane open.
// The trace that named it is docs/screenshots/repro-unread-open-recenter/
// (board offset constant across the lane change).
//
// Contract:
// 1. The active card relocating to another lane scrolls that lane into range.
// 2. A re-render that leaves the card in the same lane never moves the board
//    (the operator's resting pan, the rule the width-only gate protects).
// 3. The card's own lane list scrolls it into view along the card flow.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

let restoreRects: (() => void) | null = null;

/** jsdom has no ResizeObserver at all; the board observes its container. */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  restoreRects?.();
  restoreRects = null;
  cleanup();
  vi.unstubAllGlobals();
});

/** A board 430px wide. The card's lane decides where it sits in the board's
 *  scroll space (Unread is near the start, the idle buckets sit far right), and
 *  the reported rect is offset by the board's own scrollLeft — so a fit that
 *  scrolls really does read as the card arriving in view, like a browser. */
const LANE_LEFT: Readonly<Record<string, number>> = {
  unread: 300,
  "idle-recent": 1150,
};
const CARD_WIDTH = 240;

function rect(left: number, width: number, top = 0, height = 100): DOMRect {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function installLayout(): void {
  const original = Element.prototype.getBoundingClientRect;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  Element.prototype.getBoundingClientRect = function () {
    const el = this as HTMLElement;
    const board = document.querySelector("[data-columns-board]") as HTMLElement | null;
    const scrollLeft = board?.scrollLeft ?? 0;
    if (el.hasAttribute?.("data-thread-card")) {
      const lane = el.closest("section[data-column-id]")?.getAttribute("data-column-id") ?? "";
      return rect((LANE_LEFT[lane] ?? 0) - scrollLeft, CARD_WIDTH);
    }
    if (el.hasAttribute?.("data-card-list")) return rect(0, 300, 0, 600);
    return rect(0, 430, 0, 600);
  };
  restoreRects = () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function boardProps(threads: PluginSidebarThread[], activeThreadId: string | null) {
  return {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    reveal: null,
  } as unknown as BoardProps;
}

const unread = () => thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 5000 });
const read = () => thread({ id: "thr_a", isUnread: false, updatedAt: NOW - 5000 });

function laneOf(threadId: string): string | null {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  return card?.closest("section[data-column-id]")?.getAttribute("data-column-id") ?? null;
}

describe("Board follows the active card when it relocates lanes", () => {
  it("scrolls the card's new lane into range after the state flip re-lanes it", () => {
    installLayout();
    const rendered = render(<Board {...boardProps([unread()], null)} />);
    const board = document.querySelector("[data-columns-board]") as HTMLElement;

    // The click: the thread becomes the board's active card. The mount fit
    // brings its Unread lane into view.
    rendered.rerender(<Board {...boardProps([unread()], "thr_a")} />);
    expect(laneOf("thr_a")).toBe("unread");
    const afterOpen = board.scrollLeft;
    expect(afterOpen).toBeGreaterThan(0);

    // The host marks the thread read: the card relocates to its idle bucket,
    // which sits beyond the visible range.
    rendered.rerender(<Board {...boardProps([read()], "thr_a")} />);
    expect(laneOf("thr_a")).toBe("idle-recent");

    // The board followed the card it has open.
    expect(board.scrollLeft).toBe(960);
    // And the card is inside the board's visible range at that offset.
    const cardRect = (
      document.querySelector('[data-thread-card="thr_a"]') as HTMLElement
    ).getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    expect(cardRect.left).toBeGreaterThanOrEqual(boardRect.left);
    expect(cardRect.right).toBeLessThanOrEqual(boardRect.right);
  });

  it("leaves the operator's pan alone when the same lane re-renders (no relane)", () => {
    installLayout();
    const rendered = render(<Board {...boardProps([unread()], "thr_a")} />);
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    board.scrollLeft = 0;

    // A data refresh with the card where it already was — a sibling's
    // activity, a live refetch, an ambient re-render.
    rendered.rerender(<Board {...boardProps([unread()], "thr_a")} />);
    expect(laneOf("thr_a")).toBe("unread");
    expect(board.scrollLeft).toBe(0);
  });

  it("scrolls the card's own lane list along the card flow, not only the board", () => {
    installLayout();
    const original = Element.prototype.getBoundingClientRect;
    // A long lane: the card sits below the list's visible band (0…600), so the
    // list has to scroll down to it, the vertical twin of the board's slide.
    Element.prototype.getBoundingClientRect = function () {
      const el = this as HTMLElement;
      if (el.hasAttribute?.("data-thread-card")) return rect(0, CARD_WIDTH, 700, 100);
      if (el.hasAttribute?.("data-card-list")) return rect(0, 300, 0, 600);
      return rect(0, 430, 0, 600);
    };
    try {
      const rendered = render(<Board {...boardProps([unread()], null)} />);
      rendered.rerender(<Board {...boardProps([unread()], "thr_a")} />);
      const list = document.querySelector(
        'section[data-column-id="unread"] [data-card-list]',
      ) as HTMLElement;
      expect(list.scrollTop).toBe(200);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("leaves a restored view's scroll position alone until the card really moves", () => {
    // The remount path (bb re-creating the panel on a split) replays the board's
    // own scroll, so the mount pass must not fit to the active card — the rule
    // `restoredView` exists for. A later relocation is still the board's
    // business: the restored key only pins the FIRST run.
    installLayout();
    const rendered = render(
      <Board {...{ ...boardProps([unread()], "thr_a"), restoredView: true }} />,
    );
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(laneOf("thr_a")).toBe("unread");
    // The card sits at 300…540 in a 0…430 board: a mount fit would have scrolled
    // by 110. The restored view keeps its own position instead.
    expect(board.scrollLeft).toBe(0);

    rendered.rerender(<Board {...{ ...boardProps([read()], "thr_a"), restoredView: true }} />);
    expect(laneOf("thr_a")).toBe("idle-recent");
    expect(board.scrollLeft).toBe(960);
  });

  it("follows a card into another lane ROW on the horizontal read", () => {
    // Horizontal lanes stack as rows: the board scrolls vertically, and each
    // lane's own list scrolls its card flow sideways. A card that relocates
    // into a row below the fold must move both, exactly as the pane-open fit
    // does for the same axis pair.
    installLayout();
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const el = this as HTMLElement;
      const board = document.querySelector("[data-columns-board]") as HTMLElement | null;
      const scrollTop = board?.scrollTop ?? 0;
      if (el.hasAttribute?.("data-thread-card")) {
        const lane = el.closest("section[data-column-id]")?.getAttribute("data-column-id") ?? "";
        if (lane === "unread") return rect(100, CARD_WIDTH, 100 - scrollTop, 100);
        return rect(400, CARD_WIDTH, 900 - scrollTop, 100);
      }
      if (el.hasAttribute?.("data-card-list")) return rect(0, 300, 0, 600);
      return rect(0, 430, 0, 600);
    };
    try {
      const horizontal = { ...boardProps([unread()], "thr_a"), laneDirection: "horizontal" as const };
      const rendered = render(<Board {...horizontal} />);
      const board = document.querySelector("[data-columns-board]") as HTMLElement;
      expect(board.scrollTop).toBe(0);

      rendered.rerender(
        <Board {...{ ...boardProps([read()], "thr_a"), laneDirection: "horizontal" as const }} />,
      );
      expect(laneOf("thr_a")).toBe("idle-recent");
      // The row slid into the board's vertical range…
      expect(board.scrollTop).toBe(400);
      // …and that row's own flow scrolled to the card.
      const list = document.querySelector(
        'section[data-column-id="idle-recent"] [data-card-list]',
      ) as HTMLElement;
      expect(list.scrollLeft).toBe(340);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});
