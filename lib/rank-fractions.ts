// Per-card fractional ranks: the storage model behind `rank_move`.
//
// The old storage model — a column's sparse ORDERED LIST of ids — made a
// move's write derive from the client's displayed order: the handler rewrote
// the order's HEAD from `visibleIds`, so a stale window's drop rearranged
// cards it never touched (the cross-window edition of #232: the other
// window's drag briefly lands, then falls back). Under this model every card
// in a column carries its own fraction in (0,1); a move reads the server's
// fresh fractions, computes the dragged card's new fraction from its anchor's
// CURRENT neighborhood, and writes only the fragments the move must touch —
// the moved card's, the unit block's for a family drag, and minted fractions
// for head cards the standing densify rule covers (see the postscript in
// docs/musings/2026-09-25-rank-ordering.md). A ranked card the move did not
// aim at keeps its fraction whatever the client's `visibleIds` claimed.
//
// The ordered id list survives as a DERIVED PROJECTION: the RPC wire format
// (rank_list output, rank_move output, and the client's RankStore) stays
// `columnKey → ordered id list`, derived from the fraction map on every
// read. Clients never see a fraction. Properties preserved, deliberately
// (docs/musings + docs/plans/2026-10-16-per-card-fractional-ranks-*):
// the never-densify gap property (a card's fraction survives its absence,
// so re-entry restores its old neighbors' bounds), ranked-before-unranked
// with a recency tail, fail-loud parsing, and one serialized write per
// gesture (the #243 lock stays as the crash-safe backstop).
//
// Pure module: no host, no SDK, no React, so the RPC layer, the screenshot
// harness, and tests can drive it directly.
import { appendTo, applyMove, RANK_KV_KEY } from "./rank";
import { displayAfterUnitMove } from "./rank-unit-move";

export { RANK_KV_KEY };

/** One column's sparse fraction map: thread id → rank in the open interval (0,1). */
export type FractionColumn = Readonly<Record<string, number>>;

/** columnKey → fraction map. Missing key = that column has no ranks yet. */
export type FractionRankStore = Readonly<Record<string, FractionColumn>>;

/**
 * Mint one legacy ordered list into fractions: id i (after de-duplication)
 * gets (i+1)/(n+1), strictly inside (0,1) and in the list's exact order.
 * Lossless by construction — the fractions sort back to the same list.
 */
