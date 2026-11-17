// @vitest-environment jsdom
// The board must not reload when bb's window splits or unsplits.
//
// The operator's report (2026-11-17): "when the window splits/unsplits, focus
// board reloads every time." bb re-creates this panel's React subtree on the
// first split and again on the last unsplit — the host's own branch swap, quoted
// in lib/board-snapshot's header and measured live by
// scripts/screenshot/probe-board-remount-on-split.mjs — so no test here can
// prevent the re-creation. What these tests pin is the half that makes it
// invisible, and the half that keeps it honest:
//
// - a seeded mount paints the board on its FIRST frame: no loading view, and
//   the previous instance's Done lane already in place while the mount fan-in
//   is still hung;
// - the fan-in still fires on a seeded mount — the snapshot decides the first
//   paint, never the truth — and the server's answer replaces the seed;
// - the scroll the operator had is captured on unmount and restored on the
//   next mount;
// - a mount with no snapshot behaves exactly as before: the gate holds;
// - a split layout change never makes this app navigate (if it did, the reload
//   would be ours).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakePanelPushes,
  fakeRpcCalls,
  registeredNavPanel,
  releaseRpcHangs,
  resetFakePanelPushes,
  resetFakeRpcCalls,
  seedFakeThreads,
  setFakeSplitLayout,
  stubRpcDelay,
  stubRpcHang,
} from "./helpers/app-fake-sdk";
import {
  EMPTY_SNAPSHOT_DATA,
  forgetBoardSnapshot,
  recallBoard,
  rememberBoardData,
  type BoardSnapshotData,
} from "../lib/board-snapshot";

const HOUR = 3_600_000;

function fixtureThreads() {
  const now = Date.now();
  return [
    {
      id: "thr_remount_done",
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
      displayTitle: "Remount: done card",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      id: "thr_remount_live",
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
      displayTitle: "Remount: live card",
      lastReadAt: null,
      createdAt: 0,
    },
  ];
}

function seedData(overrides: Partial<BoardSnapshotData> = {}): BoardSnapshotData {
  return { ...EMPTY_SNAPSHOT_DATA, ...overrides };
}

/** What the previous panel instance left behind, as its writer effect would. */
function seedFromPreviousMount(overrides: Partial<BoardSnapshotData> = {}): void {
  rememberBoardData(
    seedData({ sweepConfig: { doneArchiveMs: 172_800_000, idleArchiveMs: 172_800_000 }, ...overrides }),
  );
}

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

const loadingView = (): HTMLElement | null => screen.queryByText("Loading threads…");
const cardIn = (laneId: string, threadId: string): Element | null =>
  document.querySelector(
    `section[data-column-id="${laneId}"] [data-thread-card="${threadId}"]`,
  );
const firstCard = (): Element | null => document.querySelector("[data-thread-card]");

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  resetFakeRpcCalls();
  resetFakePanelPushes();
  forgetBoardSnapshot();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  releaseRpcHangs();
  stubRpcHang(null);
  stubRpcDelay(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetBoardSnapshot();
});

describe("a mount the host re-created", () => {
  it("paints the previous board on its first frame: no loading view, the seed's Done lane already there", async () => {
    // The server has not answered anything yet: everything on screen is the
    // snapshot.
    stubRpcHang("board_state_get");
    stubRpcHang("rank_list");
    stubRpcHang("family_state_list");
    seedFromPreviousMount({ doneIds: ["thr_remount_done"] });

    mountBoard();

    // The first frame, before any await: the gate is released and the board is
    // the seeded board. This is the flash the operator reported, gone.
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
    expect(cardIn("done", "thr_remount_done")).not.toBeNull();
    expect(cardIn("done", "thr_remount_live")).toBeNull();
  }, 20_000);

  it("still runs the mount fan-in, and the server's answer replaces the seed", async () => {
    // The aggregate read is slow, not hung: it lands after the first paint.
    stubRpcDelay("board_state_get", 500);
    seedFromPreviousMount({ doneIds: ["thr_remount_done"] });
    mountBoard();
    expect(loadingView()).toBeNull();
    expect(cardIn("done", "thr_remount_done")).not.toBeNull();
    // The seed decided the PAINT, not the truth: the aggregate read fired.
    const methods = fakeRpcCalls().map((call) => call.method);
    expect(methods).toContain("board_state_get");
    expect(methods).toContain("rank_list");
    expect(methods).toContain("family_state_list");
    expect(methods.filter((method) => method === "board_state_get")).toHaveLength(1);
    // The fake's aggregate answers with no done ids: the seeded Done card
    // leaves the Done lane, and no loading view is ever interposed.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {});
    expect(loadingView()).toBeNull();
    expect(cardIn("done", "thr_remount_done")).toBeNull();
    expect(firstCard()).not.toBeNull();
  });

  it("hands its painted state to the next mount, so a split's re-creation is seeded", async () => {
    expect(recallBoard()).toBeNull(); // nothing remembered before the first mount
    mountBoard();
    await act(async () => {}); // the fan-in settled, the board painted
    const held = recallBoard();
    expect(held).not.toBeNull();
    expect(held?.data.sweepConfig.doneArchiveMs).toBe(172_800_000);
    // The host re-creates the subtree: the instance goes away, the state does not.
    cleanup();
    expect(recallBoard()).not.toBeNull();
    // And the next mount starts from it rather than from empty sets.
    mountBoard();
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
  });

  it("restores the scroll the operator had, captured as they scrolled", async () => {
    mountBoard();
    await act(async () => {});
    const scroller = document.querySelector("[data-columns-board]");
    const laneList = document.querySelector("[data-column-id] [data-card-list]");
    if (scroller === null || laneList === null) throw new Error("board did not paint");
    scroller.scrollLeft = 260;
    laneList.scrollTop = 120;
    // The browser's own event for a pan (jsdom does not synthesize one).
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    cleanup(); // the host drops the pane's subtree

    mountBoard();
    const again = document.querySelector("[data-columns-board]");
    const againList = document.querySelector("[data-column-id] [data-card-list]");
    if (again === null || againList === null) throw new Error("second mount did not paint");
    expect(again.scrollLeft).toBe(260);
    expect(againList.scrollTop).toBe(120);
    expect(loadingView()).toBeNull();
  });

  it("does not let a split layout change hold the paint a second time", async () => {
    mountBoard();
    await act(async () => {});
    expect(firstCard()).not.toBeNull();
    // bb creates the second pane: the host reports a two-pane layout.
    await act(async () => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_remount_live", isFocused: true },
      ]);
    });
    await act(async () => {});
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
  });
});

describe("what must NOT change", () => {
  it("a mount with no snapshot still holds the gate until the fan-in settles", async () => {
    stubRpcHang("rank_list");
    mountBoard();
    expect(loadingView()).not.toBeNull();
    expect(firstCard()).toBeNull();
    await act(async () => {
      releaseRpcHangs();
    });
    expect(loadingView()).toBeNull();
    expect(firstCard()).not.toBeNull();
  });

  it("never navigates because the layout changed — the reload would then be ours", async () => {
    mountBoard();
    await act(async () => {});
    resetFakePanelPushes();
    await act(async () => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_remount_live", isFocused: true },
      ]);
    });
    // And back to one pane, the unsplit direction.
    await act(async () => {
      setFakeSplitLayout(null);
    });
    await act(async () => {});
    expect(fakePanelPushes()).toEqual([]);
  });
});
