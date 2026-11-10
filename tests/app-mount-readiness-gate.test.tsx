// @vitest-environment jsdom
// The mount readiness gate (issues #403, #424): the board's first paint waits
// for the mount fan-in to settle — all nine immediate mount lists resolved OR
// rejected — with a hard ceiling so a hung list can never blank the panel.
// The laws under test:
// - instant-rpc environments (this fake host) release the gate within
//   microtasks, so every suite's timing is unchanged;
// - a rejected optional list counts as settled — the hold never waits for
//   a retry;
// - a LIVE fan-in that outlasts the retired 400ms mark still holds the paint
//   (issue #424: the old ceiling was shorter than a real workspace's mount
//   read, so the hold was a no-op there and the board painted first);
// - a HUNG call is the ceiling's job: past MOUNT_SETTLE_CEILING_MS the board
//   paints with whatever landed;
// - the ceiling cancels on unmount and never re-arms, and it stays sized
//   above the measured fan-in;
// - the gate is mount-only: the realtime signal path's refetches never
//   re-gate the paint, and the mount effect's calls fire at the same moment
//   they do today (the fan-in runs DURING the loading view).
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
  stubRpcDelay,
  stubRpcHang,
  stubRpcRejection,
} from "./helpers/app-fake-sdk";
import { MOUNT_SETTLE_CEILING_MS } from "../lib/idle-callback";
import { REFETCH_COALESCE_MS } from "../lib/refetch-coalescer";

const HOUR = 3_600_000;

/** The aggregate mount read's wall on a real workspace, staged: ~0.6s
 *  measured for 358 threads, and the retired hold's ceiling was 400ms. */
const LIVE_FAN_IN_MS = 1200;
/** The ceiling the hold shipped with before issue #424. */
const RETIRED_CEILING_MS = 400;

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
    {
      id: "thr_gate_two",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 3 * HOUR,
      displayTitle: "Readiness board, second card",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      id: "thr_gate_three",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 4 * HOUR,
      displayTitle: "Readiness board, third card",
      lastReadAt: null,
      createdAt: 0,
    },
  ];
}

const FIXTURE_CARD_COUNT = 3;

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
  stubRpcDelay(null);
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
    expect(methods).toContain("board_state_get");
    expect(methods).toContain("rank_list");
    expect(methods).toContain("family_state_list");
    // The six aggregated lists cost ONE mount call, and the per-list handlers
    // they replaced are not on the mount path at all (issue #424).
    expect(methods.filter((method) => method === "board_state_get")).toHaveLength(1);
    expect(methods).not.toContain("done_list");
    expect(methods).not.toContain("groups_list");
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

  // Issue #424: the hold must cover a LIVE fan-in, not just a fast one. The
  // board painted before the metadata settled because the ceiling was shorter
  // than the mount read; on a real 358-thread workspace the six per-thread
  // walks took ~2s, so the retired 400ms ceiling fired on every mount. Both
  // lane directions are pinned here because the gate is ONE early return in
  // front of both boards — a direction-specific fix would be the wrong fix.
  it.each(["horizontal", "vertical"] as const)(
    "holds the paint for a live fan-in that outlasts the retired 400ms mark — %s",
    async (laneDirection) => {
      window.localStorage.setItem("focus-board:laneDirection", laneDirection);
      stubRpcDelay("board_state_get", LIVE_FAN_IN_MS);
      mountBoard();
      expect(loadingView()).not.toBeNull();
      expect(firstCard()).toBeNull();
      // The retired ceiling's own mark: at 400ms the old hold painted the
      // board with the aggregate still in flight. Nothing may paint here.
      await act(async () => {
        vi.advanceTimersByTime(RETIRED_CEILING_MS);
      });
      expect(loadingView()).not.toBeNull();
      expect(firstCard()).toBeNull();
      // The read lands: the paint is the settled board, every card at once.
      await act(async () => {
        vi.advanceTimersByTime(LIVE_FAN_IN_MS);
      });
      expect(loadingView()).toBeNull();
      expect(document.querySelectorAll("[data-thread-card]")).toHaveLength(FIXTURE_CARD_COUNT);
    },
  );

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
    // app's only MOUNT_SETTLE_CEILING_MS timer here is the ceiling).
    const callIndex = setTimeoutSpy.mock.calls.findIndex(
      ([, delay]) => delay === MOUNT_SETTLE_CEILING_MS,
    );
    expect(callIndex).toBeGreaterThanOrEqual(0);
    const handle = setTimeoutSpy.mock.results[callIndex].value;
    cleanup();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(handle); // canceled with the mount
  });

  it("keeps the ceiling above the measured live fan-in (regression guard)", () => {
    // The number is a measurement, not a guess: the aggregate mount read is
    // ~0.6s on a 358-thread workspace, and the retired 400ms value was
    // already shorter than the OLD six-walk fan-in (~2s). A ceiling below
    // the measured fan-in silently makes the hold a no-op again.
    expect(MOUNT_SETTLE_CEILING_MS).toBeGreaterThanOrEqual(1500);
    expect(LIVE_FAN_IN_MS).toBeLessThan(MOUNT_SETTLE_CEILING_MS);
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
