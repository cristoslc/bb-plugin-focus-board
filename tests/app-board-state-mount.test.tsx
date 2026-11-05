// @vitest-environment jsdom
// The mount's aggregate read (server.ts board_state_get, app.tsx's mount
// effect): the board hydrates its board-state from ONE aggregate call — the
// same setters the refetch units apply — and when the host REJECTS the
// aggregate (an old server build that never registered the method) the mount
// falls back to issuing the exact nine per-list calls, each with the
// optional-state rejection semantics it has always had.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRpcCalls,
  fakeRankOrders,
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeGroups,
  seedFakeRanks,
  seedFakeFamilyState,
  seedFakeThreads,
  stubBoardStateUnavailable,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  return [
    {
      id: "thr_agg",
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
      displayTitle: "Aggregate mount",
      lastReadAt: null,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  resetFakeRpcCalls();
  seedFakeThreads(fixtureThreads());
  seedFakeFamilyState({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  stubBoardStateUnavailable(null);
  window.localStorage.clear();
  seedFakeFamilyState({});
});

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

describe("the mount's board_state_get aggregate", () => {
  it("hydrates board state from ONE aggregate call, not nine per-list calls", async () => {
    seedFakeRanks({ "status:idle": ["thr_agg"] });
    seedFakeGroups({ grp_box: { name: "Box", createdAt: "2026-11-01T00:00:00.000Z" } });
    mountBoard();
    await act(async () => {});
    await waitFor(() => expect(fakeRankOrders()["status:idle"]).toEqual(["thr_agg"]));
    const methods = fakeRpcCalls().map((call) => call.method);
    expect(methods).toContain("board_state_get");
    // The aggregate is the ONLY board-state read at mount (plus the pulse
    // poll's own mount call, which is not part of the aggregate): no
    // per-list call rides the mount read in the aggregate's presence.
    expect(methods.filter((method) => method === "board_state_get")).toHaveLength(1);
    for (const perList of [
      "done_list",
      "pin_parks_list",
      "sweep_config_get",
      "link_list",
      "error_acks_list",
      "snooze_list",
      "rank_list",
      "groups_list",
      "family_state_list",
    ]) {
      expect(methods).not.toContain(perList);
    }
  });

  it("a rejected aggregate falls back to the exact nine per-list mount calls", async () => {
    seedFakeRanks({ "status:idle": ["thr_agg"] });
    stubBoardStateUnavailable("no such rpc method: board_state_get");
    mountBoard();
    await waitFor(() => expect(fakeRankOrders()["status:idle"]).toEqual(["thr_agg"]));
    const methods = fakeRpcCalls().map((call) => call.method);
    expect(methods.filter((method) => method === "board_state_get")).toHaveLength(1);
    for (const perList of [
      "done_list",
      "pin_parks_list",
      "sweep_config_get",
      "link_list",
      "error_acks_list",
      "snooze_list",
      "rank_list",
      "groups_list",
      "family_state_list",
    ]) {
      expect(methods).toContain(perList);
    }
  });

  it("the fallback's optional-state rejection semantics stay per-list (an unserved list loses nothing else)", async () => {
    // error_acks_list is unserved on this fake (it already rejects); with the
    // aggregate ALSO unavailable, the board still hydrates everything the
    // served lists answer — today's per-call rejections, one list at a time.
    // The group state must land even while another list is rejecting.
    seedFakeGroups(
      { grp_fallback: { name: "Fallback", createdAt: "2026-11-01T00:00:00.000Z" } },
      { thr_agg: "grp_fallback" },
    );
    stubBoardStateUnavailable("no such rpc method: board_state_get");
    mountBoard();
    await act(async () => {});
    await waitFor(() =>
      expect(document.querySelector('[data-group-box="grp_fallback"]')).not.toBeNull(),
    );
    // And no unserved list took the mount down: the card itself renders.
    await waitFor(() =>
      expect(document.querySelector('[data-thread-card="thr_agg"]')).not.toBeNull(),
    );
  });
});
