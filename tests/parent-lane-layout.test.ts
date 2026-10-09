import { describe, expect, it } from "vitest";
import { buildParentLanes } from "../components/parent-lanes";
import {
  CELL_PAD,
  CONTEXT_MAX_COLS,
  GAP,
  MIN_BAND_H,
  MINI,
  RULER,
  RAIL_TO_LANE_GAP,
  computeParentLaneLayout,
  lockIndexFor,
  pinIsInstant,
  predictedStart,
  viewportContextCols,
  viewportLockedCols,
  wallTrim,
} from "../components/parent-lane-layout";
import { thread } from "./thread-fixture";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 10 * DAY;

const RAIL_W = 140;
const VIEWPORT = 1280;

/** Fixture: families whose children all sit in the Working row (status
 *  "active"), so per-lane Working counts are exactly the given numbers. */
function familyLanes(counts: number[]) {
  const threads = counts.map((n, li) => {
    const parent = thread({ id: `p${li}`, displayTitle: `Parent ${li}` })
    const children = Array.from({ length: n }, (_, ci) =>
      thread({
        id: `c${li}_${ci}`,
        parentThreadId: `p${li}`,
        displayTitle: `Child ${li}_${ci}`,
        status: "active",
        updatedAt: NOW - ci * 1000,
      }),
    );
    return [parent, ...children];
  });
  return buildParentLanes(threads.flat(), new Set(), NOW)
}

function workingIndex(lanes: { rows: { id: string }[] }[]): number {
  return lanes[0].rows.findIndex((row) => row.id === "working");
}
function doneIndex(lanes: { rows: { id: string }[] }[]): number {
  return lanes[0].rows.findIndex((row) => row.id === "done");
}

describe("lockIndexFor", () => {
  const flushes = [0, 300, 700];

  it("grabs a lane once its flush point is reached", () => {
    expect(lockIndexFor(300, flushes)).toBe(1);
  });

  it("widens each lane's grab range across the lane gap into the lane to its left", () => {
    // Stop with the previous lane's right sliver at the lock point: the
    // next lane still grabs (pad covers the inter-lane gap plus the sliver).
    expect(lockIndexFor(277, flushes)).toBe(1);
    expect(lockIndexFor(680, flushes)).toBe(2);
  });

  it("keeps the previous lane when the stop is short of the padded boundary", () => {
    expect(lockIndexFor(275, flushes)).toBe(0);
    expect(lockIndexFor(675, flushes)).toBe(1);
  });

  it("returns the first lane before any lock point", () => {
    expect(lockIndexFor(-30, flushes)).toBe(0);
  });

  it("locks the last lane with no further lanes to its right", () => {
    expect(lockIndexFor(2000, flushes)).toBe(2);
    expect(lockIndexFor(695, flushes)).toBe(2);
  });
});

