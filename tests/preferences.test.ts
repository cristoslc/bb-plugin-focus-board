import { describe, expect, it } from "vitest";
import {
  CARD_TRANSPORT_KEY,
  COLLAPSED_FAMILIES_KEY,
  COLLAPSED_GROUPS_KEY,
  MOTION_PREF_KEY,
  NEST_CHILDREN_KEY,
  WALLPAPER_KEY,
  cardTransportStoredValue,
  collapsedFamiliesStoredValue,
  collapsedGroupsStoredValue,
  escStopsRunningFromSetting,
  nestStoredValue,
  parseCardTransportStored,
  parseCollapsedFamiliesStored,
  parseCollapsedGroupsStored,
  parseGroupStored,
  parseMotionStored,
  parseNestStored,
  parseParentLaneOrderStored,
  parseWallpaperStored,
  wallpaperBackgroundStyle,
  wallpaperLayerOf,
  wallpaperStoredValue,
  SWEEP_CAPS,
  sweepUnitFromSetting,
  sweepValueFromSetting,
  type SweepValueKey,
} from "../components/preferences";

describe("wallpaper persistence", () => {
  it("exposes the localStorage key", () => {
    expect(WALLPAPER_KEY).toBe("focus-board:wallpaper");
  });

  it("round-trips a global url and dim", () => {
    const settings = { version: 1 as const, global: { url: "https://example.com/w.png", dim: 0.4 } };
    expect(parseWallpaperStored(wallpaperStoredValue(settings))).toEqual(settings);
    expect(wallpaperStoredValue(settings)).toBe(
      '{"version":1,"global":{"url":"https://example.com/w.png","dim":0.4}}',
    );
  });

  it("round-trips an unset wallpaper", () => {
    expect(parseWallpaperStored(wallpaperStoredValue({ version: 1, global: null }))).toEqual({
      version: 1,
      global: null,
    });
  });

  it("defaults to no wallpaper for null / empty / garbage", () => {
    for (const raw of [null, "", "not json", "123", "null", "[1,2,3]", JSON.stringify(5)]) {
      expect(parseWallpaperStored(raw)).toEqual({ version: 1, global: null });
    }
  });

  it("drops stored shapes it does not understand", () => {
    expect(parseWallpaperStored(JSON.stringify({ version: 2, global: { url: "https://a", dim: 0 } }))).toEqual({ version: 1, global: null });
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: 7, dim: 0 } }))).toEqual({ version: 1, global: null });
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: "high" } }))).toEqual({ version: 1, global: null });
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "", dim: 0 } }))).toEqual({ version: 1, global: null });
  });

  it("rejects non-http(s)/data url schemes instead of rendering them", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "chrome://settings",
      "not-a-url",
      "ftp://example.com/w.png",
    ]) {
      expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url, dim: 0.3 } }))).toEqual({ version: 1, global: null });
    }
  });

  it("accepts https, http, and data urls", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url, dim: 0.3 } })).global?.url).toBe(url);
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "http://intranet/w.jpg", dim: 0.3 } })).global?.url).toBe("http://intranet/w.jpg");
  });

  it("clamps dim into [0, 0.9] and defaults to 0.35 when absent or invalid", () => {
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: 2 } })).global?.dim).toBe(0.9);
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: -1 } })).global?.dim).toBe(0);
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a" } })).global?.dim).toBe(0.35);
  });

  it("exposes the active layer through wallpaperLayerOf (the future per-project read builds on it)", () => {
    expect(wallpaperLayerOf({ version: 1, global: null })).toBeNull();
    expect(wallpaperLayerOf({ version: 1, global: { url: "https://a", dim: 0.4 } })).toEqual({
      url: "https://a",
      dim: 0.4,
    });
  });

  it("round-trips a dark variant next to the light url", () => {
    const settings = {
      version: 1 as const,
      global: { url: "https://example.com/w.png", dim: 0.4, darkUrl: "https://example.com/w-dark.png" },
    };
    expect(parseWallpaperStored(wallpaperStoredValue(settings))).toEqual(settings);
    expect(wallpaperStoredValue(settings)).toBe(
      '{"version":1,"global":{"url":"https://example.com/w.png","dim":0.4,"darkUrl":"https://example.com/w-dark.png"}}',
    );
  });

  it("an invalid darkUrl degrades by dropping the field but keeps the layer", () => {
    for (const darkUrl of ["javascript:alert(1)", "not-a-url", "", "   ", "file:///etc/passwd"]) {
      expect(
        parseWallpaperStored(
          JSON.stringify({ version: 1, global: { url: "https://a", dim: 0.3, darkUrl } }),
        ).global,
      ).toEqual({ url: "https://a", dim: 0.3 });
    }
    // A darkUrl of the wrong TYPE degrades the same per-key way.
    expect(
      parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: 0.3, darkUrl: 7 } }))
        .global,
    ).toEqual({ url: "https://a", dim: 0.3 });
  });

  it("a valid data darkUrl round-trips too", () => {
    expect(
      parseWallpaperStored(
        JSON.stringify({ version: 1, global: { url: "https://a", dim: 0.3, darkUrl: "data:image/svg+xml;base64,x" } }),
      ),
    ).toEqual({
      version: 1,
      global: { url: "https://a", dim: 0.3, darkUrl: "data:image/svg+xml;base64,x" },
    });
  });
});

