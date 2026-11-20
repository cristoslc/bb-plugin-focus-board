// @vitest-environment jsdom
// Regression for the operator report, 2026-11-20: "keeping the focused card in
// view (by scrolling) isn't fully working in conjunction with the pane split."
//
// The measured shape (scripts/screenshot/probe-pane-split-recenter.mjs against
// the installed bb, evidence in docs/screenshots/probe-pane-split-recenter/):
// the board is panned so the card sits near its right edge; the click opens a
// native thread pane beside it. bb's split renderer swaps parent element types
// and re-creates the panel subtree (lib/board-snapshot), so the board mounts
// fresh inside a pane that is now half as wide, restores the scroll it captured
// at the wide width, and never fits the card it was told to follow. The width
// observer cannot catch it either: it is created after this paint, with the
// already-narrow width as its baseline. Result: the click focuses a card that
// is outside the board's visible range.
//
// Contract:
// 1. A restored mount whose viewport is narrower than the one the scroll was
//    captured at fits the active card.
// 2. A restored mount at the SAME width keeps the operator's own position —
//    the rule `restoredView` exists for.
// 3. The pane's in-panel answer narrows the board without a re-creation, where
//    the existing width observer already handles it; this pins the branch the
//    snapshot width must not disturb.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

/** The board's visible width in this test: the pane split halved 1280. */
const NARROW = 640;
/** The width the restored scroll was captured at: the board before the split. */
const WIDE = 1280;
const CARD_WIDTH = 240;
/** Where each lane starts in the board's scroll space. */
const LANE_LEFT: Readonly<Record<string, number>> = {
  unread: 300,
  "idle-recent": 1150,
};

let restoreRects: (() => void) | null = null;

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

/** A board whose visible width is NARROW, with every rect offset by its own
 *  scrollLeft — so a fit that scrolls really does read as the card arriving. */
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
    return rect(0, NARROW, 0, 600);
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

const readIdle = () => thread({ id: "thr_a", isUnread: false, updatedAt: NOW - 5000 });

function cardOf(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (!(card instanceof HTMLElement)) throw new Error(`no card ${threadId}`);
  return card;
}

function expectInBoardView(threadId: string): void {
  const board = document.querySelector("[data-columns-board]") as HTMLElement;
  const card = cardOf(threadId).getBoundingClientRect();
  const box = board.getBoundingClientRect();
  expect(card.left).toBeGreaterThanOrEqual(box.left);
  expect(card.right).toBeLessThanOrEqual(box.right);
}

describe("Board fits the focused card when a host re-creation resized it", () => {
  it("brings the card in when the restored viewport is the wider pre-split one", () => {
    installLayout();
    // The card the click focused sits beyond the narrow viewport (1150 > 640),
    // exactly where the split leaves it: the scroll came back at 0 and the
    // board was wide when that 0 was captured.
    render(
      <Board
        {...{
          ...boardProps([readIdle()], "thr_a"),
          restoredView: true,
          restoredViewportWidth: WIDE,
        }}
      />,
    );
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(cardOf("thr_a").closest("section[data-column-id]")?.getAttribute("data-column-id")).toBe(
      "idle-recent",
    );
    // A mount fit would land the card's right edge on the board's right edge.
    expect(board.scrollLeft).toBe(LANE_LEFT["idle-recent"] + CARD_WIDTH - NARROW);
    expectInBoardView("thr_a");
  });

  it("keeps the operator's position when the restored viewport still matches", () => {
    installLayout();
    render(
      <Board
        {...{
          ...boardProps([readIdle()], "thr_a"),
          restoredView: true,
          restoredViewportWidth: NARROW,
        }}
      />,
    );
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    // The same position the restored-view test in
    // board-active-card-relane-recenter pins: a re-creation is not an open.
    expect(board.scrollLeft).toBe(0);
  });

  it("leaves a restored view with no recorded width alone, the older snapshot shape", () => {
    installLayout();
    render(
      <Board {...{ ...boardProps([readIdle()], "thr_a"), restoredView: true }} />,
    );
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(board.scrollLeft).toBe(0);
  });

  it("fits a horizontal lane row's own list when the split narrows it", () => {
    // Horizontal lanes stack as rows the board scrolls vertically; each lane's
    // list scrolls its card flow sideways. A pane split narrows the list too,
    // so a card that sat at the list's right edge falls outside it — the same
    // re-creation, the other axis pair.
    const original = Element.prototype.getBoundingClientRect;
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    Element.prototype.getBoundingClientRect = function () {
      const el = this as HTMLElement;
      const board = document.querySelector("[data-columns-board]") as HTMLElement | null;
      const list = el.closest?.("[data-card-list]") as HTMLElement | null;
      if (el.hasAttribute?.("data-thread-card")) {
        // The idle row sits below the board's 600px fold; inside its list the
        // card sits at 900…1140, past the list's 640px visible width.
        return rect(900 - (list?.scrollLeft ?? 0), CARD_WIDTH, 900 - (board?.scrollTop ?? 0));
      }
      if (el.hasAttribute?.("data-card-list")) return rect(0, NARROW, 900 - (board?.scrollTop ?? 0), 300);
      return rect(0, NARROW, 0, 600);
    };
    try {
      render(
        <Board
          {...{
            ...boardProps([readIdle()], "thr_a"),
            laneDirection: "horizontal" as const,
            restoredView: true,
            restoredViewportWidth: WIDE,
          }}
        />,
      );
      const board = document.querySelector("[data-columns-board]") as HTMLElement;
      const list = document.querySelector(
        'section[data-column-id="idle-recent"] [data-card-list]',
      ) as HTMLElement;
      // The row slid up into the board's range…
      expect(board.scrollTop).toBe(400);
      // …and the lane's own flow scrolled to the card.
      expect(list.scrollLeft).toBe(900 + CARD_WIDTH - NARROW);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });
});
