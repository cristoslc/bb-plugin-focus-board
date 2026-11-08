// @vitest-environment jsdom
// The ungrouped view is a card GRID, not a one-lane board (issue #416): no
// column containers, no lane headers, no lane menu. The real app mounts
// against the fake host so the assertion covers the wiring the operator
// touches — the View menu's sort rows, the persistence, the card menu, the
// pane, and the filters — rather than the component in isolation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { GRID_SORT_KEY, GROUP_BY_KEY } from "../components/preferences";
import { registeredNavPanel, seedFakeThreads } from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Four threads whose three keys each read differently:
 *
 *   last activity  delta, bravo, alpha, charlie
 *   created        charlie, alpha, delta, bravo
 *   title          alpha, bravo, charlie, delta
 */
function fixtureThreads() {
  const now = Date.now();
  const t = (
    id: string,
    displayTitle: string,
    updatedAt: number,
    createdAt: number,
  ) => ({
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
    updatedAt: now - updatedAt * HOUR,
    createdAt: now - createdAt * HOUR,
    displayTitle,
    lastReadAt: now,
  });
  return [
    t("thr_alpha", "Alpha release notes", 3, 2),
    t("thr_bravo", "Bravo migration", 2, 9),
    t("thr_charlie", "Charlie refactor", 4, 1),
    t("thr_delta", "Delta dashboard", 1, 3),
  ];
}

function gridCardIds(): string[] {
  return [...document.querySelectorAll("[data-grid-card]")].map(
    (card) => card.getAttribute("data-grid-card") ?? "",
  );
}

function grid(): HTMLElement | null {
  return document.querySelector("[data-card-grid]");
}

async function mountApp(): Promise<void> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  await waitFor(() => expect(grid()).not.toBeNull());
}

function openViewMenu(): void {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="View"]');
  if (trigger === null) throw new Error("View menu trigger not found");
  fireEvent.click(trigger);
}

function pair(name: string): HTMLElement {
  return screen.getByRole("radiogroup", { name });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  window.localStorage.setItem(GROUP_BY_KEY, "none");
  seedFakeThreads(fixtureThreads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the ungrouped view's frame", () => {
  it("renders a grid of cards with no lane containers and no headers", async () => {
    await mountApp();

    expect(gridCardIds()).toHaveLength(4);
    // No lane: no column section, no lane header, no lane menu trigger, and
    // none of the lane vocabulary's names on screen.
    expect(document.querySelectorAll("[data-column-id]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-columns-board]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-lane-menu-trigger]")).toHaveLength(0);
    expect(screen.queryByText("Threads")).toBeNull();
  });

  it("keeps the lane board for every grouped view", async () => {
    window.localStorage.setItem(GROUP_BY_KEY, "status");
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-column-id]").length).toBeGreaterThan(0),
    );
    expect(grid()).toBeNull();
  });
});

