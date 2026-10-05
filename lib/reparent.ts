/**
 * Re-parenting a thread under another (drop a card onto a card, or the card
 * menu's detach). The rules run in two places, so the checks live in one
 * pure, shared module:
 *
 * - the board's dragover decides, from the raw parent map it holds, whether
 *   the hovered card can receive the dragged card in its middle third — this
 *   is what switches the cursor affordance and the drop highlight;
 * - the `thread_reparent` RPC handler re-checks against its own thread rows
 *   before writing, because the UI's map can be stale between the dragover
 *   and the drop.
 *
 * A refusal is a string; null means the write is legal. Callers wrap the
 * string with the card names they know — the lib intentionally never loads
 * titles or React.
 */

/**
 * The raw parent edges a client already holds. Raw (not the display map's
 * two-level flattening): the loop and already-child checks must see the real
 * tree, so re-parenting a grandchild onto its grandparent counts as a change.
 */
export type ReparentParentOf = ReadonlyMap<string, string>;

/** The server-side row shape the RPC guard checks against. */
export interface ReparentRow {
  id: string;
  parentThreadId: string | null | undefined;
  isArchived?: boolean;
}

/**
 * The checks every caller shares: identity, the already-a-child no-op, and
 * the loop walk. A corrupt cycle in the graph (which buildFamilyIndex also
 * unlinks) must never hang the walk, so the seen set bounds it.
 */
function graphRefusal(
  parentOf: ReparentParentOf,
  childId: string,
  parentThreadId: string | null,
): string | null {
  if (childId === "") {
    return "could not identify the dropped card.";
  }
  // Detach to top level is always legal — even when the card is already a
  // root, the write is a harmless no-op the host answers.
  if (parentThreadId === null) return null;
  if (childId === parentThreadId) {
    return "a card cannot nest inside itself.";
  }
  if (parentOf.get(childId) === parentThreadId) {
    return "that card is already nested under this card.";
  }
  const seen = new Set<string>([parentThreadId]);
  let cursor: string | undefined = parentThreadId;
  while (cursor !== undefined) {
    if (cursor === childId) {
      return "a card cannot nest under one of its own children — that would close a family loop.";
    }
    const nextCursor = parentOf.get(cursor);
    if (nextCursor === undefined) break;
    if (seen.has(nextCursor)) break; // corrupt cycle; the next caller handles it
    seen.add(nextCursor);
    cursor = nextCursor;
  }
  return null;
}

/**
 * The client-side check. `parentOf` is the RAW parent map (components/
 * nesting.ts exposes it on FamilyIndex). Card existence is assumed: both ids
 * name cards the board renders.
 */
export function reparentRefusalFromParents(
  parentOf: ReparentParentOf,
  childId: string,
  parentThreadId: string | null,
): string | null {
  return graphRefusal(parentOf, childId, parentThreadId);
}

/**
 * The server-side check against fresh thread rows. Existence and archived
 * state are checked here (the server cannot assume what the board renders),
 * then the same graph checks.
 */
export function reparentRefusal(
  rows: readonly ReparentRow[],
  childId: string,
  parentThreadId: string | null,
): string | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (!byId.has(childId)) {
    return "the dropped card is no longer on the board.";
  }
  if (parentThreadId !== null && !byId.has(parentThreadId)) {
    return "the target card is no longer on the board.";
  }
  const child = byId.get(childId) as ReparentRow;
  if (child.isArchived) {
    return "an archived card cannot move.";
  }
  if (parentThreadId !== null) {
    const parent = byId.get(parentThreadId) as ReparentRow;
    if (parent.isArchived) {
      return "cannot nest under an archived card.";
    }
  }
  // Raw parent edges, tolerant of the corrupt shapes buildFamilyIndex also
  // tolerates: unknown, empty-string, and self parents drop out up front.
  const parentOf = new Map<string, string>();
  for (const row of rows) {
    const parentId = row.parentThreadId;
    if (
      parentId === undefined ||
      parentId === null ||
      parentId === "" ||
      parentId === row.id ||
      !byId.has(parentId)
    ) {
      continue;
    }
    parentOf.set(row.id, parentId);
  }
  return graphRefusal(parentOf, childId, parentThreadId);
}