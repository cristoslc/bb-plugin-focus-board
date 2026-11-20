// @vitest-environment jsdom
// Regression for the phone report "opening a card from unread moves it to its
// idle lane but does not recenter the view on the active card, so it seems to
// disappear" (2026-11-18).
//
// The gesture: tap a card in Unread. The host marks the thread read a beat
// later, and under the status grouping a state flip re-lanes the card at once
// (components/grouping.ts `frozenLaneHolds`, issue #338), so the card lands in
// its idle bucket — usually beyond the board's visible range. On a phone the
// pane covers the board and app.tsx deliberately hands Board
// `activeThreadId={null}` while it does (the covered-sheet quiet open), so the
// keep-active-card-in-view path cannot follow it: the operator lifts the sheet
// onto a board where the card they just opened is gone. Desktop is worse than
// it looks too — the effect's lane-change dependency was dead (see
// tests/board-active-card-relane-recenter.test.tsx), so nothing fitted there
// either.
//
// Contract:
// 1. Opening an unread card arms a one-shot reveal for its relocation, so the
//    board settles on the card's new lane once the host's read write lands —
//    at the phone/covered shape, where the board is given no active card.
// 2. The same on a desktop-width board (in-board pane, active card present).
// 3. A card the operator opens that was ALREADY read arms nothing: an ambient
//    refresh later must never yank the board to it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeSplitPanes,
  registeredNavPanel,
  resetFakePanelPushes,
  resetFakeThreadNavigations,
  seedFakeLinks,
  seedFakeThreads,
  setFakeRouteThread,
  setFakeSettings,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";

const MINUTE = 60_000;

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** bb's compact predicate is a media query; the board reads the same one. */
function stubCompactViewport(compact: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: compact && query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

/** A board 430px wide (the phone read). The card's lane decides where it sits
 *  in the board's scroll space, and the rect is offset by the board's own
 *  scrollLeft — so a fit that scrolls reads as the card arriving in view. */
const LANE_LEFT: Readonly<Record<string, number>> = {
  unread: 300,
  "idle-recent": 1150,
};
const CARD_WIDTH = 240;

let restoreRects: (() => void) | null = null;

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

function fixtureThreads(unread: boolean) {
  const now = Date.now();
  return [
    {
      id: "thr_unread",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: unread,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 5 * MINUTE,
      displayTitle: "Unread thread",
      lastReadAt: unread ? null : now,
      createdAt: 0,
    },
    {
      id: "thr_quiet",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 9 * MINUTE,
      displayTitle: "Quiet thread",
      lastReadAt: now,
      createdAt: 0,
    },
  ];
}

function mountBoard() {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  return render(<Component subPath="" />);
}

function cardAnchor(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  const anchor = card.querySelector("a");
  if (anchor === null) throw new Error(`missing title anchor on ${threadId}`);
  return anchor as HTMLElement;
}

function board(): HTMLElement {
  const found = document.querySelector("[data-columns-board]");
  if (found === null) throw new Error("no columns board on the page");
  return found as HTMLElement;
}

function laneOf(threadId: string): string | null {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  return card?.closest("section[data-column-id]")?.getAttribute("data-column-id") ?? null;
}

/** The host's read write, in the commit it lands: the sidebar hands the board
 *  the threads already read. */
function markRead(): void {
  act(() => {
    seedFakeThreads(fixtureThreads(false));
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  setFakeSettings(null);
  resetFakePanelPushes();
  window.localStorage.clear();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads(true));
  setFakeRouteThread(null);
  resetFakeThreadNavigations();
  setFakeSplitsOff(false);
  setFakeSplitLayout(null);
});

afterEach(() => {
  restoreRects?.();
  restoreRects = null;
  cleanup();
  vi.unstubAllGlobals();
});

describe("opening an unread card recenters the board on it", () => {
  it("follows the card into its idle lane at the covered (phone) shape", async () => {
    stubCompactViewport(true);
    act(() => {
      setFakeSplitsOff(true);
    });
    installLayout();
    mountBoard();
    await waitFor(() => expect(laneOf("thr_unread")).toBe("unread"));

    fireEvent.click(cardAnchor("thr_unread"));
    await waitFor(() => expect(document.querySelector('aside[aria-label^="Thread:"]')).not.toBeNull());

    // The host marks it read: the card relocates to its idle bucket, past the
    // board's visible range, while the sheet covers the board.
    markRead();
    await waitFor(() => expect(laneOf("thr_unread")).toBe("idle-recent"));

    // The board settled on the card it opened: its new lane is in range and
    // the card is fully inside the board's view.
    await waitFor(() => expect(board().scrollLeft).toBe(960));
    const cardRect = (
      document.querySelector('[data-thread-card="thr_unread"]') as HTMLElement
    ).getBoundingClientRect();
    const boardRect = board().getBoundingClientRect();
    expect(cardRect.left).toBeGreaterThanOrEqual(boardRect.left);
    expect(cardRect.right).toBeLessThanOrEqual(boardRect.right);
  });

  it("follows the card at the desktop shape too", async () => {
    stubCompactViewport(false);
    installLayout();
    mountBoard();
    await waitFor(() => expect(laneOf("thr_unread")).toBe("unread"));

    // Desktop asks the host for the split (the operator's ruling), so the
    // board follows the focused native pane's thread here, not an in-panel
    // one: same reveal claim, same settled lane.
    fireEvent.click(cardAnchor("thr_unread"));
    await waitFor(() => expect(fakeSplitPanes()).toHaveLength(2));

    markRead();
    await waitFor(() => expect(laneOf("thr_unread")).toBe("idle-recent"));
    await waitFor(() => expect(board().scrollLeft).toBe(960));
  });

  it("an already-read card arms nothing: a later refresh never yanks the board", async () => {
    stubCompactViewport(false);
    installLayout();
    mountBoard();
    await waitFor(() => expect(laneOf("thr_quiet")).toBe("idle-recent"));

    fireEvent.click(cardAnchor("thr_quiet"));
    await waitFor(() => expect(fakeSplitPanes()).toHaveLength(2));
    // The operator pans away from the pane's card.
    board().scrollLeft = 0;

    // An unrelated live refresh lands: same lanes, fresh thread data.
    act(() => {
      seedFakeThreads(fixtureThreads(true));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(board().scrollLeft).toBe(0);
  });
});
