/**
 * The sweep threshold config: two value+unit pairs — the Done-archive arm
 * and the long-idle arm — stored as one KV row (`sweep-config` on the
 * server) instead of four declared settings. The move exists for the
 * settings page: bb's host-rendered settings form draws one control per
 * declared setting with no composite row, so a `[number] [unit]` pair needs
 * a plugin-rendered settings section, which means plugin-owned storage.
 *
 * Pure data + validation, no imports beyond lib/duration, so both the
 * server bundle and the app-side settings component share one model (the
 * same rule lib/duration.ts follows).
 */

import {
  ARCHIVE_UNITS,
  DEFAULT_ARCHIVE_UNIT,
  DEFAULT_ARCHIVE_VALUE,
  type ArchiveUnit,
} from "./duration";

/**
 * Count caps per arm, in the configured unit — the garbage rail the old
 * descriptor schemas enforced (365 for the Done arm, 3650 for idle), kept
 * identical so the CLI's messages and the RPC boundary reject the same
 * values they always did.
 */
export const DONE_ARCHIVE_VALUE_CAP = 365;
export const IDLE_ARCHIVE_VALUE_CAP = 3650;

export type SweepConfig = {
  doneArchiveValue: number;
  doneArchiveUnit: ArchiveUnit;
  idleArchiveValue: number;
  idleArchiveUnit: ArchiveUnit;
};

/** Both arms default to 2 days — the operator-tuned aggressive default. */
export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  doneArchiveValue: DEFAULT_ARCHIVE_VALUE,
  doneArchiveUnit: DEFAULT_ARCHIVE_UNIT,
  idleArchiveValue: DEFAULT_ARCHIVE_VALUE,
  idleArchiveUnit: DEFAULT_ARCHIVE_UNIT,
};

const UNIT_SET: ReadonlySet<string> = new Set(ARCHIVE_UNITS);

/** An arm's count: a whole number between 1 and the arm's cap. */
export function isValidSweepValue(value: unknown, cap: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= cap
  );
}

function isArchiveUnit(value: unknown): value is ArchiveUnit {
  return typeof value === "string" && UNIT_SET.has(value);
}

/**
 * The strict row parser — the single encoding the server's read accepts and
 * its write persists, so a written row round-trips instead of failing
 * validation on the next read. Returns null for anything else; callers
 * decide the failure policy (the config row fails loud — unlike the keep
 * store's warn-and-reset, a silent default reset would change what the
 * sweep archives without a trace).
 */
export function parseSweepConfigRow(raw: unknown): SweepConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).length !== 4) return null;
  if (!isValidSweepValue(row.doneArchiveValue, DONE_ARCHIVE_VALUE_CAP)) return null;
  if (!isArchiveUnit(row.doneArchiveUnit)) return null;
  if (!isValidSweepValue(row.idleArchiveValue, IDLE_ARCHIVE_VALUE_CAP)) return null;
  if (!isArchiveUnit(row.idleArchiveUnit)) return null;
  return {
    doneArchiveValue: row.doneArchiveValue,
    doneArchiveUnit: row.doneArchiveUnit,
    idleArchiveValue: row.idleArchiveValue,
    idleArchiveUnit: row.idleArchiveUnit,
  };
}

/** A partial write: any subset of the four fields. */
export type SweepConfigPatch = Partial<SweepConfig>;
