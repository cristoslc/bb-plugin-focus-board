// The ungrouped view's card-grid order (issue #416). Pure module, so the
// whole matrix runs without a DOM: every key against every direction, the
// tie-break that makes the order total, the key's own default direction, and
// the stored form's tolerance.
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  compareGridSort,
  DEFAULT_GRID_SORT,
  defaultDirectionFor,
  GRID_SORT_KEYS,
  gridSortDirectionOptions,
  type GridSort,
} from "../components/grid-sort";
import { GRID_SORT_KEY, gridSortStoredValue, parseGridSortStored } from "../components/preferences";

/**
 * Three threads whose three sort keys each produce a DIFFERENT order, so a
 * key that silently read the wrong field would fail rather than happen to
 * agree:
 *
 *   title      alpha, bravo, charlie       (A → Z)
 *   activity   bravo (newest), alpha, charlie
 *   created    charlie (newest), bravo, alpha
 */
function thread(
  id: string,
  displayTitle: string,
  updatedAt: number,
  createdAt: number,
): PluginSidebarThread {
  return {
    id,
    displayTitle,
    updatedAt,
    createdAt,
  } as unknown as PluginSidebarThread;
}

const ALPHA = thread("thr_a", "alpha", 2_000, 1_000);
const BRAVO = thread("thr_b", "bravo", 3_000, 2_000);
const CHARLIE = thread("thr_c", "charlie", 1_000, 3_000);
const ALL = [ALPHA, BRAVO, CHARLIE];

function ordered(sort: GridSort, cards: readonly PluginSidebarThread[] = ALL): string[] {
  return [...cards].sort((a, b) => compareGridSort(a, b, sort)).map((card) => card.id);
}

describe("the grid's sort keys", () => {
  it("orders by title A to Z and Z to A", () => {
    expect(ordered({ key: "title", direction: "asc" })).toEqual(["thr_a", "thr_b", "thr_c"]);
    expect(ordered({ key: "title", direction: "desc" })).toEqual(["thr_c", "thr_b", "thr_a"]);
  });

  it("orders by last activity, newest and oldest first", () => {
    expect(ordered({ key: "activity", direction: "desc" })).toEqual(["thr_b", "thr_a", "thr_c"]);
    expect(ordered({ key: "activity", direction: "asc" })).toEqual(["thr_c", "thr_a", "thr_b"]);
  });

  it("orders by created date, newest and oldest first", () => {
    expect(ordered({ key: "created", direction: "desc" })).toEqual(["thr_c", "thr_b", "thr_a"]);
    expect(ordered({ key: "created", direction: "asc" })).toEqual(["thr_a", "thr_b", "thr_c"]);
  });

  it("is a total order: cards tied on the key still land deterministically", () => {
    // Two cards with identical timestamps and titles differ only by id.
    const tieOne = thread("thr_one", "same", 5_000, 5_000);
    const tieTwo = thread("thr_two", "same", 5_000, 5_000);
    const sort: GridSort = { key: "activity", direction: "desc" };
    const forwards = ordered(sort, [tieOne, tieTwo]);
    const backwards = ordered(sort, [tieTwo, tieOne]);
    expect(forwards).toEqual(["thr_one", "thr_two"]);
    expect(backwards).toEqual(forwards);
  });

  it("names numbers inside titles in reading order", () => {
    const nine = thread("thr_9", "Thread 9", 0, 0);
    const ten = thread("thr_10", "Thread 10", 0, 0);
    expect(ordered({ key: "title", direction: "asc" }, [ten, nine])).toEqual([
      "thr_9",
      "thr_10",
    ]);
  });
});

describe("the key's own direction", () => {
  it("starts each key the way that key reads", () => {
    expect(defaultDirectionFor("activity")).toBe("desc");
    expect(defaultDirectionFor("created")).toBe("desc");
    expect(defaultDirectionFor("title")).toBe("asc");
    expect(DEFAULT_GRID_SORT).toEqual({ key: "activity", direction: "desc" });
  });

  it("labels the direction pair for the key it applies to", () => {
    expect(gridSortDirectionOptions("activity").map((option) => option.label)).toEqual([
      "Newest first",
      "Oldest first",
    ]);
    expect(gridSortDirectionOptions("created").map((option) => option.label)).toEqual([
      "Newest first",
      "Oldest first",
    ]);
    expect(gridSortDirectionOptions("title").map((option) => option.label)).toEqual([
      "A to Z",
      "Z to A",
    ]);
  });

  it("offers the three keys the row data honestly carries, in menu order", () => {
    expect(GRID_SORT_KEYS.map((option) => option.value)).toEqual([
      "activity",
      "created",
      "title",
    ]);
  });
});

describe("the stored grid order", () => {
  it("round-trips every key and direction", () => {
    for (const option of GRID_SORT_KEYS) {
      for (const direction of ["asc", "desc"] as const) {
        const sort: GridSort = { key: option.value, direction };
        expect(parseGridSortStored(gridSortStoredValue(sort))).toEqual(sort);
      }
    }
  });

  it("falls back to the board's standing order on nothing or nonsense", () => {
    expect(parseGridSortStored(null)).toEqual({ key: "activity", direction: "desc" });
    expect(parseGridSortStored("")).toEqual({ key: "activity", direction: "desc" });
    expect(parseGridSortStored("priority:desc")).toEqual({
      key: "activity",
      direction: "desc",
    });
    expect(parseGridSortStored("title:sideways")).toEqual({ key: "title", direction: "asc" });
  });

  it("reads a bare key in that key's own direction", () => {
    // A hand-written seed or a shortened stored value: the key is honoured,
    // the missing direction takes the key's default rather than activity's.
    expect(parseGridSortStored("title")).toEqual({ key: "title", direction: "asc" });
    expect(parseGridSortStored("created")).toEqual({ key: "created", direction: "desc" });
  });

  it("stores under its own preference key, beside the grouping", () => {
    expect(GRID_SORT_KEY).toBe("focus-board:gridSort");
    expect(gridSortStoredValue({ key: "title", direction: "desc" })).toBe("title:desc");
  });
});
