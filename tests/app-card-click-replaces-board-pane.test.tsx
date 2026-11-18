// @vitest-environment jsdom
// The card click's pane contract, third revision (2026-11-17): "still opening
// new, not replacing, panes."
//
// bb's `useSidebarSplitLayout()` answers null for a one-pane layout (its hook
// requires more than one pane), so a freshly opened board cannot name a single
// pane. Asking the host for a split from that state is a blind ask: the board
// cannot learn which pane it got, and the next click asks again. The rule now
// reads: a native split is only ever asked for to FOCUS or REPLACE a pane the
// board can name; every other click opens the board's own in-panel pane, one
// pane that changes thread. Live evidence and the trace lines:
// docs/plans/2026-11-17-one-board-pane.md section 8.
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
  resetFakeThreadNavigations,
  seedFakeLinks,
  seedFakeThreads,
  setFakeRouteThread,
  setFakeSettings,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** bb's compact predicate is a media query; the board reads the same one
 *  (`components/ui/hooks/use-compact-viewport.tsx`). */
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  stubCompactViewport(false);
  setFakeSettings(null);
  resetFakePanelPushes();
  window.localStorage.clear();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads());
  resetFakeNativeOpens();
  setFakeRouteThread(null);
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

function mountBoard() {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  return render(<Component subPath="" />);
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

/** The board's own in-panel pane, by the thread title it shows. */
function inBoardPaneTitle(): string | null {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (pane === null) return null;
  return (pane.getAttribute("aria-label") ?? "").replace(/^Thread: /, "");
}

/** Seed the record the board writes when it owns a native pane, plus the
 *  layout that holds it. */
function seedOwnedPane(threadId: string, paneId = "pane-2"): void {
  window.localStorage.setItem(
    "focus-board:boardNativeThreadPane",
    JSON.stringify({ paneId, threadId, priorPaneIds: [] }),
  );
  act(() => {
    setFakeSplitLayout([
      { paneId: "pane-1", threadId: null, isFocused: true },
      { paneId, threadId, isFocused: false },
    ]);
  });
}

/** A click that lands on the board's own pane. */
async function clickCardInBoard(threadId: string): Promise<void> {
  fireEvent.click(cardAnchor(threadId));
  await waitFor(() => expect(fakePanelPushes().at(-1)).toMatchObject({ subPath: `t/${threadId}` }));
}

describe("a click the board cannot place", () => {
  it("opens the board's own pane and never asks the host for a split", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    // The blind ask is gone: bb's hook reads null at one pane, so a split
    // request here could not be recorded, and every later click would stack.
    expect(fakeNativeOpens()).toEqual([]);
    await waitFor(() =>
      expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_focus" }),
    );
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Focused thread"));
    expect(threadPanes()).toEqual([]);
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
  });

  it("a second click moves the board's pane to the new thread, one pane, never stacked", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCardInBoard("thr_focus");
    await clickCardInBoard("thr_older");
    await clickCardInBoard("thr_backlog");

    expect(fakeNativeOpens()).toEqual([]);
    expect(threadPanes()).toEqual([]);
    expect(inBoardPaneTitle()).toBe("Backlog thread");
    expect(document.querySelectorAll('aside[aria-label^="Thread:"]')).toHaveLength(1);
  });

  it("the card menu's Open thread entry takes the same path", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    const card = document.querySelector('[data-thread-card="thr_older"]');
    if (card === null) throw new Error("missing card thr_older");
    fireEvent.contextMenu(card);
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error("menu did not open");
      return found;
    });
    const open = [...menu.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Open thread",
    );
    if (open === undefined) throw new Error("missing Open thread entry");
    fireEvent.click(open);

    expect(fakeNativeOpens()).toEqual([]);
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Older thread"));
  });

  it("a double click on one card leaves one pane", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Focused thread"));
    expect(document.querySelectorAll('aside[aria-label^="Thread:"]')).toHaveLength(1);
    expect(fakeNativeOpens()).toEqual([]);
  });
});

