// Unit moves: a group's family box is dragged (or Alt+Arrow'd) as ONE unit,
// but the rank store still stores bare thread ids. This helper extends the
// single-id move semantics to a set of ids that must END UP CONTIGUOUS and
// in their previous relative order — the whole point of a box: the members
// never interleave with foreign cards again.
//
// Every rule mirrors lib/rank's own move contract so the two paths cannot
// disagree: sparse orders (gaps preserved below the drop point), the
// display-order head ranking that makes a first drop into an unranked
// column work, an equal order out of a no-op (so the caller skips the
// write), and "returns a NEW order, input untouched".
import type { ColumnOrder } from "./rank";

/**
 * The displayed order after a unit move: `unitIds` (drawn from
 * `visibleIds`; the first entry is the card the operator grabbed) come out
 * of the rest and re-insert as ONE contiguous block — before `beforeId`,
 * at the top for a null anchor, or below the last card for `toEnd`.
 * Anchors pointing into the unit's own span are no-ops (the unit cannot
 * land inside itself); an anchor the rest no longer holds appends below —
 * the same below-the-gap fallback the single-card move uses for a drop
 * target the displayed order lost.
 */
export function displayAfterUnitMove(
  visibleIds: readonly string[],
  unitIds: readonly string[],
  beforeId: string | null,
  toEnd: boolean,
): string[] {
  const unit = [...new Set(unitIds)].filter((id) => visibleIds.includes(id));
  if (unit.length === 0) return [...visibleIds];
  const unitSet = new Set(unit);
  if (beforeId !== null && unitSet.has(beforeId)) return [...visibleIds];
  const rest = visibleIds.filter((id) => !unitSet.has(id));
  const at = beforeId === null ? (toEnd ? rest.length : 0) : rest.indexOf(beforeId);
  if (at === -1) return [...rest, ...unit];
  return [...rest.slice(0, at), ...unit, ...rest.slice(at)];
}

/**
 * The stored order write for a unit move, mirroring applyMoveVisible: rank
 * the whole unit plus everything above the drop point, leave the cards
 * below with whatever rank they had, and return an equal order when the
 * move changes nothing. The unit travels as one block ABOVE every unranked
 * card, which is what keeps a first drop into a fresh column honest — and
 * keeps the block contiguous, because every member ranked above the drop
 * point sits in the head together.
 */
export function applyUnitMoveVisible(
  order: ColumnOrder,
  visibleIds: readonly string[],
  unitIds: readonly string[],
  beforeId: string | null,
  toEnd: boolean,
): string[] {
  const unit = [...new Set(unitIds)].filter((id) => visibleIds.includes(id));
  if (unit.length === 0) return [...order];
  const arranged = displayAfterUnitMove(visibleIds, unit, beforeId, toEnd);
  // No-op detection on the DISPLAYED order: the unit already sits exactly
  // where it would land.
  if (joinOf(arranged) === joinOf(visibleIds)) return [...order];
  // The head runs to the LAST unit member: the unit is contiguous in
  // `arranged`, so everything above and including its last member is what
  // gets ranked — anchoring on the FIRST would rank the head short of the
  // block's tail and the sparse comparator would re-scatter it. (A manual
  // walk, not findLastIndex: the module's lib target predates es2023.)
  let lastUnit = -1;
  for (let i = 0; i < arranged.length; i++) {
    if (unit.includes(arranged[i] as string)) lastUnit = i;
  }
  if (lastUnit === -1) return [...order];
  const head = arranged.slice(0, lastUnit + 1);
  const headSet = new Set(head);
  return [...head, ...order.filter((id) => !headSet.has(id))];
}

const joinOf = (ids: readonly string[]): string => ids.join("\u0000");