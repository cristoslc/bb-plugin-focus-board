// The per-card fraction model (lib/rank-fractions.ts): parse/migration,
// minting, the anchor-fresh move, the unit move, and the property pins the
// mandate calls for — never-densify survives, ranked-before-unranked holds,
// and a malformed row fails loud. The two-window SERVER behavior lives in
// tests/rank-fractions.test.ts; this file pins the module itself.
import { describe, expect, it } from "vitest";
import {
  applyRankClearFractions,
  applyRankMoveFractions,
  fractionRowFromStore,
  fractionsAfterMove,
  fractionsAfterUnitMove,
  mintLegacyColumn,
  ordersFromFractionStore,
  parseFractionRankStore,
  rankedOrderFromFractions,
  rebaseColumnFractions,
  type FractionRankStore,
} from "../lib/rank-fractions";
import { compareByRank, orderForColumn } from "../lib/rank";

/** The column's fraction map from a legacy ordered list, in one call. */
const seeded = parseFractionRankStore({ pinned: ["a", "b", "c", "d"] }).pinned;

describe("parseFractionRankStore", () => {
  it("absent row is not a failure", () => {
    expect(parseFractionRankStore(undefined)).toEqual({});
    expect(parseFractionRankStore(null)).toEqual({});
  });

  it("accepts the current fraction shape and round-trips the written row", () => {
    const store: FractionRankStore = parseFractionRankStore({
      pinned: { thr_b: 0.5, thr_a: 0.25 },
      "status:unread": {},
    });
    expect(rankedOrderFromFractions(store.pinned)).toEqual(["thr_a", "thr_b"]);
    const row = fractionRowFromStore(store);
    expect(parseFractionRankStore(row)).toEqual(store);
  });

  it("converts a legacy ordered list losslessly on read, order preserved", () => {
    const store = parseFractionRankStore({ "status:unread": ["thr_x", "thr_y", "thr_z"] });
    expect(ordersFromFractionStore(store)["status:unread"]).toEqual([
      "thr_x",
      "thr_y",
      "thr_z",
    ]);
    const fractions = Object.values(store["status:unread"]).sort((a, b) => a - b);
    expect(fractions[0]).toBeGreaterThan(0);
    expect(fractions[2]).toBeLessThan(1);
  });

  it("de-duplicates a legacy list before minting, like parseRankStore does", () => {
    expect(mintLegacyColumn(["thr_a", "thr_a", "thr_b"])).toEqual({
      thr_a: 1 / 3,
      thr_b: 2 / 3,
    });
  });

  it("the legacy and current shapes sort back to the same order list", () => {
    const list = ["thr_a", "thr_b", "thr_c"];
    expect(
      rankedOrderFromFractions(parseFractionRankStore({ pinned: list }).pinned),
    ).toEqual(
      rankedOrderFromFractions(
        parseFractionRankStore({ pinned: mintLegacyColumn(list) }).pinned,
      ),
    );
  });

  it("a malformed row always throws — malformed in either shape", () => {
    expect(() => parseFractionRankStore(["a"])).toThrow(/expected object, got array/);
    expect(() => parseFractionRankStore("nope")).toThrow(/expected object, got string/);
    expect(() =>
      parseFractionRankStore({ pinned: { thr_a: 0.5 }, "status:unread": "thr_a" }),
    ).toThrow(/neither an order list nor a fraction map/);
    expect(() => parseFractionRankStore({ pinned: { thr_a: "0.5" } })).toThrow(
      /non-fraction value/,
    );
    expect(() => parseFractionRankStore({ pinned: { thr_a: Number.NaN } })).toThrow(
      /non-fraction value/,
    );
    expect(() => parseFractionRankStore({ pinned: { thr_a: 1 } })).toThrow(/non-fraction value/);
    expect(() => parseFractionRankStore({ pinned: { thr_a: 0 } })).toThrow(/non-fraction value/);
    expect(() => parseFractionRankStore({ pinned: { thr_a: -0.5 } })).toThrow(
      /non-fraction value/,
    );
    expect(() => parseFractionRankStore({ pinned: { thr_a: Number.POSITIVE_INFINITY } })).toThrow(
      /non-fraction value/,
    );
    expect(() => parseFractionRankStore({ pinned: { "": 0.5 } })).toThrow(/empty card id/);
    expect(() => parseFractionRankStore({ pinned: ["thr_a", 7] })).toThrow(/non-string id/);
  });

  it("a literally-named __proto__ column survives the round trip", () => {
    // parseRankStore's defineProperty guard, mirrored for both shapes. The
    // row comes from JSON.parse, the one path a hand-edited KV row or a
    // hostile writer reaches the parser by: a quoted object literal's
    // "__proto__" key sets the prototype instead of minting the own key.
    const parsed = parseFractionRankStore(
      JSON.parse('{"__proto__": {"thr_a": 0.5}}') as unknown,
    );
    expect(parsed.__proto__).toEqual({ thr_a: 0.5 });
    expect(parseFractionRankStore(fractionRowFromStore(parsed)).__proto__).toEqual({
      thr_a: 0.5,
    });
    const legacy = parseFractionRankStore(
      JSON.parse('{"__proto__": ["thr_a"]}') as unknown,
    );
    expect(rankedOrderFromFractions(legacy.__proto__)).toEqual(["thr_a"]);
  });
});

