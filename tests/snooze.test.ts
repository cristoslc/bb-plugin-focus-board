import { describe, expect, it, vi } from "vitest";
import {
  SNOOZE_METADATA_KEY,
  describeWakeAt,
  parseSnoozeRecord,
  parseWhenArg,
  presetWakeAt,
  snoozeMenuActions,
  stampSnooze,
} from "../lib/snooze";

describe("parseSnoozeRecord", () => {
  it("round-trips a stamped record", () => {
    const record = stampSnooze(
      new Date("2026-10-02T10:00:00.000Z"),
      new Date("2026-10-02T12:00:00.000Z"),
    );
    expect(parseSnoozeRecord(record)).toEqual(record);
  });

  it("absent and null mean not snoozed", () => {
    expect(parseSnoozeRecord(undefined)).toBeNull();
    expect(parseSnoozeRecord(null)).toBeNull();
  });

  it("fails loud on malformed values (never coerces)", () => {
    expect(() => parseSnoozeRecord(123 as never)).toThrow(/expected object/);
    expect(() => parseSnoozeRecord([1] as never)).toThrow(/expected object/);
    expect(() =>
      parseSnoozeRecord({ wakeAt: 123, setAt: "2026-10-02T10:00:00.000Z" } as never),
    ).toThrow(/wakeAt/);
    expect(() =>
      parseSnoozeRecord({ wakeAt: "nope", setAt: "2026-10-02T10:00:00.000Z" } as never),
    ).toThrow(/wakeAt/);
    expect(() =>
      parseSnoozeRecord({ wakeAt: "2026-10-02T12:00:00.000Z", setAt: null } as never),
    ).toThrow(/setAt/);
  });
});

describe("stampSnooze", () => {
  it("stamps wakeAt and setAt as ISO strings", () => {
    const now = new Date("2026-10-02T10:00:00.000Z");
    const wakeAt = new Date("2026-10-02T12:00:00.000Z");
    expect(stampSnooze(now, wakeAt)).toEqual({
      wakeAt: "2026-10-02T12:00:00.000Z",
      setAt: "2026-10-02T10:00:00.000Z",
    });
  });
});

describe("presetWakeAt", () => {
  it("adds exact hours for 1h and 4h", () => {
    const now = new Date("2026-10-02T10:00:00.000Z");
    expect(presetWakeAt("1h", now).toISOString()).toBe("2026-10-02T11:00:00.000Z");
    expect(presetWakeAt("4h", now).toISOString()).toBe("2026-10-02T14:00:00.000Z");
  });

  it("lands tomorrow 9:00 local, via date arithmetic (DST-safe)", () => {
    const now = new Date("2026-10-02T10:00:00.000Z");
    const wake = presetWakeAt("tomorrow9", now);
    expect(wake.getDate()).toBe(now.getDate() + 1);
    expect(wake.getHours()).toBe(9);
    expect(wake.getMinutes()).toBe(0);
    expect(wake.getSeconds()).toBe(0);
  });

  it("keeps the same local time of day one week out", () => {
    const now = new Date("2026-10-02T10:00:00.000Z");
    const wake = presetWakeAt("1week", now);
    expect(wake.getDate()).toBe(now.getDate() + 7);
    expect(wake.getHours()).toBe(now.getHours());
    expect(wake.getMinutes()).toBe(now.getMinutes());
  });
});

describe("parseWhenArg (CLI)", () => {
  const now = new Date("2026-10-02T10:00:00.000Z");

  it("parses relative durations +N<m|h|d|w>", () => {
    expect(parseWhenArg("+30m", now)?.getTime()).toBe(now.getTime() + 30 * 60_000);
    expect(parseWhenArg("+4h", now)?.getTime()).toBe(now.getTime() + 4 * 3_600_000);
    expect(parseWhenArg("+1d", now)?.getTime()).toBe(now.getTime() + 86_400_000);
    expect(parseWhenArg("+1w", now)?.getTime()).toBe(now.getTime() + 7 * 86_400_000);
  });

  it("parses a future epoch-valid timestamp", () => {
    expect(parseWhenArg("2026-10-02T12:00:00.000Z", now)?.toISOString()).toBe(
      "2026-10-02T12:00:00.000Z",
    );
  });

  it("rejects garbage, the past, and 'now'", () => {
    expect(parseWhenArg("nope", now)).toBeNull();
    expect(parseWhenArg("2026-10-02T09:00:00.000Z", now)).toBeNull();
    expect(parseWhenArg("2026-10-02T10:00:00.000Z", now)).toBeNull();
  });
});

describe("describeWakeAt", () => {
  // Fixtures construct concrete local clock times so assertions hold in
  // every timezone the suite runs in.
  const todayAt = (hour: number) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  it("says 'today at H:MM' for a wake later today", () => {
    const now = todayAt(9);
    const wake = todayAt(14);
    expect(describeWakeAt(wake.getTime(), now.getTime())).toBe("today at 2:00 PM");
  });

  it("says 'tomorrow at H:MM' for a wake the next calendar day", () => {
    const now = todayAt(15);
    const wake = todayAt(10);
    wake.setDate(wake.getDate() + 1);
    expect(describeWakeAt(wake.getTime(), now.getTime())).toBe("tomorrow at 10:00 AM");
  });

  it("names the month and day further out", () => {
    const now = todayAt(15);
    const wake = todayAt(10);
    wake.setDate(wake.getDate() + 5);
    const label = wake.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const time = wake.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(describeWakeAt(wake.getTime(), now.getTime())).toBe(`${label} at ${time}`);
  });
});

describe("SNOOZE_METADATA_KEY", () => {
  it("names the board's snooze key in its metadata namespace", () => {
    expect(SNOOZE_METADATA_KEY).toBe("snooze");
  });
});

describe("snoozeMenuActions", () => {
  it("a snoozed thread gets exactly one Unsnooze entry that clears", () => {
    const clearSnooze = vi.fn();
    const openPicker = vi.fn();
    const entries = snoozeMenuActions({
      snoozed: true,
      clearSnooze,
      openPicker,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("Unsnooze");
    expect(entries[0].icon).toBe("ClockArrowUp");
    expect(entries[0].dividerAbove).toBe(true);
    entries[0].run();
    expect(clearSnooze).toHaveBeenCalledTimes(1);
    expect(openPicker).not.toHaveBeenCalled();
  });

  it("an unsnoozed thread gets ONE Snooze… entry that opens the picker (the ladder lives in the picker, not the menu)", () => {
    const openPicker = vi.fn();
    const entries = snoozeMenuActions({
      snoozed: false,
      clearSnooze: vi.fn(),
      openPicker,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("snooze");
    expect(entries[0].label).toBe("Snooze…");
    expect(entries[0].icon).toBe("Clock");
    expect(entries[0].dividerAbove).toBe(true);
    entries[0].run();
    expect(openPicker).toHaveBeenCalledTimes(1);
  });
});