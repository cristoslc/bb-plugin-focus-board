// @vitest-environment jsdom
// The View menu's two structural choices, as selections rather than
// checkboxes: the lane direction (Vertical | Horizontal, the same setting the
// Appearance tab carries) and the nesting toggle (Off | On). Both are
// two-state radio pairs — the app's own choice anatomy (the Appearance tab's
// ChoiceRow radiogroup, components/appearance-controls.tsx) drawn as the
// compact segment pair the wallpaper's Fit control uses — so neither reads
// as a checkbox any more. The old footer checkbox is gone, the grouped views
// stay the menu's rows, and the parent view's lock disables the nesting pair
// while it reads On.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function renderToolbar(overrides: Partial<BoardToolbarProps> = {}): void {
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
    laneDirection: "vertical" as const,
    onLaneDirectionChange: vi.fn(),
    nestChildren: true,
    onNestChildrenChange: vi.fn(),
    nestingLocked: false,
    filter: {
      projects: new Set<string>(),
      providers: new Set<string>(),
      states: new Set<string>(),
    },
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
  render(<BoardToolbar {...props} />);
}

function openViewMenu(): void {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="View"]');
  if (trigger === null) throw new Error("View menu trigger not found");
  fireEvent.click(trigger);
}

/** The pair's group, by its accessible name. */
function pair(name: string): HTMLElement {
  return screen.getByRole("radiogroup", { name });
}

function chosen(name: string): string | null {
  const checked = within(pair(name))
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true");
  return checked?.textContent ?? null;
}

afterEach(cleanup);

describe("the View menu's lane direction pair", () => {
  it("renders exactly two choices and selects the live direction", () => {
    renderToolbar({ laneDirection: "horizontal" });
    openViewMenu();
    const radios = within(pair("Lane direction")).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Vertical", "Horizontal"]);
    expect(chosen("Lane direction")).toBe("Horizontal");
  });

  it("picking the other choice reports it and leaves the menu open", () => {
    const onLaneDirectionChange = vi.fn();
    renderToolbar({ onLaneDirectionChange, laneDirection: "vertical" });
    openViewMenu();
    expect(chosen("Lane direction")).toBe("Vertical");
    fireEvent.click(within(pair("Lane direction")).getByRole("radio", { name: "Horizontal" }));
    expect(onLaneDirectionChange).toHaveBeenCalledWith("horizontal");
    // The pair is a control, not a menu row: the menu stays open so the
    // operator can flip both choices in one visit.
    expect(document.querySelector('button[aria-label="View"]')?.getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("a vertical board selects Vertical, so the pair always names one side", () => {
    renderToolbar({ laneDirection: "vertical" });
    openViewMenu();
    expect(chosen("Lane direction")).toBe("Vertical");
  });
});

describe("the View menu's Nest child threads pair", () => {
  it("renders On and Off with the live nesting state selected", () => {
    renderToolbar({ nestChildren: false });
    openViewMenu();
    const radios = within(pair("Nest child threads")).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Off", "On"]);
    expect(chosen("Nest child threads")).toBe("Off");
  });

  it("picking On reports the flip", () => {
    const onNestChildrenChange = vi.fn();
    renderToolbar({ onNestChildrenChange, nestChildren: false });
    openViewMenu();
    fireEvent.click(within(pair("Nest child threads")).getByRole("radio", { name: "On" }));
    expect(onNestChildrenChange).toHaveBeenCalledWith(true);
  });

  it("picking Off reports the flip", () => {
    const onNestChildrenChange = vi.fn();
    renderToolbar({ onNestChildrenChange, nestChildren: true });
    openViewMenu();
    fireEvent.click(within(pair("Nest child threads")).getByRole("radio", { name: "Off" }));
    expect(onNestChildrenChange).toHaveBeenCalledWith(false);
  });

  it("under the parent view it reads On and refuses both picks", () => {
    const onNestChildrenChange = vi.fn();
    renderToolbar({ nestingLocked: true, nestChildren: false, onNestChildrenChange });
    openViewMenu();
    expect(chosen("Nest child threads")).toBe("On");
    expect(pair("Nest child threads").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(pair("Nest child threads")).getByRole("radio", { name: "Off" }));
    expect(onNestChildrenChange).not.toHaveBeenCalled();
  });
});

describe("the View menu's checkbox remnant", () => {
  it("no checkbox renders in the open View menu", () => {
    renderToolbar();
    openViewMenu();
    const menu = document.querySelector('[aria-label="View"][role="presentation"]');
    if (menu === null) throw new Error("View menu surface not found");
    expect(within(menu as HTMLElement).queryAllByRole("checkbox")).toHaveLength(0);
  });
});
