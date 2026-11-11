// @vitest-environment jsdom
// The operator's ruling (2026-11-11), pinned through the REAL app: the board
// is filtered to one feature group, and a family whose parent sits in that
// group renders WHOLE — the child that lives in another group keeps its row
// inside the parent's card, with its state dot and its own click target. The
// child is never hoisted into its own group's lane, and a family whose parent
// sits in another group stays absent. This is the app-level half of the
// report (`tests/group-filter-family-keep.test.ts` pins the assembly half);
// before the fix the keep pass dropped the cross-group child, so the filtered
// card rendered with a missing row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { registeredNavPanel, seedFakeGroups, seedFakeThreads } from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
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
      id: "thr_orchestrator",
      projectId: "proj_a",
      providerId: "pi",
      status: "active",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - HOUR,
      displayTitle: "Orchestrator",
      lastReadAt: now - 2 * HOUR,
      createdAt: 0,
    },
    {
      id: "thr_same_child",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: "thr_orchestrator",
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Alpha child",
      lastReadAt: now - 2 * HOUR,
      createdAt: 0,
    },
    {
      id: "thr_cross_child",
      projectId: "proj_a",
      providerId: "pi",
      status: "active",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: "thr_orchestrator",
      hasPendingInteraction: false,
      updatedAt: now - 3 * HOUR,
      displayTitle: "Beta child",
      lastReadAt: now - 3 * HOUR,
      createdAt: 0,
    },
    {
      id: "thr_beta_loner",
      projectId: "proj_a",
      providerId: "pi",
      status: "active",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 4 * HOUR,
      displayTitle: "Beta loner",
      lastReadAt: now - 4 * HOUR,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeGroups(
    {
      grp_alpha: { name: "Alpha rework", createdAt: new Date().toISOString() },
      grp_beta: { name: "Beta rework", createdAt: new Date().toISOString() },
    },
    {
      thr_orchestrator: "grp_alpha",
      thr_same_child: "grp_alpha",
      thr_cross_child: "grp_beta",
      thr_beta_loner: "grp_beta",
    },
  );
  // Land the board on the Group view, restricted to Alpha — the filtered
  // Group board the report describes.
  window.localStorage.setItem("focus-board:groupBy", "group");
  window.localStorage.setItem("focus-board:filter:groups", JSON.stringify(["grp_alpha"]));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (id: string): Element | null => document.querySelector(`[data-thread-card="${id}"]`);

function renderedCardIds(): string[] {
  return [...document.querySelectorAll("[data-thread-card]")].map((el) =>
    el.getAttribute("data-thread-card"),
  );
}

describe("a Group-filtered board keeps a matched family whole", () => {
  it("renders the cross-group child as a row inside the parent's card, with its dot", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => {
      if (card("thr_orchestrator") === null) throw new Error("board not mounted yet");
    });

    // The Alpha column stands with the parent on it.
    const alpha = document.querySelector('section[data-column-id="grp_alpha"]');
    expect(alpha).not.toBeNull();
    expect(alpha?.querySelector('[data-thread-card="thr_orchestrator"]')).not.toBeNull();

    // BOTH children ride the card — the Alpha child and the Beta child that
    // the group filter alone would have dropped.
    const rows = card("thr_orchestrator")?.querySelector("[data-nested-rows]");
    expect(rows).not.toBeNull();
    expect(rows?.querySelector('[data-thread-card="thr_same_child"]')).not.toBeNull();
    const crossRow = rows?.querySelector('[data-thread-card="thr_cross_child"]');
    expect(crossRow).not.toBeNull();
    // Fully present: its working dot and its own click target (the row is the
    // thread anchor the other rows are), not a placeholder or a disabled row.
    expect(crossRow?.querySelector(".bg-blue-500")).not.toBeNull();
    expect(crossRow?.tagName).toBe("A");
    expect(crossRow?.textContent).toContain("Beta child");
    expect(card("thr_orchestrator")?.textContent).toContain("2 child threads");
  });

  it("never hoists the child into its own group's lane or a second card", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => {
      if (card("thr_orchestrator") === null) throw new Error("board not mounted yet");
    });

    // The Beta lane is off the board (the filter excluded it), and the child
    // holds exactly one appearance: the row.
    expect(document.querySelector('section[data-column-id="grp_beta"]')).toBeNull();
    expect(renderedCardIds()).not.toContain("thr_beta_loner");
    expect(document.querySelectorAll('[data-thread-card="thr_cross_child"]')).toHaveLength(1);
  });

  it("keeps a family whose parent sits in another group off the board", async () => {
    window.localStorage.setItem("focus-board:filter:groups", JSON.stringify(["grp_beta"]));
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => {
      if (card("thr_beta_loner") === null) throw new Error("board not mounted yet");
    });

    // The Alpha family's parent does not match the filter, so the family card
    // stays absent — children alone never pull a parent in.
    expect(card("thr_orchestrator")).toBeNull();
    expect(document.querySelector('section[data-column-id="grp_alpha"]')).toBeNull();
    // The matching Beta child keeps standing on its own (per-thread, exactly
    // as before this change) while the Alpha child drops with its filter miss.
    expect(card("thr_cross_child")).not.toBeNull();
    expect(card("thr_beta_loner")).not.toBeNull();
    expect(card("thr_same_child")).toBeNull();
  });
});
