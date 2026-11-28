// @vitest-environment jsdom
// The Done sweep's age gate, driven through the REAL app on the shape the
// operator reported (2026-11-28): a Done lane holding a whole batch of
// threads past the two-day threshold plus a batch marked Done hours ago, and
// a broom that "auto-arms ALL Done issues".
//
// The arm is filtered by `doneArchiveMs` (lib/sweep's
// sweepCandidatesForDoneColumn); these pins hold that filter on every door
// the operator can open a Done sweep through, and on both boards:
//
// 1. The Focus lane's pill proposes only the past-threshold threads, and
//    arming it highlights exactly those — the fresh, kept, and live-child
//    cards stay unhighlighted.
// 2. The lane menu's "Sweep this lane…" — the manual door on the same lane —
//    arms the same set, because both doors call the app's one arm path.
// 3. The Parent view's Done row rail runs the same law over every family
//    lane: its pill counts only the past-threshold cards and arming lights
//    only those.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeDone,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function sidebarThread(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  return {
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null,
    hasPendingInteraction: false,
    lastReadAt: now - 3 * DAY,
    createdAt: 0,
    updatedAt: now - 3 * DAY,
    displayTitle: String(overrides.id ?? "thread"),
    ...overrides,
  };
}

function doneAgo(ms: number, keep = false): { doneAt: string; keep?: boolean } {
  const record: { doneAt: string; keep?: boolean } = {
    doneAt: new Date(Date.now() - ms).toISOString(),
  };
  if (keep) record.keep = true;
  return record;
}

/** The reported shape: a batch past the threshold, a fresh batch, a kept
 *  thread, and a done parent whose child is still live. */
function liveShapedDoneLane(): {
  threads: Record<string, unknown>[];
  records: Record<string, { doneAt: string; keep?: boolean }>;
} {
  const threads = [
    sidebarThread({ id: "thr_aged_1" }),
    sidebarThread({ id: "thr_aged_2" }),
    sidebarThread({ id: "thr_aged_3" }),
    sidebarThread({ id: "thr_fresh_minutes" }),
    sidebarThread({ id: "thr_fresh_hours" }),
    sidebarThread({ id: "thr_kept" }),
    sidebarThread({ id: "thr_parent" }),
    sidebarThread({ id: "thr_live_child", parentThreadId: "thr_parent", updatedAt: Date.now() - HOUR }),
  ];
  const records = {
    thr_aged_1: doneAgo(2.1 * DAY),
    thr_aged_2: doneAgo(2.5 * DAY),
    thr_aged_3: doneAgo(4 * DAY),
    thr_fresh_minutes: doneAgo(5 * 60_000),
    thr_fresh_hours: doneAgo(3 * HOUR),
    thr_kept: doneAgo(3 * DAY, true),
    thr_parent: doneAgo(6 * DAY),
  };
  return { threads, records };
}

const AGED_IDS = ["thr_aged_1", "thr_aged_2", "thr_aged_3"];

