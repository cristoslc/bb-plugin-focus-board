// @vitest-environment jsdom
// The card click's surface after the 2026-11-17 review: the board asks the
// host for a native split only to focus or replace a pane it can name, and
// opens its own in-panel pane otherwise, so one click never grows a second
// thread pane (docs/plans/2026-11-17-one-board-pane.md section 8).
//
// This file keeps the two properties that are not about placement: the
// attention freeze still captures at click time, and the eight-pane ceiling
// never hands the host a click that would evict the board. The replacement
// rule itself lives in tests/app-card-click-replaces-board-pane.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeNativeOpens,
  fakeSplitPanes,
  registeredNavPanel,
  resetFakeNativeOpens,
  seedFakeLinks,
  seedFakeThreads,
  setFakeRouteThread,
  setFakeSplitLayout,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  window.localStorage.clear();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads());
  resetFakeNativeOpens();
  setFakeRouteThread(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function threadFixture(id: string, title: string, updatedAt: number) {
  const now = Date.now();
  return {
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle: title,
    lastReadAt: now,
    createdAt: 0,
  };
}

function fixtureThreads() {
  const now = Date.now();
  return [
    threadFixture("thr_focus", "Focused thread", now - 75 * 60_000),
    threadFixture("thr_older", "Older thread", now - 3 * HOUR),
    threadFixture("thr_backlog", "Backlog thread", now - 5 * HOUR),
  ];
}

/** The churn of tests/app-pane-covered-sheet-capture.test.tsx: thr_backlog
 *  jumps to the newest slot, so the unfrozen board sorts it above
 *  thr_focus. All three stay inside the idle-today bucket, so the churn is
 *  a slot move, never a lane move. */
function seedChurn() {
  const now = Date.now();
  seedFakeThreads([
    threadFixture("thr_focus", "Focused thread", now - 75 * 60_000),
    threadFixture("thr_older", "Older thread", now - 3 * HOUR),
    threadFixture("thr_backlog", "Backlog thread", now - 70 * 60_000),
  ]);
}

function columnCardIds(columnId: string): string[] {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (section === null) return [];
  return [...section.querySelectorAll("[data-thread-card]")]
    .filter((el) => el.parentElement?.closest("[data-thread-card]") === null)
    .map((el) => (el instanceof HTMLElement ? el.getAttribute("data-thread-card") : ""));
}

function cardAnchor(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  const anchor = card.querySelector("a");
  if (anchor === null) throw new Error(`missing title anchor on ${threadId}`);
  return anchor as HTMLElement;
}

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

describe("a card click under the pane rule", () => {
  it("opens the thread beside the board: the host's opener, then a split", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    fireEvent.click(cardAnchor("thr_focus"));
    // The click asks the host's own opener for the split (the operator's
    // ruling), the host places the thread in a right-hand pane, and the board
    // keeps the pane it had: nothing replaces it and nothing mounts a second
    // thread surface inside the board.
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
  });

  it("still captures the attention freeze at click time: churn holds the clicked card's slot", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    fireEvent.click(cardAnchor("thr_focus"));
    // The click's capture is taken at the click, before the host's answer, so
    // the split landing reads the card's rendered placement exactly as the
    // board's own pane did.
    await waitFor(() => expect(fakeSplitPanes()).toHaveLength(2));
    act(() => {
      seedChurn();
    });
    // The freeze: the clicked card's captured slot 0 is held, so the
    // churned card (natural order: backlog, focus, older) cannot take the
    // lead while the pane reads the thread.
    expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_backlog", "thr_older"]);
  });

  it("at bb's pane cap with the board focused, the click falls back to the board's own pane instead of evicting it", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    // The ceiling layout the probe measured live
    // (docs/screenshots/probe-native-split-pane/evidence-cap.json): eight
    // panes, the board (a non-thread pane) focused, as every card click
    // starts — the host's opener would replace the focused pane, the board.
    act(() => {
      setFakeSplitLayout(
        Array.from({ length: 8 }, (_, index) => ({
          paneId: `pane-${index + 1}`,
          threadId: index === 0 ? null : "thr_other",
          isFocused: index === 0,
        })),
      );
    });

    fireEvent.click(cardAnchor("thr_focus"));
    // The guard: the click never reached the host's opener…
    expect(fakeNativeOpens()).toEqual([]);
    // …and opened the board's own pane instead.
    await waitFor(() =>
      expect(document.querySelector('aside[aria-label="Thread: Focused thread"]')).not.toBeNull(),
    );
  });
});