describe("a pane the board owns", () => {
  it("replaces that pane's thread instead of opening a second one", async () => {
    seedOwnedPane("thr_older");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(fakeSplitPanes()).toHaveLength(2);
    expect(focusedPaneId()).toBe(fakeSplitPanes()[1]?.paneId);
  });

  it("a third click still leaves one thread pane", async () => {
    seedOwnedPane("thr_focus");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_older"]));
    fireEvent.click(cardAnchor("thr_backlog"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_backlog"]));
    fireEvent.click(cardAnchor("thr_other"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_other"]));
    expect(fakeSplitPanes()).toHaveLength(2);
  });

  it("focuses the pane when the clicked thread is already in it", async () => {
    seedOwnedPane("thr_focus");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    expect(threadPanes()).toEqual(["thr_focus"]);
    expect(fakeSplitPanes()).toHaveLength(2);
  });

  it("leaves a pane the operator re-threaded alone, and uses the board's own pane", async () => {
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older", priorPaneIds: [] }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_other", isFocused: true },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCardInBoard("thr_focus");
    // Their thread is untouched, and no pane was added.
    expect(threadPanes()).toEqual(["thr_other"]);
    expect(inBoardPaneTitle()).toBe("Focused thread");
  });

  it("a record naming a thread the board no longer lists falls back to its own pane", async () => {
    seedOwnedPane("thr_missing");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCardInBoard("thr_focus");
    expect(threadPanes()).toEqual(["thr_missing"]);
    expect(inBoardPaneTitle()).toBe("Focused thread");
  });

  it("a dragged pane is still the board's: position does not decide ownership", async () => {
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older", priorPaneIds: [] }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-2", threadId: "thr_older", isFocused: false },
        { paneId: "pane-1", threadId: null, isFocused: true },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(fakeSplitPanes()).toHaveLength(2);
  });
});

describe("where the host will not split", () => {
  it("opens the board's own pane instead of asking for a split that replaces the board", async () => {
    stubCompactViewport(true);
    act(() => {
      setFakeSplitsOff(true);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));

    expect(fakeNativeOpens()).toEqual([]);
    await waitFor(() =>
      expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_older" }),
    );
    expect(inBoardPaneTitle()).toBe("Older thread");
    expect(threadPanes()).toEqual([]);
  });
});

describe("the developer trace", () => {
  it("logs one line naming the branch when the setting is on", async () => {
    setFakeSettings({ nativeOpenDebug: true });
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));
    expect(debug).toHaveBeenCalledWith(
      "[focus-board:native-open]",
      expect.objectContaining({
        threadId: "thr_older",
        branch: "in-board: no pane of the board's to replace",
      }),
    );
    debug.mockRestore();
  });

  it("stays silent when the setting is off", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));
    expect(
      debug.mock.calls.filter((call) => call[0] === "[focus-board:native-open]"),
    ).toEqual([]);
    debug.mockRestore();
  });
});

describe("one click, one surface", () => {
  it("does not open the board's pane when a replacement lands", async () => {
    // bb re-creates the plugin panel's subtree whenever the window's layout
    // changes, and its opener navigates the route to the thread it placed.
    // #467's 500ms repair read that pair as "the board was replaced" and
    // pushed the board's route back with a subPath, so one click produced the
    // native pane AND the board's in-panel pane. Measured live on a938fc7.
    seedOwnedPane("thr_older");
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    const view = render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    // What the host does next, inside the click's own repair window: the
    // route becomes the thread's and the panel's subtree is gone while it is
    // re-created.
    window.history.pushState({}, "", "/projects/proj_a/threads/thr_focus");
    view.unmount();
    expect(document.querySelector("[data-focus-board-panel]")).toBeNull();

    // Past the old repair window.
    await new Promise((resolve) => setTimeout(resolve, 650));

    // One surface: the pane the replacement landed in.
    expect(fakePanelPushes()).toEqual([]);
    window.history.pushState({}, "", "/");
  });
});
