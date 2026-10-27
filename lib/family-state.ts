// Family fold + idle-hide server state helpers.
//
// Two deliberate-toggle SETS used to live in browser localStorage:
// `focus-board:collapsedFamilies` (the parent ids whose nested child rows are
// folded, plus Done-projection keys `done:<parent id>`) and
// `focus-board:hideIdleChildren` (the same key space for the child section's
// idle filter). localStorage is per-browser, so the sets never followed the
// operator to a second machine and only reached a same-machine second window
// through the `storage` event. They now live in ONE plugin-wide KV row, key
// `focus-board:family-state` → `{ collapsedFamilies, hideIdleChildren }`,
// exactly the shape of the plugin's other board-global stores (the groups
// registry, the done index, the rank orders, the keep flags). The row holds
// PARENT thread ids plus Done-projection keys; every id absent from a list
// renders expanded / not-hidden (the default), so each list only ever
// records deliberate toggles.
//
// Why a plugin-wide KV row and not per-thread plugin metadata
// (`threads.getPluginMetadata`): the stored value is a board-global set whose
// key space includes synthetic `done:<parent id>` projection keys that are
// not thread ids, and reading per-thread metadata would mean an N+1 scan
// (`threads.list({})` then one `getPluginMetadata` per row) on every window
// load and every refetch, the shape `link_list`/`error_acks_list` pay for
// genuinely per-thread facts. The tradeoff (bb plugin storage rather than the
// `threads.*PluginMetadata` surface by name, and a whole-row rewrite that
// serializes through the server's KV write lock) is recorded in the pull
// request.
//
// Like every other stored value, everything here is pure — no host, no SDK —
// so the RPC layer and tests drive it directly.

/** The plugin KV key the two family-state sets live under. */
export const FAMILY_STATE_KV_KEY = "focus-board:family-state";

/** The two deliberate-toggle sets the row carries. */
export const FAMILY_STATE_KEYS = ["collapsedFamilies", "hideIdleChildren"] as const;

export type FamilyStateKey = (typeof FAMILY_STATE_KEYS)[number];

/** The parsed row: the two id lists, canonical order (sorted, deduped). */
export interface FamilyStateStore {
  readonly collapsedFamilies: readonly string[];
  readonly hideIdleChildren: readonly string[];
}

export const EMPTY_FAMILY_STATE: FamilyStateStore = {
  collapsedFamilies: [],
  hideIdleChildren: [],
};

/** Sorted and deduped, so equal sets round-trip byte-identical. */
function canonicalIds(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Parse the KV row. Absent (undefined/null) means "nothing folded or hidden
 * yet" → empty, which is not a failure: a fresh install has no row. A
 * present-but-malformed row THROWS (fail loud, never coerce): a half-read
 * set would silently re-open a family the operator deliberately folded, the
 * exact "my fold vanished" failure this store exists to prevent. Only the
 * two named lists are read; a foreign extra field is ignored, not an error.
 */
export function parseFamilyStateStore(raw: unknown): FamilyStateStore {
  if (raw === undefined || raw === null) return EMPTY_FAMILY_STATE;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const got = Array.isArray(raw) ? "array" : typeof raw;
    throw new Error(`family state store: expected object, got ${got}`);
  }
  const record = raw as Record<string, unknown>;
  const readList = (key: FamilyStateKey): string[] => {
    const value = record[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new Error(
        `family state store: ${key} must be an array, got ${typeof value}`,
      );
    }
    return value.map((entry, index) => {
      if (typeof entry !== "string" || entry === "") {
        throw new Error(
          `family state store: ${key}[${index}] must be a non-empty string, got ${JSON.stringify(entry)}`,
        );
      }
      return entry;
    });
  };
  return {
    collapsedFamilies: readList("collapsedFamilies"),
    hideIdleChildren: readList("hideIdleChildren"),
  };
}

/** The row shape written back — must satisfy parseFamilyStateStore. */
export function familyStateRowFromStore(
  store: FamilyStateStore,
): Record<FamilyStateKey, string[]> {
  return {
    collapsedFamilies: canonicalIds(store.collapsedFamilies),
    hideIdleChildren: canonicalIds(store.hideIdleChildren),
  };
}

/** True when both lists are empty (the migration's "server store is empty" test). */
export function isFamilyStateEmpty(store: FamilyStateStore): boolean {
  return (
    store.collapsedFamilies.length === 0 && store.hideIdleChildren.length === 0
  );
}

/** Whether two stores carry the same two sets, in canonical order. */
export function sameFamilyState(
  a: FamilyStateStore,
  b: FamilyStateStore,
): boolean {
  const left = familyStateRowFromStore(a);
  const right = familyStateRowFromStore(b);
  return (
    left.collapsedFamilies.length === right.collapsedFamilies.length &&
    left.hideIdleChildren.length === right.hideIdleChildren.length &&
    left.collapsedFamilies.every((id, i) => id === right.collapsedFamilies[i]) &&
    left.hideIdleChildren.every((id, i) => id === right.hideIdleChildren[i])
  );
}

/**
 * One deliberate toggle: add or remove `id` in `key`'s set. Returns the SAME
 * reference when the toggle is a no-op (the id was already in the requested
 * state), so the server can skip both the KV write and the realtime publish —
 * a re-run of any surface reports the settled call instead of re-writing.
 */
export function toggleFamilyStateId(
  store: FamilyStateStore,
  key: FamilyStateKey,
  id: string,
  on: boolean,
): FamilyStateStore {
  const current = new Set(store[key]);
  if (current.has(id) === on) return store;
  if (on) current.add(id);
  else current.delete(id);
  return { ...store, [key]: canonicalIds(current) };
}

/**
 * Union the incoming ids into both sets (the one-time migration write). Never
 * removes: the merge can only add a fold the server did not already hold, so a
 * migration can never erase state a newer window wrote.
 */
export function mergeFamilyStateIds(
  store: FamilyStateStore,
  incoming: Partial<Record<FamilyStateKey, readonly string[]>>,
): FamilyStateStore {
  return {
    collapsedFamilies: canonicalIds([
      ...store.collapsedFamilies,
      ...(incoming.collapsedFamilies ?? []),
    ]),
    hideIdleChildren: canonicalIds([
      ...store.hideIdleChildren,
      ...(incoming.hideIdleChildren ?? []),
    ]),
  };
}

/**
 * The one-time migration decision: the store to write when localStorage still
 * holds folds the server does not. Null when there is nothing to do — the
 * server already holds state (it is authoritative; stale localStorage must
 * never win) or localStorage holds nothing.
 */
export function familyStateMigration(
  server: FamilyStateStore,
  local: { collapsedFamilies: readonly string[]; hideIdleChildren: readonly string[] },
): FamilyStateStore | null {
  if (!isFamilyStateEmpty(server)) return null;
  if (local.collapsedFamilies.length === 0 && local.hideIdleChildren.length === 0) {
    return null;
  }
  return {
    collapsedFamilies: canonicalIds(local.collapsedFamilies),
    hideIdleChildren: canonicalIds(local.hideIdleChildren),
  };
}
