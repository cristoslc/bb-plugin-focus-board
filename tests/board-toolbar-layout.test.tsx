// @vitest-environment jsdom
// Toolbar layout: New thread leads from the far left, the filter controls
// abut the search field, and the count/gift cluster anchors whatever space
// remains.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function renderToolbar(
  overrides: Partial<BoardToolbarProps> = {},
): HTMLElement {
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
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
    onOpenWhatsNew: vi.fn(),
    ...overrides,
  } as unknown as BoardToolbarProps;
  const view = render(<BoardToolbar {...props} />);
  return view.container.firstElementChild as HTMLElement;
}

function topChildIndex(root: HTMLElement, element: Element): number {
  let current: Element | null = element;
  while (current !== null && current.parentElement !== root) {
    current = current.parentElement;
  }
  if (current === null) throw new Error("element is not inside the toolbar root");
  return [...root.children].indexOf(current);
}

afterEach(() => {
  cleanup();
});

describe("BoardToolbar layout", () => {
  it("leads with New thread, before the search field", () => {
    const root = renderToolbar();
    const newThreadIndex = topChildIndex(root, screen.getByText("New thread"));
    const searchIndex = topChildIndex(root, screen.getByLabelText("Search threads"));
    expect(newThreadIndex).toBeLessThan(searchIndex);
  });

  it("abuts the filter controls to the search field, count last", () => {
    const root = renderToolbar();
    const searchIndex = topChildIndex(root, screen.getByLabelText("Search threads"));
    const groupIndex = topChildIndex(root, screen.getByText(/Group:/));
    const stateIndex = topChildIndex(root, screen.getByText(/State:/));
    const countIndex = topChildIndex(root, screen.getByText("7 threads"));
    expect(groupIndex).toBeGreaterThan(searchIndex);
    expect(stateIndex).toBeGreaterThan(groupIndex);
    expect(countIndex).toBeGreaterThan(stateIndex);
  });

  it("places Clear right behind the filters when one is active", () => {
    const root = renderToolbar({ anyFilterActive: true, onClearFilters: vi.fn() });
    const clearIndex = topChildIndex(root, screen.getByText("Clear"));
    const stateIndex = topChildIndex(root, screen.getByText(/State:/));
    expect(clearIndex).toBeGreaterThan(stateIndex);
  });

  it("carries no maximize button — that lives in the New thread modal", () => {
    renderToolbar();
    expect(screen.queryByLabelText("Maximize new thread")).toBeNull();
  });
});