describe("fractionsAfterMove", () => {
  it("writes only the moved card's fragment: anchored midpoint between fresh neighbors", () => {
    // [a,b,c,d] → drop d directly before b: d's new fraction sits between
    // a (the fresh predecessor of b) and b; a, b, c keep their exact
    // fractions — the per-card write, realized.
    const next = fractionsAfterMove(seeded, ["a", "b", "c", "d"], "d", "b", false);
    expect(next).not.toBeNull();
    expect(next?.a).toBe(seeded.a);
    expect(next?.b).toBe(seeded.b);
    expect(next?.c).toBe(seeded.c);
    expect(next?.d).not.toBe(seeded.d);
    expect(next?.d).toBeGreaterThan(seeded.a as number);
    expect(next?.d).toBeLessThan(seeded.b as number);
    expect(rankedOrderFromFractions(next)).toEqual(["a", "d", "b", "c"]);
  });

  it("a ranked head card keeps its fraction whatever the client's view claimed — the anti-rewrite guarantee", () => {
    // The stale-window shape, module level (the server-level red lives in
    // tests/rank-fractions.test.ts): B's STALE visibleIds claims c below b,
    // but A's move already ranked c second — c's fragment must not move.
    const afterA = fractionsAfterMove(seeded, ["a", "b", "c", "d"], "c", "b", false);
    expect(rankedOrderFromFractions(afterA)).toEqual(["a", "c", "b", "d"]);
    const afterB = fractionsAfterMove(afterA, ["a", "b", "c", "d"], "d", "b", false);
    expect(afterB?.c).toBe(afterA?.c);
    expect(rankedOrderFromFractions(afterB)).toEqual(["a", "c", "d", "b"]);
  });

  it("a first drop into an unranked column densifies the head above the drop point", () => {
    // The standing head rule (musings postscript): with only the dragged
    // card ranked, the sparse comparator would sort it above every unranked
    // card, so "drop below the second card" must rank the card above the
    // drop point too.
    const next = fractionsAfterMove({}, ["thr_a", "thr_b", "thr_c"], "thr_c", "thr_b", false);
    expect(rankedOrderFromFractions(next)).toEqual(["thr_a", "thr_c"]);
    expect(next?.thr_a).toBeLessThan(next?.thr_c as number);
  });

  it("a toEnd drop ranks every visible card and lands the moved card last", () => {
    const next = fractionsAfterMove(seeded, ["a", "b", "c", "d"], "a", null, true);
    // All four mints happen above the seed state's last fraction; the moved
    // card is the highest.
    expect(rankedOrderFromFractions(next)).toEqual(["b", "c", "d", "a"]);
    expect(next?.a).toBeGreaterThan(next?.d as number);
  });

  it("an anchor the display lost appends below the ranked cards, like the list move", () => {
    const next = fractionsAfterMove(seeded, ["a", "b", "c", "d"], "a", "missing", false);
    expect(rankedOrderFromFractions(next)).toEqual(["b", "c", "d", "a"]);
  });

  it("a drop where the card already sits keeps the displayed order (the server then skips the write)", () => {
    const next = fractionsAfterMove(seeded, ["a", "b", "c", "d"], "c", "d", false);
    // c is already directly above d: whatever the mint recomputes, the
    // derived order is the same, so the server's derived-order compare
    // skips the write — the module's contract is the ORDER, not the
    // exact bits.
    expect(rankedOrderFromFractions(next)).toEqual(rankedOrderFromFractions(seeded));
  });

  it("a floating-point-degenerate gap rebases the column once, order-preserving, and mints", () => {
    // Two fractions one representable step apart: the only number between
    // them rounds onto the lower neighbor, so no midpoint exists. The move
    // must not silently collide; the column rebases (every fraction
    // re-spread, order kept) and the mint retries on the fresh bounds.
    const step = 2 ** -53;
    const tight = { a: 0.5 + step, b: 0.5 + 2 * step };
    const next = fractionsAfterMove(tight, ["a", "b", "x"], "x", "b", false);
    expect(next).not.toBeNull();
    expect(next?.a).toBe(1 / 3);
    expect(next?.b).toBe(2 / 3);
    expect(next?.x).toBe(0.5);
    expect(rebaseColumnFractions({ a: 0.1, b: 0.3 })).toEqual({ a: 1 / 3, b: 2 / 3 });
  });

  it("a rebase preserves the derived order exactly (the projection is display-invariant)", () => {
    const fractions = parseFractionRankStore({ pinned: { a: 0.9, b: 0.1, c: 0.5 } }).pinned;
    const after = rebaseColumnFractions(fractions);
    expect(rankedOrderFromFractions(after)).toEqual(rankedOrderFromFractions(fractions));
    expect(new Set(Object.keys(after))).toEqual(new Set(Object.keys(fractions)));
    expect(Object.keys(after).length).toBe(3);
  });
});

