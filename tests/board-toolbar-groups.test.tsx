// @vitest-environment jsdom
// The Group filter in the toolbar: a multi-select dropdown alongside the
// Project filter — the board's group buckets (registry names, "Unknown
// group" for a record-less assignment) plus the "No group" sentinel. The
// menu is the hide gesture's restore path: a hidden group is simply an
// unchecked row the operator re-checks (hover checkbox adds without
// closing). Anatomy matches the Project filter's.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

const groupOptions = [
  { id: "grp_a", label: "Alpha" },
  { id: "grp_b", label: "Beta" },
  { id: "none", label: "No group" },
];

const baseFilter = {
  projects: new Set<string>(),
  providers: new Set<string>(),
  states: new Set(),
  groups: new Set<string>(),
};

const onFilterChange = vi.fn();

function renderToolbar(
  filter: BoardToolbarProps["filter"] = baseFilter,
): void {
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
    laneDirection: "vertical" as const,
    onLaneDirectionChange: vi.fn(),
    nestChildren: true,
    onNestChildrenChange: vi.fn(),
    nestingLocked: false,
    filter,
    onFilterChange,
    search: "",
    onSearchChange: vi.fn(),
    projectIds: new Set<string>(),
    providerIds: new Set<string>(),
    projects: [],
    providers: [],
    groupOptions,
    onCreateProject: vi.fn(),
    totalCount: 7,
    onClearFilters: vi.fn(),
    anyFilterActive: false,
    onNewThread: vi.fn(),
    whatsNewUnseen: false,
    onOpenWhatsNew: vi.fn(),
    wallpaper: { version: 1 as const, global: null },
    onWallpaperChange: vi.fn(),
  } as unknown as BoardToolbarProps;
  render(<BoardToolbar {...props} />);
}

function openGroupMenu(): void {
  fireEvent.click(screen.getByText(/Group:/));
}

afterEach(cleanup);

beforeEach(() => {
  onFilterChange.mockClear();
});

describe("BoardToolbar group filter", () => {
  it("renders a Group dropdown with the board's buckets and the No-group row", () => {
    renderToolbar();
    openGroupMenu();
    const listbox = screen.getByRole("listbox", { name: "Group" });
    expect(listbox).toBeTruthy();
    for (const label of ["Alpha", "Beta", "No group"]) {
      expect(screen.getByRole("option", { name: label })).toBeTruthy();
    }
  });

  it("the trigger reads All groups when nothing is selected", () => {
    renderToolbar();
    expect(screen.getByText(/All groups/)).toBeTruthy();
  });

  it("single-select applies the group restriction through onFilterChange", () => {
    renderToolbar();
    openGroupMenu();
    fireEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ groups: new Set(["grp_a"]) }),
    );
  });

  it("the hover checkbox adds a bucket to the selection without closing (the hide's restore path)", () => {
    renderToolbar({ ...baseFilter, groups: new Set(["grp_b"]) });
    openGroupMenu();
    fireEvent.click(screen.getByRole("checkbox", { name: "Add Alpha to selection" }));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ groups: new Set(["grp_b", "grp_a"]) }),
    );
  });

  it("clear restores all groups and preserves the other filter sets", () => {
    renderToolbar({
      ...baseFilter,
      projects: new Set(["proj_x"]),
      groups: new Set(["grp_a"]),
    });
    openGroupMenu();
    fireEvent.click(screen.getByText("Clear selection"));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ groups: new Set(), projects: new Set(["proj_x"]) }),
    );
  });

  it("an unknown persisted id degrades to its raw id in the summary without crashing", () => {
    renderToolbar({ ...baseFilter, groups: new Set(["grp_ghost"]) });
    expect(screen.getByText(/grp_ghost/)).toBeTruthy();
  });
});