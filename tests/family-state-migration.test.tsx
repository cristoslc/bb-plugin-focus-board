// @vitest-environment jsdom
// The one-time localStorage migration for the family fold + idle-hide sets:
// an operator upgrading from the localStorage era keeps every fold. The
// server row is the truth from here on; the migration runs exactly once, only
// when the server row is empty, and only a successful write retires the
// legacy keys (a failed write keeps the folds and retries next load).
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
import { COLLAPSED_FAMILIES_KEY, HIDE_IDLE_CHILDREN_KEY } from "../components/preferences";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  const t = (id: string, displayTitle: string, parentThreadId: string | null, updatedAt: number) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
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
    t("thr_folda", "Family A", null, now - HOUR),
    t("thr_folda_c1", "Family A child", "thr_folda", now - 2 * HOUR),
    t("thr_foldb", "Family B", null, now - 3 * HOUR),
    t("thr_foldb_c1", "Family B child", "thr_foldb", now - 4 * HOUR),
    t("thr_foldc", "Family C", null, now - 5 * HOUR),
    t("thr_foldc_c1", "Family C child", "thr_foldc", now - 6 * HOUR),
  ];
}

const familyCard = (threadId: string): HTMLElement => {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  return card as HTMLElement;
};

const expectsCollapsed = (threadId: string): boolean =>
  familyCard(threadId).querySelector("button[data-child-threads-toggle]")?.getAttribute("aria-label") ===
  "Expand subthreads";

const expectsHidingIdle = (threadId: string): boolean =>
  familyCard(threadId).querySelector("button[data-idle-children-toggle]")?.getAttribute("aria-label") ===
  "Show idle child threads";

async function mountBoard(): Promise<void> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  await waitFor(() =>
    expect(document.querySelector('[data-thread-card="thr_folda"]')).toBeTruthy(),
  );
  await waitFor(() =>
    expect(familyCard("thr_folda").querySelector("button[data-child-threads-toggle]")).toBeTruthy(),
  );
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
  vi.unstubAllGlobals();
  window.localStorage.clear();
  seedFakeFamilyState({});
});

describe("family-state localStorage migration", () => {
  it("migrates stored folds to the server row once, then retires the legacy keys", async () => {
    window.localStorage.setItem(COLLAPSED_FAMILIES_KEY, JSON.stringify(["thr_folda"]));
    window.localStorage.setItem(HIDE_IDLE_CHILDREN_KEY, JSON.stringify(["thr_foldb"]));
    await mountBoard();
    // The migration unioned the local sets into the server row.
    await waitFor(() =>
      expect(fakeFamilyStateStore()).toEqual({
        collapsedFamilies: ["thr_folda"],
        hideIdleChildren: ["thr_foldb"],
      }),
    );
    // The board renders the migrated folds.
    await waitFor(() => expect(expectsCollapsed("thr_folda")).toBe(true));
    await waitFor(() => expect(expectsHidingIdle("thr_foldb")).toBe(true));
    // The migration call carried exactly the local ids.
    expect(
      fakeRpcCalls().find((call) => call.method === "family_state_merge")?.args,
    ).toEqual({ collapsedFamilies: ["thr_folda"], hideIdleChildren: ["thr_foldb"] });
    // The legacy keys are retired, so no later read can revive stale state.
    expect(window.localStorage.getItem(COLLAPSED_FAMILIES_KEY)).toBeNull();
    expect(window.localStorage.getItem(HIDE_IDLE_CHILDREN_KEY)).toBeNull();
  });

  it("a non-empty server row wins; stale localStorage is never merged in", async () => {
    seedFakeFamilyState({ collapsedFamilies: ["thr_foldc"], hideIdleChildren: [] });
    window.localStorage.setItem(COLLAPSED_FAMILIES_KEY, JSON.stringify(["thr_folda"]));
    await mountBoard();
    await waitFor(() => expect(expectsCollapsed("thr_foldc")).toBe(true));
    // The server row is untouched: no merge of the stale local fold.
    expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_foldc"]);
    expect(fakeRpcCalls().some((call) => call.method === "family_state_merge")).toBe(false);
    expect(expectsCollapsed("thr_folda")).toBe(false);
    // The superseded legacy key is still retired.
    expect(window.localStorage.getItem(COLLAPSED_FAMILIES_KEY)).toBeNull();
  });

  it("a failed migration keeps the folds and the legacy keys (retry next load)", async () => {
    window.localStorage.setItem(COLLAPSED_FAMILIES_KEY, JSON.stringify(["thr_folda"]));
    stubFamilyStateWriteFailure("kv write rejected");
    await mountBoard();
    // The fold stays on screen from the local fallback...
    await waitFor(() => expect(expectsCollapsed("thr_folda")).toBe(true));
    // ...the server row never took it...
    expect(fakeFamilyStateStore().collapsedFamilies).toEqual([]);
    // ...and the legacy key survives so the next load retries.
    expect(window.localStorage.getItem(COLLAPSED_FAMILIES_KEY)).toBe(
      JSON.stringify(["thr_folda"]),
    );
  });

  it("a fresh install migrates nothing and writes nothing", async () => {
    await mountBoard();
    await waitFor(() =>
      expect(fakeRpcCalls().some((call) => call.method === "family_state_list")).toBe(true),
    );
    expect(fakeRpcCalls().some((call) => call.method === "family_state_merge")).toBe(false);
    expect(expectsCollapsed("thr_folda")).toBe(false);
    expect(familyCard("thr_folda").querySelector("button[data-child-threads-toggle]")).toBeTruthy();
  });

  it("a corrupt legacy list degrades through the tolerant parser (never drops the good fold)", async () => {
    // The collapse key holds one good id and junk; the tolerant parser keeps
    // the good one and the migration carries just it.
    window.localStorage.setItem(COLLAPSED_FAMILIES_KEY, '["thr_folda", 42, {"x": 1}]');
    await mountBoard();
    await waitFor(() => expect(expectsCollapsed("thr_folda")).toBe(true));
    expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_folda"]);
  });

  it("a fold toggled after a successful migration writes the server, not localStorage", async () => {
    window.localStorage.setItem(COLLAPSED_FAMILIES_KEY, JSON.stringify(["thr_folda"]));
    await mountBoard();
    await waitFor(() => expect(expectsCollapsed("thr_folda")).toBe(true));
    fireEvent.click(
      familyCard("thr_foldb").querySelector("button[data-child-threads-toggle]") as HTMLElement,
    );
    await waitFor(() =>
      expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_folda", "thr_foldb"]),
    );
    expect(window.localStorage.getItem(COLLAPSED_FAMILIES_KEY)).toBeNull();
  });
});
