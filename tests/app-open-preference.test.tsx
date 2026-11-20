// @vitest-environment jsdom
// The card click's surface choice, end to end against the fake host: the setup
// dialog asks a fresh install once, its answer is the DECLARED setting, and the
// click reads that one value — from the dialog, from the gear modal, and from
// bb's configuration page (both surfaces write the same host row, which the
// fake SDK merges into the store `useSettings` reads back).
//
// The laws under test:
// - the marker for "already asked" is the setting itself, so it is once per
//   install and a reload mid-answer never asks twice;
// - closing without choosing keeps the split pane, so an unanswered dialog
//   never changes what a click does;
// - "in the board panel" never reaches the host's opener, even in a window
//   that could split;
// - a compact viewport or a host known older than 0.50 never asks and never
//   splits, whatever the stored value says.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeNativeOpens,
  fakeSettingsWrites,
  registeredNavPanel,
  resetFakeNativeOpens,
  resetFakeSettingsWrites,
  seedFakeLinks,
  seedFakeThreads,
  setFakeHostVersion,
  setFakeRouteThread,
  setFakeSettings,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";
import { resetHostCapabilitiesForTests } from "../lib/host-capabilities";
import { forgetBoardSnapshot } from "../lib/board-snapshot";
import { CURRENT_UNRELEASED_FINGERPRINT, LAST_SEEN_UNRELEASED_KEY } from "../lib/whats-new";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** bb's compact predicate is a media query the board reads too. */
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

/** The board is up: its cards are painted past the readiness gate. */
async function boardPainted(): Promise<void> {
  await waitFor(() => expect(document.querySelector('[data-thread-card="thr_focus"]')).not.toBeNull());
}

function setupDialog(): HTMLElement | null {
  return document.querySelector("[data-open-preference-dialog]");
}

function inPanelPane(title: string): HTMLElement | null {
  return document.querySelector(`aside[aria-label="Thread: ${title}"]`);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  stubCompactViewport(false);
  window.localStorage.clear();
  // A dev build whose [Unreleased] group has been read once: the toolbar's
  // gift keeps its gear costume, so the suites below open the settings modal
  // through the gear the operator sees.
  window.localStorage.setItem(LAST_SEEN_UNRELEASED_KEY, CURRENT_UNRELEASED_FINGERPRINT);
  forgetBoardSnapshot();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads());
  resetFakeNativeOpens();
  resetFakeSettingsWrites();
  setFakeHostVersion("0.50.1");
  resetHostCapabilitiesForTests();
  setFakeRouteThread(null);
  setFakeSplitsOff(false);
  setFakeSplitLayout(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the setup dialog", () => {
  it("asks a fresh install once, records the shipping default as the marker, and never asks again", async () => {
    // A loaded settings store with no answer: the one state a fresh install is
    // in — bb has painted its settings surface and this install never chose.
    setFakeSettings({});
    mountBoard();
    await boardPainted();

    await waitFor(() => expect(setupDialog()).not.toBeNull());
    expect(document.body.textContent).toContain("Where should threads open?");
    // Opening the dialog IS the mark: today's behaviour, stored, so a reload
    // mid-answer cannot ask twice. One write, no answer yet.
    expect(fakeSettingsWrites()).toEqual([{ threadOpenTarget: "beside" }]);

    cleanup();
    forgetBoardSnapshot();
    mountBoard();
    await boardPainted();
    // The store now holds the answer, so a second load asks nothing. The board
    // has had a full settle; the dialog would have mounted by now.
    await act(async () => {
      await Promise.resolve();
    });
    expect(setupDialog()).toBeNull();
  });

  it("keeps the current setup when dismissed, and a click still opens the thread beside the board", async () => {
    setFakeSettings({});
    mountBoard();
    await boardPainted();
    await waitFor(() => expect(setupDialog()).not.toBeNull());

    fireEvent.click(document.querySelector('[aria-label="Keep the current setup"]') as HTMLElement);
    await waitFor(() => expect(setupDialog()).toBeNull());
    // Dismissal wrote nothing beyond the mark: the shipped split pane stands.
    expect(fakeSettingsWrites()).toEqual([{ threadOpenTarget: "beside" }]);

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]));
    expect(inPanelPane("Focused thread")).toBeNull();
  });

  it("an answered install is never asked, and its click takes the stored surface", async () => {
    setFakeSettings({ threadOpenTarget: "panel" });
    mountBoard();
    await boardPainted();
    await act(async () => {
      await Promise.resolve();
    });
    expect(setupDialog()).toBeNull();

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(inPanelPane("Focused thread")).not.toBeNull());
    // The host's opener was never asked: the window stays one pane.
    expect(fakeNativeOpens()).toEqual([]);
  });
});