describe("the grid's order", () => {
  it("starts on the board's standing read: last activity, newest first", async () => {
    await mountApp();
    expect(gridCardIds()).toEqual([
      "thr_delta",
      "thr_bravo",
      "thr_alpha",
      "thr_charlie",
    ]);
  });

  it("re-sorts in place from the View menu and stores the pick", async () => {
    await mountApp();
    openViewMenu();

    // Both of the grid's rows are in the menu, and the lane direction pair is
    // not: the grid has no lanes to run in either direction.
    expect(screen.queryByRole("radiogroup", { name: "Lane direction" })).toBeNull();
    fireEvent.click(
      within(pair("Sort by")).getByRole("radio", { name: "Alphabetical" }),
    );

    await waitFor(() =>
      expect(gridCardIds()).toEqual([
        "thr_alpha",
        "thr_bravo",
        "thr_charlie",
        "thr_delta",
      ]),
    );
    expect(window.localStorage.getItem(GRID_SORT_KEY)).toBe("title:asc");
    // The direction pair relabels for the key it now orders: A to Z / Z to A.
    expect(
      within(pair("Order"))
        .getByRole("radio", { name: "A to Z" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(within(pair("Order")).getByRole("radio", { name: "Z to A" }));
    await waitFor(() =>
      expect(gridCardIds()).toEqual([
        "thr_delta",
        "thr_charlie",
        "thr_bravo",
        "thr_alpha",
      ]),
    );
    expect(window.localStorage.getItem(GRID_SORT_KEY)).toBe("title:desc");
  });

  it("sorts by created date, newest first by default", async () => {
    await mountApp();
    openViewMenu();
    fireEvent.click(within(pair("Sort by")).getByRole("radio", { name: "Created" }));
    await waitFor(() =>
      expect(gridCardIds()).toEqual([
        "thr_charlie",
        "thr_alpha",
        "thr_delta",
        "thr_bravo",
      ]),
    );
    expect(window.localStorage.getItem(GRID_SORT_KEY)).toBe("created:desc");
    expect(
      within(pair("Order"))
        .getByRole("radio", { name: "Newest first" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a stored order lands at mount, before any menu opens", async () => {
    window.localStorage.setItem(GRID_SORT_KEY, "created:asc");
    await mountApp();
    await waitFor(() =>
      expect(gridCardIds()).toEqual([
        "thr_bravo",
        "thr_delta",
        "thr_alpha",
        "thr_charlie",
      ]),
    );
  });
});

describe("a card in the grid", () => {
  it("opens its thread in the pane on click", async () => {
    await mountApp();
    const card = document.querySelector('[data-grid-card="thr_alpha"] a');
    if (card === null) throw new Error("grid card not found");
    fireEvent.click(card);
    await waitFor(() =>
      expect(
        document.querySelector('aside[aria-label="Thread: Alpha release notes"]'),
      ).not.toBeNull(),
    );
  });

  it("closes the pane on a click in the empty grid, never on a card", async () => {
    await mountApp();
    const card = document.querySelector('[data-grid-card="thr_alpha"] a');
    if (card === null) throw new Error("grid card not found");
    fireEvent.click(card);
    const pane = await waitFor(() => {
      const found = document.querySelector('aside[aria-label="Thread: Alpha release notes"]');
      if (found === null) throw new Error("pane did not open");
      return found;
    });
    expect(pane).not.toBeNull();

    // A click on a card is not a background click: the pane stays.
    fireEvent.click(card);
    expect(document.querySelector('aside[aria-label^="Thread:"]')).not.toBeNull();

    const board = document.querySelector("[data-card-grid-board]");
    if (board === null) throw new Error("grid board not found");
    fireEvent.click(board);
    await waitFor(() =>
      expect(document.querySelector('aside[aria-label^="Thread:"]')).toBeNull(),
    );
  });

  it("opens the same context menu a lane card does", async () => {
    await mountApp();
    const card = document.querySelector('[data-grid-card="thr_bravo"] [data-thread-card]');
    if (card === null) throw new Error("grid card not found");
    fireEvent.contextMenu(card);
    const menu = await screen.findByRole("menu");
    const labels = [...menu.querySelectorAll('[role="menuitem"]')].map((item) =>
      item.textContent?.trim() ?? "",
    );
    expect(labels).toEqual(
      expect.arrayContaining(["Pin", "Mark Unread", "Mark Done", "Snooze…", "Archive"]),
    );
  });

  it("is not a drag source: a grid has no order for a lift to write", async () => {
    await mountApp();
    const anchor = document.querySelector('[data-grid-card="thr_alpha"] a');
    if (anchor === null) throw new Error("grid card anchor not found");
    expect(anchor.getAttribute("draggable")).toBe("false");
  });
});

describe("filters over the grid", () => {
  it("search narrows the cards the grid holds", async () => {
    await mountApp();
    const search = screen.getByLabelText("Search threads");
    fireEvent.change(search, { target: { value: "migration" } });
    await waitFor(() => expect(gridCardIds()).toEqual(["thr_bravo"]));
  });

  it("a state filter narrows the grid too", async () => {
    seedFakeThreads(
      fixtureThreads().map((thread) =>
        thread.id === "thr_delta" ? { ...thread, isUnread: true } : thread,
      ),
    );
    await mountApp();
    const stateFilter = screen.getByText(/State:/).closest("button");
    if (stateFilter === null) throw new Error("State filter trigger not found");
    fireEvent.click(stateFilter);
    fireEvent.click(screen.getByRole("option", { name: "Unread" }));
    await waitFor(() => expect(gridCardIds()).toEqual(["thr_delta"]));
  });
});