export function mintLegacyColumn(order: readonly string[]): FractionColumn {
  const deduped = [...new Set(order)];
  const out: Record<string, number> = {};
  deduped.forEach((id, index) => {
    // defineProperty like parseRankStore: a thread id that is literally
    // "__proto__" must not invoke the prototype setter and vanish.
    Object.defineProperty(out, id, {
      value: (index + 1) / (deduped.length + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  return out;
}

/** True for a finite number strictly inside (0,1). */
function isFraction(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
}

/**
 * Parse the stored rank row, accepting BOTH shape generations forever:
 * legacy `columnKey → ordered id list` (converted losslessly on read) and
 * `columnKey → { threadId → fraction }` (the current shape). Absent means
 * "no ranks anywhere" → empty store. A present-but-malformed row THROWS
 * (fail loud, never coerce) — a half-read rank row silently reverts to
 * recency and looks like the drag never saved. Values must be numbers
 * strictly inside (0,1): NaN breaks every sort, out-of-range values are
 * hand-edited corruption, and guessing a repair would invent an order the
 * operator never chose.
 */
export function parseFractionRankStore(raw: unknown): FractionRankStore {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const got = Array.isArray(raw) ? "array" : typeof raw;
    throw new Error(`rank store: expected object, got ${got}`);
  }
  const out: Record<string, FractionColumn> = {};
  for (const [columnKey, value] of Object.entries(raw as Record<string, unknown>)) {
    let column: FractionColumn;
    if (Array.isArray(value)) {
      // Legacy shape: validate exactly like parseRankStore, then mint.
      for (const id of value) {
        if (typeof id !== "string" || id === "") {
          throw new Error(
            `rank store: column ${JSON.stringify(columnKey)} has a non-string id ${JSON.stringify(id)}`,
          );
        }
      }
      column = mintLegacyColumn(value as string[]);
    } else if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>);
      column = {};
      for (const [id, fraction] of entries) {
        if (id === "") {
          throw new Error(
            `rank store: column ${JSON.stringify(columnKey)} has an empty card id`,
          );
        }
        if (!isFraction(fraction)) {
          throw new Error(
            `rank store: column ${JSON.stringify(columnKey)} has a non-fraction value ${JSON.stringify(fraction)} for id ${JSON.stringify(id)}`,
          );
        }
        Object.defineProperty(column, id, {
          value: fraction,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    } else {
      throw new Error(
        `rank store: column ${JSON.stringify(columnKey)} is neither an order list nor a fraction map`,
      );
    }
    Object.defineProperty(out, columnKey, {
      value: column,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** The row shape written back to storage — must satisfy parseFractionRankStore. */
export function fractionRowFromStore(
  store: FractionRankStore,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(store).map(([columnKey, fractions]) => [
      columnKey,
      Object.fromEntries(Object.entries(fractions)),
    ]),
  );
}

/**
 * A column's ranked card ids, lowest fraction first. The (fraction, id)
 * tuple tiebreak keeps the order deterministic across processes even for a
 * hand-edited row with tied values; minting and migration never produce
 * ties, and every write is serialized, so the id arm is a determinism
 * backstop, not an order source.
 */
export function rankedOrderFromFractions(fractions: FractionColumn): string[] {
  return Object.entries(fractions)
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id]) => id);
}

/** A column's stored (ranked) order — the same list `orderForColumn` projects. */
export function orderForFractions(
  store: FractionRankStore,
  columnKey: string,
): string[] {
  return rankedOrderFromFractions(store[columnKey] ?? {});
}

/** Every column's derived order — the rank_list / rank_move wire projection. */
export function ordersFromFractionStore(
  store: FractionRankStore,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const columnKey of Object.keys(store)) {
    Object.defineProperty(out, columnKey, {
      value: orderForFractions(store, columnKey),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * The column's display order the current state supports: ranked cards
 * (fresh fraction order) first, then the unranked remainder in the caller's
 * displayed order. `visibleIds` is the dropping window's view; the server
 * uses it ONLY to name and order the unranked remainder — every ranked card's
 * position comes from the store, so a stale view can name unranked cards but
 * cannot move ranked ones (the anti-rewrite guarantee). De-duplicated first
 * occurrence; a ranked id the client's view lost still ranks.
 */
export function freshDisplayOrder(
  fractions: FractionColumn,
  visibleIds: readonly string[],
): string[] {
  const ranked = rankedOrderFromFractions(fractions);
  const rankedSet = new Set(ranked);
  const seen = new Set(ranked);
  const rest: string[] = [];
  for (const id of visibleIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    rest.push(id);
  }
  return [...ranked, ...rest];
}

/**
 * Mint `count` strictly ascending fractions inside the open interval
 * (lo, hi), evenly spaced, or null when the interval cannot hold them
 * (floating-point degeneracy: a bound rounds onto a neighbor). Callers
 * rebase the column and retry once on null.
 */
function mintInto(count: number, lo: number, hi: number): number[] | null {
  const out: number[] = [];
  let prev = lo;
  for (let i = 1; i <= count; i++) {
    const value = lo + ((hi - lo) * i) / (count + 1);
    if (!(value > prev && value < hi)) return null;
    out.push(value);
    prev = value;
  }
  return out;
}

/**
 * Re-spread a column's ranked fractions evenly over (0,1), preserving their
 * current order. Order-preserving, so the derived display never changes; it
 * only buys fresh interval room when a region runs out of floating-point
 * space. Runs under the KV write lock like every rank write.
 */
export function rebaseColumnFractions(fractions: FractionColumn): FractionColumn {
  const ids = rankedOrderFromFractions(fractions);
  const out: Record<string, number> = {};
  ids.forEach((id, index) => {
    Object.defineProperty(out, id, {
      value: (index + 1) / (ids.length + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  return out;
}

/**
 * The fractions after one move gesture.
 *
 * `arranged` is the display order the gesture produces (the abstract move —
 * `applyMove`/`appendTo` semantics, the same functions the client's
 * announcement uses — applied to the fresh display). `mustMint` holds every
 * head card that needs a fresh fraction: the moved card, a unit block's
 * members, and the unranked cards the densify rule covers. Every head card
 * that instead keeps a stored fraction is an anchor the mint cannot cross.
 *
 * Head cards are laid out between consecutive anchors: each stretch of
 * must-mint cards inside (or outside) two anchors is spaced evenly in that
 * interval, leading stretches below the first anchor's fraction, trailing
 * stretches above the last's. A stretch the arithmetic cannot place
 * rebases the whole column (order-preserving) and retries once; a second
 * failure throws — fail loud, never a silent slot collision.
 *
 * Returns the NEXT fraction map for the column, or null when the gesture
 * changes nothing the store could express (the caller then skips both the
 * write and the rank-changed publish).
 */
function mintHead(
  fractions: FractionColumn,
  arranged: readonly string[],
  mustMint: ReadonlySet<string>,
): FractionColumn {
  let last = -1;
  for (let i = 0; i < arranged.length; i++) {
    if (mustMint.has(arranged[i] as string)) last = i;
  }
  if (last === -1) return fractions;
  const head = arranged.slice(0, last + 1);
  const attempt = (base: FractionColumn): FractionColumn | null => {
    const next: Record<string, number> = { ...base };
    // Fixed anchors for bounds. A head card that is neither must-mint nor
    // ranked is a caller bug (the head cannot contain an unranked card the
    // densify rule does not cover): fail loud rather than mint against a
    // missing bound.
    const fixed = new Map<string, number>();
    for (const id of head) {
      if (mustMint.has(id)) continue;
      const fraction = base[id];
      if (fraction === undefined) {
        throw new Error(
          `rank move: head card ${id} has no rank and the move does not mint one`,
        );
      }
      fixed.set(id, fraction);
    }
    const trailingBound = () => {
      // A ranked card beyond the head still bounds the trailing stretch:
      // the mint must land directly above it in the display. (An unranked
      // card beyond displays below every ranked one, so no bound.)
      const beyond = arranged[last + 1];
      if (beyond !== undefined) {
        const fraction = base[beyond];
        if (fraction !== undefined) return fraction;
      }
      return 1;
    };
    let index = 0;
    let lo = 0;
    while (index < head.length) {
      if (mustMint.has(head[index] as string)) {
        // A stretch of must-mint cards. Its interval runs from the last
        // assigned/anchor value to the next fixed anchor in the head — or,
        // past the head's end, to the trailing bound above.
        let end = index;
        while (end < head.length && mustMint.has(head[end] as string)) end++;
        const after = head[end];
        // `after` is either undefined (stretch runs to the head's end) or a
        // fixed anchor — a head card that is neither must-mint nor ranked
        // already threw in the fixed pass above.
        const hi =
          after === undefined || !fixed.has(after)
            ? trailingBound()
            : (fixed.get(after) as number);
        const minted = mintInto(end - index, lo, hi);
        if (minted === null) return null;
        for (let j = 0; j < minted.length; j++) {
          Object.defineProperty(next, head[index + j] as string, {
            value: minted[j],
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        lo = minted[minted.length - 1] as number;
        index = end;
      } else {
        lo = fixed.get(head[index] as string)!;
        index++;
      }
    }
    return next;
  };
  const first = attempt(fractions);
  if (first !== null) return first;
  const retried = attempt(rebaseColumnFractions(fractions));
  if (retried === null) {
    throw new Error(
      "rank move: no room to mint the moved card's rank even after a rebase",
    );
  }
  return retried;
}

/**
 * One card's move, anchor-fresh: the drop's anchor card is authoritative,
 * the move is applied against the display order the CURRENT store supports
 * (not the possibly stale `visibleIds` the client sent), the moved card's
 * new fraction is minted from its new neighbors' current fractions, and
 * every other ranked card keeps its fraction. Unranked cards above the drop
 * point densify with minted fractions (the standing head rule), preserving
 * their displayed relative order.
 */
export function fractionsAfterMove(
  fractions: FractionColumn,
  visibleIds: readonly string[],
  threadId: string,
  beforeId: string | null,
  toEnd: boolean,
): FractionColumn | null {
  if (threadId === "") return null;
  const display = freshDisplayOrder(fractions, visibleIds);
  const arranged = toEnd
    ? appendTo(display, threadId)
    : applyMove(display, threadId, beforeId);
  const at = arranged.indexOf(threadId);
  if (at === -1) return null;
  const mustMint = new Set<string>([threadId]);
  for (let i = 0; i < at; i++) {
    const id = arranged[i] as string;
    if (fractions[id] === undefined) mustMint.add(id);
  }
  return mintHead(fractions, arranged, mustMint);
}

/**
 * A unit (family box) move: the block lands contiguous at the drop point,
 * all members re-minted together into one stretch (their fresh internal
 * order — ranked members by fraction, unranked in the client's order — is
 * preserved), and unranked cards above the drop point densify like the
 * single-card move. An anchor inside the unit's own span is a no-op: the
 * block cannot land inside itself.
 */
export function fractionsAfterUnitMove(
  fractions: FractionColumn,
  visibleIds: readonly string[],
  unitIds: readonly string[],
  beforeId: string | null,
  toEnd: boolean,
): FractionColumn | null {
  const unitSet = new Set(unitIds);
  if (beforeId !== null && unitSet.has(beforeId)) return null;
  const ranked = rankedOrderFromFractions(fractions);
  const rankedSet = new Set(ranked);
  // Fresh internal order for the re-minted block: ranked members keep their
  // fraction order, unranked members follow the client's view. Filtered to
  // the members the displayed order can hold (the displayable unit), like
  // the display helper below does.
  const unitSeq = [
    ...ranked.filter((id) => unitSet.has(id) && visibleIds.includes(id)),
    ...[...unitSet].filter(
      (id) => !rankedSet.has(id) && visibleIds.includes(id),
    ),
  ];
  if (unitSeq.length === 0) return null;
  const display = freshDisplayOrder(fractions, visibleIds);
  const arranged = displayAfterUnitMove(display, unitSeq, beforeId, toEnd);
  const unitSeqSet = new Set(unitSeq);
  let last = -1;
  for (let i = 0; i < arranged.length; i++) {
    if (unitSeqSet.has(arranged[i] as string)) last = i;
  }
  if (last === -1) return null;
  const mustMint = new Set<string>(unitSeq);
  for (let i = 0; i < last; i++) {
    const id = arranged[i] as string;
    if (fractions[id] === undefined) mustMint.add(id);
  }
  return mintHead(fractions, arranged, mustMint);
}

/** One `rank_move` gesture's inputs, exactly as the RPC carries them. */
export type RankMove = Readonly<{
  columnKey: string;
  threadId: string;
  beforeId: string | null;
  toEnd: boolean;
  visibleIds: readonly string[];
  unitIds?: readonly string[];
}>;

export type RankMoveResult = Readonly<{
  /** The store after the move; identical object when unchanged. */
  next: FractionRankStore;
  /** The column's derived order after the move — the wire projection. */
  order: string[];
  /** False when the write (and its rank-changed publish) should happen. */
  unchanged: boolean;
}>;

/**
 * One rank_move gesture, server-computed: the store merge plus its derived
 * projection. Shared by the real `rank_move` handler and the rank_move
 * implementations in the app test host and the screenshot harness, so all
 * three carry the same semantics and none can drift into its own private
 * re-spelling (what `scripts/screenshot/mock-sdk.tsx` warned about).
 *
 * A unit id mismatch throws (fail loud — a client bug, never coerced); the
 * server handler re-checks the same condition first so it can throw its
 * PluginCliError with a code. An otherwise no-op move reports
 * `unchanged: true` and returns the fresh projection.
 */
export function applyRankMoveFractions(
  store: FractionRankStore,
  move: RankMove,
): RankMoveResult {
  const { columnKey, threadId, beforeId, toEnd, visibleIds, unitIds } = move;
  const current = store[columnKey] ?? {};
  let next: FractionColumn | null;
  if (unitIds !== undefined && unitIds.length > 0) {
    if (!unitIds.includes(threadId)) {
      throw new Error(
        `rank_move: dragged id ${threadId} is not part of the unit (${unitIds.join(", ")})`,
      );
    }
    next = fractionsAfterUnitMove(current, visibleIds, unitIds, beforeId, toEnd);
  } else {
    next = fractionsAfterMove(current, visibleIds, threadId, beforeId, toEnd);
  }
  if (next === null) {
    return {
      next: store,
      order: orderForFractions(store, columnKey),
      unchanged: true,
    };
  }
  const withColumn: FractionRankStore = { ...store, [columnKey]: next };
  const before = orderForFractions(store, columnKey);
  const after = orderForFractions(withColumn, columnKey);
  return {
    next: withColumn,
    order: after,
    unchanged: before.join("\u0000") === after.join("\u0000"),
  };
}

export type RankClearResult = Readonly<{
  /** The store after the clear; identical object when there was nothing to clear. */
  next: FractionRankStore;
  /** True when the column held a stored order and the write (plus its
   *  rank-changed publish) should happen. */
  cleared: boolean;
}>;

/**
 * One `rank_clear` gesture: the column's whole stored hand-order goes away,
 * the column reads recency again. Deleting the KEY (not writing an empty
 * map) keeps the store's "absent = never ranked" reading exact — a column
 * that never came back keeps no dead entry in the row. Clearing a column
 * that has no stored order changes nothing (`cleared: false`, no write, no
 * rank-changed publish). Shared by the real `rank_clear` handler, the app
 * fake host, and the screenshot harness, one semantics for all three (the
 * same one-copy law `applyRankMoveFractions` carries).
 */
export function applyRankClearFractions(
  store: FractionRankStore,
  columnKey: string,
): RankClearResult {
  if (store[columnKey] === undefined) {
    return { next: store, cleared: false };
  }
  const next: Record<string, FractionColumn> = {};
  for (const [key, value] of Object.entries(store)) {
    if (key === columnKey) continue;
    Object.defineProperty(next, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { next, cleared: true };
}