describe("fractionsAfterUnitMove", () => {
  const five = parseFractionRankStore({ pinned: ["a", "b", "c", "d", "e"] }).pinned;

  it("the unit block lands contiguous, all members re-minted, foreign cards untouched", () => {
    // Drop the {c, e} box between a and b: the block re-mints as one
    // stretch between a's and b's fractions; a and b keep their fractions.
    const next = fractionsAfterUnitMove(five, ["a", "b", "c", "d", "e"], ["c", "e"], "b", false);
    expect(next?.a).toBe(five.a);
    expect(next?.b).toBe(five.b);
    const cMinted = next?.c as number;
    const eMinted = next?.e as number;
    expect(cMinted).toBeLessThan(eMinted); // the unit's internal order preserved
    expect(cMinted).toBeGreaterThan(five.a as number);
    expect(eMinted).toBeLessThan(five.b as number);
    expect(rankedOrderFromFractions(next)).toEqual(["a", "c", "e", "b", "d"]);
  });

  it("the unit's internal order follows the fresh fraction order, not a stale client order", () => {
    // A window whose stale view of the box disagrees with the stored member
    // order must not rewrite the box's internals: the block re-mints in the
    // server's order.
    const next = fractionsAfterUnitMove(five, ["a", "b", "c", "d", "e"], ["d", "c"], null, true);
    expect(next?.c).toBeLessThan(next?.d as number);
  });

  it("an anchor inside the unit's own span is a no-op", () => {
    expect(fractionsAfterUnitMove(five, ["a", "b", "c", "d", "e"], ["c"], "c", false)).toBeNull();
  });

  it("a unit absent from the display is a no-op", () => {
    expect(fractionsAfterUnitMove(five, ["a", "b"], ["x", "y"], "b", false)).toBeNull();
  });

  it("unranked cards above the drop point densify with the unit block below them", () => {
    // Fresh: [a, u1, u2] (only a ranked); the {u1, u2} box drops toEnd →
    // everything ranks; the block keeps its order above a.
    const next = fractionsAfterUnitMove({ a: 0.5 }, ["a", "u1", "u2"], ["u1", "u2"], null, true);
    expect(rankedOrderFromFractions(next)).toEqual(["a", "u1", "u2"]);
    expect(next?.u1).toBeLessThan(next?.u2 as number);
    expect(next?.u2).toBeGreaterThan(0.5);
  });
});

