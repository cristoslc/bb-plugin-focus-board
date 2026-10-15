// @vitest-environment jsdom
// The board toolbar search box's in-field search button (issue #207): while
// the field holds text AND is focused, a search button sits between the text
// and the "x" clear button. Blur or an empty field hides it. Clicking it is
// the Enter-equivalent: the search is live, so the click re-confirms the
// current query and leaves the field focused with its text intact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CompactViewportOverrideProvider,
} from "../components/ui/hooks/use-compact-viewport";
import { BoardToolbar } from "../components/board-toolbar";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function renderToolbar({ search }: { search: string }) {
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
    nestChildren: true,
    onNestChildrenChange: vi.fn(),
    nestingLocked: false,
    filter: { projects: new Set<string>(), providers: new Set<string>(), states: new Set<string>() },
    onFilterChange: vi.fn(),
    search,
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
  render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <BoardToolbar {...props} />
    </CompactViewportOverrideProvider>,
  );
  return props;
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector(
    'input[aria-label="Search threads"]',
  ) as HTMLInputElement;
  if (input === null) throw new Error("search input not found");
  return input;
}

function searchButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Search" });
}

function clearButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Clear search" });
}

/** The field container that holds the input, search button, and clear x. */
function fieldContainer(): HTMLElement {
  const input = searchInput();
  const container = input.parentElement;
  if (container === null) throw new Error("search field container not found");
  return container;
}

/** jsdom: a dispatched focus/blur event does not move document.activeElement,
 *  and a native focus()/blur() does not run React's handlers, so do both —
 *  native first, then the event for the toolbar's focus state. */
function focusField(input: HTMLInputElement): void {
  input.focus();
  fireEvent.focus(input);
}

function blurField(input: HTMLInputElement): void {
  input.blur();
  fireEvent.blur(input);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BoardToolbar search-field search button", () => {
  it("a focused field with text shows the search button left of the clear x", () => {
    renderToolbar({ search: "Protect" });
    const input = searchInput();
    focusField(input);
    const button = searchButton();
    expect(button).not.toBeNull();
    const clear = clearButton();
    expect(clear).not.toBeNull();
    // Both live inside the field, and the search button precedes the clear x
    // in reading order (it sits to the x's left).
    const container = fieldContainer();
    expect(button!.parentElement).toBe(container);
    expect(clear!.parentElement).toBe(container);
    expect(
      container.compareDocumentPosition(button!, clear!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("blurring the field hides the search button but keeps the clear x", () => {
    renderToolbar({ search: "Protect" });
    const input = searchInput();
    focusField(input);
    expect(searchButton()).not.toBeNull();
    blurField(input);
    expect(searchButton()).toBeNull();
    expect(clearButton()).not.toBeNull();
  });

  it("an empty field shows no search button even while focused", () => {
    renderToolbar({ search: "" });
    const input = searchInput();
    focusField(input);
    expect(searchButton()).toBeNull();
    expect(clearButton()).toBeNull();
  });

  it("clicking the search button re-confirms the live search and keeps the field focused with its text", () => {
    const props = renderToolbar({ search: "Protect" });
    const input = searchInput();
    focusField(input);
    const button = searchButton();
    if (button === null) throw new Error("search button not found");
    fireEvent.click(button);
    // The Enter-equivalent: the query is re-committed unchanged (no clear,
    // no rewrite of the text), so the board state matches Enter with that
    // text.
    expect(props.onSearchChange).toHaveBeenCalledWith("Protect");
    expect(input.value).toBe("Protect");
    expect(document.activeElement).toBe(input);
    // The clear x is not displaced.
    expect(clearButton()).not.toBeNull();
  });
});