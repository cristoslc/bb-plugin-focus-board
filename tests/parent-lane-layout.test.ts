import { describe, expect, it } from "vitest";
import { buildParentLanes } from "../components/parent-lanes";
import {
  CELL_PAD,
  CONTEXT_MAX_COLS,
  GAP,
  MIN_BAND_H,
  MINI,
  RULER,
  RULER_COLS,
  RAIL_TO_LANE_GAP,
  RULER_MIN_W,
  computeParentLaneLayout,
  predictedStart,
  viewportContextCols,
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

describe("computeParentLaneLayout", () => {
  it("gives every lane the same band height per status row, driven by the locked lane", () => {
    const lanes = familyLanes([1, 5, 2, 0]); // lane 1 has 5 working children
    const layout = computeParentLaneLayout(lanes, 1, VIEWPORT, RAIL_W);
    const w = workingIndex(lanes);
    // The band height is a row-level property shared by all lanes, so the
    // render can align seams: one bandHeights array governs every lane cell.
    expect(layout.bandHeights).toHaveLength(lanes[0].rows.length);
    const rulerRows = Math.ceil(5 / RULER_COLS);
    const expected = Math.max(MIN_BAND_H, rulerRows * RULER.h + (rulerRows - 1) * GAP);
    expect(layout.bandHeights[w]).toBe(expected);
    expect(layout.bandHeights[w]).toBeGreaterThan(MIN_BAND_H);
  });

  it("an empty locked-lane band collapses to the minimum band height", () => {
    const lanes = familyLanes([3, 1, 0, 0]);
    const layout = computeParentLaneLayout(lanes, 0, VIEWPORT, RAIL_W);
    expect(layout.bandHeights[doneIndex(lanes)]).toBe(MIN_BAND_H);
  });

  it("the locked lane is at least RULER_MIN_W wide and lays rulers in RULER_COLS columns", () => {
    const lanes = familyLanes([7, 1, 1, 0]);
    const layout = computeParentLaneLayout(lanes, 0, VIEWPORT, RAIL_W);
    expect(layout.laneWidths[0]).toBeGreaterThanOrEqual(RULER_MIN_W);
    const w = workingIndex(lanes);
    const rulerCells = layout.lanes[0].cells.filter((cell) => cell.row === w);
    expect(rulerCells).toHaveLength(7);
    expect(rulerCells.every((cell) => cell.variant === "ruler")).toBe(true);
    // Every ruler card is rendered — the locked lane's overflow grows the
    // shared band height instead of chipping.
    expect(layout.lanes[0].chipFor[w]).toBeUndefined();
    // Two columns: a band never places rulers beyond RULER_COLS columns.
    for (const cell of rulerCells) {
      expect(cell.col % RULER_COLS).toBeLessThan(RULER_COLS);
    }
    expect(Math.max(...rulerCells.map((cell) => Math.floor(cell.col / RULER_COLS)))).toBe(3);
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
        predictedStart(i - 1, layout.laneWidths, RAIL_W) + layout.laneWidths[i - 1] + GAP,
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
});