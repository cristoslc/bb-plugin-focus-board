// The family fold-key space, shared by the card that reads a fold and the
// lane menu that folds a whole lane at once.
//
// One family's fold and idle-hide state live under ONE key: a live card's
// parent id, or `done:<parent id>` for the Done column's projection card (a
// root's two cards fold separately — the derived ruleset's Defect 8 — so the
// projection's stored fold is prefixed to keep both entries in the one
// collapsed list). The lane menu's bulk actions must write that same key,
// never a second spelling of the prefix, so the key derivation lives here and
// `components/board.tsx` reads it for the card AND for the lane.
//
// Pure on purpose — no host, no SDK — so the menu's key set is unit-testable
// beside the store helpers it writes through (lib/family-state).

/** The Done column's id: its cards are fold-space projections. */
export const DONE_LANE_ID = "done";

/**
 * The fold key of a Done projection card: a root's two cards fold separately,
 * so the projection's stored fold is prefixed to keep both entries in the one
 * collapsed list.
 */
export function foldKeyForSpace(threadId: string): string {
  return `done:${threadId}`;
}

/**
 * Does this lane's card render as the Done projection (a live root shown in
 * the Done column, carrying the family's done portion)? A done thread's own
 * card in the Done column is not a projection: it folds under its plain id.
 */
export function isDoneProjectionCard(
  laneId: string,
  cardId: string,
  doneIds: ReadonlySet<string>,
): boolean {
  return laneId === DONE_LANE_ID && !doneIds.has(cardId);
}

/** The fold key the card in this lane reads and reports. */
export function foldKeyForCard(
  laneId: string,
  cardId: string,
  doneIds: ReadonlySet<string>,
): string {
  return isDoneProjectionCard(laneId, cardId, doneIds) ? foldKeyForSpace(cardId) : cardId;
}

/**
 * The two child-row maps the board already holds: parent id → the rows that
 * render under its card. Only "is there at least one row" is read here, so
 * callers pass their own row type.
 */
export interface FamilyRowsIndex {
  readonly nestedChildrenByParent: ReadonlyMap<string, readonly unknown[]>;
  readonly doneChildrenByParent: ReadonlyMap<string, readonly unknown[]>;
}

/**
 * The fold keys of a lane's family cards, in lane order, deduplicated.
 *
 * A card is a family exactly when its card renders child rows: a projection
 * card renders the done portion (`doneChildrenByParent`), every other card
 * renders the nested rows (`nestedChildrenByParent`). A card with no rows
 * contributes nothing, so a lane of standalone cards answers an empty set and
 * the menu offers no bulk action that would do nothing.
 */
export function laneFamilyFoldKeys(
  cards: readonly { readonly id: string }[],
  laneId: string,
  doneIds: ReadonlySet<string>,
  index: FamilyRowsIndex,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const childRows = isDoneProjectionCard(laneId, card.id, doneIds)
      ? index.doneChildrenByParent.get(card.id)
      : index.nestedChildrenByParent.get(card.id);
    if (childRows === undefined || childRows.length === 0) continue;
    const key = foldKeyForCard(laneId, card.id, doneIds);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}
