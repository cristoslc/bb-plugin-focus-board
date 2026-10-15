// @vitest-environment jsdom
// The app-level burst contract (issue #186, refetch half): a burst of
// realtime signals arriving together — the echo tail of one write reaching
// several channels — produces ONE refetch pass on the app's state lists,
// not one per signal. The fake SDK's realtime channels are fired back to
// back and the counted rpc log must show each list refetched exactly once
// for the burst, past the coalescing window.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  clearRpcCallLog,
  fireRealtime,
  registeredNavPanel,
  rpcCalls,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";
import { REFETCH_COALESCE_MS } from "../lib/refetch-coalescer";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  return [
    {
      id: "thr_burst",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Burst board",
      lastReadAt: null,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

describe("a realtime signal burst", () => {
  it("refetches each state list once for the burst, not once per signal", async () => {
    mountBoard();
    // The mount's own refetches are immediate; settle them and clear the
    // log so the burst's contribution is what gets asserted.
    await act(async () => {});
    clearRpcCallLog();
    // Ten done-changed echoes together with a link, ack, snooze, rank, and
    // group signal, all inside one coalescing window.
    await act(async () => {
      for (let i = 0; i < 10; i++) fireRealtime("done-changed");
      fireRealtime("link-changed");
      fireRealtime("error-ack-changed");
      fireRealtime("snooze-changed");
      fireRealtime("rank-changed");
      fireRealtime("group-changed");
    });
    expect(rpcCalls()).toHaveLength(0); // the burst is still inside the quiet window
    await act(async () => {
      vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    });
    await act(async () => {});
    const counts: Record<string, number> = {};
    for (const method of rpcCalls()) counts[method] = (counts[method] ?? 0) + 1;
    expect(counts["done_list"]).toBe(1);
    expect(counts["pin_parks_list"]).toBe(1);
    expect(counts["sweep_config_get"]).toBe(1);
    expect(counts["link_list"]).toBe(1);
    expect(counts["error_acks_list"]).toBe(1);
    expect(counts["snooze_list"]).toBe(1);
    expect(counts["rank_list"]).toBe(1);
    expect(counts["groups_list"]).toBe(1);
  });
});