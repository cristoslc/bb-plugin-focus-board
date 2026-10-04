// Snooze-record helpers for the board's Snooze state.
//
// Snoozed = per-thread plugin metadata in the board's own namespace: key
// "snooze" → { wakeAt: ISO-8601, setAt: ISO-8601 }. Absent key = not
// snoozed. These helpers are pure — no host, no SDK — so the RPC layer,
// the CLI, and tests drive them directly (the same contract the done and
// pin-park record helpers hold).
//
// Semantics: read now, unread later. The set gesture marks the thread read
// and stamps the record; at wakeAt the server marks the thread unread
// again. setAt is anchored at the set gesture's own read mark, so the wake
// can recognize a thread genuinely read since the snooze began (its read
// must be strictly later than the mark snoozing itself caused) and consume
// the snooze without re-alerting.
import type { JsonValue } from "@get-bb/plugin-sdk";

/** The board's Snooze key inside its thread plugin-metadata namespace. */
export const SNOOZE_METADATA_KEY = "snooze";

/** The settled record shape: key "snooze" → { wakeAt, setAt }, ISO-8601. */
export type SnoozeRecord = { wakeAt: string; setAt: string };

/** The card menu's snooze presets, in display order. */
export type SnoozePreset = "1h" | "4h" | "tomorrow9" | "1week";

export const SNOOZE_PRESETS: readonly { kind: SnoozePreset; label: string }[] = [
  { kind: "1h", label: "Snooze · 1 hour" },
  { kind: "4h", label: "Snooze · 4 hours" },
  { kind: "tomorrow9", label: "Snooze · Tomorrow 9am" },
  { kind: "1week", label: "Snooze · 1 week" },
];

/**
 * Parse a metadata value into a SnoozeRecord.
 *
 * Absent (undefined) and null mean "not snoozed" → null. A malformed
 * present value throws (fail loud, never coerce): the wake timer and the
 * board's chip both read this record, so a wrong shape is a bug to
 * surface, not data to paper over.
 */
export function parseSnoozeRecord(
  value: JsonValue | undefined,
): SnoozeRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`snooze metadata: expected object, got ${got}`);
  }
  const obj = value as { [key: string]: JsonValue };
  for (const field of ["wakeAt", "setAt"] as const) {
    const raw = obj[field];
    if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
      throw new Error(`snooze metadata: invalid ${field} ${JSON.stringify(raw)}`);
    }
  }
  return { wakeAt: obj["wakeAt"] as string, setAt: obj["setAt"] as string };
}

/** Stamp a fresh snooze record: setAt = now, wakeAt as given (ISO out). */
export function stampSnooze(now: Date, wakeAt: Date): SnoozeRecord {
  return { wakeAt: wakeAt.toISOString(), setAt: now.toISOString() };
}

/** ISO-8601 wakeAt → epoch ms; null on unparseable input (never coerces). */
export function snoozeWakeAtMs(record: SnoozeRecord): number | null {
  const ms = Date.parse(record.wakeAt);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The wake preset as a concrete local Date. Hour presets add exact
 * durations; calendar presets move by calendar days so a "Tomorrow 9am"
 * snooze stays 9am across a DST shift (local-time arithmetic, not ms).
 */
export function presetWakeAt(kind: SnoozePreset, now: Date): Date {
  const date = new Date(now);
  if (kind === "1h") date.setTime(date.getTime() + 60 * 60_000);
  else if (kind === "4h") date.setTime(date.getTime() + 4 * 60 * 60_000);
  else if (kind === "tomorrow9") {
    date.setDate(date.getDate() + 1);
    date.setHours(9, 0, 0, 0);
  } else {
    date.setDate(date.getDate() + 7);
  }
  return date;
}

/**
 * The CLI's `<when>` argument: an epoch-parseable future timestamp, or a
 * relative duration `+<N><m|h|d|w>` from `now`. Returns null on anything
 * else — including the past and "now" — and the caller surfaces that as a
 * CLI error (fail loud, never coerce).
 */
export function parseWhenArg(raw: string, now: Date): Date | null {
  const relative = /^\+(\d+)([mhdw])$/.exec(raw.trim());
  if (relative !== null) {
    const count = Number(relative[1]);
    const unitMs = {
      m: 60_000,
      h: 60 * 60_000,
      d: 24 * 60 * 60_000,
      w: 7 * 24 * 60 * 60_000,
    }[relative[2] as "m" | "h" | "d" | "w"];
    return new Date(now.getTime() + count * unitMs);
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms) || ms <= now.getTime()) return null;
  return new Date(ms);
}

/**
 * A wake time for the card chip, relative to `now`: "today at 2:15 PM",
 * "tomorrow at 9:00 AM", or "Oct 5 at 9:00 AM" further out. Hand-rolled
 * (English, like the cards' relativeTime) so tests pin behavior without
 * the global locale.
 */
export function describeWakeAt(wakeAt: number, now: number): string {
  const wake = new Date(wakeAt);
  const calendarDay = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const time = wake
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (calendarDay(wake) === calendarDay(new Date(now))) {
    return `today at ${time}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (calendarDay(wake) === calendarDay(tomorrow)) {
    return `tomorrow at ${time}`;
  }
  const day = wake.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day} at ${time}`;
}

/** Shape of one flag entry in the card's right-click menu (CardMenuAction-compatible). */
export interface SnoozeMenuAction {
  id: string;
  label: string;
  icon: string;
  dividerAbove?: boolean;
  run: () => void;
}

/**
 * The card and pane menus' snooze section, pure so tests pin the entries
 * without rendering the app. Either way the menu carries ONE entry:
 * unsnoozed → "Snooze…" opens the picker (the preset ladder lives in the
 * picker, not the menu — five flat menu rows drowned every other action);
 * snoozed → "Edit snooze…" opens the same picker in edit mode, where
 * changing the wake time and removing the wake-up live. The entry carries
 * the divider so it visually separates from the state actions above it.
 */
export function snoozeMenuActions(options: {
  snoozed: boolean;
  clearSnooze: () => void;
  openPicker: () => void;
}): SnoozeMenuAction[] {
  if (options.snoozed) {
    return [
      {
        id: "snooze-edit",
        label: "Edit snooze…",
        icon: "ClockArrowUp",
        dividerAbove: true,
        run: () => options.openPicker(),
      },
    ];
  }
  return [
    { id: "snooze", label: "Snooze…", icon: "Clock", dividerAbove: true, run: () => options.openPicker() },
  ];
}