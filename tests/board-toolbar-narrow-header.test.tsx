// @vitest-environment jsdom
// [REDWORK] Narrowed desktop header collapse: the toolbar's compact palette
// collapse (the header "Filters" toggle) used to be mobile-only — keyed to the
// window media query at ≤767px. On desktop the full single-row palette needs
// roughly 1000px, so a small window (or an open pane squeezing the board)
// left the header wrapping the palette into several rows while the window
// still read "desktop".
//
// Contract:
// 1. A wide desktop header keeps the single-row palette (no toggle).
// 2. When the toolbar band itself measures narrower than the collapse
//    threshold, the header borrows the mobile collapse: toggle present,
//    View/filters/count inside the ribbon.
// 3. Crossing back above the threshold restores the single-row palette.
// 4. The borrowed collapse reuses the same persisted open/closed choice.
// 5. With no ResizeObserver (jsdom) nothing crashes; desktop stays expanded.
// 6. The compact media query still collapses regardless of measured width.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CompactViewportOverrideProvider,
} from "../components/ui/hooks/use-compact-viewport";
import { BoardToolbar, NARROW_HEADER_COLLAPSE_WIDTH } from "../components/board-toolbar";
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
  // act-wrapped: the callback drives a setState, and the tests read the
  // committed DOM synchronously right after.
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

describe("BoardToolbar narrow desktop header", () => {
  it("a wide desktop band keeps the single-row palette: no toggle", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), 1400);
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
    expect(screen.getByText(/State:/)).not.toBeNull();
    expect(screen.getByText("7 threads")).not.toBeNull();
  });

  it("a band narrower than the threshold borrows the mobile collapse", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH - 1);
    // The toggle is present, collapsed by default, and the palette hides.
    const toggle = ribbonToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/Project:/)).toBeNull();
    expect(screen.queryByText(/State:/)).toBeNull();
    expect(screen.queryByText("7 threads")).toBeNull();
    // Row one keeps the keep-visible surfaces.
    expect(screen.getByText("New thread")).not.toBeNull();
    expect(screen.getByLabelText("Search threads")).not.toBeNull();
    expect(screen.getByLabelText("Focus Board settings")).not.toBeNull();
    // Expanding reveals View, the filters, and the count, like mobile.
    fireEvent.click(toggle);
    expect(screen.getByText(/Project:/)).not.toBeNull();
    expect(screen.getByText(/Provider:/)).not.toBeNull();
    expect(screen.getByText(/State:/)).not.toBeNull();
    expect(screen.getByText("7 threads")).not.toBeNull();
    expect(document.querySelector('button[aria-label="View"]')).not.toBeNull();
  });

  it("the boundary pins exactly: at the threshold (and above) the palette stays on one row", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), NARROW_HEADER_COLLAPSE_WIDTH);
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("crossing back above the threshold restores the single-row palette", () => {
    renderToolbar();
    fireWidth(toolbarRoot(), 900);
    ribbonToggle();
    fireWidth(toolbarRoot(), 1400);
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("the borrowed collapse reads the same persisted ribbon choice", () => {
    window.localStorage.setItem(TOOLBAR_FILTER_RIBBON_KEY, "open");
    renderToolbar();
    fireWidth(toolbarRoot(), 900);
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("without ResizeObserver nothing crashes and desktop stays expanded", () => {
    renderToolbar({ stubObserver: false });
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
  });

  it("the compact media query still collapses no matter how wide the band measures", () => {
    renderToolbar({ compact: true });
    fireWidth(toolbarRoot(), 1400);
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/Project:/)).toBeNull();
  });
});