function mount(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

function lane(columnId: string): HTMLElement {
  const section = document.querySelector<HTMLElement>(`section[data-column-id="${columnId}"]`);
  if (section === null) throw new Error(`no lane ${columnId}`);
  return section;
}

function lanePill(columnId: string): HTMLButtonElement | null {
  return lane(columnId).querySelector<HTMLButtonElement>("[data-sweep-button]");
}

function highlightedIds(): string[] {
  return [...document.querySelectorAll("[data-sweep-highlighted]")]
    .map((card) => card.getAttribute("data-thread-card"))
    .filter((id): id is string => id !== null)
    .sort();
}

function isHighlighted(threadId: string): boolean {
  return document
    .querySelector(`[data-thread-card="${threadId}"]`)
    ?.hasAttribute("data-sweep-highlighted") ?? false;
}

function laneMenuTrigger(columnId: string): HTMLElement {
  const trigger = lane(columnId).querySelector<HTMLElement>("button[data-lane-menu-trigger]");
  if (trigger === null) throw new Error(`no lane menu trigger in ${columnId}`);
  return trigger;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  resetFakeRpcCalls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Done lane's age gate holds on the live-shaped lane", () => {
  it("proposes only the past-threshold threads and arms exactly those", async () => {
    const { threads, records } = liveShapedDoneLane();
    seedFakeThreads(threads);
    seedFakeDone(Object.keys(records), records);
    mount();

    await waitFor(() => expect(lanePill("done")?.textContent).toBe("3"));
    // The lane's own count is larger than the proposal: the fresh batch, the
    // kept thread, and the live-child parent are all Done cards the arm
    // leaves out.
    expect(lane("done").querySelectorAll("[data-thread-card]").length).toBeGreaterThan(3);

    fireEvent.click(lanePill("done") as HTMLElement);
    await waitFor(() => expect(lanePill("done")?.textContent).toBe("3 → Archive"));
    expect(highlightedIds()).toEqual(AGED_IDS);

    // The inverse assertions: every Done card inside the threshold stays
    // unhighlighted, and so do the two excluded past-threshold shapes.
    expect(isHighlighted("thr_fresh_minutes")).toBe(false);
    expect(isHighlighted("thr_fresh_hours")).toBe(false);
    expect(isHighlighted("thr_kept")).toBe(false);
    expect(isHighlighted("thr_parent")).toBe(false);
  });

  it("arms the same past-threshold set from the lane menu's manual door", async () => {
    const { threads, records } = liveShapedDoneLane();
    seedFakeThreads(threads);
    seedFakeDone(Object.keys(records), records);
    mount();

    await waitFor(() => expect(lane("done")).not.toBeNull());
    fireEvent.click(laneMenuTrigger("done"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sweep this lane…" }));
    await waitFor(() => expect(lanePill("done")?.textContent).toBe("3 → Archive"));
    expect(highlightedIds()).toEqual(AGED_IDS);
  });
});

describe("the armed Done lane names the age it filtered on", () => {
  it("labels a Done card with its Done age, not its last activity", async () => {
    // The operator's report (2026-11-28) read off the cards: an armed Done
    // card showing "23m ago" is younger than the 2-day sweep age. The age
    // gate filters on the Done stamp, but the card painted the thread's last
    // activity, so a correctly armed card claimed to be young. The two live
    // examples (thr_by4i6v9n6b, thr_e8rfjse49w) were Done 60h and 95h ago
    // while their activity was 23 and 25 minutes old.
    const now = Date.now();
    seedFakeThreads([
      sidebarThread({ id: "thr_long_done", updatedAt: now - 23 * 60_000 }),
      sidebarThread({ id: "thr_fresh_done", updatedAt: now - 20 * 60_000 }),
    ]);
    seedFakeDone(["thr_long_done", "thr_fresh_done"], {
      thr_long_done: doneAgo(2.5 * DAY),
      thr_fresh_done: doneAgo(20 * 60_000),
    });
    mount();

    await waitFor(() => expect(lanePill("done")?.textContent).toBe("1"));
    fireEvent.click(lanePill("done") as HTMLElement);
    await waitFor(() => expect(lanePill("done")?.textContent).toBe("1 → Archive"));

    const armedAge = document.querySelector<HTMLElement>(
      '[data-thread-card="thr_long_done"] [data-age]',
    );
    expect(armedAge?.getAttribute("data-age-source")).toBe("done");
    expect(armedAge?.textContent).toBe("Done 2d ago");
    // The activity clock stays one hover away, so the label never loses it.
    expect(armedAge?.getAttribute("title")).toContain("last active 23m ago");

    // The card the arm left out says how young it is on the same clock.
    const freshAge = document.querySelector<HTMLElement>(
      '[data-thread-card="thr_fresh_done"] [data-age]',
    );
    expect(freshAge?.textContent).toBe("Done 20m ago");
    expect(isHighlighted("thr_fresh_done")).toBe(false);
  });
});

describe("the Parent view's Done row sweeps only the cards it renders", () => {
  it("keeps the cards behind a lane's +N chip out of the arm", async () => {
    const now = Date.now();
    // Family A locks first (its parent was touched most recently) and holds
    // two aged Done children, all rendered: a ruler lane never chips. Family B
    // is a context lane whose twelve aged Done children overflow its band, so
    // the tail renders as a "+3 more" cell with no card to click.
    const threads = [
      sidebarThread({ id: "thr_family_a", updatedAt: now - HOUR }),
      sidebarThread({ id: "thr_a_0", parentThreadId: "thr_family_a" }),
      sidebarThread({ id: "thr_a_1", parentThreadId: "thr_family_a" }),
      sidebarThread({ id: "thr_family_b", updatedAt: now - 5 * DAY }),
    ];
    const records: Record<string, { doneAt: string; keep?: boolean }> = {
      thr_a_0: doneAgo(2.5 * DAY),
      thr_a_1: doneAgo(2.6 * DAY),
    };
    for (let i = 0; i < 12; i += 1) {
      const id = `thr_b_${i}`;
      threads.push(sidebarThread({ id, parentThreadId: "thr_family_b" }));
      records[id] = doneAgo((2.5 + i * 0.1) * DAY);
    }
    seedFakeThreads(threads);
    seedFakeDone(Object.keys(records), records);
    window.localStorage.setItem("focus-board:groupBy", "parent");
    mount();

    await waitFor(() => expect(document.querySelector("[data-parent-board]")).not.toBeNull());
    const railRow = document.querySelector<HTMLElement>('[data-rail-row="done"]');
    const pill = railRow?.querySelector<HTMLButtonElement>("[data-sweep-button]") ?? null;
    expect(pill).not.toBeNull();
    // The chip is the proof that some cards sit outside the operator's reach.
    const chip = await waitFor(() => {
      const node = [...document.querySelectorAll("[data-parent-board] [data-cell]")].find(
        (cell) => /^\+\d+ more$/.test(cell.firstElementChild?.textContent ?? "") ||
          /^\+\d+ more$/.test(cell.textContent?.trim() ?? ""),
      );
      if (node === undefined) throw new Error("no +N more chip on the Done row");
      return node;
    });
    const chipCount = Number((chip.textContent ?? "").match(/\d+/)?.[0] ?? "0");
    expect(chipCount).toBeGreaterThan(0);
    const renderedIds = [
      ...document.querySelectorAll('[data-band="done"] [data-thread-card]'),
    ]
      .map((card) => card.getAttribute("data-thread-card"))
      .filter((id): id is string => id !== null);
    // Fourteen aged Done cards exist; the chip hides part of the row.
    expect(renderedIds.length + chipCount).toBe(14);
    expect(renderedIds).toHaveLength(14 - chipCount);
    // The pill proposes exactly the cards the row renders.
    await waitFor(() => expect(pill?.textContent).toBe(String(renderedIds.length)));

    fireEvent.click(pill as HTMLElement);
    await waitFor(() => expect(pill?.textContent).toBe(`${renderedIds.length} → Archive`));
    expect(highlightedIds()).toEqual([...renderedIds].sort());
  });
});

describe("the Parent view's Done row runs the same age gate", () => {
  it("counts and lights only the past-threshold cards across family lanes", async () => {
    // Two families, each with an aged-out Done child and one marked Done an
    // hour ago: the row's rail must propose two, not four.
    const threads = [
      sidebarThread({ id: "thr_family_a" }),
      sidebarThread({ id: "thr_family_b" }),
      sidebarThread({ id: "thr_a_aged", parentThreadId: "thr_family_a" }),
      sidebarThread({ id: "thr_a_fresh", parentThreadId: "thr_family_a" }),
      sidebarThread({ id: "thr_b_aged", parentThreadId: "thr_family_b" }),
      sidebarThread({ id: "thr_b_fresh", parentThreadId: "thr_family_b" }),
    ];
    const records = {
      thr_a_aged: doneAgo(2.5 * DAY),
      thr_a_fresh: doneAgo(10 * 60_000),
      thr_b_aged: doneAgo(3 * DAY),
      thr_b_fresh: doneAgo(HOUR),
    };
    seedFakeThreads(threads);
    seedFakeDone(Object.keys(records), records);
    window.localStorage.setItem("focus-board:groupBy", "parent");
    mount();

    await waitFor(() => expect(document.querySelector("[data-parent-board]")).not.toBeNull());
    const railRow = document.querySelector<HTMLElement>('[data-rail-row="done"]');
    expect(railRow).not.toBeNull();
    const pill = railRow?.querySelector<HTMLButtonElement>("[data-sweep-button]") ?? null;
    expect(pill).not.toBeNull();
    await waitFor(() => expect(pill?.textContent).toBe("2"));

    fireEvent.click(pill as HTMLElement);
    await waitFor(() => expect(pill?.textContent).toBe("2 → Archive"));
    expect(highlightedIds()).toEqual(["thr_a_aged", "thr_b_aged"]);
    expect(isHighlighted("thr_a_fresh")).toBe(false);
    expect(isHighlighted("thr_b_fresh")).toBe(false);
  });
});
