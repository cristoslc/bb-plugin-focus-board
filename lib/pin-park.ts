// Pin-park record helpers for the board's lane-exit behavior.
//
// A pinned card that leaves the Pinned lane (a cross-column drop or the
// menu's Mark Done) is un-pinned as part of the gesture — column placement
// derives from the pin, so leaving the pin in place would bounce the card
// straight back. The un-pinned pin is PARKED, not destroyed: a per-thread
// plugin-metadata record lets the state writes that bring the card back to
// the operator (Mark Not Done, Mark Unread) restore the pin as it was.
//
// Park = board-owned thread plugin metadata, key "pin" →
// { parkedAt: ISO-8601 string }. Absent key = nothing parked. These helpers
// are pure — no host, no SDK — so the RPC layer and tests drive them
// directly.
import type { JsonValue } from "@get-bb/plugin-sdk";

/** The board's pin-park key inside its thread plugin-metadata namespace. */
export const PIN_PARK_METADATA_KEY = "pin";

/** The settled record shape: key "pin" → { parkedAt: ISO-8601 }. */
export type PinParkRecord = { parkedAt: string };

/**
 * Parse a metadata value into a PinParkRecord.
 *
 * Absent and null mean "nothing parked" → null. A malformed present value
 * throws (fail loud, never coerce): the park drives a restore write, so a
 * wrong shape is a bug to surface, not data to paper over — the same
 * contract parseDoneRecord holds for its sibling record.
 */
export function parsePinParkRecord(
  value: JsonValue | undefined,
): PinParkRecord | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`pin park metadata: expected object, got ${got}`);
  }
  const parkedAt = (value as { [key: string]: JsonValue })["parkedAt"];
  if (typeof parkedAt !== "string" || Number.isNaN(Date.parse(parkedAt))) {
    throw new Error(
      `pin park metadata: invalid parkedAt ${JSON.stringify(parkedAt)}`,
    );
  }
  return { parkedAt };
}

/**
 * Stamp a (re-)park: parkedAt = now. Re-parking refreshes the stamp — the
 * park moment is provenance for "this is where the pin was lost", and a
 * prior park value must not survive a newer gesture.
 */
export function stampPinPark(existing: PinParkRecord | null, now: Date): PinParkRecord {
  void existing;
  return { parkedAt: now.toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The thread id of a native `thread:changed` realtime event that carries the
 * `pin-state-changed` kind, or null when the event is not one.
 *
 * These events publish for every pin write from EVERY surface — bb's own
 * sidebar, another panel instance, the CLI — which is what lets the board
 * reconcile a parked pin without actor attribution: a foreign surface taking
 * the pin back supersedes the park, while the lane exit's own unpin echo
 * (an unpinned result) leaves it alone.
 */
export function pinStateChangeFromEvent(event: unknown): string | null {
  if (!isRecord(event)) return null;
  if (event.entity !== "thread") return null;
  if (typeof event.id !== "string" || event.id.length === 0) return null;
  if (!Array.isArray(event.changes)) return null;
  if (!event.changes.includes("pin-state-changed")) return null;
  return event.id;
}