describe("the never-densify gap property survives the fraction store", () => {
  it("other cards' moves never touch a departed card's fraction", () => {
    const store = parseFractionRankStore({
      "status:unread": { a: 0.25, b: 0.5, c: 0.75 },
    });
    const originalC = store["status:unread"]?.c;
    // c departs the column: the client's display no longer holds it.
    const after = fractionsAfterMove(store["status:unread"], ["a", "b"], "b", null, false);
    expect(after?.c).toBe(originalC);
    // Re-entry: c keeps its fraction, so it returns into its old spot.
    expect(rankedOrderFromFractions(after)).toEqual(["b", "a", "c"]);
  });

  it("an unranked card below the drop point stays unranked (gaps below preserved)", () => {
    const next = fractionsAfterMove({}, ["thr_a", "thr_b", "thr_c"], "thr_c", "thr_b", false);
    expect(next?.thr_b).toBeUndefined();
  });
});

describe("the board's existing comparator consumes the derived projection unchanged", () => {
  it("compareByRank sorts ranked cards by fraction, unranked below in derived order", () => {
    // The wire projection a client would hold from rank_list.
    const wire = ordersFromFractionStore(
      parseFractionRankStore({ pinned: { b: 0.5, a: 0.25, d: 0.75 } }),
    );
    const order = orderForColumn(wire, "pinned");
    const cards = [
      { id: "d", recency: 1 },
      { id: "u", recency: 9 },
      { id: "b", recency: 8 },
      { id: "a", recency: 4 },
    ];
    const sorted = [...cards].sort(
      compareByRank(order, (x, y) => y.recency - x.recency),
    );
    expect(sorted.map((card) => card.id)).toEqual(["a", "b", "d", "u"]);
  });

  it("applyRankMoveFractions is the store-level op the three rank_move surfaces share", () => {
    const store: FractionRankStore = { pinned: seeded };
    const result = applyRankMoveFractions(store, {
      columnKey: "pinned",
      threadId: "d",
      beforeId: "b",
      toEnd: false,
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(result.unchanged).toBe(false);
    expect(result.order).toEqual(["a", "d", "b", "c"]);
    // Other columns untouched; the moved column replaced.
    expect(Object.keys(result.next)).toEqual(["pinned"]);
    // A no-op gesture reports unchanged and returns the fresh projection.
    const again = applyRankMoveFractions(result.next, {
      columnKey: "pinned",
      threadId: "d",
      beforeId: "b",
      toEnd: false,
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(again.unchanged).toBe(true);
    expect(again.order).toEqual(result.order);
    // A unit mismatch throws, fail loud.
    expect(() =>
      applyRankMoveFractions(store, {
        columnKey: "pinned",
        threadId: "a",
        beforeId: "b",
        toEnd: false,
        visibleIds: ["a", "b", "c", "d"],
        unitIds: ["b", "c"],
      }),
    ).toThrow(/not part of the unit/);
  });

  it("applyRankClearFractions deletes the column's key outright, and no-ops on a clean store", () => {
    const store: FractionRankStore = { pinned: seeded, "status:unread": { x: 0.5 } };
    const result = applyRankClearFractions(store, "pinned");
    expect(result.cleared).toBe(true);
    expect(result.next["pinned"]).toBeUndefined();
    // The other column survives whole.
    expect(result.next["status:unread"]).toEqual({ x: 0.5 });
    // Clearing again is a no-op: no write, no rank-changed publish.
    const again = applyRankClearFractions(result.next, "pinned");
    expect(again.cleared).toBe(false);
    expect(again.next).toBe(result.next);
  });
});