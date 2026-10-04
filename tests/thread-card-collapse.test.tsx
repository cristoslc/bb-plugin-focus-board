// @vitest-environment jsdom
// Collapsible nested children on a family card. Collapsing hides the nested
// rows and leaves a labeled "N child threads" affordance that re-opens them;
// the collapsed state itself is controlled (persisted by the caller), with an
// uncontrolled local fallback for callers that do not persist.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

function family(): { parent: PluginSidebarThread; children: PluginSidebarThread[] } {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: 5000 }),
    children: [
      thread({ id: "thr_c1", parentThreadId: "thr_parent", displayTitle: "Child one", updatedAt: 4000 }),
      thread({ id: "thr_c2", parentThreadId: "thr_parent", displayTitle: "Child two", updatedAt: 3000 }),
    ],
  };
}

type CardProps = Parameters<typeof ThreadCard>[0];

function renderCard(overrides: Partial<CardProps> = {}) {
  const { parent, children } = family();
  const props = {
    thread: parent,
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    childThreads: children,
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

/** The card's collapse chevron, by its aria label. */
function chevron(collapsed: boolean): HTMLElement {
  const button = document.querySelector(
    `button[aria-label="${collapsed ? "Expand subthreads" : "Collapse subthreads"}"]`,
  );
  if (!(button instanceof HTMLElement)) throw new Error("missing collapse chevron");
  return button;
}

/** The collapsed "N child threads" summary, by its marker. */
function summary(): HTMLElement {
  const button = document.querySelector("[data-child-threads-summary]");
  if (!(button instanceof HTMLElement)) throw new Error("missing collapsed summary");
  return button;
}

function row(id: string): HTMLElement | null {
  return document.querySelector(`[data-thread-card="${id}"]`);
}

afterEach(cleanup);

describe("uncontrolled collapse (callers without persistence)", () => {
  it("renders the nested rows expanded by default", () => {
    renderCard();
    expect(row("thr_c1")).not.toBeNull();
    expect(row("thr_c2")).not.toBeNull();
    expect(document.querySelector("[data-child-threads-summary]")).toBeNull();
  });

  it("the chevron collapses the rows into a labeled summary", () => {
    renderCard();
    fireEvent.click(chevron(false));
    expect(row("thr_c1")).toBeNull();
    expect(row("thr_c2")).toBeNull();
    expect(summary().textContent).toContain("2 child threads");
  });

  it("clicking the summary re-expands the rows", () => {
    renderCard();
    fireEvent.click(chevron(false));
    fireEvent.click(summary());
    expect(row("thr_c1")).not.toBeNull();
    expect(row("thr_c2")).not.toBeNull();
    expect(document.querySelector("[data-child-threads-summary]")).toBeNull();
  });

  it("one child reads singular: 1 child thread", () => {
    const { children } = family();
    renderCard({ childThreads: children.slice(0, 1) });
    fireEvent.click(chevron(false));
    expect(summary().textContent).toContain("1 child thread");
    expect(summary().textContent).not.toContain("1 child threads");
  });
});

describe("controlled collapse (persisted by the caller)", () => {
  it("isCollapsed=true hides the rows and shows the summary", () => {
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn() });
    expect(row("thr_c1")).toBeNull();
    expect(summary().textContent).toContain("2 child threads");
  });

  it("clicking the summary reports the expansion", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: true, onCollapsedChange });
    fireEvent.click(summary());
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("clicking the chevron reports the collapse", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: false, onCollapsedChange });
    fireEvent.click(chevron(false));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("controlled state does not flip on its own: the caller owns the re-render", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: false, onCollapsedChange });
    fireEvent.click(chevron(false));
    // The prop is still false — the card must still show the rows, not a
    // summary, until the caller passes the new collapsed state back down.
    expect(row("thr_c1")).not.toBeNull();
  });
});

describe("collapse does not leak into the card's own gestures", () => {
  it("opening the parent card never toggles the collapse", () => {
    const onOpen = vi.fn();
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), onOpen });
    const anchor = document.querySelector<HTMLAnchorElement>('[data-thread-card="thr_parent"] a[draggable]');
    if (anchor === null) throw new Error("missing parent anchor");
    fireEvent.click(anchor);
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Still collapsed: the summary is the only collapse surface.
    expect(document.querySelector("[data-child-threads-summary]")).not.toBeNull();
  });

  it("no summary renders when the card has no nested rows", () => {
    renderCard({ childThreads: undefined, isCollapsed: true });
    expect(document.querySelector("[data-child-threads-summary]")).toBeNull();
  });
});
