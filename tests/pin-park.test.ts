// Pin-park record contract: parse is fail-loud, stamp is refresh-provenance.
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { parsePinParkRecord, pinStateChangeFromEvent, stampPinPark } from "../lib/pin-park";

describe("parsePinParkRecord", () => {
  it("absent and null mean nothing parked", () => {
    expect(parsePinParkRecord(undefined)).toBeNull();
    expect(parsePinParkRecord(null)).toBeNull();
  });

  it("a well-formed record parses", () => {
    expect(parsePinParkRecord({ parkedAt: "2026-09-29T12:00:00.000Z" })).toEqual({
      parkedAt: "2026-09-29T12:00:00.000Z",
    });
  });

  it("a malformed present value throws — fail loud, never coerce", () => {
    expect(() => parsePinParkRecord("2026-09-29" as unknown as JsonValue)).toThrow();
    expect(() => parsePinParkRecord({} as JsonValue)).toThrow(
      /invalid parkedAt/,
    );
    expect(() =>
      parsePinParkRecord({ parkedAt: "not-a-date" } as JsonValue),
    ).toThrow(/invalid parkedAt/);
    expect(() =>
      parsePinParkRecord({ parkedAt: 42 } as unknown as JsonValue),
    ).toThrow(/invalid parkedAt/);
    expect(() => parsePinParkRecord([1] as unknown as JsonValue)).toThrow(
      /expected object, got array/,
    );
  });
});

describe("pinStateChangeFromEvent — the cross-surface pin feed", () => {
  const pinEvent = (changes: unknown, id: string | null = "thr_a") => ({
    type: "changed",
    entity: "thread",
    id,
    changes,
  });

  it("extracts the thread id from a pin-state-changed event", () => {
    expect(pinStateChangeFromEvent(pinEvent(["pin-state-changed"]))).toBe("thr_a");
  });

  it("reads the id even among other change kinds in the same event", () => {
    expect(
      pinStateChangeFromEvent(pinEvent(["read-state-changed", "pin-state-changed"])),
    ).toBe("thr_a");
  });

  it("ignored kinds, entities, missing ids, and junk return null", () => {
    expect(pinStateChangeFromEvent(pinEvent(["read-state-changed"]))).toBeNull();
    expect(pinStateChangeFromEvent({ ...pinEvent(["pin-state-changed"]), entity: "project" })).toBeNull();
    expect(pinStateChangeFromEvent(pinEvent(["pin-state-changed"], null))).toBeNull();
    expect(pinStateChangeFromEvent(pinEvent(["pin-state-changed"], ""))).toBeNull();
    expect(pinStateChangeFromEvent(null)).toBeNull();
    expect(pinStateChangeFromEvent("nope")).toBeNull();
    expect(pinStateChangeFromEvent({ entity: "thread", id: "thr_a", changes: "pin-state-changed" })).toBeNull();
  });
});

describe("stampPinPark", () => {
  it("a first park stamps now", () => {
    const now = new Date("2026-09-29T12:00:00.000Z");
    expect(stampPinPark(null, now)).toEqual({ parkedAt: "2026-09-29T12:00:00.000Z" });
  });

  it("re-parking refreshes the stamp — a prior park never survives a newer gesture", () => {
    const now = new Date("2026-09-29T15:00:00.000Z");
    expect(
      stampPinPark({ parkedAt: "2026-09-29T12:00:00.000Z" }, now),
    ).toEqual({ parkedAt: "2026-09-29T15:00:00.000Z" });
  });
});