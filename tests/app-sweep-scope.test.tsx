// @vitest-environment jsdom
// A sweep may only act on cards the operator can inspect. The Parent view
// reaches that by scoping a row to the cards the layout renders (a context
// lane's "+N more" chip hides the rest, pinned in app-sweep-done-age.test.tsx).
// The Focus view has one hiding mechanism of its own: a FOLDED group box
// renders one group card in place of its members. Those members have no card
// to highlight or click away, so the Done lane's pill must not count them and
// its arm must not carry them. Driven end to end through the real app, the
// same shape #539 established for the age gate.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRpcCalls,
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeDone,
  seedFakeGroups,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const DAY = 24 * 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function sidebarThread(id: string): Record<string, unknown> {
  const now = Date.now();
  return {
    id,
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
    displayTitle: id,
  };
}

function doneAgo(ms: number): { doneAt: string } {
  return { doneAt: new Date(Date.now() - ms).toISOString() };
}

function mount(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

function donePill(): HTMLButtonElement | null {
  const section = document.querySelector<HTMLElement>('section[data-column-id="done"]');
  return section?.querySelector<HTMLButtonElement>("[data-sweep-button]") ?? null;
}

function highlightedIds(): string[] {
  return [...document.querySelectorAll("[data-sweep-highlighted]")]
    .map((card) => card.getAttribute("data-thread-card"))
    .filter((id): id is string => id !== null)
    .sort();
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

describe("a folded group box keeps its members out of the Done lane's sweep", () => {
  it("counts and arms only the cards the lane renders", async () => {
    // Three aged Done cards sit inside one group; the operator folded that
    // box, so the lane draws one group card instead of the three threads.
    // A fourth aged card stands alone, outside any box.
    const grouped = ["thr_g1", "thr_g2", "thr_g3"];
    seedFakeThreads([...grouped, "thr_solo"].map(sidebarThread));
    seedFakeDone([...grouped, "thr_solo"], {
      thr_g1: doneAgo(3 * DAY),
      thr_g2: doneAgo(3.1 * DAY),
      thr_g3: doneAgo(3.2 * DAY),
      thr_solo: doneAgo(2.5 * DAY),
    });
    seedFakeGroups(
      { grp_1: { name: "Group 1", createdAt: new Date(0).toISOString() } },
      { thr_g1: "grp_1", thr_g2: "grp_1", thr_g3: "grp_1" },
    );
    window.localStorage.setItem("focus-board:collapsedGroups", JSON.stringify(["grp_1"]));
    mount();

    // The fold is up: no member card renders, only the group's own card.
    await waitFor(() => expect(document.querySelector('[data-thread-card="thr_solo"]')).not.toBeNull());
    for (const id of grouped) {
      expect(document.querySelector(`[data-thread-card="${id}"]`)).toBeNull();
    }
    expect(document.querySelector('[data-collapsed-group-card="grp_1"]')).not.toBeNull();

    // The pill proposes the one card on screen, not the four Done threads.
    await waitFor(() => expect(donePill()?.textContent).toBe("1"));
    fireEvent.click(donePill() as HTMLElement);
    await waitFor(() => expect(donePill()?.textContent).toBe("1 → Archive"));
    expect(highlightedIds()).toEqual(["thr_solo"]);
  });
});

describe("an armed sweep never outruns the cards on screen", () => {
  it("drops the cards a box folds away after arming, and says they stayed armed", async () => {
    // Four long-idle threads, three of them in one group. The box is expanded
    // at arm time, so the pill proposes all four; folding it afterwards hides
    // the three members. Confirm must not mark a card the operator can no
    // longer see, click, or click away.
    const grouped = ["thr_i1", "thr_i2", "thr_i3"];
    const idleThread = (id: string): Record<string, unknown> => {
      const now = Date.now();
      return {
        id,
        projectId: "proj_a",
        providerId: "pi",
        status: "idle",
        isUnread: false,
        isPinned: false,
        isArchived: false,
        isHidden: false,
        parentThreadId: null,
        hasPendingInteraction: false,
        lastReadAt: now - 40 * DAY,
        createdAt: 0,
        updatedAt: now - 40 * DAY,
        displayTitle: id,
      };
    };
    seedFakeThreads([...grouped, "thr_i_solo"].map(idleThread));
    seedFakeGroups(
      { grp_1: { name: "Group 1", createdAt: new Date(0).toISOString() } },
      { thr_i1: "grp_1", thr_i2: "grp_1", thr_i3: "grp_1" },
    );
    window.localStorage.setItem("focus-board:nestChildren", "off");
    mount();

    // The lane holding the idle threads (an idle bucket, so it preselects).
    const lane = await waitFor(() => {
      const section = document
        .querySelector('[data-thread-card="thr_i1"]')
        ?.closest<HTMLElement>("section[data-column-id]");
      if (section === null || section === undefined) throw new Error("no idle lane");
      return section;
    });
    const pill = (): HTMLButtonElement | null =>
      lane.querySelector<HTMLButtonElement>("[data-sweep-button]");

    await waitFor(() => expect(pill()?.textContent).toBe("4"));
    fireEvent.click(pill() as HTMLElement);
    await waitFor(() => expect(pill()?.textContent).toBe("4 → Done"));

    // Fold the box while armed: the three member cards leave the DOM. The
    // armed selection keeps its count (it is the operator's own frozen set),
    // but confirm must not mark a card with no card on screen.
    fireEvent.click(
      document.querySelector('[data-group-box-collapse="grp_1"]') as HTMLElement,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-thread-card="thr_i1"]')).toBeNull(),
    );
    expect(pill()?.textContent).toBe("4 → Done");

    fireEvent.click(pill() as HTMLElement);
    await waitFor(() => {
      const calls = fakeRpcCalls().filter((call) => call.method === "done_set");
      expect(calls).toEqual([
        { method: "done_set", args: { threadId: "thr_i_solo", done: true } },
      ]);
    });
    // The difference is named, not silently swallowed: the three hidden cards
    // stay armed for the view that shows them again.
    await waitFor(() =>
      expect(document.querySelector('[data-testid="sweep-notice"]')?.textContent).toContain(
        'Swept 1 to Done. 3 armed threads are hidden by a "+N more" chip or a folded box, so they stay armed.',
      ),
    );
  });
});
