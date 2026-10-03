import { describe, expect, it } from "vitest";
import {
  COLLAPSED_FAMILIES_KEY,
  NEST_CHILDREN_KEY,
  collapsedFamiliesStoredValue,
  escStopsRunningFromSetting,
  nestStoredValue,
  parseCollapsedFamiliesStored,
  parseNestStored,
} from "../components/preferences";

describe("nesting toggle persistence (R3)", () => {
  it("exposes the localStorage key", () => {
    expect(NEST_CHILDREN_KEY).toBe("focus-board:nestChildren");
  });

  it("round-trips: on for true, off for false", () => {
    expect(parseNestStored(nestStoredValue(true))).toBe(true);
    expect(parseNestStored(nestStoredValue(false))).toBe(false);
    expect(nestStoredValue(true)).toBe("on");
    expect(nestStoredValue(false)).toBe("off");
  });

  it("defaults to ON (nesting enabled) for null — first visit", () => {
    expect(parseNestStored(null)).toBe(true);
  });

  it("validates like readStored: any invalid stored value falls back to ON", () => {
    expect(parseNestStored("yes")).toBe(true);
    expect(parseNestStored("")).toBe(true);
    expect(parseNestStored("OFF")).toBe(true); // case-sensitive allow-list
    expect(parseNestStored("0")).toBe(true);
  });
});

describe("collapsed family persistence", () => {
  it("exposes the localStorage key", () => {
    expect(COLLAPSED_FAMILIES_KEY).toBe("focus-board:collapsedFamilies");
  });

  it("round-trips a set of parent ids", () => {
    const ids = new Set(["thr_a", "thr_b"]);
    expect([...parseCollapsedFamiliesStored(collapsedFamiliesStoredValue(ids))].sort()).toEqual([
      "thr_a",
      "thr_b",
    ]);
  });

  it("defaults to an empty set for null — first visit, everything expanded", () => {
    expect(parseCollapsedFamiliesStored(null).size).toBe(0);
  });

  it("falls back to an empty set on corrupt JSON", () => {
    expect(parseCollapsedFamiliesStored("{not json").size).toBe(0);
    expect(parseCollapsedFamiliesStored("").size).toBe(0);
  });

  it("falls back to an empty set when the stored value is not an array", () => {
    expect(parseCollapsedFamiliesStored(JSON.stringify({ thr_a: true })).size).toBe(0);
    expect(parseCollapsedFamiliesStored(JSON.stringify("thr_a")).size).toBe(0);
  });

  it("drops non-string entries instead of admitting them", () => {
    const parsed = parseCollapsedFamiliesStored(JSON.stringify(["thr_a", 7, null, {}]));
    expect([...parsed]).toEqual(["thr_a"]);
  });
});

describe("Esc-stops-thread setting read side", () => {
  // The server-declared boolean renders in the plugin detail page's config
  // panel; the board reads it reactively through `useSettings()` and
  // narrows the value through this helper.
  it("is off only for an explicit stored false", () => {
    expect(escStopsRunningFromSetting(false)).toBe(false);
  });

  it("defaults to ON for unset, loading, and unexpected values", () => {
    expect(escStopsRunningFromSetting(undefined)).toBe(true); // loading / unset
    expect(escStopsRunningFromSetting(true)).toBe(true);
    expect(escStopsRunningFromSetting(0)).toBe(true);
    expect(escStopsRunningFromSetting("off")).toBe(true); // wrong type
  });
});