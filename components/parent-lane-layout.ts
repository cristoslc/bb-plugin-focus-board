import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ParentLane } from "./parent-lanes";

/**
 * Pure geometry for the ruler+wrap parent board (ported from the
 * lanes-mock.html prototype). The lane locked to position 1 renders large
 * readable cards; every other lane renders mini cards that wrap to the size
 * of its busiest band — lane widths are content-driven, never reserved for
 * capacity that is not there. Band heights are uniform per status row across
 * all lanes — driven by the locked lane — so the rail labels and band seams
 * line up board-wide. The pin-before-recut scroll interaction predicts flush
 * positions from these pure functions while the board geometry is still
 * frozen (no lock assigned).
 */

export const RULER = { w: 216, h: 140 } as const;
export const MINI = { w: 136, h: 92 } as const;
/** Ruler cards lay out in up to this many columns inside the locked lane. */
export const RULER_COLS = 2;
export const CONTEXT_MAX_COLS = 5;
export const GAP = 8;
/** Inner cell padding: the lane body insets cards from the lane edge. */
export const CELL_PAD = 4;
export const MIN_BAND_H = 96;
export const RAIL_W_DEFAULT = 140;
/** Horizontal lane rhythm: rail → first lane and lane → lane. The board
 *  render keeps each section's margin-left at this value, so predictions
 *  match the DOM exactly. */
export const RAIL_TO_LANE_GAP = 16;

export type CardVariant = "ruler" | "mini";

export interface LaneCell {
  thread: PluginSidebarThread;
  /** Status-band index. */
  row: number;
  /** Grid column (in variant-sized cells) across the lane width. */
  col: number;
  variant: CardVariant;
}

export interface LaneLayout {
  width: number;
  cells: LaneCell[];
  /** Status-band index → overflow count shown as a "+N" chip. */
  chipFor: Record<number, number>;
  /** Status bands with no cards: render a slab spanning the lane width. */
  emptyRows: number[];
}

export interface ParentLaneLayout {
  laneWidths: number[];
  /** One height per status band, shared by every lane column. */
  bandHeights: number[];
  lanes: LaneLayout[];
  totalWidth: number;
}

/** Hard cap on mini-card columns next to the rail in the current viewport. */
export function viewportContextCols(
  viewportWidth: number,
  railWidth: number = RAIL_W_DEFAULT,
): number {
  const budget = viewportWidth - railWidth - RAIL_TO_LANE_GAP - 24;
  return Math.max(1, Math.min(CONTEXT_MAX_COLS, Math.floor(budget / (RULER.w + GAP))));
}

/** Mini-card rows that fit one shared band of the given height. */
function miniRowsForBand(bandHeight: number): number {
  const inner = bandHeight - CELL_PAD * 2;
  return Math.max(1, Math.floor((inner + GAP) / (MINI.h + GAP)));
}

/** The locked lane's column count: its busiest band, one ruler column per
 *  RULER_COLS cards, floored at one so an empty lane still has a column. */
function lockedColumnsFor(lane: ParentLane): number {
  let cols = 1;
  for (const row of lane.rows) {
    cols = Math.max(cols, Math.ceil(row.threads.length / RULER_COLS));
  }
  return cols;
}

/** A context lane's column count: its busiest band's cards over the mini
 *  rows that band affords, capped by the viewport cap. Overflow above the
 *  capacity renders as a chip, so width never reserves unseen cards. */
function contextColumnsFor(lane: ParentLane, bandHeights: readonly number[], cap: number): number {
  let cols = 1;
  lane.rows.forEach((row, rowIndex) => {
    if (row.threads.length === 0) return;
    const rows = miniRowsForBand(bandHeights[rowIndex]);
    cols = Math.max(cols, Math.ceil(row.threads.length / rows));
  });
  return Math.max(1, Math.min(cap, cols));
}

function lockedLaneWidth(cols: number): number {
  return cols * RULER.w + (cols - 1) * GAP + CELL_PAD * 2;
}

