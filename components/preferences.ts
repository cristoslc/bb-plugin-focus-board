import type { GroupBy } from "./grouping";

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
