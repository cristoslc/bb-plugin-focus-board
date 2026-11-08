// @vitest-environment jsdom
// [REDWORK] View keep-visible chip in the borrowed collapse (issue #206):
// once the header borrows the mobile ribbon (band measured below
// NARROW_HEADER_COLLAPSE_WIDTH), the View dropdown used to hide inside the
// ribbon behind the "Filters" toggle even when the collapsed row still had
// obvious room for a second button at the far right.
//
// Contract:
// 1. A collapsed band at or above the keep-visible floor shows the View
//    chip on row one, left of the Filters toggle, with the ribbon closed.
// 2. Below the floor, View hides into the ribbon (the old collapse).
// 3. With View on the row, expanding the ribbon does not duplicate it.
// 4. Crossing the floor downward and back flips the chip live.
// 5. The compact media query follows the same measured rule (wide enough →
//    row chip; too narrow → ribbon), and without a measurement View stays
//    in the ribbon (degrades to the old behavior).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CompactViewportOverrideProvider,
} from "../components/ui/hooks/use-compact-viewport";
import {
  BoardToolbar,
  NARROW_HEADER_COLLAPSE_WIDTH,
  VIEW_KEEP_VISIBLE_MIN_WIDTH,
} from "../components/board-toolbar";
import { TOOLBAR_FILTER_RIBBON_KEY } from "../components/preferences";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

/** ResizeObserver stub: records each (callback, target) pair; the test fires
 *  callbacks by hand. jsdom has no ResizeObserver at all. */
class StubResizeObserver {
  static instances: { callback: ResizeObserverCallback; target: Element | null }[] = [];
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    StubResizeObserver.instances.push({ callback: this.cb, target });
  }
  unobserve(): void {}
  disconnect(): void {}
}

function fireWidth(target: Element, width: number): void {
  const instance = StubResizeObserver.instances.find((x) => x.target === target);
  if (instance === undefined) throw new Error("no ResizeObserver observed the toolbar");
  const entry = { contentRect: { width } } as unknown as ResizeObserverEntry;
  act(() => {
    instance.callback([entry], instance.callback as unknown as ResizeObserver);
  });
}

function renderToolbar({ compact = false, stubObserver = true }: { compact?: boolean; stubObserver?: boolean } = {}) {
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
    laneDirection: "vertical" as const,
    onLaneDirectionChange: vi.fn(),
    nestChildren: true,
    onNestChildrenChange: vi.fn(),
    nestingLocked: false,
    filter: { projects: new Set<string>(), providers: new Set<string>(), states: new Set<string>() },
    onFilterChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    projectIds: new Set<string>(),
    providerIds: new Set<string>(),
    projects: [],
    providers: [],
    onCreateProject: vi.fn(),
    totalCount: 7,
    onClearFilters: vi.fn(),
    anyFilterActive: false,
    onNewThread: vi.fn(),
    whatsNewUnseen: false,
    onOpenSettings: vi.fn(),
  } as unknown as BoardToolbarProps;
  if (stubObserver) vi.stubGlobal("ResizeObserver", StubResizeObserver);
  render(
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <BoardToolbar {...props} />
    </CompactViewportOverrideProvider>,
  );
  return props;
}

function ribbonToggle(): HTMLElement {
  const button = screen.queryByRole("button", { name: /^Filters/ });
  if (button === null) throw new Error("Filters ribbon toggle not found");
  return button;
}

function viewButton(): HTMLElement | null {
  return document.querySelector('button[aria-label="View"]');
}

/** True when `before` comes before `after` in the DOM reading order. */
function comesBefore(before: HTMLElement, after: HTMLElement): boolean {
  return Boolean(after.compareDocumentPosition(before) & Node.DOCUMENT_POSITION_PRECEDING);
}

function toolbarRoot(): HTMLElement {
  const element = document.querySelector(".border-b.border-border");
  if (element === null) throw new Error("toolbar root band not found");
  return element as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BoardToolbar View chip that stays on the collapsed row", () => {
  it("a collapsed band with room for two far-right buttons keeps View on the row, left of the Filters toggle", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH - 1);
    const toggle = ribbonToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const view = viewButton();
    if (view === null) throw new Error("View chip did not stay on the collapsed row");
    expect(comesBefore(view, toggle)).toBe(true);
    // The ribbon is closed: no filter dropdowns on the page.
    expect(screen.queryByText(/Project:/)).toBeNull();
  });

  it("the floor pins exactly: at the floor View shows, one pixel below it hides into the ribbon", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), VIEW_KEEP_VISIBLE_MIN_WIDTH);
    expect(viewButton()).not.toBeNull();
    cleanup();
    renderToolbar();
    fireWidth(toolbarRoot(), VIEW_KEEP_VISIBLE_MIN_WIDTH - 1);
    expect(viewButton()).toBeNull();
    // Below the floor the old collapse holds: the ribbon still owns View.
    fireEvent.click(ribbonToggle());
    expect(viewButton()).not.toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("expanding the ribbon does not duplicate the View chip", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH - 1);
    fireEvent.click(ribbonToggle());
    expect(document.querySelectorAll('button[aria-label="View"]').length).toBe(1);
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("crossing back above the collapse threshold restores the single-row palette as before", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), VIEW_KEEP_VISIBLE_MIN_WIDTH);
    ribbonToggle();
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH);
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(viewButton()).not.toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("the compact media query follows the same measured rule in both directions", () => {
    renderToolbar({ compact: true });
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH - 1);
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("false");
    expect(viewButton()).not.toBeNull();
    fireWidth(toolbarRoot(), VIEW_KEEP_VISIBLE_MIN_WIDTH - 1);
    expect(viewButton()).toBeNull();
  });

  it("without a measurement (no ResizeObserver) compact keeps View in the ribbon like before", () => {
    renderToolbar({ compact: true, stubObserver: false });
    expect(viewButton()).toBeNull();
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("the borrowed collapse reads the same persisted ribbon choice with the chip on the row", () => {
    window.localStorage.setItem(TOOLBAR_FILTER_RIBBON_KEY, "open");
    renderToolbar();
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH - 1);
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("true");
    // Exactly one View chip total (row one, with the ribbon open).
    expect(document.querySelectorAll('button[aria-label="View"]').length).toBe(1);
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });
});