function contextLaneWidth(cols: number): number {
  return cols * MINI.w + (cols - 1) * GAP + CELL_PAD * 2;
}

/**
 * Compute the board geometry under `lockedIndex` (a hypothetical or actual
 * lock — the function is pure, so released boards can reuse the previously
 * locked geometry and settle handlers can predict post-recut positions).
 */
export function computeParentLaneLayout(
  lanes: readonly ParentLane[],
  lockedIndex: number | null,
  viewportWidth: number,
  railWidth: number = RAIL_W_DEFAULT,
): ParentLaneLayout {
  const cap = viewportContextCols(viewportWidth, railWidth);
  const rulerLane = lockedIndex === null ? undefined : lanes[lockedIndex];
  const lockedCols = rulerLane === undefined ? 0 : lockedColumnsFor(rulerLane);
  const lockedWidth = lockedLaneWidth(Math.max(1, lockedCols));

  // Band heights: the locked lane's ruler content dictates each status row's
  // height; empty locked bands collapse to the minimum. Context lanes always
  // fit (wrap or chip) inside the shared band height.
  const bandHeights = (lanes[0]?.rows ?? []).map((_, rowIndex) => {
    const count = rulerLane ? rulerLane.rows[rowIndex]?.threads.length ?? 0 : 0;
    if (count === 0) return MIN_BAND_H;
    const rows = Math.ceil(count / Math.max(1, lockedCols));
    return Math.max(MIN_BAND_H, rows * RULER.h + (rows - 1) * GAP);
  });

  const laneWidths = lanes.map((lane, index) =>
    index === lockedIndex ? lockedWidth : contextLaneWidth(contextColumnsFor(lane, bandHeights, cap)),
  );

  const layoutLanes: LaneLayout[] = lanes.map((lane, laneIndex) => {
    const locked = laneIndex === lockedIndex;
    const width = laneWidths[laneIndex];
    const cells: LaneCell[] = [];
    const chipFor: Record<number, number> = {};
    const emptyRows: number[] = [];
    const columns = locked ? lockedCols : contextColumnsFor(lane, bandHeights, cap);

    lane.rows.forEach((row, rowIndex) => {
      const count = row.threads.length;
      if (count === 0) {
        emptyRows.push(rowIndex);
        return;
      }
      if (locked) {
        // The locked lane's overflow grows the band (shared height) instead
        // of chipping: the ruler's full stack stays visible, going down the
        // page. Rows follow the lane's own column count.
        row.threads.forEach((t, i) => {
          cells.push({ thread: t, row: rowIndex, col: i, variant: "ruler" });
        });
        return;
      }
      const rowsPerBand = miniRowsForBand(bandHeights[rowIndex]);
      const capacity = rowsPerBand * columns;
      const chip = count > capacity;
      const visible = chip ? capacity - 1 : count;
      for (let i = 0; i < visible; i += 1) {
        cells.push({ thread: row.threads[i], row: rowIndex, col: i, variant: "mini" });
      }
      if (chip) chipFor[rowIndex] = count - visible;
    });

    return { width, cells, chipFor, emptyRows };
  });

  return {
    laneWidths,
    bandHeights,
    lanes: layoutLanes,
    totalWidth: railWidth + RAIL_TO_LANE_GAP + laneWidths.reduce((a, b) => a + b + RAIL_TO_LANE_GAP, 0),
  };
}

/** Content-space x of lane `index`'s left edge given final lane widths — the
 *  DOM renders every section's margin-left at RAIL_TO_LANE_GAP, so this
 *  matches the real layout. The flush target scroll is
 *  `predictedStart(index, ..., rail) - (rail + RAIL_TO_LANE_GAP)`: the locked
 *  lane's left edge rests just past the rail. */
export function predictedStart(
  index: number,
  laneWidths: readonly number[],
  railWidth: number = RAIL_W_DEFAULT,
): number {
  return (
    railWidth +
    RAIL_TO_LANE_GAP +
    laneWidths.slice(0, index).reduce((a, b) => a + b + RAIL_TO_LANE_GAP, 0)
  );
}