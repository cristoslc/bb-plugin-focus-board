// @vitest-environment jsdom
// Family fold + idle-hide persistence moved off browser localStorage onto a
// plugin-wide server KV row (lib/family-state), so the same fold and hide
// read on every window AND every machine. This suite drives the REAL app (the
// fake-sdk harness) through both sides of the exchange:
//
//   1. this window's fold/hide gesture writes the server row (and never
//      localStorage),
//   2. ANOTHER window's write lands here through the `family-state-changed`
//      signal and hydrates live,
//   3. this window's next gesture keeps the other window's field.
//
// The wallpaper document and the per-GROUP box fold still ride localStorage,
// so the wallpaper cross-window case stays here unchanged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeFamilyStateStore,
  fireRealtime,
  registeredNavPanel,
  seedFakeFamilyState,
  seedFakeThreads,
  stubFamilyStateWriteFailure,
} from "./helpers/app-fake-sdk";
import {
  COLLAPSED_FAMILIES_KEY,
  HIDE_IDLE_CHILDREN_KEY,
  WALLPAPER_KEY,
} from "../components/preferences";

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
    // Three families: A is this window's local actor, B the other window's,
    // C the witness that this window's later gesture keeps both.
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

/** The card's own child-section fold toggle, read through its aria-state. */
const foldToggle = (threadId: string): HTMLButtonElement => {
  const button = familyCard(threadId).querySelector(`button[data-child-threads-toggle]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing fold toggle on ${threadId}`);
  return button;
};

const expectsCollapsed = (threadId: string): boolean =>
  foldToggle(threadId).getAttribute("aria-label") === "Expand subthreads";

/** Local gesture: this window's own fold/unfold click (the real write path). */
function foldLocally(threadId: string, collapsed: boolean): void {
  const toggle = foldToggle(threadId);
  const label = collapsed ? "Collapse subthreads" : "Expand subthreads";
  if (toggle.getAttribute("aria-label") !== label) {
    throw new Error(`${threadId} toggle is not in the "${label}" state`);
  }
  fireEvent.click(toggle);
}

/** Local gesture: the idle-children eye toggle beside the fold toggle. */
const hideToggle = (threadId: string): HTMLButtonElement => {
  const button = familyCard(threadId).querySelector("button[data-idle-children-toggle]");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing hide toggle on ${threadId}`);
  return button;
};

function hideIdleLocally(threadId: string, hide: boolean): void {
  const toggle = hideToggle(threadId);
  const label = hide ? "Hide idle child threads" : "Show idle child threads";
  if (toggle.getAttribute("aria-label") !== label) {
    throw new Error(`${threadId} eye is not in the "${label}" state`);
  }
  fireEvent.click(toggle);
}

/**
 * The other machine/window's write, as this document receives it: the host
 * row changes and the `family-state-changed` signal reaches every open
 * window, which refetches through the coalescer.
 */
function otherWindowWrite(state: { collapsedFamilies: string[]; hideIdleChildren: string[] }): void {
  seedFakeFamilyState(state);
  fireRealtime("family-state-changed", { key: null, id: null, on: null });
}

async function mountBoard(): Promise<void> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  await waitFor(() =>
    expect(document.querySelector('[data-thread-card="thr_folda"]')).toBeTruthy(),
  );
  await waitFor(() => expect(foldToggle("thr_folda")).toBeTruthy());
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeFamilyState({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  seedFakeFamilyState({});
});

describe("family fold + idle-hide persistence (the server store)", () => {
  it("a fold writes the server row and never localStorage", async () => {
    await mountBoard();
    foldLocally("thr_folda", true);
    await waitFor(() =>
      expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_folda"]),
    );
    // The legacy localStorage key stays untouched — the fold is the server's.
    expect(window.localStorage.getItem(COLLAPSED_FAMILIES_KEY)).toBeNull();
    expect(window.localStorage.getItem(HIDE_IDLE_CHILDREN_KEY)).toBeNull();
  });

  it("another window's fold hydrates live and survives this window's next gesture", async () => {
    await mountBoard();
    foldLocally("thr_folda", true);
    await waitFor(() =>
      expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_folda"]),
    );
    // Side B (another window on the same server) folds family B.
    otherWindowWrite({ collapsedFamilies: ["thr_folda", "thr_foldb"], hideIdleChildren: [] });
    // Hydrated live: family B's rows folded here with no reload.
    await waitFor(() => expect(expectsCollapsed("thr_foldb")).toBe(true));
    // Side A folds family C. The server row keeps every field.
    foldLocally("thr_foldc", true);
    await waitFor(() =>
      expect(fakeFamilyStateStore().collapsedFamilies).toEqual([
        "thr_folda",
        "thr_foldb",
        "thr_foldc",
      ]),
    );
    expect(expectsCollapsed("thr_foldb")).toBe(true);
    expect(expectsCollapsed("thr_folda")).toBe(true);
  });

  it("another window's expansion hydrates live and is not re-added", async () => {
    await mountBoard();
    foldLocally("thr_folda", true);
    await waitFor(() =>
      expect(fakeFamilyStateStore().collapsedFamilies).toEqual(["thr_folda"]),
    );
    // Another window re-opens family A (an explicit removal this window never
    // made); the signal reaches us and the rows expand live.
    otherWindowWrite({ collapsedFamilies: [], hideIdleChildren: [] });
    await waitFor(() => expect(expectsCollapsed("thr_folda")).toBe(false));
  });

  it("an idle-hide toggle writes the server row and a remote hide hydrates live", async () => {
    await mountBoard();
    hideIdleLocally("thr_folda", true);
    await waitFor(() =>
      expect(fakeFamilyStateStore().hideIdleChildren).toEqual(["thr_folda"]),
    );
    otherWindowWrite({ collapsedFamilies: [], hideIdleChildren: ["thr_folda", "thr_foldb"] });
    await waitFor(() =>
      expect(hideToggle("thr_foldb").getAttribute("aria-label")).toBe("Show idle child threads"),
    );
    expect(window.localStorage.getItem(HIDE_IDLE_CHILDREN_KEY)).toBeNull();
  });

  it("a rejected fold write rolls the toggle back and surfaces the error", async () => {
    await mountBoard();
    stubFamilyStateWriteFailure("rpc input validation failed");
    foldLocally("thr_folda", true);
    // The optimistic fold is retracted to the server's truth...
    await waitFor(() => expect(expectsCollapsed("thr_folda")).toBe(false));
    // ...and the failure is named, never silent.
    await waitFor(() =>
      expect(document.querySelector('[data-testid="family-state-save-error"]')).toBeTruthy(),
    );
    expect(fakeFamilyStateStore().collapsedFamilies).toEqual([]);
  });

  it("another window's wallpaper paints this board live (localStorage, unchanged)", async () => {
    await mountBoard();
    const wallpaperDoc = { version: 1, global: { url: "https://example.com/w.png", dim: 0.4 } };
    // Window B (the plugin configuration page, say) sets a wallpaper; the
    // storage event reaches this document (jsdom cannot spawn a second living
    // document, so the event is dispatched with the payload a real one lands).
    const raw = JSON.stringify(wallpaperDoc);
    window.localStorage.setItem(WALLPAPER_KEY, raw);
    fireEvent(
      window,
      new StorageEvent("storage", {
        key: WALLPAPER_KEY,
        oldValue: null,
        newValue: raw,
        storageArea: window.localStorage,
      }),
    );
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("div")].some((div) =>
          (div.getAttribute("style") ?? "").includes("example.com/w.png"),
        ),
      ).toBe(true),
    );
  });
});
