// @vitest-environment jsdom
// The native-pane move's click switch (dec_nhnljjo8rgbz, docs/plans/
// 2026-11-17-native-thread-pane.md §6.2 step 3): a card click opens the
// thread in bb's own native pane beside the board — the host's opener call
// — instead of opening the board's in-panel pane.
//
// The jsdom half pins the click's contract: the open call carries the
// thread with split on, the in-board pane does not open (no fallback pane,
// no pushed subPath), and the attention freeze still captures at click
// time so the attended card holds its placement through churn. The live
// half — the split actually rendering beside the board, an already-open
// thread focusing, the pane-cap fallback — is probe evidence
// (docs/screenshots/probe-native-split-pane/), not something the fake
// host can paint.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeNativeOpens,
  registeredNavPanel,
  resetFakeNativeOpens,
  seedFakeLinks,
  seedFakeThreads,
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

describe("a card click under the native-pane move", () => {
  it("calls the host's opener with split on and never opens the in-board pane", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    // The board's own pane is not the click's destination anymore: no
    // fallback pane mounts (the fake's toPluginPanel always declines, so
    // the old path would have opened one here).
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
  });

  it("still captures the attention freeze at click time: churn holds the clicked card's slot", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    act(() => {
      seedChurn();
    });
    // The freeze: the clicked card's captured slot 0 is held, so the
    // churned card (natural order: backlog, focus, older) cannot take the
    // lead while the native pane reads the thread beside the board.
    expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_backlog", "thr_older"]);
  });

  it("the card menu's Open thread entry rides the same native path", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

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
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_older", split: true }]),
    );
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
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
    // …and opened the board's own pane instead (the fake host declines
    // every panel push, so the in-board fallback pane mounts).
    await waitFor(() =>
      expect(document.querySelector('aside[aria-label="Thread: Focused thread"]')).not.toBeNull(),
    );
  });

  it("at the cap with a thread pane focused, the click stays native — a thread pane is evicted, not the board", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    act(() => {
      setFakeSplitLayout(
        Array.from({ length: 8 }, (_, index) => ({
          paneId: `pane-${index + 1}`,
          threadId: index === 0 ? null : "thr_other",
          isFocused: index === 0 ? false : index === 1,
        })),
      );
    });

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
  });
});
