// The ungrouped view's card grid order (issue #416): the view has no lanes,
// so it has no lane order either — the operator picks the one key the grid
// reads, and the grid is a total order on that key.
//
// Pure module: no host, no SDK runtime, no React. app.tsx owns the persisted
// state (components/preferences.ts parses the stored text), the View menu
// renders the rows, and the board sorts the assembled cards through
// `sortGridCards`.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * The grid's sort keys. Every one of them is a field the card row actually
 * carries (PluginSidebarThread): `displayTitle`, `updatedAt`, `createdAt`.
 * No derived key rides here that the row does not hold — a "priority" or
 * "done date" order would be this module inventing data.
 */
export type GridSortKey = "activity" | "created" | "title";

/** Ascending or descending. For a date key that is oldest/newest first; for
 *  the title key it is A to Z or Z to A (see `gridSortDirectionOptions`). */
export type GridSortDirection = "asc" | "desc";

export interface GridSort {
  key: GridSortKey;
  direction: GridSortDirection;
}

/**
 * The default reads like the board always has: most recent activity first.
 * `updatedAt` newest-first is the standing unranked order every lane uses
 * (components/grouping.ts `derivedCompare`), so picking "No grouping" changes
 * the frame and not the reading order.
 */
export const DEFAULT_GRID_SORT: GridSort = { key: "activity", direction: "desc" };

/** The View menu's "Sort by" row, in the order it renders. */
export const GRID_SORT_KEYS: readonly { value: GridSortKey; label: string }[] = [
  { value: "activity", label: "Last activity" },
  { value: "created", label: "Created" },
  { value: "title", label: "Alphabetical" },
];

/**
 * The direction a key starts in when the operator picks it: newest first for
 * the two dates (the board's reading order), A to Z for titles (the order an
 * alphabetical list is expected in). Picking a new key resets the direction
 * to this, so "Alphabetical" never inherits "Oldest first" from the activity
 * key and read as Z to A.
 */
export function defaultDirectionFor(key: GridSortKey): GridSortDirection {
  return key === "title" ? "asc" : "desc";
}

/**
 * The "Order" pair's labels for the chosen key. The labels name the axis the
 * key actually measures — "Newest first" is meaningless on a title sort and
 * "A to Z" is meaningless on a date.
 */
export function gridSortDirectionOptions(
  key: GridSortKey,
): readonly { value: GridSortDirection; label: string }[] {
  return key === "title"
    ? [
        { value: "asc", label: "A to Z" },
        { value: "desc", label: "Z to A" },
      ]
    : [
        { value: "desc", label: "Newest first" },
        { value: "asc", label: "Oldest first" },
      ];
}

function titleCompare(a: PluginSidebarThread, b: PluginSidebarThread): number {
  // Case- and accent-insensitive, digits read as numbers ("thread 9" before
  // "thread 10"), so an alphabetical grid reads the way a human alphabetizes.
  return a.displayTitle.localeCompare(b.displayTitle, undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function primaryCompare(
  a: PluginSidebarThread,
  b: PluginSidebarThread,
  key: GridSortKey,
): number {
  if (key === "title") return titleCompare(a, b);
  if (key === "created") return a.createdAt - b.createdAt;
  return a.updatedAt - b.updatedAt;
}

/**
 * The grid's one comparator. The chosen key decides first; the direction
 * flips it; two cards that tie fall back to title then thread id, so the
 * order is TOTAL — a re-render, a live-data push, or a second window never
 * shuffles tied cards into a different arrangement.
 */
export function compareGridSort(
  a: PluginSidebarThread,
  b: PluginSidebarThread,
  sort: GridSort,
): number {
  const primary = primaryCompare(a, b, sort.key);
  if (primary !== 0) return sort.direction === "asc" ? primary : -primary;
  const tied = titleCompare(a, b);
  if (tied !== 0) return tied;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One grid's card list in the chosen order (never mutates the input). */
export function sortGridCards<T extends PluginSidebarThread>(
  cards: readonly T[],
  sort: GridSort,
): T[] {
  return [...cards].sort((a, b) => compareGridSort(a, b, sort));
}

