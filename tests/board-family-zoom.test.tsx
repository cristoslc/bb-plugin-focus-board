// @vitest-environment jsdom
// The card menu's "Zoom to family" gesture (issue #170): choosing it
// switches the board to the Parent view (`groupBy: "parent"`) with the
// filter scoped to the acted-on family — the thread itself plus its nested
// children, nothing else. The scoping rides the filter surface (a toolbar
// chip that names the family and clears), persists like every other filter
// field, and zooms from a nested child row to the family's OWNER, never a
// sub-child. A card without a multi-member family offers no entry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { registeredNavPanel, seedFakeThreads } from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
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
      id: "thr_parent",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - HOUR,
      displayTitle: "Family epic",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      id: "thr_child",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: "thr_parent",
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Family child",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      // A second family: the Parent view's clearing witness — loose
      // unparented threads render no lane there, so only another family
      // proves the unfiltered Parent view came back.
      id: "thr_fam2",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 4 * HOUR,
      displayTitle: "Second family",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      id: "thr_fam2_child",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: "thr_fam2",
      hasPendingInteraction: false,
      updatedAt: now - 5 * HOUR,
      displayTitle: "Second family child",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      id: "thr_other",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 3 * HOUR,
      displayTitle: "Unrelated thread",
      lastReadAt: null,
      createdAt: 0,
    },
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

/** Right-click the card or nested row's title anchor and choose the zoom.
 *  A nested row IS the anchor (an <a data-thread-card>); a card's is inside. */
async function zoomFrom(threadId: string): Promise<void> {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  const anchor =
    card instanceof HTMLAnchorElement ? card : card.querySelector("a");
  if (anchor === null) throw new Error(`missing title anchor on ${threadId}`);
  fireEvent.contextMenu(anchor);
  const menus = screen.getAllByRole("menu");
  const entry = within(menus[0] as HTMLElement).getByText("Zoom to family");
  fireEvent.click(entry.closest('[role="menuitem"]') ?? entry);
}

describe("card menu Zoom to family (issue #170)", () => {
  it("the gesture lands the Parent view showing only the acted-on family", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(document.querySelector('[data-thread-card="thr_parent"]')).toBeTruthy());

    await zoomFrom("thr_parent");
    await waitFor(() => expect(document.querySelector("[data-parent-board]")).toBeTruthy());
    // The zoomed family stays; everything else drops off the board. On the
    // Parent view the family's root thread IS its lane (the lane header
    // names it); its child renders as a card row inside the lane.
    await waitFor(() =>
      expect(document.querySelector('[data-thread-card="thr_other"]')).toBeNull(),
    );
    expect(document.querySelector('[data-lane-id="thr_parent"]')).toBeTruthy();
    expect(document.querySelector('[data-lane-id="thr_fam2"]')).toBeNull();
    expect(document.querySelector('[data-thread-card="thr_child"]')).toBeTruthy();
    // The scope is a filter write plus the Parent view switch, both persisted
    // the way every other filter field and grouping is.
    await waitFor(() =>
      expect(window.localStorage.getItem("focus-board:filter:family")).toBe("thr_parent"),
    );
    expect(window.localStorage.getItem("focus-board:groupBy")).toBe("parent");
  });

  it("a nested child row zooms to the family that OWNS it, never to a sub-child", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(document.querySelector('[data-thread-card="thr_child"]')).toBeTruthy());

    await zoomFrom("thr_child");
    // The scope names thr_parent (the family root), and the whole family
    // renders on the Parent view.
    await waitFor(() =>
      expect(window.localStorage.getItem("focus-board:filter:family")).toBe("thr_parent"),
    );
    expect(window.localStorage.getItem("focus-board:groupBy")).toBe("parent");
    await waitFor(() =>
      expect(document.querySelector('[data-lane-id="thr_fam2"]')).toBeNull(),
    );
    expect(document.querySelector('[data-lane-id="thr_parent"]')).toBeTruthy();
  });

  it("a card without nested children offers no zoom entry", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(document.querySelector('[data-thread-card="thr_other"]')).toBeTruthy());

    const anchor = document
      .querySelector('[data-thread-card="thr_other"]')
      ?.querySelector("a") as HTMLElement | null;
    if (anchor === null) throw new Error("missing title anchor on thr_other");
    fireEvent.contextMenu(anchor);
    const menu = screen.getAllByRole("menu")[0] as HTMLElement;
    expect(within(menu).queryByText("Zoom to family")).toBeNull();
  });

  it("the toolbar chip names the family and clears it, restoring the unfiltered Parent view", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(document.querySelector('[data-thread-card="thr_parent"]')).toBeTruthy());

    await zoomFrom("thr_parent");
    const chip = await waitFor(
      () => document.querySelector("[data-family-scope-chip]") as HTMLElement | null,
    );
    if (chip === null) throw new Error("missing family-scope chip");
    expect(chip.textContent).toContain("Family epic");

    fireEvent.click(within(chip).getByRole("button", { name: /Clear family zoom/ }));
    // The view stays Parent; the unfiltered board returns — the Second
    // family's lane is back.
    expect(document.querySelector("[data-parent-board]")).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('[data-lane-id="thr_fam2"]')).toBeTruthy(),
    );
    expect(window.localStorage.getItem("focus-board:filter:family")).toBe("");
  });

  it("the scoping survives a remount (page refresh)", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(document.querySelector('[data-thread-card="thr_parent"]')).toBeTruthy());

    await zoomFrom("thr_parent");
    cleanup();
    render(<Component subPath="" />);
    // The readiness gate (issue #403) holds the remount's first paint until
    // the mount fan-in settles; the preserved law is that the state lands:
    // the scoped view returns from storage (fam2's lane stays absent).
    await waitFor(() => expect(document.querySelector("[data-parent-board]")).toBeTruthy());
    expect(document.querySelector('[data-lane-id="thr_fam2"]')).toBeNull();
    expect(document.querySelector('[data-lane-id="thr_parent"]')).toBeTruthy();
    expect(document.querySelector('[data-thread-card="thr_child"]')).toBeTruthy();
  });
});