// @vitest-environment jsdom
// Compact (mobile) toolbar: the filter palette collapses into a header
// ribbon toggle. Row one keeps only the new-thread button, the search
// field, the ribbon toggle, and the settings gear/gift; every other
// control — View chip, Project/Group/Provider/State dropdowns, Clear, the
// thread count — hides inside the ribbon and reveals on the toggle. The
// open/closed choice persists in localStorage (default: closed), and the
// toggle shows a badge with how many filter values are hidden while
// active. Desktop (non-compact) keeps the single-row palette untouched.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CompactViewportOverrideProvider,
} from "../components/ui/hooks/use-compact-viewport";
import { BoardToolbar } from "../components/board-toolbar";
import {
  TOOLBAR_FILTER_RIBBON_KEY,
  parseFilterRibbonStored,
  filterRibbonStoredValue,
} from "../components/preferences";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

interface RenderOptions {
  /** Force the viewport mode this render sees (default: compact). */
  compact?: boolean;
  overrides?: Partial<BoardToolbarProps>;
}

function renderToolbar({ compact = true, overrides = {} }: RenderOptions = {}) {
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
    ...overrides,
  } as unknown as BoardToolbarProps;
  const view = render(
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <BoardToolbar {...props} />
    </CompactViewportOverrideProvider>,
  );
  return { props, ...view };
}

function ribbonToggle(): HTMLElement {
  const button = screen.queryByRole("button", { name: /^Filters/ });
  if (button === null) throw new Error("Filters ribbon toggle not found");
  return button;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("BoardToolbar compact header tint", () => {
  it("the compact toolbar's root band carries the muted tint", () => {
    const { container } = renderToolbar();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("bg-muted/50");
  });
});

afterEach(() => {
  cleanup();
});

describe("BoardToolbar compact palette collapse", () => {
  it("compact collapses the palette by default: filters hidden, controls kept", () => {
    renderToolbar();
    // The surfaces that change or find things stay visible.
    expect(screen.getByText("New thread")).not.toBeNull();
    expect(screen.getByLabelText("Search threads")).not.toBeNull();
    expect(screen.getByLabelText("Focus Board settings")).not.toBeNull();
    // The filter triggers, the View mode chip, and the count hide.
    expect(screen.queryByText(/Project:/)).toBeNull();
    expect(screen.queryByText(/Provider:/)).toBeNull();
    expect(screen.queryByText(/State:/)).toBeNull();
    expect(document.querySelector('button[aria-label="View"]')).toBeNull();
    expect(screen.queryByText("7 threads")).toBeNull();
    // The ribbon toggle is present, announcing collapsed.
    const toggle = ribbonToggle();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("expanding the ribbon reveals View, filters, and the count", () => {
    renderToolbar();
    fireEvent.click(ribbonToggle());
    expect(screen.getByText(/Project:/)).not.toBeNull();
    expect(screen.getByText(/Group:/)).not.toBeNull();
    expect(screen.getByText(/Provider:/)).not.toBeNull();
    expect(screen.getByText(/State:/)).not.toBeNull();
    expect(screen.getByText("7 threads")).not.toBeNull();
    expect(document.querySelector('button[aria-label="View"]')).not.toBeNull();
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("true");
    // The toggle names the region it controls while it is open.
    expect(ribbonToggle().getAttribute("aria-controls")).not.toBeNull();
    expect(document.getElementById(ribbonToggle().getAttribute("aria-controls") ?? "")).not.toBeNull();
  });

  it("the collapsed toggle badges the count of active-but-hidden filter values", () => {
    renderToolbar({
      overrides: {
        filter: {
          projects: new Set(["p1"]),
          groups: null,
          providers: new Set(["prov-a", "prov-b"]),
          states: new Set<string>(),
        },
      },
    });
    // One project + two providers = three hidden narrowing values.
    expect(ribbonToggle().textContent).toContain("3");
  });

  it("the expand choice persists: toggling writes localStorage and a fresh mount reads it", () => {
    const { unmount } = renderToolbar();
    fireEvent.click(ribbonToggle());
    expect(window.localStorage.getItem(TOOLBAR_FILTER_RIBBON_KEY)).toBe("open");
    fireEvent.click(ribbonToggle());
    expect(window.localStorage.getItem(TOOLBAR_FILTER_RIBBON_KEY)).toBe("closed");

    // A fresh mount with "open" stored starts expanded, no click needed.
    unmount();
    window.localStorage.setItem(TOOLBAR_FILTER_RIBBON_KEY, "open");
    renderToolbar();
    expect(screen.queryByText(/Project:/)).not.toBeNull();
    expect(ribbonToggle().getAttribute("aria-expanded")).toBe("true");
  });

  it("desktop keeps the single-row palette: no ribbon toggle at all", () => {
    renderToolbar({ compact: false });
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.getByText(/Project:/)).not.toBeNull();
    expect(screen.getByText(/Provider:/)).not.toBeNull();
    expect(screen.getByText(/State:/)).not.toBeNull();
    expect(screen.getByText("7 threads")).not.toBeNull();
  });
});

describe("filter-ribbon preference parser", () => {
  it("defaults to collapsed; only a stored open reads expanded", () => {
    expect(parseFilterRibbonStored(null)).toBe(false);
    expect(parseFilterRibbonStored("")).toBe(false);
    expect(parseFilterRibbonStored("open")).toBe(true);
    expect(parseFilterRibbonStored("closed")).toBe(false);
    expect(parseFilterRibbonStored("garbage")).toBe(false);
  });

  it("round-trips through the stored form", () => {
    expect(filterRibbonStoredValue(true)).toBe("open");
    expect(filterRibbonStoredValue(false)).toBe("closed");
    expect(parseFilterRibbonStored(filterRibbonStoredValue(true))).toBe(true);
    expect(parseFilterRibbonStored(filterRibbonStoredValue(false))).toBe(false);
  });
});