import type { GroupBy, SwimlaneBy } from "./grouping";

/**
 * The "Nest child threads" toggle's localStorage persistence (R3). The
 * parsing lives here — pure, unit-testable without a DOM — so app.tsx only
 * wires localStorage access around it.
 */

export const NEST_CHILDREN_KEY = "focus-board:nestChildren";

/** Stored values are `"on"`/`"off"`; anything else (or nothing) defaults to ON. */
export function parseNestStored(raw: string | null): boolean {
  return raw === "off" ? false : true;
}

export function nestStoredValue(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

/** The Group-by dropdown's localStorage persistence (D1). */
export const GROUP_BY_KEY = "focus-board:groupBy";

const ALLOWED_GROUP_BY: readonly GroupBy[] = [
  "none",
  "status",
  "recency",
  "project",
  "provider",
  "machine",
  "parent",
];

/** Validate a stored group-by value; anything stale or unknown falls back to Attention. */
export function parseGroupStored(raw: string | null): GroupBy {
  return (ALLOWED_GROUP_BY as readonly string[]).includes(raw ?? "")
    ? (raw as GroupBy)
    : "status";
}

/** The parent-lane board lane-order toggle (D5a): recency (default) or project grouping. */
export const PARENT_LANE_ORDER_KEY = "focus-board:parentLaneOrder";

export type ParentLaneOrder = "recency" | "project";

const ALLOWED_PARENT_LANE_ORDER: readonly ParentLaneOrder[] = ["recency", "project"];

/** Validate the stored lane-order value; anything stale or unknown falls back to recency. */
export function parseParentLaneOrderStored(raw: string | null): ParentLaneOrder {
  return (ALLOWED_PARENT_LANE_ORDER as readonly string[]).includes(raw ?? "")
    ? (raw as ParentLaneOrder)
    : "recency";
}

/**
 * Collapsed family cards' persistence. The stored list holds the PARENT
 * thread ids whose nested child rows are collapsed; every id absent from it
 * renders expanded (the default), so the list only ever records deliberate
 * collapses. Tolerant like every other stored value: corrupt JSON, a
 * non-array, or non-string entries degrade to fewer (or zero) collapsed
 * families, never to a board that fails to load.
 */
export const COLLAPSED_FAMILIES_KEY = "focus-board:collapsedFamilies";

export function parseCollapsedFamiliesStored(raw: string | null): ReadonlySet<string> {
  if (raw === null || raw === "") return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

/** Sorted for a stable stored form, so equal sets round-trip byte-identical. */
export function collapsedFamiliesStoredValue(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}

/**
 * The server-declared boolean setting backing the thread pane's Escape
 * behavior (see server.ts `escStopsRunningThread`). Only an explicit stored
 * `false` is off: while loading, unset (default applied host-side as true),
 * or an unexpected type, the default ON applies.
 */
export function escStopsRunningFromSetting(
  value: string | number | boolean | undefined,
): boolean {
  return value !== false;
}

/** The Swimlanes dropdown's localStorage persistence. */
export const SWIMLANE_BY_KEY = "focus-board:swimlaneBy";

const ALLOWED_SWIMLANE_BY: readonly SwimlaneBy[] = [
  "none",
  "status",
  "recency",
  "project",
  "provider",
  "machine",
];

/** Validate a stored swimlane value; anything stale or unknown falls back to no lanes. */
export function parseSwimlaneStored(raw: string | null): SwimlaneBy {
  return (ALLOWED_SWIMLANE_BY as readonly string[]).includes(raw ?? "")
    ? (raw as SwimlaneBy)
    : "none";
}

/**
 * Collapsed swimlanes, keyed `<swimlaneBy>:<laneId>` so folding the "Personal"
 * project lane does not also fold a provider lane that happens to share an id.
 * Same tolerant parse as the collapsed families list.
 */
export const COLLAPSED_SWIMLANES_KEY = "focus-board:collapsedSwimlanes";
export const parseCollapsedSwimlanesStored = parseCollapsedFamiliesStored;
export const collapsedSwimlanesStoredValue = collapsedFamiliesStoredValue;