describe("computeParentLaneLayout", () => {
  it("a locked band lays ruler rows following the lane's own column count", () => {
    const lanes = familyLanes([1, 5, 1, 0]); // the family at lane 1 has 5 working children
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    const w = workingIndex(lanes);
    // Locked columns for lane 1 = ceil(5 / 2) = 3; rows per band = ceil(5 / 3) = 2.
    const expected = Math.max(MIN_BAND_H, 2 * RULER.h + GAP);
    expect(layout.bandHeights).toHaveLength(lanes[0].rows.length);
    expect(layout.bandHeights[w]).toBe(expected);
    expect(layout.bandHeights[w]).toBeGreaterThan(MIN_BAND_H);
  });

  it("an empty locked-lane band collapses to the minimum band height", () => {
    const lanes = familyLanes([3, 1, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 0, VIEWPORT, RAIL_W);
    expect(layout.bandHeights[doneIndex(lanes)]).toBe(MIN_BAND_H);
  });

  it("the locked lane width is content-driven: one ruler column per two cards", () => {
    const lanes = familyLanes([7, 1, 1, 0]);
    const layout = computeParentLaneLayout(lanes, 0, VIEWPORT, RAIL_W);
    const w = workingIndex(lanes);
    const rulerCells = layout.lanes[0].cells.filter((cell) => cell.row === w);
    expect(rulerCells).toHaveLength(7);
    expect(rulerCells.every((cell) => cell.variant === "ruler")).toBe(true);
    // Every ruler card is rendered — the locked lane's overflow grows the
    // shared band height instead of chipping.
    expect(layout.lanes[0].chipFor[w]).toBeUndefined();
    // Locked columns = ceil(7 / 2) = 4; width follows the content, not a
    // reserved floor.
    expect(layout.laneWidths[0]).toBe(4 * RULER.w + 3 * GAP + CELL_PAD * 2);
  });

  it("a locked lane whose busiest band holds one card stays one ruler column wide", () => {
    const lanes = familyLanes([1, 0, 1, 0]);
    const layout = computeParentLaneLayout(lanes, 0, VIEWPORT, RAIL_W);
    expect(layout.laneWidths[0]).toBe(RULER.w + CELL_PAD * 2);
    const w = workingIndex(lanes);
    expect(layout.bandHeights[w]).toBe(RULER.h);
  });

  it("context lane widths fit their busiest band, not the viewport cap", () => {
    const lanes = familyLanes([2, 1, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    const w = workingIndex(lanes);
    // The locked lane 1 has one working child → band height = 140 → one mini
    // row per band; lane 0's two working children need two mini columns.
    expect(layout.bandHeights[w]).toBe(RULER.h);
    expect(layout.laneWidths[0]).toBe(2 * MINI.w + GAP + CELL_PAD * 2);
    expect(layout.laneWidths[0]).toBeLessThan(CONTEXT_MAX_COLS * MINI.w);
  });

  it("context lanes wrap minis up to the viewport cap and overflow renders a +N chip", () => {
    const lanes = familyLanes([30, 1, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    const context = layout.lanes[0];
    const w = workingIndex(lanes);
    const cols = viewportContextCols(VIEWPORT, RAIL_W);
    expect(cols).toBeLessThanOrEqual(CONTEXT_MAX_COLS);
    // The context lane width fits exactly `cols` mini columns (2×CELL_PAD
    // padding, GAP between cells).
    expect(Math.floor((layout.laneWidths[0] - 2 * CELL_PAD + GAP) / (MINI.w + GAP))).toBe(cols);
    const rows = Math.floor((layout.bandHeights[w] - 2 * CELL_PAD + GAP) / (MINI.h + GAP));
    const capacity = cols * rows;
    const cells = context.cells.filter((cell) => cell.row === w);
    expect(cells).toHaveLength(capacity - 1); // the last slot is the chip
    expect(context.chipFor[w]).toBe(30 - (capacity - 1));
  });

  it("context lanes with room show every card and no chip", () => {
    const lanes = familyLanes([2, 0, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    const context = layout.lanes[0];
    const w = workingIndex(lanes);
    const cells = context.cells.filter((cell) => cell.row === w);
    expect(cells).toHaveLength(2);
    expect(context.chipFor[w]).toBeUndefined();
  });

  it("an empty band renders a slab in every lane, not leftover wrap space", () => {
    const lanes = familyLanes([1, 1, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    const d = doneIndex(lanes);
    expect(layout.lanes[0].emptyRows).toContain(d);
    expect(layout.lanes[1].emptyRows).toContain(d);
  });

  it("predictedStart accumulates lane widths and the rail offset; geometry is pure", () => {
    const lanes = familyLanes([2, 1, 0, 1]);
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    expect(predictedStart(0, layout.laneWidths, RAIL_W)).toBe(RAIL_W + RAIL_TO_LANE_GAP);
    for (let i = 1; i < lanes.length; i += 1) {
      expect(predictedStart(i, layout.laneWidths, RAIL_W)).toBe(
        predictedStart(i - 1, layout.laneWidths, RAIL_W) +
          layout.laneWidths[i - 1] +
          RAIL_TO_LANE_GAP,
      );
    }
    const again = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    expect(again.laneWidths).toEqual(layout.laneWidths);
    expect(again.bandHeights).toEqual(layout.bandHeights);
  });

  it("a narrow viewport caps context lanes to fewer columns", () => {
    expect(viewportContextCols(640, RAIL_W)).toBe(2);
    expect(viewportContextCols(4000, RAIL_W)).toBe(CONTEXT_MAX_COLS);
  });

  it("a locked lane never exceeds the viewport budget, however many cards its busiest band holds", () => {
    // 20 working cards at a 900px viewport: the uncapped content-driven
    // width would be ceil(20 / 2) = 10 ruler columns = 2240px (issue #22).
    const lanes = familyLanes([20, 1, 0, 0]);
    const viewport = 900;
    const layout = computeParentLaneLayout(lanes, 0, viewport, RAIL_W);
    expect(layout.laneWidths[0]).toBeLessThanOrEqual(viewport - RAIL_W);
  });

  it("a locked lane capped by the viewport wraps every card into rows instead of chipping", () => {
    const lanes = familyLanes([20, 1, 0, 0]);
    const viewport = 900;
    const layout = computeParentLaneLayout(lanes, 0, viewport, RAIL_W);
    const w = workingIndex(lanes);
    const cap = viewportLockedCols(viewport, RAIL_W);
    // Capped width matches the ruler geometry exactly, and every card is
    // rendered — the overflow grows the band downward.
    expect(layout.laneWidths[0]).toBe(cap * RULER.w + (cap - 1) * GAP + CELL_PAD * 2);
    const cells = layout.lanes[0].cells.filter((cell) => cell.row === w);
    expect(cells).toHaveLength(20);
    expect(layout.lanes[0].chipFor[w]).toBeUndefined();
    expect(layout.bandHeights[w]).toBe(
      Math.max(1, Math.ceil(20 / cap)) * RULER.h + (Math.ceil(20 / cap) - 1) * GAP,
    );
  });

  it("a tiny viewport floors the locked lane at one ruler column", () => {
    const lanes = familyLanes([6, 1, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 0, 300, RAIL_W);
    expect(layout.laneWidths[0]).toBe(RULER.w + CELL_PAD * 2);
  });

  it("an uncapped locked lane keeps the content-driven width", () => {
    // Regression: the cap must not bite when the content-driven width already
    // fits the viewport (ceil(7 / 2) = 4 columns at 1280px).
    const lanes = familyLanes([7, 1, 1, 0]);
    const layout = computeParentLaneLayout(lanes, 0, VIEWPORT, RAIL_W);
    expect(layout.laneWidths[0]).toBe(4 * RULER.w + 3 * GAP + CELL_PAD * 2);
  });
});

describe("pinIsInstant", () => {
  it("a pin whose target sits behind the scroll position snaps instantly", () => {
    // Momentum overshoot: the settle stop is past the lane's flush point,
    // so pinning it means moving backward.
    expect(pinIsInstant(1467, 1597)).toBe(true);
  });
  it("forward pins keep the smooth glide", () => {
    expect(pinIsInstant(1913, 1597)).toBe(false);
  });
  it("an exact flush target is not a backward pin", () => {
    expect(pinIsInstant(1467, 1467)).toBe(false);
  });
});

describe("wallTrim", () => {
  it("trims the spacer so maxScroll reaches the last lane's flush", () => {
    // maxSl 2400 vs wall 1913: trim the 487px of dead scroll space.
    expect(wallTrim(2400, 1913, 1280)).toBe(793);
  });
  it("keeps the spacer untouched when the wall is already within reach", () => {
    expect(wallTrim(1913, 1913, 1280)).toBe(1280);
    expect(wallTrim(1800, 1913, 1280)).toBe(1280);
  });
  it("never returns a negative spacer width", () => {
    expect(wallTrim(2500, 1913, 10)).toBe(0);
  });
});