// @vitest-environment jsdom
// One board-opened pane, replaced in place (the operator's ruling of
// 2026-11-17: "if there's already a split open for another thread that Focus
// board opened, then we should replace it, not create a bunch of split
// panes"). The simulated host places panes by bb's own rules
// (tests/helpers/app-fake-sdk.tsx model `openThreadInSplit` and the route
// reconciliation in Apps' SplitThreadArea), so the observable here is the
// layout itself: how many thread panes sit beside the board, and which thread
// each shows — not merely which host call the click made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  boardNativePaneStoredValue,
  nativePaneStorageKey,
} from "../lib/native-pane-ownership";
import {
  fakeNativeOpens,
  fakeSplitPanes,
  fakeThreadNavigations,
  registeredNavPanel,
  resetFakeNativeOpens,
  resetFakeThreadNavigations,
  seedFakeLinks,
  seedFakeThreads,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;
const PLUGIN_ID = "focus-board";

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
  resetFakeThreadNavigations();
  setFakeSplitsOff(false);
  setFakeSplitLayout(null);
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
    threadFixture("thr_other", "Someone else's thread", now - 2 * HOUR),
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

/** The thread panes beside the board, in layout order. */
function threadPanes(): string[] {
  return fakeSplitPanes()
    .filter((pane) => pane.threadId !== null)
    .map((pane) => pane.threadId as string);
}

function focusedPaneId(): string | null {
  return fakeSplitPanes().find((pane) => pane.isFocused)?.paneId ?? null;
}

async function clickCard(threadId: string): Promise<void> {
  fireEvent.click(cardAnchor(threadId));
  await waitFor(() => expect(fakeSplitPanes().some((pane) => pane.threadId === threadId)).toBe(true));
}

describe("a card click beside a pane the board already opened", () => {
  it("replaces that pane's thread instead of opening a second one", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_focus");
    expect(threadPanes()).toEqual(["thr_focus"]);

    await clickCard("thr_older");
    // One thread pane, always: the second click moved the first pane's
    // thread, it did not split another pane off the board.
    expect(threadPanes()).toEqual(["thr_older"]);
    expect(fakeSplitPanes()).toHaveLength(2);
    // The replacement pane keeps the focus the click gave it, so the board's
    // follow (active card, attention freeze) points at the thread it shows.
    expect(focusedPaneId()).toBe(fakeSplitPanes()[1]?.paneId);
  });

  it("keeps replacing: a third click still leaves one thread pane", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_focus");
    await clickCard("thr_older");
    await clickCard("thr_backlog");
    expect(threadPanes()).toEqual(["thr_backlog"]);
  });

  it("opens one when no board pane is beside the board yet", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_focus");
    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]);
    expect(threadPanes()).toEqual(["thr_focus"]);
  });

  it("clicks back to a thread the board already showed: still one pane", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_focus");
    await clickCard("thr_older");
    await clickCard("thr_focus");
    expect(threadPanes()).toEqual(["thr_focus"]);
    expect(fakeSplitPanes()).toHaveLength(2);
  });
});

describe("a pane the board did not open", () => {
  it("is left alone: the click opens its own pane beside it", async () => {
    // The operator opened thr_other from bb's own sidebar, not from a card.
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-4", threadId: "thr_other", isFocused: true },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_focus");
    // Their pane still shows their thread; the board added its own.
    expect(threadPanes()).toEqual(["thr_other", "thr_focus"]);
  });

  it("keeps the board: the replacement never navigates while the board is focused", async () => {
    window.localStorage.setItem(
      nativePaneStorageKey(PLUGIN_ID),
      boardNativePaneStoredValue({ paneId: "pane-2", threadId: "thr_focus" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_focus", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_older");
    // The board pane is still the first pane, still non-thread content.
    expect(fakeSplitPanes()[0]).toMatchObject({ paneId: "pane-1", threadId: null });
    expect(threadPanes()).toEqual(["thr_older"]);
    // Two navigations: the first moved the focus onto the board's own pane
    // (the thread it showed), the second landed the click in it.
    expect(fakeThreadNavigations()).toEqual(["thr_focus", "thr_older"]);
  });

  it("navigates once when the board's pane already has the focus", async () => {
    window.localStorage.setItem(
      nativePaneStorageKey(PLUGIN_ID),
      boardNativePaneStoredValue({ paneId: "pane-2", threadId: "thr_focus" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_focus", isFocused: true },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_older");
    expect(threadPanes()).toEqual(["thr_older"]);
    expect(fakeThreadNavigations()).toEqual(["thr_older"]);
  });
});

describe("ownership across a reload and across operator edits", () => {
  it("a recorded pane survives a reload: the first click replaces instead of growing a pane", async () => {
    window.localStorage.setItem(
      nativePaneStorageKey(PLUGIN_ID),
      boardNativePaneStoredValue({ paneId: "pane-2", threadId: "thr_focus" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_focus", isFocused: true },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_older");
    expect(threadPanes()).toEqual(["thr_older"]);
    expect(fakeSplitPanes()).toHaveLength(2);
  });

  it("a pane the operator re-threaded is theirs: the click opens a new pane", async () => {
    // The record names pane-2 / thr_focus, but the pane now shows thr_other —
    // the operator navigated it themselves after the board opened it.
    window.localStorage.setItem(
      nativePaneStorageKey(PLUGIN_ID),
      boardNativePaneStoredValue({ paneId: "pane-2", threadId: "thr_focus" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_older");
    // The board's pane splits in beside the focused board, ahead of theirs;
    // what matters is that theirs still shows their thread.
    expect(threadPanes()).toEqual(["thr_older", "thr_other"]);
  });

  it("a dragged pane is still the board's: position does not decide ownership", async () => {
    window.localStorage.setItem(
      nativePaneStorageKey(PLUGIN_ID),
      boardNativePaneStoredValue({ paneId: "pane-3", threadId: "thr_focus" }),
    );
    // The operator moved the board's pane to the left of the board; bb keeps
    // the pane id through a move (`movePane`), so it stays the board's.
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-3", threadId: "thr_focus", isFocused: true },
        { paneId: "pane-1", threadId: null, isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_older");
    expect(threadPanes()).toEqual(["thr_older"]);
  });

  it("the recorded pane closing forgets the record: the next click opens a fresh pane", async () => {
    window.localStorage.setItem(
      nativePaneStorageKey(PLUGIN_ID),
      boardNativePaneStoredValue({ paneId: "pane-9", threadId: "thr_focus" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCard("thr_older");
    expect(threadPanes()).toEqual(["thr_older", "thr_other"]);
    // The board now owns the pane it just opened.
    await clickCard("thr_focus");
    expect(threadPanes()).toEqual(["thr_focus", "thr_other"]);
  });
});

describe("the phone path", () => {
  it("never replaces anything: splits are off, so each click is a plain open", async () => {
    act(() => {
      setFakeSplitsOff(true);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]));
    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([
        { threadId: "thr_focus", split: true },
        { threadId: "thr_older", split: true },
      ]),
    );
    // No route-driven replacement: the board never navigates on the phone.
    expect(fakeThreadNavigations()).toEqual([]);
    expect(threadPanes()).toEqual([]);
  });
});
