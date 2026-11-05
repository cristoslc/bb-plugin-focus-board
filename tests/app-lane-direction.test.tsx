// @vitest-environment jsdom
// The lane menu's sort pair, end to end (the operator's amendment: sorting
// carries real actions, ascending vs descending even on the recency
// dimension). The full app runs in here: the pick writes the preference,
// the lane re-orders live, the write persists, and another window's write
// hydrates this one through the storage event the cross-window hook reads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { LANE_ORDER_DIRECTIONS_KEY } from "../components/preferences";
import { registeredNavPanel, seedFakeThreads } from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  const t = (id: string, displayTitle: string, updatedAt: number) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: true,
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
  return [
    t("thr_dir_old", "Unread oldest", now - 9 * HOUR),
    t("thr_dir_new", "Unread newest", now - 1 * HOUR),
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function laneCards(): string[] {
  const section = document.querySelector('section[data-column-id="unread"]');
  return [...(section?.querySelectorAll("[data-thread-card]") ?? [])]
    .filter(
      (el) =>
        (el instanceof HTMLElement) &&
        el.parentElement?.closest("[data-thread-card]") === null,
    )
    .map((el) => (el instanceof HTMLElement ? el.getAttribute("data-thread-card") : ""));
}

describe("the lane menu's sort pair", () => {
  it("picking Oldest first re-orders the lane live and persists the preference", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(laneCards()).toEqual(["thr_dir_new", "thr_dir_old"]));

    // The trigger opens the menu; the pair's pick writes the direction.
    fireEvent.click(
      document.querySelector(
        'section[data-column-id="unread"] button[data-lane-menu-trigger]',
      ) as HTMLElement,
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }));

    await waitFor(() => expect(laneCards()).toEqual(["thr_dir_old", "thr_dir_new"]));
    // The preference, persisted per columnRankKey.
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(LANE_ORDER_DIRECTIONS_KEY) ?? "")).toEqual({
        "status:unread": "oldest-first",
      }),
    );
    // The menu closed with the pick; reopened, the pair reads the flipped state.
    fireEvent.click(
      document.querySelector(
        'section[data-column-id="unread"] button[data-lane-menu-trigger]',
      ) as HTMLElement,
    );
    expect(screen.getByRole("menuitemradio", { name: "Oldest first" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Newest first" }));
    await waitFor(() => expect(laneCards()).toEqual(["thr_dir_new", "thr_dir_old"]));
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(LANE_ORDER_DIRECTIONS_KEY) ?? "")).toEqual({}),
    );
  });

  it("another window's direction choice hydrates this board live", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(laneCards()).toEqual(["thr_dir_new", "thr_dir_old"]));

    // Window B writes the preference (a real browser delivers this document a
    // storage event; jsdom cannot spawn a second living document, so the
    // event is dispatched with the payload a real one lands).
    const raw = JSON.stringify({ "status:unread": "oldest-first" });
    window.localStorage.setItem(LANE_ORDER_DIRECTIONS_KEY, raw);
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: LANE_ORDER_DIRECTIONS_KEY,
        oldValue: null,
        newValue: raw,
        storageArea: window.localStorage,
      }),
    );

    await waitFor(() => expect(laneCards()).toEqual(["thr_dir_old", "thr_dir_new"]));
  });
});
