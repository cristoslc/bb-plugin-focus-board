import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ParentLane } from "./parent-lanes";

/**
 * Pure geometry for the ruler+wrap parent board (ported from the
 * lanes-mock.html prototype). The lane locked to position 1 renders large
 * readable cards; every other lane renders mini cards that wrap to fill its
 * bands up to a viewport-derived column cap. Band heights are uniform per
 * status row across all lanes — driven by the locked lane — so the rail
 * labels and band seams line up board-wide. The pin-before-recut scroll
 * interaction predicts flush positions from these pure functions while the
 * board geometry is still frozen (no lock assigned).
 */

export const RULER = { w: 216, h: 140 } as const;
export const MINI = { w: 136, h: 92 } as const;
export const RULER_COLS = 2;
export const RULER_MIN_W = 460;
export const CONTEXT_MAX_COLS = 5;
export const GAP = 8;
/** Inner cell padding: the lane body insets cards from the lane edge. */
export const CELL_PAD = 4;
export const MIN_BAND_H = 96;
export const RAIL_W_DEFAULT = 140;
/** Total horizontal margin between the rail's inner edge and the first lane. */
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

/** How many mini-card columns fit next to the rail in the current viewport. */
export function viewportContextCols(
  viewportWidth: number,
  railWidth: number = RAIL_W_DEFAULT,
): number {
  const budget = viewportWidth - railWidth - RAIL_TO_LANE_GAP - 24;
  return Math.max(1, Math.min(CONTEXT_MAX_COLS, Math.floor(budget / (RULER.w + GAP))));
}

function laneInnerColumns(width: number, cellW: number): number {
  return Math.max(1, Math.floor((width - CELL_PAD * 2 + GAP) / (cellW + GAP)));
}

function lockedLaneWidth(): number {
  return Math.max(RULER_MIN_W, RULER_COLS * RULER.w + (RULER_COLS - 1) * GAP) + CELL_PAD * 2;
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
  const cols = viewportContextCols(viewportWidth, railWidth);
  const laneWidths = lanes.map((_, index) =>
    index === lockedIndex ? lockedLaneWidth() : contextLaneWidth(cols),
  );

  // Band heights: the locked lane's ruler content dictates each status row's
  // height; empty locked bands collapse to the minimum. Context lanes always
  // fit (wrap or chip) inside the shared band height.
  const bandHeights = (lanes[0]?.rows ?? []).map((_, rowIndex) => {
    const rulerLane = lockedIndex === null ? undefined : lanes[lockedIndex];
    const count = rulerLane ? rulerLane.rows[rowIndex]?.threads.length ?? 0 : 0;
    if (count === 0) return MIN_BAND_H;
    const rows = Math.ceil(count / RULER_COLS);
    return Math.max(MIN_BAND_H, rows * RULER.h + (rows - 1) * GAP);
  });

  const layoutLanes: LaneLayout[] = lanes.map((lane, laneIndex) => {
    const locked = laneIndex === lockedIndex;
    const width = laneWidths[laneIndex];
    const cells: LaneCell[] = [];
    const chipFor: Record<number, number> = {};
    const emptyRows: number[] = [];
    const columns = locked
      ? RULER_COLS
      : laneInnerColumns(width, MINI.w);

    lane.rows.forEach((row, rowIndex) => {
      const count = row.threads.length;
      if (count === 0) {
        emptyRows.push(rowIndex);
        return;
      }
      if (locked) {
        // The locked lane's overflow grows the band (shared height) instead
        // of chipping: the ruler's full stack stays visible, going down the
        // page. Rows fit by construction: bandH ≈ ceil(count/RULER_COLS)
        // rows of RULER height.
        row.threads.forEach((t, i) => {
          cells.push({ thread: t, row: rowIndex, col: i, variant: "ruler" });
        });
        return;
      }
      const innerRowHeight = bandHeights[rowIndex] - CELL_PAD * 2;
      const rowsPerBand = Math.max(
        1,
        Math.floor((innerRowHeight + GAP) / (MINI.h + GAP)),
      );
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
    totalWidth: railWidth + RAIL_TO_LANE_GAP + laneWidths.reduce((a, b) => a + b + GAP, 0),
  };
}

/** Horizontal position of lane `index` given final lane widths — the flush
 *  target for the pin glide is `predictedStart(index, ..., rail) - 1`. */
export function predictedStart(
  index: number,
  laneWidths: readonly number[],
  railWidth: number = RAIL_W_DEFAULT,
): number {
  return (
    railWidth +
    RAIL_TO_LANE_GAP +
    laneWidths.slice(0, index).reduce((a, b) => a + b + GAP, 0)
  );
}