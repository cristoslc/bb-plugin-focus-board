// @vitest-environment jsdom
// The card click in a ONE-PANE window (the operator's ruling
// dec_a4lrjn0gqqmk, "navigate, then bring the board back").
//
// Measured on the installed host (scripts/screenshot/probe-split-dance.mjs,
// evidence in docs/screenshots/probe-split-dance/): a one-pane window already
// carries a one-pane layout, so the host's own opener SPLITS it — the board
// keeps its pane and the thread arrives beside it, nothing unmounts. bb's
// `useSidebarSplitLayout()` still answers null there (it reports a layout only
// from two panes up), which is why the click used to open the board's own
// in-panel pane instead of asking.
//
// The same click must still end somewhere usable when the window has splits
// off: the host then cannot split, and the click's deadline opens the board's
// own pane. That is the shipped contract for a window the host will not split,
// and the two files either side of this one pin the rest of it:
// tests/app-card-click-native-open.test.tsx (the freeze, the pane cap) and
// tests/app-card-click-replaces-board-pane.test.tsx (the replacement rule).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeNativeOpens,
  fakePanelPushes,
  fakeSplitPanes,
  registeredNavPanel,
  resetFakeNativeOpens,
  resetFakePanelPushes,
  seedFakeLinks,
  seedFakeThreads,
  setFakeHostVersion,
  setFakeRouteThread,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";
import { resetHostCapabilitiesForTests } from "../lib/host-capabilities";

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
  resetFakePanelPushes();
  setFakeRouteThread(null);
  setFakeSplitLayout(null);
  setFakeSplitsOff(false);
  // The installed host: a one-pane window carries a layout to split, so the
  // click asks. The host-version store is per module graph and settles once,
  // so every test here starts it fresh against the version it wants.
  setFakeHostVersion("0.50.1");
  resetHostCapabilitiesForTests();
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

function waitForCards(): Promise<void> {
  return waitFor(() =>
    expect(columnCardIds("idle-today")).toEqual([
      "thr_focus",
      "thr_older",
      "thr_backlog",
    ]),
  );
}

describe("a card click in a one-pane window", () => {
  it("asks the host for the split, and the board keeps its own pane", async () => {
    mountBoard();
    await waitForCards();

    fireEvent.click(cardAnchor("thr_focus"));

    // The ruling's first step: the host's own opener, with placement. It is
    // the only call that can put the thread BESIDE the board.
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    // What the host does with it on a one-pane window: a right-hand pane.
    expect(fakeSplitPanes()).toEqual([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-2", threadId: "thr_focus", isFocused: true },
    ]);
    // And the board is still on screen: it never asked for its own pane, and
    // it never pushed a panel route.
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
    expect(fakePanelPushes()).toEqual([]);
  });

  it("adopts the pane the host created, so the next click replaces it", async () => {
    mountBoard();
    await waitForCards();

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() =>
      expect(
        window.localStorage.getItem("focus-board:boardNativeThreadPane"),
      ).toBe(JSON.stringify({ paneId: "pane-2", threadId: "thr_focus" })),
    );

    // The second click is the shipped replacement rule: the record names the
    // pane, the host's opener focuses it, and the clicked thread lands in it.
    // The card press focuses the board first (the host does that on
    // pointerdown, measured: probe-card-click-focus-trace.mjs), so the pane is
    // not focused when the click runs.
    act(() => {
      setFakeSplitLayout(
        fakeSplitPanes().map((pane) => ({ ...pane, isFocused: pane.paneId === "pane-1" })),
      );
    });
    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([
        { threadId: "thr_focus", split: true },
        // The focus step: the thread the pane shows while the replacement
        // runs, which is what the host focuses.
        { threadId: "thr_focus", split: true },
      ]),
    );
    await waitFor(() =>
      expect(fakeSplitPanes()).toEqual([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_older", isFocused: true },
      ]),
    );
  });

  it("opens the board's own pane when the window has splits off", async () => {
    // The state the host cannot split in: the same click asks anyway (it is
    // the only call that can split), and the deadline keeps the thread on the
    // board rather than losing it.
    setFakeSplitsOff(true);
    mountBoard();
    await waitForCards();

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    await waitFor(
      () =>
        expect(
          document.querySelector('aside[aria-label="Thread: Focused thread"]'),
        ).not.toBeNull(),
      { timeout: 3000 },
    );
    expect(fakeSplitPanes()).toEqual([
      { paneId: "pane-1", threadId: null, isFocused: true },
    ]);
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
  });

  // The version guard. Below 0.50 the host's opener has no layout to split, so
  // the same ask plainly navigates: the board unmounts and only the dance
  // brings its route back. A host KNOWN to be that old opens the board's own
  // pane directly instead, with no ask and nothing to repair. The installed
  // host here is 0.50.1, so this branch is proved by test only.
  it("on a 0.49 host opens the board's own pane and records no opener call", async () => {
    setFakeHostVersion("0.49.0");
    resetHostCapabilitiesForTests();
    mountBoard();
    await waitForCards();

    fireEvent.click(cardAnchor("thr_focus"));

    // The board never asked: no opener call, no dance, no navigation to
    // repair. The thread arrives in the board's own in-panel pane instead.
    await waitFor(() =>
      expect(
        document.querySelector('aside[aria-label="Thread: Focused thread"]'),
      ).not.toBeNull(),
    );
    expect(fakeNativeOpens()).toEqual([]);
    // The board kept its pane and pushed its own panel route for the pane.
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
    expect(fakePanelPushes().length).toBeGreaterThan(0);
    // One pane throughout, focused: the window the host would have reached
    // by navigating, without the unmount in between.
    expect(fakeSplitPanes()).toEqual([
      { paneId: "pane-1", threadId: null, isFocused: true },
    ]);
  });

  it("still asks on a 0.50 host after the read settles", async () => {
    setFakeHostVersion("0.50.1");
    resetHostCapabilitiesForTests();
    mountBoard();
    await waitForCards();

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    expect(fakeSplitPanes()).toEqual([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-2", threadId: "thr_focus", isFocused: true },
    ]);
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
  });

  it("keeps the ask when the host version cannot be read", async () => {
    // The deliberate deviation: an unread version is not an old host. Asking
    // costs a navigation the dance repairs; skipping would cost the split on
    // every 0.50 host whose read failed.
    setFakeHostVersion(null);
    resetHostCapabilitiesForTests();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mountBoard();
    await waitForCards();

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
  });

});
