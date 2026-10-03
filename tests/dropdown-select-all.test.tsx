// @vitest-environment jsdom
// Select-all in the searchable filter dropdowns. A filter dropdown long
// enough to grow a search bar also grows a checkbox to the left of that
// search bar: clicking selects every row the search currently shows (and
// keeps the menu open), clicking again deselects them, and a partial
// selection reports mixed. Dropdowns without a search bar (State) and the
// exclusive Group control get no checkbox — there is nothing to add to.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";
import type { FilterState } from "../components/grouping";

const PROVIDERS = [
  { id: "p-alpha-1", displayName: "Alpha One" },
  { id: "p-alpha-2", displayName: "Alpha Two" },
  { id: "p-beta-1", displayName: "Beta One" },
  { id: "p-beta-2", displayName: "Beta Two" },
  { id: "p-gamma-1", displayName: "Gamma One" },
  { id: "p-delta-1", displayName: "Delta One" },
];

const PROJECTS = [
  { id: "prj-1", name: "Atlas", isPersonal: false },
  { id: "prj-2", name: "Borealis", isPersonal: false },
  { id: "prj-3", name: "Cygnus", isPersonal: false },
  { id: "prj-4", name: "Dorado", isPersonal: false },
  { id: "prj-5", name: "Eridanus", isPersonal: false },
  { id: "prj-6", name: "Fornax", isPersonal: false },
];

const allProviders = (): Set<string> => new Set(PROVIDERS.map((p) => p.id));

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function renderToolbar(overrides: Partial<BoardToolbarProps> = {}) {
  const filter: FilterState = {
    projects: new Set(),
    providers: new Set(),
    states: new Set(),
  };
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
    nestChildren: false,
    onNestChildrenChange: vi.fn(),
    filter,
    onFilterChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    projectIds: new Set<string>(),
    providerIds: allProviders(),
    projects: [],
    providers: PROVIDERS,
    onCreateProject: vi.fn(() => Promise.resolve()),
    totalCount: 0,
    onClearFilters: vi.fn(),
    anyFilterActive: false,
    onNewThread: vi.fn(),
    whatsNewUnseen: false,
    onOpenWhatsNew: vi.fn(),
    ...overrides,
  } as unknown as BoardToolbarProps;
  return { props, ...render(<BoardToolbar {...props} />) };
}

function openMenu(label: RegExp): void {
  const trigger = [...document.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-haspopup") === "listbox" &&
      label.test(button.textContent ?? ""),
  );
  if (trigger === undefined) throw new Error(`missing dropdown trigger ${label}`);
  fireEvent.click(trigger);
}

function selectAllBox(): HTMLElement {
  const box = document.querySelector("[data-select-all]");
  if (!(box instanceof HTMLElement)) throw new Error("missing select-all checkbox");
  return box;
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-controls][aria-label^="Search "]',
  );
  if (input === null) throw new Error("missing dropdown search input");
  return input;
}

afterEach(cleanup);

describe("select-all beside the dropdown search bar", () => {
  it("a searchable filter dropdown grows a checkbox left of its search bar", () => {
    renderToolbar();
    openMenu(/Provider:/);
    const box = selectAllBox();
    expect(box.getAttribute("aria-checked")).toBe("false");
    // Left of the search bar: the input lives in the checkbox's next
    // sibling wrapper.
    const input = box.nextElementSibling?.querySelector("input");
    expect(input?.getAttribute("aria-label")).toBe("Search provider options");
  });

  it("clicking it with nothing selected selects every option and keeps the menu open", () => {
    const { props } = renderToolbar();
    openMenu(/Provider:/);
    fireEvent.click(selectAllBox());
    expect(props.onFilterChange).toHaveBeenCalledWith({
      projects: new Set(),
      providers: allProviders(),
      states: new Set(),
    });
    expect(searchInput()).toBeDefined();
  });

  it("with everything selected, clicking it deselects every option", () => {
    const { props } = renderToolbar({
      filter: {
        projects: new Set(),
        providers: allProviders(),
        states: new Set(),
      },
    });
    openMenu(/Provider:/);
    expect(selectAllBox().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(selectAllBox());
    expect(props.onFilterChange).toHaveBeenCalledWith({
      projects: new Set(),
      providers: new Set(),
      states: new Set(),
    });
  });

  it("a partial selection reports mixed and clicking completes the set", () => {
    const { props } = renderToolbar({
      filter: {
        projects: new Set(),
        providers: new Set(["p-alpha-1", "p-beta-2"]),
        states: new Set(),
      },
    });
    openMenu(/Provider:/);
    expect(selectAllBox().getAttribute("aria-checked")).toBe("mixed");
    fireEvent.click(selectAllBox());
    expect(props.onFilterChange).toHaveBeenCalledWith({
      projects: new Set(),
      providers: allProviders(),
      states: new Set(),
    });
  });

  it("a search query scopes select-all to the rows still visible", () => {
    const { props } = renderToolbar({
      filter: {
        projects: new Set(),
        providers: new Set(["p-beta-1", "p-gamma-1"]),
        states: new Set(),
      },
    });
    openMenu(/Provider:/);
    fireEvent.change(searchInput(), { target: { value: "alpha" } });
    expect(selectAllBox().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(selectAllBox());
    expect(props.onFilterChange).toHaveBeenCalledWith({
      projects: new Set(),
      providers: new Set(["p-beta-1", "p-gamma-1", "p-alpha-1", "p-alpha-2"]),
      states: new Set(),
    });
  });

  it("a query matching nothing leaves the checkbox inert", () => {
    const { props } = renderToolbar();
    openMenu(/Provider:/);
    fireEvent.change(searchInput(), { target: { value: "zzz" } });
    fireEvent.click(selectAllBox());
    expect(props.onFilterChange).not.toHaveBeenCalled();
  });

  it("the Project dropdown gets the same checkbox", () => {
    const { props } = renderToolbar({
      projects: PROJECTS as unknown as BoardToolbarProps["projects"],
    });
    openMenu(/Project:/);
    fireEvent.click(selectAllBox());
    expect(props.onFilterChange).toHaveBeenCalledWith({
      projects: new Set(PROJECTS.map((p) => p.id)),
      providers: new Set(),
      states: new Set(),
    });
  });

  it("the non-searchable State dropdown has no checkbox", () => {
    renderToolbar();
    openMenu(/State:/);
    expect(document.querySelector("[data-select-all]")).toBeNull();
  });

  it("the exclusive Group dropdown, though searchable, has no checkbox", () => {
    renderToolbar();
    openMenu(/Group:/);
    expect(document.querySelector("[data-select-all]")).toBeNull();
  });
});
