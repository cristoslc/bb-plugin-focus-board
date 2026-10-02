/**
 * Time-unit constants and the sweep threshold's value+unit model — pure
 * data, no imports, so both the app-side sweep (lib/sweep.ts) and the
 * server-side CLI mirror (lib/sweep-cli.ts) can share one definition
 * without dragging app-only modules into the server bundle.
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

/** The units an operator can pick for a sweep threshold. */
export const ARCHIVE_UNITS = ["hours", "days", "weeks"] as const;
export type ArchiveUnit = (typeof ARCHIVE_UNITS)[number];

/** Exact epoch-ms length of each unit. Integers all the way down: a
 *  whole-number value times one of these is an exact ms threshold, so the
 *  "age >= threshold" boundary never hits float drift (the reason
 *  fractional-days was rejected for the hours case). */
export const UNIT_MS: Record<ArchiveUnit, number> = {
  hours: HOUR_MS,
  days: DAY_MS,
  weeks: WEEK_MS,
};

/**
 * Sweep thresholds default to 2 days per arm — the operator-tuned
 * "aggressive" default (a Done thread is retired after 2 days; a quiet
 * thread after 2 days idle).
 */
export const DEFAULT_ARCHIVE_VALUE = 2;
export const DEFAULT_ARCHIVE_UNIT: ArchiveUnit = "days";

/** Resolve a value+unit pair into an exact epoch-ms duration. */
export function archiveThresholdMs(value: number, unit: ArchiveUnit): number {
  return value * UNIT_MS[unit];
}
