import { describe, expect, it } from "vitest";
import {
  NEST_CHILDREN_KEY,
  escStopsRunningFromSetting,
  nestStoredValue,
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