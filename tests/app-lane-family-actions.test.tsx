// @vitest-environment jsdom
// The lane menu's bulk family controls, end to end through the REAL app: one
// "Expand all" / "Collapse all" / idle pair click writes ONE
// `family_state_set_many` for that lane's fold keys, the whole lane moves
// together, and every other lane keeps its folds and hides. A rejected write
// rolls the lane back to the server's truth and names the action that failed.
//
// The server half is pinned in `tests/family-state-rpc.test.ts` (one lock, one
// write, one signal); this suite pins the client's lane scoping and rollback.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeFamilyStateStore,
  fakeRpcCalls,
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeFamilyState,
  seedFakeThreads,
  stubFamilyStateWriteFailure,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Three families in two lanes: A and B in Unread, C in Working. The lane
 * scoping cases read A/B moving together while C holds still.
 */
function fixtureThreads() {
  const now = Date.now();
  const t = (
    id: string,
    displayTitle: string,
    parentThreadId: string | null,
    status: string,
    updatedAt: number,
  ) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status,
    isUnread: status === "active" ? false : true,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle,
    lastReadAt: null,
    createdAt: 0,
  });
  return [
    t("thr_lane_a", "Family A", null, "idle", now - HOUR),
    t("thr_lane_a_c1", "Family A child", "thr_lane_a", "idle", now - 2 * HOUR),
    t("thr_lane_b", "Family B", null, "idle", now - 3 * HOUR),
    t("thr_lane_b_c1", "Family B child", "thr_lane_b", "idle", now - 4 * HOUR),
    t("thr_lane_c", "Family C", null, "active", now - 5 * HOUR),
    t("thr_lane_c_c1", "Family C child", "thr_lane_c", "active", now - 6 * HOUR),
  ];
}

const familyCard = (threadId: string): HTMLElement => {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  return card as HTMLElement;
};

/** The card's own child-section fold toggle, read through its aria-label. */
const foldToggle = (threadId: string): HTMLButtonElement => {
  const button = familyCard(threadId).querySelector("button[data-child-threads-toggle]");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing fold toggle on ${threadId}`);
  return button;
};

const expectsCollapsed = (threadId: string): boolean =>
  foldToggle(threadId).getAttribute("aria-label") === "Expand subthreads";

/** The card's own idle-children eye, read through its aria-label. */
const idleToggle = (threadId: string): HTMLButtonElement => {
  const button = familyCard(threadId).querySelector("button[data-idle-children-toggle]");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing idle toggle on ${threadId}`);
  return button;
};

const expectsIdleHidden = (threadId: string): boolean =>
  idleToggle(threadId).getAttribute("aria-label") === "Show idle child threads";

function openLaneMenu(columnId: string): void {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  const trigger = section?.querySelector("button[data-lane-menu-trigger]");
  if (trigger === null || trigger === undefined) throw new Error(`no lane menu on ${columnId}`);
  fireEvent.click(trigger);
}

/** Click one lane-menu entry by its label (the bulk rows are radio rows). */
function clickLaneEntry(label: string): void {
  const entry = Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(
    (row) => row.textContent?.includes(label),
  );
  if (entry === undefined) throw new Error(`no lane menu entry "${label}"`);
  fireEvent.click(entry);
}

const familyStateWrites = () =>
  fakeRpcCalls().filter(
    (call) =>
      call.method === "family_state_set" || call.method === "family_state_set_many",
  );

async function mountBoard(): Promise<void> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  await waitFor(() => expect(document.querySelector('[data-thread-card="thr_lane_a"]')).toBeTruthy());
  await waitFor(() => expect(foldToggle("thr_lane_a")).toBeTruthy());
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeFamilyState({});
  resetFakeRpcCalls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  seedFakeFamilyState({});
  resetFakeRpcCalls();
});

describe("lane menu: bulk family controls through the real app", () => {
  it("Expand all writes ONE bulk call for the lane and leaves the other lane folded", async () => {
    seedFakeFamilyState({
      collapsedFamilies: ["thr_lane_a", "thr_lane_b", "thr_lane_c"],
    });
    await mountBoard();
    await waitFor(() => expect(expectsCollapsed("thr_lane_a")).toBe(true));
    expect(expectsCollapsed("thr_lane_c")).toBe(true);
    resetFakeRpcCalls();

    openLaneMenu("unread");
    clickLaneEntry("Expand all");
    // The lane's own two families reopen...
    await waitFor(() => expect(expectsCollapsed("thr_lane_a")).toBe(false));
    expect(expectsCollapsed("thr_lane_b")).toBe(false);
    // ...while the Working lane keeps its fold.
    expect(expectsCollapsed("thr_lane_c")).toBe(true);
    await waitFor(() =>
      expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_lane_c"]),
    );
    const writes = familyStateWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      method: "family_state_set_many",
      args: { key: "collapsedFamilies", ids: ["thr_lane_a", "thr_lane_b"], on: false },
    });
  });

  it("Hide idle children writes the idle key only and never the fold set", async () => {
    await mountBoard();
    resetFakeRpcCalls();

    openLaneMenu("unread");
    clickLaneEntry("Hide idle children");
    await waitFor(() =>
      expect(fakeFamilyStateStore().hideIdleChildren).toEqual(["thr_lane_a", "thr_lane_b"]),
    );
    expect(fakeFamilyStateStore().collapsedFamilies).toEqual([]);
    await waitFor(() => expect(expectsIdleHidden("thr_lane_a")).toBe(true));
    expect(expectsCollapsed("thr_lane_a")).toBe(false);
    expect(familyStateWrites()).toEqual([
      {
        method: "family_state_set_many",
        args: { key: "hideIdleChildren", ids: ["thr_lane_a", "thr_lane_b"], on: true },
      },
    ]);
  });

  it("a rejected bulk write restores server truth and names the action once", async () => {
    // The server's row already holds one fold, in ANOTHER lane: the rollback
    // must land that row (C still folded, A and B open), which a no-op
    // rejection could not fake.
    seedFakeFamilyState({ collapsedFamilies: ["thr_lane_c"] });
    await mountBoard();
    await waitFor(() => expect(expectsCollapsed("thr_lane_c")).toBe(true));
    resetFakeRpcCalls();
    stubFamilyStateWriteFailure("rpc input validation failed");

    openLaneMenu("unread");
    clickLaneEntry("Collapse all");
    // The rejection rolls the whole lane back to the server's row (never a
    // half-folded lane) and the banner names the action that failed, once.
    await waitFor(() => expect(expectsCollapsed("thr_lane_a")).toBe(false));
    expect(expectsCollapsed("thr_lane_b")).toBe(false);
    expect(expectsCollapsed("thr_lane_c")).toBe(true);
    expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_lane_c"]);
    await waitFor(() => {
      const banner = document.querySelector('[data-testid="family-state-save-error"]');
      expect(banner?.textContent).toContain("Collapse all didn't save");
      expect(banner?.textContent).toContain("rpc input validation failed");
    });
    expect(document.querySelectorAll('[data-testid="family-state-save-error"]')).toHaveLength(1);
    expect(familyStateWrites()).toHaveLength(1);
  });
});
