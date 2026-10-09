// Feature-group record helpers for the board's thread family boxes.
//
// A feature group is a NAMED CONTAINER for unrelated sibling threads — an
// epic without a parent thread. Two pieces of state carry it:
//
// - the registry: one plugin KV row, key "focus-board:groups" →
//   Record<groupId, { name, createdAt }> (the names live in exactly one
//   place; a rename propagates to every member card through it);
// - membership: per-thread plugin metadata, key "group" →
//   { groupId: string }. Absent key = unassigned.
//
// A group record holds NO members — membership always derives from the
// per-thread keys, so the record is delete-able the moment the last
// assignment clears (the "only exists while assigned" rule) without a
// reverse-index sweep ever lying.
//
// Like the done/snooze/pin-park helpers, everything here is pure — no host,
// no SDK — so the RPC layer and tests drive it directly.
import type { JsonValue } from "@get-bb/plugin-sdk";

/** The board's group-assignment key inside thread plugin metadata. */
export const GROUP_METADATA_KEY = "group";

/** The settled membership record shape: key "group" → { groupId }. */
export type GroupMemberRecord = { groupId: string };

/**
 * The registry row stored under GROUPS_KV_KEY: groupId → name stamps.
 * groupId is an opaque id (server-generated UUID); the name alone is
 * display data.
 */
export type GroupsStore = Readonly<Record<string, GroupRecord>>;

export type GroupRecord = { name: string; createdAt: string };

/** The plugin KV key the registry lives under. */
export const GROUPS_KV_KEY = "focus-board:groups";

/**
 * Parse a metadata value into a GroupMemberRecord.
 *
 * Absent (undefined) and null mean "not assigned" → null. A malformed
 * present value throws (fail loud, never coerce): the board wraps cards
 * from this record, so a wrong shape is a bug to surface, not data to
 * paper over.
 */
export function parseGroupMember(value: JsonValue | undefined): GroupMemberRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`group metadata: expected object, got ${got}`);
  }
  const groupId = (value as { [key: string]: JsonValue })["groupId"];
  if (typeof groupId !== "string" || groupId === "") {
    throw new Error(
      `group metadata: invalid groupId ${JSON.stringify(groupId)}`,
    );
  }
  return { groupId };
}

/**
 * Parse the KV registry row.
 *
 * Absent (undefined/null) means "no groups yet" → empty store, which is
 * not a failure: a fresh install has no row. A present-but-malformed row
 * THROWS — box labels come straight from these names, and a half-read
 * registry silently losing a group would look like the box evaporating.
 * A `__proto__` key is rejected: the store spreads into object literals
 * on writes, and the key would reassign the prototype (the same shape
 * hazard the rank store's COLUMN_KEY_SCHEMA guards).
 */
export function parseGroupsStore(raw: unknown): GroupsStore {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const got = Array.isArray(raw) ? "array" : typeof raw;
    throw new Error(`groups store: expected object, got ${got}`);
  }
  const out: Record<string, GroupRecord> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (id === "__proto__") {
      throw new Error("groups store: __proto__ is not a legitimate group id");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      const got = Array.isArray(value) ? "array" : typeof value;
      throw new Error(
        `groups store: group ${JSON.stringify(id)} record is ${got}`,
      );
    }
    const record = value as { [key: string]: unknown };
    if (typeof record.name !== "string" || record.name.trim() === "") {
      throw new Error(
        `groups store: group ${JSON.stringify(id)} has an invalid name ${JSON.stringify(record.name)}`,
      );
    }
    if (
      typeof record.createdAt !== "string" ||
      Number.isNaN(Date.parse(record.createdAt))
    ) {
      throw new Error(
        `groups store: group ${JSON.stringify(id)} has an invalid createdAt ${JSON.stringify(record.createdAt)}`,
      );
    }
    out[id] = { name: record.name, createdAt: record.createdAt };
  }
  return out;
}

/** The row shape written back to storage — must satisfy parseGroupsStore. */
export function groupsRowFromStore(store: GroupsStore): Record<string, GroupRecord> {
  return Object.fromEntries(Object.entries(store).map(([id, record]) => [id, { ...record }]));
}

/**
 * Stamp a fresh registry record: createdAt = now, name persisted as given
 * (the caller normalizes; the shape keeps whatever the caller settled).
 */
export function createGroupRecord(name: string, now: Date): GroupRecord {
  return { name, createdAt: now.toISOString() };
}

/**
 * Accept a name from the create/rename surfaces: trimmed, 1–80 characters.
 * The cap matches the ticket-chip label cap (lib/link-metadata's external
 * `label`), the longest string a card's small text already shows. Returns
 * null for anything that would store an empty name — callers keep a
 * disabled confirm button instead of guessing a fallback (never coerce).
 */
export function normalizeGroupName(raw: string): string | null {
  const name = raw.trim();
  if (name === "" || name.length > 80) return null;
  return name;
}

/**
 * Delete registry records that no thread references anymore. `memberCounts`
 * carries groupId → number of assigned threads (live AND archived — an
 * archived member still counts, because its assignment persists and the
 * group must reappear when the thread returns). A groupId absent from the
 * map counts as zero members. Mutates nothing: returns a new store.
 */
export function pruneEmptyGroups(
  store: GroupsStore,
  memberCounts: ReadonlyMap<string, number>,
): GroupsStore {
  const out: Record<string, GroupRecord> = {};
  for (const [id, record] of Object.entries(store)) {
    if ((memberCounts.get(id) ?? 0) > 0) out[id] = record;
  }
  return out;
}

/**
 * Shape of one menu entry (CardMenuAction-compatible), kept pure like
 * snoozeMenuActions so tests pin the entries without rendering the app:
 * assigned and unassigned cards both carry ONE entry opening the picker —
 * "Group…" / "Change group…"; the remove action lives in the picker's
 * footer, not the menu (three flat menu rows would drown the state
 * actions, the same failure the snooze ladder had).
 */
export interface GroupMenuAction {
  id: string;
  label: string;
  icon: string;
  dividerAbove?: boolean;
  run: () => void;
}

export function groupMenuActions(options: {
  grouped: boolean;
  openPicker: () => void;
}): [GroupMenuAction] {
  return options.grouped
    ? [
        {
          id: "group-change",
          label: "Change group…",
          icon: "Tag",
          dividerAbove: true,
          run: () => options.openPicker(),
        },
      ]
    : [
        {
          id: "group",
          label: "Group…",
          icon: "Tag",
          dividerAbove: true,
          run: () => options.openPicker(),
        },
      ];
}