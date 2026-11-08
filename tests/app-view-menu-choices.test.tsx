// @vitest-environment jsdom
// The View menu's two structural choices drive the real board, end to end:
// a lane-direction pick re-lays the open board (no reload) and persists to
// the one stored preference the Appearance tab and the `?laneDirection=`
// harness seed already write; a nesting pick flips the family rows and
// persists to the nesting key. A stored value lands at mount, before any
// menu is opened, so the seed path stays authoritative.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { LANE_DIRECTION_KEY, NEST_CHILDREN_KEY } from "../components/preferences";
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
  const t = (
    id: string,
    displayTitle: string,
    updatedAt: number,
    parentThreadId: string | null,
  ) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "unread",
    isUnread: true,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle,
    lastReadAt: updatedAt,
    createdAt: 0,
  });
  return [
    t("thr_vm_root", "Family root", now - 1 * HOUR, null),
    t("thr_vm_child", "Family child", now - 2 * HOUR, "thr_vm_root"),
  ];
}

function board(): HTMLElement | null {
  return document.querySelector("[data-lane-direction]");
}

function laneDirectionOnBoard(): string | null {
  return board()?.getAttribute("data-lane-direction") ?? null;
}

function familyRows(): Element | null {
  return document.querySelector("[data-child-thread-section]");
}

async function mountApp(): Promise<void> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  await waitFor(() => expect(board()).not.toBeNull());
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
  seedFakeThreads(fixtureThreads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the View menu's lane direction pick", () => {
  it("re-lays the board live and persists the choice", async () => {
    window.localStorage.setItem(LANE_DIRECTION_KEY, "vertical");
    await mountApp();
    await waitFor(() => expect(laneDirectionOnBoard()).toBe("vertical"));

    openViewMenu();
    expect(
      within(pair("Lane direction"))
        .getByRole("radio", { name: "Vertical" })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(within(pair("Lane direction")).getByRole("radio", { name: "Horizontal" }));

    // Live, no reload: the board re-lays as the row board.
    await waitFor(() => expect(laneDirectionOnBoard()).toBe("horizontal"));
    expect(window.localStorage.getItem(LANE_DIRECTION_KEY)).toBe("horizontal");
    // The pair follows the board, still inside the open menu.
    expect(
      within(pair("Lane direction"))
        .getByRole("radio", { name: "Horizontal" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("the View menu's nesting pick", () => {
  it("flattens the family live and persists Off", async () => {
    await mountApp();
    await waitFor(() => expect(familyRows()).not.toBeNull());

    openViewMenu();
    fireEvent.click(within(pair("Nest child threads")).getByRole("radio", { name: "Off" }));

    await waitFor(() => expect(familyRows()).toBeNull());
    expect(window.localStorage.getItem(NEST_CHILDREN_KEY)).toBe("off");

    fireEvent.click(within(pair("Nest child threads")).getByRole("radio", { name: "On" }));
    await waitFor(() => expect(familyRows()).not.toBeNull());
    expect(window.localStorage.getItem(NEST_CHILDREN_KEY)).toBe("on");
  });
});

describe("the stored choices at mount", () => {
  it("the seed wins before any menu opens", async () => {
    window.localStorage.setItem(LANE_DIRECTION_KEY, "horizontal");
    window.localStorage.setItem(NEST_CHILDREN_KEY, "off");
    await mountApp();

    await waitFor(() => expect(laneDirectionOnBoard()).toBe("horizontal"));
    // A flat board: the child renders as its own card, not a family row.
    expect(familyRows()).toBeNull();

    openViewMenu();
    expect(
      within(pair("Lane direction"))
        .getByRole("radio", { name: "Horizontal" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      within(pair("Nest child threads"))
        .getByRole("radio", { name: "Off" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
