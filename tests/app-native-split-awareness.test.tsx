// @vitest-environment jsdom
// The native-pane move's additive half: the board's split-layout awareness
// (docs/plans/2026-11-17-native-thread-pane.md §6.2 step 2). Threads can be
// open beside the board in bb's own native panes; the FOCUSED pane's thread
// is the native analogue of "the open thread", and the board must behave
// the way it does today when its own pane is showing one.
//
// The three laws under test, in the same harness language as
// tests/app-pane-covered-sheet-capture.test.tsx (the freeze is the
// observable: a captured card holds its slot through churn):
// - a focused native thread pane captures attention exactly like the
//   pane's own open: churn holds the attended card's slot;
// - closing the native pane (focus leaving every thread pane) releases
//   the pin: churn moves the card again;
// - ownership: while the board's own pane is open it owns the attention
//   lifecycle — a native pin captured before the pane opened is released
//   by the pane's open (which arrives by deep link now that a card click
//   hands the host the thread), and never the pane's own capture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
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

/** A second churn shape: thr_older jumps to the newest slot (still inside
 *  the idle-today bucket — under an hour it would re-lane into idle-recent
 *  and the churn would stop being a slot move). */
function seedOlderLeadsChurn() {
  const now = Date.now();
  seedFakeThreads([
    threadFixture("thr_focus", "Focused thread", now - 75 * 60_000),
    threadFixture("thr_older", "Older thread", now - 65 * 60_000),
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

function mountBoard(): ReturnType<typeof render> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  return render(<Component subPath="" />);
}

/** The in-board pane's deep-link entry: a subPath rerender is the state a
 *  shared URL lands on, the entry the pane keeps now that a card click
 *  hands the thread to bb's own native pane. */
function openPaneByDeepLink(view: ReturnType<typeof render>, threadId: string): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  view.rerender(<Component subPath={`t/${threadId}`} />);
}

function focusNativePane(threadId: string | null): void {
  act(() => {
    setFakeSplitLayout(
      threadId === null
        ? null
        : [{ paneId: "pane-2", threadId, isFocused: true }],
    );
  });
}

describe("the board's split-layout awareness", () => {
  it("a focused native thread pane captures attention like the pane's own open: churn holds the attended card's slot", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    focusNativePane("thr_focus");
    act(() => {
      seedChurn();
    });
    // The freeze: thr_focus's captured slot 0 is held, so the churned card
    // (natural order: backlog, focus, older) cannot take the lead.
    expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_backlog", "thr_older"]);
  });

  it("closing the native pane releases the pin: churn moves the card again", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    focusNativePane("thr_focus");
    focusNativePane(null);
    act(() => {
      seedChurn();
    });
    // No pin: the data's order wins.
    expect(columnCardIds("idle-today")).toEqual(["thr_backlog", "thr_focus", "thr_older"]);
  });

  it("switching the focused native pane re-captures for the newly focused thread", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    focusNativePane("thr_focus");
    focusNativePane("thr_older");
    act(() => {
      seedOlderLeadsChurn();
    });
    // thr_older's captured slot 1 is held; the others re-place naturally
    // around it (natural order after the churn: older, backlog, focus).
    expect(columnCardIds("idle-today")).toEqual(["thr_backlog", "thr_older", "thr_focus"]);
  });

  it("the board's own pane owns attention while open: a native pin is released, the pane's capture survives", async () => {
    const view = mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    // A native focus first (its capture is the native path's own), then the
    // board's pane opens on another thread. The click no longer opens the
    // pane — it hands the host the thread — so the pane arrives the way its
    // remaining entries arrive: the deep link, an external route change.
    focusNativePane("thr_older");
    openPaneByDeepLink(view, "thr_focus");
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());

    act(() => {
      seedOlderLeadsChurn();
    });
    // The pane's capture holds thr_focus's slot 0. The native pin on
    // thr_older was released by the pane's open, so thr_older re-places
    // naturally — after the focus pin, its slot is 1 here, and if the
    // native capture had wrongly survived it would hold the same slot 1
    // while the pane's own capture died instead. The order below is the
    // one where each pin came from exactly its owning surface.
    expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]);
  });
});
