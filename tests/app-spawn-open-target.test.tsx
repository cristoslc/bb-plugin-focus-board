// @vitest-environment jsdom
// A thread CREATED inside the board opens where the operator's answer says it
// should (reported 2026-11-20).
//
// The board has one routing entry for "load this thread for interaction"
// (app.tsx `openThreadForInteraction`): it reads the stored answer, applies the
// host fallbacks (compact viewport, an older host, splits off, the pane cap, a
// pane the board already owns) and only then reaches the in-panel primitive.
// The card click has gone through it since #498; the New Thread modal's own
// spawn path called the primitive directly, so a created thread always landed
// in the board's in-panel pane and the answer "beside the board" was ignored.
//
// The two spawn entry points share `handleSpawnedThread`, so one suite proves
// both: the toolbar's New thread (a root spawn) and a card's "New child
// thread…" (the composer preset). The host composer itself is the fake SDK's
// submit button: the modal forwards that request verbatim to `threads.spawn`,
// which is the whole path between the gesture and the open.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeNativeOpens,
  fakePanelPushes,
  fakeSpawnCalls,
  fakeThreadNavigations,
  registeredNavPanel,
  resetFakeNativeOpens,
  resetFakePanelPushes,
  resetFakeSpawnCalls,
  resetFakeThreadNavigations,
  seedFakeLinks,
  seedFakeThreads,
  setFakeHostVersion,
  setFakeRouteThread,
  setFakeSettings,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";
import { resetHostCapabilitiesForTests } from "../lib/host-capabilities";
import { onePaneDance } from "../lib/native-one-pane-dance";
import { forgetBoardSnapshot } from "../lib/board-snapshot";
import { CURRENT_UNRELEASED_FINGERPRINT, LAST_SEEN_UNRELEASED_KEY } from "../lib/whats-new";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
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
  ];
}

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

/** The board is up: its cards are painted past the readiness gate. */
async function boardPainted(): Promise<void> {
  await waitFor(() =>
    expect(document.querySelector('[data-thread-card="thr_focus"]')).not.toBeNull(),
  );
}

function inPanelPane(title: string): HTMLElement | null {
  return document.querySelector(`aside[aria-label="Thread: ${title}"]`);
}

/** The board's New thread control, then the fake composer's submit. */
async function spawnFromToolbar(): Promise<void> {
  const toolbarButton = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "New thread",
  );
  if (toolbarButton === undefined) throw new Error("the board's New thread control is missing");
  fireEvent.click(toolbarButton);
  const submit = await waitFor(() => {
    const button = document.querySelector("[data-fake-composer-submit]");
    if (button === null) throw new Error("the composer never opened");
    return button as HTMLElement;
  });
  fireEvent.click(submit);
}

/** A card's own "New child thread…": the same modal, preset to a parent. */
async function spawnChildOf(threadId: string): Promise<void> {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  fireEvent.contextMenu(card);
  const entry = await waitFor(() => {
    const found = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "New child thread…",
    );
    if (found === undefined) throw new Error("the card menu never offered New child thread…");
    return found as HTMLElement;
  });
  fireEvent.click(entry);
  const submit = await waitFor(() => {
    const button = document.querySelector("[data-fake-composer-submit]");
    if (button === null) throw new Error("the composer never opened");
    return button as HTMLElement;
  });
  fireEvent.click(submit);
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
  window.localStorage.setItem(LAST_SEEN_UNRELEASED_KEY, CURRENT_UNRELEASED_FINGERPRINT);
  forgetBoardSnapshot();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads());
  resetFakeNativeOpens();
  resetFakePanelPushes();
  resetFakeSpawnCalls();
  resetFakeThreadNavigations();
  setFakeHostVersion("0.50.1");
  resetHostCapabilitiesForTests();
  setFakeRouteThread(null);
  setFakeSplitsOff(false);
  setFakeSplitLayout(null);
});

afterEach(() => {
  // The one-pane dance is module state that outlives a directory mount: left
  // pending, its deadline would open a pane in whichever suite runs next.
  onePaneDance.cancel();
  cleanup();
  vi.unstubAllGlobals();
});

describe("a thread created from the board's New Thread modal", () => {
  it("opens beside the board when that is the operator's answer", async () => {
    setFakeSettings({ threadOpenTarget: "beside" });
    mountBoard();
    await boardPainted();

    await spawnFromToolbar();

    // The spawn really went through the host: the request is the composer's,
    // and the created thread is the one the open names.
    expect(fakeSpawnCalls()).toHaveLength(1);
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_spawned", split: true }]),
    );
    // "Beside" is the host's own opener and nothing else: the board never
    // opened its in-panel pane and never pushed the panel route.
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
    expect(fakePanelPushes()).toEqual([]);
    expect(fakeThreadNavigations()).toEqual([]);
  });

  it("opens in the board's own pane when that is the operator's answer", async () => {
    setFakeSettings({ threadOpenTarget: "panel" });
    mountBoard();
    await boardPainted();

    await spawnFromToolbar();

    await waitFor(() => expect(inPanelPane("Spawned thread")).not.toBeNull());
    // The window could split here, and the answer says it must not be asked.
    expect(fakeNativeOpens()).toEqual([]);
    expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_spawned" });
  });
});

describe("a child spawned from a card's New child thread", () => {
  it("rides the same answer: beside the board asks the host's opener", async () => {
    setFakeSettings({ threadOpenTarget: "beside" });
    mountBoard();
    await boardPainted();

    await spawnChildOf("thr_focus");

    // The composer's own contract first: the parent preset rode along.
    expect(fakeSpawnCalls()).toHaveLength(1);
    expect(fakeSpawnCalls()[0]).toMatchObject({ parentThreadId: "thr_focus" });
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_spawned", split: true }]),
    );
    expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull();
  });

  it("rides the same answer: the board panel keeps it in the board", async () => {
    setFakeSettings({ threadOpenTarget: "panel" });
    mountBoard();
    await boardPainted();

    await spawnChildOf("thr_focus");

    await waitFor(() => expect(inPanelPane("Spawned thread")).not.toBeNull());
    expect(fakeNativeOpens()).toEqual([]);
  });
});
