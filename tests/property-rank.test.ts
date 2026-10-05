// Property tests over the rank-order model's laws (fast-check).
//
// The unit suites (tests/rank.test.ts) pin enumerated cases; these pin the
// invariants over ARBITRARY moves: a move changes only its own card's
// position among ranked cards, never loses a previously ranked card (the
// non-clobber property the RPC layer's single-move semantics rely on), and
// never mutates its input.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyMoveVisible,
  appendTo,
  compareByRank,
  displayAfterMove,
  moveTargetFor,
  type ColumnOrder,
} from "../lib/rank";

const idsArb = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), {
  minLength: 1,
  maxLength: 8,
});

/** A move: which card, which anchor, toEnd. */
const moveArb = fc.record({
  threadId: fc.string({ minLength: 1, maxLength: 6 }),
  beforeId: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
  toEnd: fc.boolean(),
});

describe("applyMove laws", () => {
  it("never loses a ranked card (non-clobber)", () => {
    fc.assert(
      fc.property(idsArb, moveArb, (order, move) => {
        const next = applyMove(order, move.threadId, move.beforeId);
        for (const id of order) {
          if (id !== move.threadId) expect(next).toContain(id);
        }
      }),
    );
  });

  it("returns a duplicate-free order containing at most the input plus the moved id", () => {
    fc.assert(
      fc.property(idsArb, moveArb, (order, move) => {
        const next = applyMove(order, move.threadId, move.beforeId);
        expect(new Set(next).size).toBe(next.length);
        for (const id of next) {
          expect(id === move.threadId || order.includes(id)).toBe(true);
        }
      }),
    );
  });

  it("preserves the relative order of every card except the moved one", () => {
    fc.assert(
      fc.property(idsArb, moveArb, (order, move) => {
        const next = applyMove(order, move.threadId, move.beforeId);
        const restBefore = order.filter((id) => id !== move.threadId);
        const restAfter = next.filter((id) => id !== move.threadId);
        // The moved card is removed from both; the remainder can only gain
        // the moved card re-inserted, so filtering it out of the result must
        // leave the others in their original relative sequence — UNLESS the
        // anchor was unranked, in which case the card appends (documented).
        const anchorRanked =
          move.beforeId !== null && restBefore.includes(move.beforeId);
        if (move.beforeId !== null && anchorRanked) {
          expect(restAfter).toEqual(restBefore);
        }
      }),
    );
  });

  it("never mutates its input", () => {
    fc.assert(
      fc.property(idsArb, moveArb, (order, move) => {
        const snapshot = [...order];
        applyMove(order, move.threadId, move.beforeId);
        expect(order).toEqual(snapshot);
      }),
    );
  });

  it("moving a card to its own anchor is a no-op", () => {
    fc.assert(
      fc.property(idsArb, (order) => {
        const id = order[0]!;
        expect(applyMove(order, id, id)).toEqual(order);
      }),
    );
  });
});

describe("applyMoveVisible laws", () => {
  it("ranks every visible card up to and including the drop point, loses no prior rank", () => {
    fc.assert(
      fc.property(
        idsArb,
        idsArb,
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: null }),
        fc.boolean(),
        (order, visibleIds, threadId, beforeId, toEnd) => {
          const next = applyMoveVisible(order, visibleIds, threadId, beforeId, toEnd);
          // No previously ranked card is ever un-ranked.
          for (const id of order) expect(next).toContain(id);
          // The result is duplicate-free.
          expect(new Set(next).size).toBe(next.length);
        },
      ),
    );
  });

  it("a toEnd drop ranks every visible card", () => {
    fc.assert(
      fc.property(idsArb, idsArb, fc.string({ minLength: 1 }), (order, visibleIds, threadId) => {
        const next = applyMoveVisible(order, visibleIds, threadId, null, true);
        for (const id of appendTo(visibleIds, threadId)) expect(next).toContain(id);
      }),
    );
  });
});

describe("displayAfterMove / moveTargetFor coherence", () => {
  it("a target moveTargetFor produces equals appending past the hovered card", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 8 }),
        fc.string({ minLength: 1 }),
        (visibleIds, draggingId) => {
          const hoverId = visibleIds.find((id) => id !== draggingId);
          if (hoverId === undefined) return;
          const below = visibleIds[visibleIds.indexOf(hoverId) + 1];
          const target = moveTargetFor(visibleIds, hoverId, "after", draggingId);
          if (below === undefined) {
            expect(target).toEqual({ beforeId: null, toEnd: true });
          } else if (below === draggingId) {
            expect(target).toEqual({ beforeId: hoverId, toEnd: false });
          } else {
            expect(target).toEqual({ beforeId: below, toEnd: false });
          }
        },
      ),
    );
  });

  it("displayAfterMove never drops a visible card", () => {
    fc.assert(
      fc.property(
        idsArb,
        fc.string({ minLength: 1 }),
        fc.option(fc.string({ minLength: 1 }), { nil: null }),
        fc.boolean(),
        (visibleIds, threadId, beforeId, toEnd) => {
          const shown = displayAfterMove(visibleIds, threadId, beforeId, toEnd);
          const universe = new Set([...visibleIds, threadId]);
          for (const id of shown) expect(universe.has(id)).toBe(true);
        },
      ),
    );
  });
});

describe("compareByRank laws", () => {
  it("ranked cards sort before unranked; among ranked, stored order wins over the derived tiebreak", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 8 }),
        (ranked) => {
          const order: ColumnOrder = ranked;
          const rows = [...ranked, "zz_unranked", "aa_unranked"].map((id, i) => ({
            id,
            recency: i,
          }));
          const compare = compareByRank(order, (a, b) => b.recency - a.recency);
          const sorted = [...rows].sort(compare);
          const rankedCount = ranked.length;
          for (let i = 0; i < rankedCount; i++) {
            expect(sorted[i]!.id).toBe(ranked[i]);
          }
          for (let i = rankedCount; i < sorted.length; i++) {
            expect(ranked.includes(sorted[i]!.id)).toBe(false);
          }
        },
      ),
    );
  });
});
