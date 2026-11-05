// @vitest-environment jsdom
// The lane menu's remove-custom-order write, end to end (ruling
// dl-20261105T165850-324f): the full app runs in here, so the click's write
// rides the production path — the optimistic key drop, the rank_clear RPC,
// and the host's row. A ranked Unread lane arrives seeded; the menu's entry
// erases the row, and the lane reads recency again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRankOrders,
  fakeRpcCalls,
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeRanks,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  const t = (
    id: string,
    displayTitle: string,
    isUnread: boolean,
    updatedAt: number,
  ) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle,
    lastReadAt: updatedAt,
    createdAt: 0,
  });
  // The Unread lane's derived recency order: thr_new (1h) above thr_old (5h).
  return [
    t(
      "thr_rank_old",
      "Unread older",
      true,
      now - 5 * HOUR,
    ),
    t(
      "thr_rank_new",
      "Unread newer",
      true,
      now - 1 * HOUR,
    ),
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeRanks({ "status:unread": ["thr_rank_old", "thr_rank_new"] });
  resetFakeRpcCalls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the lane menu's remove-custom-order write", () => {
  it("clears the lane's stored order over rank_clear, and the lane reads recency", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() =>
      expect(
        document.querySelector('section[data-column-id="unread"]'),
      ).not.toBeNull(),
    );
    // Seeded ranked state, the menu names it.
    fireEvent.click(
      document.querySelector(
        'section[data-column-id="unread"] button[data-lane-menu-trigger]',
      ) as HTMLElement,
    );
    const menu = screen.getByRole("menu", { name: "Lane actions" });
    expect(menu.querySelector("[data-lane-sort-state]")?.getAttribute("data-lane-sort-state")).toBe(
      "yours",
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Remove custom order" }));

    // The write, exactly named: the RPC the host serves and the row it
    // leaves (the column's key is GONE, not an empty list).
    await waitFor(() => {
      const calls = fakeRpcCalls();
      expect(calls.some((call) => call.method === "rank_clear")).toBe(true);
    });
    await waitFor(() => {
      expect(fakeRankOrders()["status:unread"]).toBeUndefined();
    });
    await waitFor(() => {
      expect(
        document
          .querySelector('section[data-column-id="unread"]')
          ?.getAttribute("data-column-ordered"),
      ).toBe("false");
    });
    // The board re-serves the stored truth: the lane reads recency again
    // (its once-ranked card's hand slot is gone, newest first).
    await waitFor(() => {
      const section = document.querySelector('section[data-column-id="unread"]');
      const ids = [...(section?.querySelectorAll("[data-thread-card]") ?? [])]
        .filter(
          (el) =>
            (el instanceof HTMLElement) &&
            el.parentElement?.closest("[data-thread-card]") === null,
        )
        .map((el) => (el instanceof HTMLElement ? el.getAttribute("data-thread-card") : ""));
      expect(ids).toEqual(["thr_rank_new", "thr_rank_old"]);
    });
  });
});