describe("wallpaper paint style (pure helper)", () => {
  it("returns null without a layer so no background paints", () => {
    expect(wallpaperBackgroundStyle(null, false)).toBeNull();
    expect(wallpaperBackgroundStyle(null, true)).toBeNull();
  });

  it("paints the light url letterboxed (contain, no-repeat, centered)", () => {
    expect(wallpaperBackgroundStyle({ url: "https://example.com/w.png", dim: 0.3 }, false)).toEqual({
      backgroundImage: 'url("https://example.com/w.png")',
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
  });

  it("dark mode resolves darkUrl ?? url", () => {
    expect(wallpaperBackgroundStyle({ url: "https://a/l.png", dim: 0.3, darkUrl: "https://a/d.png" }, true)).toEqual({
      backgroundImage: 'url("https://a/d.png")',
      backgroundSize: "contain",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
    expect(
      wallpaperBackgroundStyle({ url: "https://a/l.png", dim: 0.3 }, true)?.backgroundImage,
    ).toBe('url("https://a/l.png")');
  });

  it("escapes quotes and backslashes in the resolved url", () => {
    const style = wallpaperBackgroundStyle({ url: 'https://a/"a\\b.png', dim: 0.3 }, false);
    expect(style?.backgroundImage).toBe('url("https://a/\\"a\\\\b.png")');
  });
});

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

describe("collapsed group persistence", () => {
  it("exposes the localStorage key", () => {
    expect(COLLAPSED_GROUPS_KEY).toBe("focus-board:collapsedGroups");
  });

  it("round-trips a set of group ids", () => {
    const ids = new Set(["grp_a", "grp_b"]);
    expect([...parseCollapsedGroupsStored(collapsedGroupsStoredValue(ids))].sort()).toEqual([
      "grp_a",
      "grp_b",
    ]);
  });

  it("defaults to an empty set for null — first visit, everything expanded", () => {
    expect(parseCollapsedGroupsStored(null).size).toBe(0);
    expect(parseCollapsedGroupsStored("").size).toBe(0);
  });

  it("falls back to an empty set on corrupt JSON or a non-array", () => {
    expect(parseCollapsedGroupsStored("{not json").size).toBe(0);
    expect(parseCollapsedGroupsStored(JSON.stringify({ grp_a: true })).size).toBe(0);
  });

  it("drops non-string entries instead of admitting them", () => {
    const parsed = parseCollapsedGroupsStored(JSON.stringify(["grp_a", 7, null, {}]));
    expect([...parsed]).toEqual(["grp_a"]);
  });

  it("stores sorted, so equal sets round-trip byte-identical", () => {
    const unsorted = new Set(["grp_b", "grp_a"]);
    expect(collapsedGroupsStoredValue(unsorted)).toBe('["grp_a","grp_b"]');
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
describe("simultaneous corruption (every key garbage at once)", () => {
  // The 1.0 hardening pass: per-key degradation is pinned above; this pins
  // the WHOLE-storage case — every persisted preference corrupted in the
  // same session still degrades to the documented fallbacks, so the board
  // always renders. The law is per-parser (the storage keys have no shared
  // read path), so the same garbage list drives every parser at once.
  const garbage: Array<string | null> = [
    null,
    "",
    "not json",
    "{",
    "123",
    "null",
    "[1,2,3]",
    JSON.stringify({ wakeAt: 123 }),
    JSON.stringify(5),
  ];

  it("round-trips the group grouping", () => {
    expect(parseGroupStored("group")).toBe("group"); // Feature-group columns
  });

  it("parses the card-transport preference; the zoom read is the shipped default", () => {
    // The operator flipped the shipped default to zoom (the portal
    // shrink-out/grow-in read); the dissolve lives on as the explicit Teleport
    // choice, none is the instant read.
    expect(CARD_TRANSPORT_KEY).toBe("focus-board:cardTransport");
    expect(cardTransportStoredValue("none")).toBe("none");
    expect(cardTransportStoredValue("teleport")).toBe("teleport");
    expect(parseCardTransportStored("teleport")).toBe("teleport");
    expect(parseCardTransportStored("none")).toBe("none");
    for (const raw of [null, "", "not json", "123", "instant", "zoom out/in"]) {
      expect(parseCardTransportStored(raw)).toBe("zoom");
    }
  });

  it("parses the motion preference; the system's media query is the default", () => {
    expect(MOTION_PREF_KEY).toBe("focus-board:motion");
    expect(parseMotionStored("reduce")).toBe("reduce");
    expect(parseMotionStored("full")).toBe("full");
    for (const raw of [null, "", "not json", "on", "off", "always"]) {
      expect(parseMotionStored(raw)).toBe("system");
    }
  });

  it("every parser survives the full garbage list and returns its documented fallback", () => {
    for (const raw of garbage) {
      expect(parseNestStored(raw)).toBe(true); // default ON
      expect(parseGroupStored(raw)).toBe("status"); // Attention fallback
      expect(parseParentLaneOrderStored(raw)).toBe("recency");
      expect(parseWallpaperStored(raw)).toEqual({ version: 1, global: null });
      expect(parseCollapsedFamiliesStored(raw)).toBeInstanceOf(Set);
      for (const id of parseCollapsedFamiliesStored(raw)) {
        expect(typeof id).toBe("string");
      }
    }
  });
});

describe("sweep threshold readers (the Behavior tab's Sweep block)", () => {
  it("mirrors the declared descriptor caps", () => {
    expect(SWEEP_CAPS.doneArchiveValue).toBe(365);
    expect(SWEEP_CAPS.idleArchiveValue).toBe(3650);
  });

  it.each<SweepValueKey>(["doneArchiveValue", "idleArchiveValue"])(
    "%s: a stored integer inside the cap is used as-is",
    (key) => {
      expect(sweepValueFromSetting(3, key)).toBe(3);
      expect(sweepValueFromSetting(SWEEP_CAPS[key], key)).toBe(SWEEP_CAPS[key]);
      expect(sweepValueFromSetting(1, key)).toBe(1);
    },
  );

  it.each<SweepValueKey>(["doneArchiveValue", "idleArchiveValue"])(
    "%s: unset or a foreign value falls back to the default, never coerced",
    (key) => {
      // Default fallbacks, lib/duration's ground truth.
      expect(sweepValueFromSetting(undefined, key)).toBe(2);
      for (const raw of [0, -1, SWEEP_CAPS[key] + 1, 2.5, "2", "3", true, null, NaN]) {
        expect(sweepValueFromSetting(raw as number, key)).toBe(2);
      }
    },
  );

  it("units: a stored member of ARCHIVE_UNITS is used as-is, anything else is the default", () => {
    expect(sweepUnitFromSetting("hours")).toBe("hours");
    expect(sweepUnitFromSetting("weeks")).toBe("weeks");
    for (const raw of [undefined, "months", 3, true, null, ""]) {
      expect(sweepUnitFromSetting(raw as string)).toBe("days");
    }
  });
});
