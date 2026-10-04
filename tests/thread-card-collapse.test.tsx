// @vitest-environment jsdom
// Collapsible nested children on a family card. The toggle lives in the
// child section itself — directly above the rows it controls. Collapsed, the
// rows become a horizontal strip of status-colored dots (one per nested
// child, in display order) sitting directly below the card's count chip in
// the top-right rail; the strip and the section toggle both re-open the
// rows. The collapsed state itself is controlled (persisted by the caller),
// with an uncontrolled local fallback for callers that do not persist.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

function family(): { parent: PluginSidebarThread; children: PluginSidebarThread[] } {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: 5000 }),
    children: [
      // One child per state, in display order, so dot colors are assertable.
      thread({ id: "thr_c1", parentThreadId: "thr_parent", displayTitle: "Child one", updatedAt: 4000 }),
      thread({ id: "thr_c2", parentThreadId: "thr_parent", displayTitle: "Child two", isUnread: true, updatedAt: 3900 }),
      thread({ id: "thr_c3", parentThreadId: "thr_parent", displayTitle: "Child three", status: "active", updatedAt: 3800 }),
      thread({ id: "thr_c4", parentThreadId: "thr_parent", displayTitle: "Child four", hasPendingInteraction: true, updatedAt: 3700 }),
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

/** The child section's toggle, by its aria label. */
function toggle(collapsed: boolean): HTMLElement {
  const button = document.querySelector(
    `button[data-child-threads-toggle][aria-label="${collapsed ? "Expand subthreads" : "Collapse subthreads"}"]`,
  );
  if (!(button instanceof HTMLElement)) throw new Error("missing child-section toggle");
  return button;
}

/** The collapsed status-dot strip, in the card's top-right rail. */
function dots(): HTMLElement {
  const strip = document.querySelector("[data-child-thread-dots]");
  if (!(strip instanceof HTMLElement)) throw new Error("missing child dot strip");
  return strip;
}

/** The chip rail: the top-right container holding the count chip and the strip. */
function chipRail(): HTMLElement {
  const chip = document.querySelector<HTMLElement>('[data-thread-card] span.rounded-full');
  if (chip === null) throw new Error("missing count chip");
  const rail = chip.parentElement;
  if (!(rail instanceof HTMLElement)) throw new Error("missing chip rail");
  return rail;
}

function dotAt(index: number): Element {
  const dot = dots().children[index];
  if (dot === undefined) throw new Error(`missing dot ${index}`);
  return dot;
}

function row(id: string): HTMLElement | null {
  return document.querySelector(`[data-thread-card="${id}"]`);
}

afterEach(cleanup);

describe("the child section toggle placement", () => {
  it("renders the nested rows expanded by default with the toggle directly above them", () => {
    renderCard();
    expect(row("thr_c1")).not.toBeNull();
    expect(row("thr_c4")).not.toBeNull();
    const toggleButton = toggle(false);
    // The toggle is the section's own header, not a corner control: the rows
    // container is its sibling inside the same section.
    expect(toggleButton.parentElement?.querySelector("[data-nested-rows]")).not.toBeNull();
  });

  it("expanded, the top-right rail holds only the count chip — no dots, no far-away chevron", () => {
    renderCard();
    const chip = chipRail().querySelector("span.rounded-full");
    if (!(chip instanceof HTMLElement)) throw new Error("missing count chip");
    expect(chip.textContent).toContain("4");
    expect(document.querySelector("[data-child-thread-dots]")).toBeNull();
    expect(chipRail().querySelector("button")).toBeNull();
  });
});

describe("uncontrolled collapse (callers without persistence)", () => {
  it("the toggle collapses the rows into the dot strip below the count chip", () => {
    renderCard();
    fireEvent.click(toggle(false));
    expect(row("thr_c1")).toBeNull();
    expect(toggle(true).textContent).toContain("4 child threads");
    // The strip sits in the chip rail, directly below the count.
    expect(chipRail().contains(dots())).toBe(true);
    expect(chipRail().querySelector("span.rounded-full")).not.toBeNull();
    expect(dots().children.length).toBe(4);
    // The section toggle carries only the chevron and the count — the strip
    // lives beside the chip, and exactly one strip renders.
    expect(toggle(true).querySelector("[data-child-thread-dots]")).toBeNull();
    expect(document.querySelectorAll("[data-child-thread-dots]").length).toBe(1);
  });

  it("clicking the collapsed strip re-expands the rows", () => {
    renderCard();
    fireEvent.click(toggle(false));
    fireEvent.click(dots());
    expect(row("thr_c1")).not.toBeNull();
    expect(row("thr_c4")).not.toBeNull();
    expect(document.querySelector("[data-child-thread-dots]")).toBeNull();
  });

  it("dots are colored by the child's state, in display order", () => {
    renderCard();
    fireEvent.click(toggle(false));
    expect(dotAt(0).className).toContain("bg-muted-foreground/30"); // idle
    expect(dotAt(1).className).toContain("bg-emerald-500"); // unread
    expect(dotAt(2).className).toContain("bg-blue-500"); // working
    expect(dotAt(3).className).toContain("bg-amber-500"); // attention
  });

  it("a needs-you child's dot pulses, like every other attention signal", () => {
    renderCard();
    fireEvent.click(toggle(false));
    expect(dotAt(3).className).toContain("animate-pulse");
    expect(dotAt(0).className).not.toContain("animate-pulse");
  });

  it("each dot names its child on hover", () => {
    renderCard();
    fireEvent.click(toggle(false));
    expect(dotAt(1).getAttribute("title")).toContain("Child two");
  });

  it("one child reads singular: 1 child thread", () => {
    const { children } = family();
    renderCard({ childThreads: children.slice(0, 1) });
    fireEvent.click(toggle(false));
    expect(toggle(true).textContent).toContain("1 child thread");
    expect(toggle(true).textContent).not.toContain("1 child threads");
    expect(dots().children.length).toBe(1);
  });
});

describe("controlled collapse (persisted by the caller)", () => {
  it("isCollapsed=true hides the rows and shows the dot strip", () => {
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn() });
    expect(row("thr_c1")).toBeNull();
    expect(dots().children.length).toBe(4);
    expect(toggle(true).textContent).toContain("4 child threads");
  });

  it("clicking the collapsed strip reports the expansion", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: true, onCollapsedChange });
    fireEvent.click(toggle(true));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("clicking the expanded toggle reports the collapse", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: false, onCollapsedChange });
    fireEvent.click(toggle(false));
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("controlled state does not flip on its own: the caller owns the re-render", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: false, onCollapsedChange });
    fireEvent.click(toggle(false));
    // The prop is still false — the card must still show the rows, not the
    // strip, until the caller passes the new collapsed state back down.
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
    // Still collapsed: the strip is the only collapse surface.
    expect(document.querySelector("[data-child-thread-dots]")).not.toBeNull();
  });

  it("no toggle or strip renders when the card has no nested rows", () => {
    renderCard({ childThreads: undefined, isCollapsed: true });
    expect(document.querySelector("[data-child-thread-dots]")).toBeNull();
    expect(document.querySelector("[data-child-threads-toggle]")).toBeNull();
  });
});