describe("the choice reaches the click", () => {
  it("a dialog answer in the board panel keeps every later click in the board", async () => {
    setFakeSettings({});
    mountBoard();
    await boardPainted();
    await waitFor(() => expect(setupDialog()).not.toBeNull());

    fireEvent.click(document.querySelector('[aria-label="In the board panel"]') as HTMLElement);
    await waitFor(() => expect(setupDialog()).toBeNull());
    // The mark first, the operator's pick second, so the pick can never be
    // overwritten by the mark it raced.
    expect(fakeSettingsWrites().at(-1)).toEqual({ threadOpenTarget: "panel" });

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(inPanelPane("Focused thread")).not.toBeNull());
    expect(fakeNativeOpens()).toEqual([]);

    // And the next click rides the same stored value.
    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() => expect(inPanelPane("Older thread")).not.toBeNull());
    expect(fakeNativeOpens()).toEqual([]);
  });

  it("a change in the gear modal reaches the next click", async () => {
    setFakeSettings({ threadOpenTarget: "beside" });
    mountBoard();
    await boardPainted();

    fireEvent.click(document.querySelector('button[aria-label="Focus Board settings"]') as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector('select[aria-label="Where a card click opens the thread"]')).not.toBeNull(),
    );
    fireEvent.change(
      document.querySelector('select[aria-label="Where a card click opens the thread"]') as HTMLElement,
      { target: { value: "panel" } },
    );
    await waitFor(() =>
      expect(fakeSettingsWrites().at(-1)).toEqual({ threadOpenTarget: "panel" }),
    );
    // Close the modal so the click below is the board's own.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() =>
      expect(document.querySelector('select[aria-label="Where a card click opens the thread"]')).toBeNull(),
    );

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(inPanelPane("Focused thread")).not.toBeNull());
    expect(fakeNativeOpens()).toEqual([]);
  });

  it("a change made on bb's configuration page reaches the next click while the board stays open", async () => {
    // The configuration page writes the same declared row through the host,
    // which pushes the new value into the board's reactive read: the fake SDK's
    // setFakeSettings IS that push.
    setFakeSettings({ threadOpenTarget: "beside" });
    mountBoard();
    await boardPainted();

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]));

    act(() => {
      setFakeSettings({ threadOpenTarget: "panel" });
    });

    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() => expect(inPanelPane("Older thread")).not.toBeNull());
    // The opener was asked once, for the click made before the switch.
    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]);
  });
});

describe("where the choice cannot matter", () => {
  it("a compact viewport never asks and always uses the board's own pane", async () => {
    stubCompactViewport(true);
    setFakeSettings({});
    mountBoard();
    await boardPainted();
    await act(async () => {
      await Promise.resolve();
    });
    expect(setupDialog()).toBeNull();
    expect(fakeSettingsWrites()).toEqual([]);

    // Even with the split pane stored, the compact window keeps its own pane.
    act(() => {
      setFakeSettings({ threadOpenTarget: "beside" });
    });
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(inPanelPane("Focused thread")).not.toBeNull());
    expect(fakeNativeOpens()).toEqual([]);
  });

  it("a host known older than 0.50 never asks and ignores a stored split choice", async () => {
    setFakeHostVersion("0.49.0");
    resetHostCapabilitiesForTests();
    setFakeSettings({ threadOpenTarget: "beside" });
    mountBoard();
    await boardPainted();
    await waitFor(() => expect(document.querySelector('button[aria-label="Focus Board settings"]')).not.toBeNull());
    await act(async () => {
      await Promise.resolve();
    });
    expect(setupDialog()).toBeNull();

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(inPanelPane("Focused thread")).not.toBeNull());
    // Below 0.50 the opener has no layout to split: the click skips the ask.
    expect(fakeNativeOpens()).toEqual([]);
  });
});
