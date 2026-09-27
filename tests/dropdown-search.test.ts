import { describe, expect, it } from "vitest";
import {
  DROPDOWN_SEARCH_THRESHOLD,
  filterDropdownOptions,
  shouldShowDropdownSearch,
} from "../components/dropdown-search";

const options = (labels: string[]) => labels.map((label) => ({ value: label, label }));

describe("dropdown search threshold", () => {
  it("shows no search bar at or below the threshold", () => {
    expect(DROPDOWN_SEARCH_THRESHOLD).toBe(5);
    expect(shouldShowDropdownSearch([])).toBe(false);
    expect(shouldShowDropdownSearch(options(["a"]))).toBe(false);
    expect(shouldShowDropdownSearch(options(["a", "b", "c", "d", "e"]))).toBe(false);
  });

  it("shows a search bar one option past the threshold", () => {
    expect(shouldShowDropdownSearch(options(["a", "b", "c", "d", "e", "f"]))).toBe(true);
  });
});

describe("filterDropdownOptions", () => {
  it("returns every option in order for a blank query", () => {
    expect(filterDropdownOptions(options(["alpha", "beta"]), "")).toEqual([
      { value: "alpha", label: "alpha" },
      { value: "beta", label: "beta" },
    ]);
  });

  it("treats a whitespace-only query as blank", () => {
    expect(filterDropdownOptions(options(["alpha", "beta"]), "   ")).toHaveLength(2);
  });

  it("matches case-insensitively on a substring", () => {
    expect(filterDropdownOptions(options(["Focus Board", "focus-board", "Sweep"]), "focus")).toEqual([
      { value: "Focus Board", label: "Focus Board" },
      { value: "focus-board", label: "focus-board" },
    ]);
  });

  it("trims the query so a pasted trailing space still matches", () => {
    expect(filterDropdownOptions(options(["alpha", "beta"]), " alp ")).toHaveLength(1);
  });

  it("returns nothing when no label matches", () => {
    expect(filterDropdownOptions(options(["alpha", "beta"]), "zzz")).toEqual([]);
  });

  it("returns nothing for an empty list, with or without a query", () => {
    expect(filterDropdownOptions([], "")).toEqual([]);
    expect(filterDropdownOptions([], "alpha")).toEqual([]);
  });
});
