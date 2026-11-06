// @vitest-environment jsdom
// The mount readiness gate (issue #403): the board's first paint waits for
// the mount fan-in to settle — all nine immediate mount lists resolved OR
// rejected — with a hard ceiling so a hung list can never blank the panel.
// The laws under test:
// - instant-rpc environments (this fake host) release the gate within
//   microtasks, so every suite's timing is unchanged;
// - a rejected optional list counts as settled — the hold never waits for
//   a retry;
// - a HUNG call is the ceiling's job: past MOUNT_SETTLE_CEILING_MS the
//   board paints with whatever landed;
// - the ceiling cancels on unmount and never re-arms;
// - the gate is mount-only: the realtime signal path's refetches never
//   re-gate the paint, and the mount effect's calls fire at the same
//   moment they do today (the fan-in runs DURING the loading view).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRpcCalls,
  fireRealtime,
  registeredNavPanel,
  releaseRpcHangs,
  seedFakeThreads,
  stubRpcHang,
  stubRpcRejection,
} from "./helpers/app-fake-sdk";
import { MOUNT_SETTLE_CEILING_MS } from "../lib/idle-callback";
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
      id: "thr_gate",
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
      displayTitle: "Readiness board",
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
  releaseRpcHangs();
  stubRpcHang(null);
  stubRpcRejection(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

const loadingView = (): HTMLElement | null => screen.queryByText("Loading threads…");
const firstCard = (): Element | null => document.querySelector("[data-thread-card]");

describe("the mount readiness gate", () => {
  it("holds the loading view until the nine mount lists settle, with the fan-in running during it", async () => {
    stubRpcHang("rank_list");
    mountBoard();
    // The hold: the paint waits, but the fetches fired exactly as today.
    expect(loadingView()).not.toBeNull();
    expect(firstCard()).toBeNull();
    const methods = fakeRpcCalls().map((call) => call.method);
    expect(methods).toContain("done_list");
    expect(methods).toContain("rank_list");
    expect(methods).toContain("family_state_list");
    // The ninth list settles: the gate releases.
    await act(async () => {
      releaseRpcHangs();
    });
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
  });

  it("releases within microtasks when rpc answers immediately — no timer moved", async () => {
    mountBoard();
    expect(loadingView()).not.toBeNull();
    await act(async () => {});
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
    // The release rode microtasks alone: zero fake time was advanced — the
    // ceiling never became the active path.
  });

  it("releases via a rejected list's settled status — the hold never waits for a retry", async () => {
    stubRpcRejection("rank_list");
    mountBoard();
    await act(async () => {});
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
  });

  it("paints with whatever landed once the ceiling fires under a hung list", async () => {
    stubRpcHang("rank_list");
    mountBoard();
    await act(async () => {}); // the other eight settled; the gate still holds
    expect(loadingView()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(MOUNT_SETTLE_CEILING_MS);
    });
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
  });

  it("cancels the ceiling on unmount", () => {
    stubRpcHang("rank_list");
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    mountBoard();
    // The ceiling is armed (jsdom's own storage timers share the spy; the
    // app's only 400ms timer here is the ceiling).
    const callIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, delay]) => delay === MOUNT_SETTLE_CEILING_MS,
    );
    expect(callIndex).toBeGreaterThanOrEqual(0);
    const handle = setTimeoutSpy.mock.results[callIndex].value;
    cleanup();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(handle); // canceled with the mount
  });

  it("never re-gates the paint on the realtime signal path's refetches", async () => {
    mountBoard();
    await act(async () => {}); // released
    expect(firstCard()).not.toBeNull();
    await act(async () => {
      fireRealtime("done-changed");
      fireRealtime("rank-changed");
    });
    await act(async () => {
      vi.advanceTimersByTime(REFETCH_COALESCE_MS);
    });
    await act(async () => {});
    expect(loadingView()).toBeNull(); // signals refetch; the board stays painted
    expect(firstCard()).not.toBeNull();
  });
});
