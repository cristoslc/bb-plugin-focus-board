import { describe, expect, it } from "vitest";
import {
  DEFAULT_SWEEP_CONFIG,
  DONE_ARCHIVE_VALUE_CAP,
  IDLE_ARCHIVE_VALUE_CAP,
  isValidSweepValue,
  parseSweepConfigRow,
} from "../lib/sweep-config";

const row = (overrides: Record<string, unknown> = {}) => ({
  doneArchiveValue: 2,
  doneArchiveUnit: "days",
  idleArchiveValue: 3,
  idleArchiveUnit: "weeks",
  ...overrides,
});

describe("sweep config model", () => {
  it("defaults both arms to 2 days", () => {
    expect(DEFAULT_SWEEP_CONFIG).toEqual({
      doneArchiveValue: 2,
      doneArchiveUnit: "days",
      idleArchiveValue: 2,
      idleArchiveUnit: "days",
    });
  });

  it("parseSweepConfigRow round-trips a written row", () => {
    const written = {
      doneArchiveValue: 14,
      doneArchiveUnit: "hours",
      idleArchiveValue: 1,
      idleArchiveUnit: "weeks",
    };
    expect(parseSweepConfigRow(written)).toEqual(written);
  });

  it("parseSweepConfigRow rejects non-object rows", () => {
    expect(parseSweepConfigRow(null)).toBeNull();
    expect(parseSweepConfigRow(undefined)).toBeNull();
    expect(parseSweepConfigRow("2 days")).toBeNull();
    expect(parseSweepConfigRow([2, "days", 2, "days"])).toBeNull();
  });

  it("parseSweepConfigRow rejects rows with wrong field counts", () => {
    expect(parseSweepConfigRow({})).toBeNull();
    expect(parseSweepConfigRow({ doneArchiveValue: 2 })).toBeNull();
    expect(
      parseSweepConfigRow({
        ...row(),
        extra: true,
      }),
    ).toBeNull();
  });

  it("parseSweepConfigRow rejects out-of-range or fractional counts", () => {
    expect(parseSweepConfigRow(row({ doneArchiveValue: 0 }))).toBeNull();
    expect(parseSweepConfigRow(row({ doneArchiveValue: -1 }))).toBeNull();
    expect(parseSweepConfigRow(row({ doneArchiveValue: 2.5 }))).toBeNull();
    expect(
      parseSweepConfigRow(row({ idleArchiveValue: IDLE_ARCHIVE_VALUE_CAP + 1 })),
    ).toBeNull();
    // Exactly at each cap is still valid.
    expect(parseSweepConfigRow(row({ doneArchiveValue: DONE_ARCHIVE_VALUE_CAP })))
      .not.toBeNull();
    expect(parseSweepConfigRow(row({ idleArchiveValue: IDLE_ARCHIVE_VALUE_CAP })))
      .not.toBeNull();
  });

  it("parseSweepConfigRow rejects foreign units and types", () => {
    expect(parseSweepConfigRow(row({ doneArchiveUnit: "fortnights" }))).toBeNull();
    expect(parseSweepConfigRow(row({ idleArchiveUnit: 7 }))).toBeNull();
    expect(parseSweepConfigRow(row({ doneArchiveValue: "2" }))).toBeNull();
  });

  it("isValidSweepValue bounds counts per cap", () => {
    expect(isValidSweepValue(1, 365)).toBe(true);
    expect(isValidSweepValue(365, 365)).toBe(true);
    expect(isValidSweepValue(0, 365)).toBe(false);
    expect(isValidSweepValue(366, 365)).toBe(false);
    expect(isValidSweepValue(1.5, 365)).toBe(false);
    expect(isValidSweepValue("2", 365)).toBe(false);
  });
});
