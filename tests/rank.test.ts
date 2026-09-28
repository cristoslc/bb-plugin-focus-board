import { describe, expect, it } from "vitest";
import {
  appendTo,
  applyMove,
  applyMoveVisible,
  columnIsRanked,
  displayAfterMove,
  columnRankKey,
  compareByRank,
  moveTargetFor,
  orderForColumn,
  parseRankStore,
  rankRowFromStore,
} from "../lib/rank";

const newestFirst = (a: { updatedAt: number }, b: { updatedAt: number }): number =>
  b.updatedAt - a.updatedAt;

describe("column rank keys", () => {
  it("namespaces a lane by its grouping", () => {
    expect(columnRankKey("status", "unread")).toBe("status:unread");
    expect(columnRankKey("project", "abc")).toBe("project:abc");
  });

  it("leaves the grouping-independent lanes un-namespaced", () => {
    // Pinned and Done mean the same thing under every grouping, so their
    // order must follow the card across a grouping switch.
    expect(columnRankKey("status", "pinned")).toBe("pinned");
    expect(columnRankKey("project", "done")).toBe("done");
  });

  it("cannot collide a project id with a lane id", () => {
    expect(columnRankKey("project", "unread")).not.toBe(
      columnRankKey("status", "unread"),
    );
  });
});

describe("rank store parsing", () => {
  it("an absent row means no ranks anywhere, not a failure", () => {
    expect(parseRankStore(undefined)).toEqual({});
    expect(parseRankStore(null)).toEqual({});
  });

  it("reads a written row back unchanged", () => {
    const store = { "status:unread": ["thr_a", "thr_b"], pinned: ["thr_c"] };
    expect(parseRankStore(rankRowFromStore(store))).toEqual(store);
  });

  it("throws on a present-but-malformed row rather than losing the order", () => {
    // Silently reverting to recency here would look like the drag never saved.
    expect(() => parseRankStore([])).toThrow(/expected object, got array/);
    expect(() => parseRankStore("nope")).toThrow(/expected object, got string/);
    expect(() => parseRankStore({ "status:unread": "thr_a" })).toThrow(
      /not an array/,
    );
    expect(() => parseRankStore({ "status:unread": ["thr_a", 7] })).toThrow(
      /non-string id/,
    );
  });

  it("collapses a duplicate id so lookups stay order-independent", () => {
    expect(parseRankStore({ "status:unread": ["thr_a", "thr_a", "thr_b"] })).toEqual(
      { "status:unread": ["thr_a", "thr_b"] },
    );
  });
});

describe("applyMove", () => {
  it("inserts at the top when no anchor is given", () => {
    expect(applyMove(["thr_b", "thr_c"], "thr_a", null)).toEqual([
      "thr_a",
      "thr_b",
      "thr_c",
    ]);
  });

  it("inserts immediately before the anchor", () => {
    expect(applyMove(["thr_a", "thr_c"], "thr_b", "thr_c")).toEqual([
      "thr_a",
      "thr_b",
      "thr_c",
    ]);
  });

  it("moves an already-ranked card without duplicating it", () => {
    expect(applyMove(["thr_a", "thr_b", "thr_c"], "thr_c", "thr_a")).toEqual([
      "thr_c",
      "thr_a",
      "thr_b",
    ]);
  });

  it("leaves the input order untouched", () => {
    const order = ["thr_a", "thr_b"];
    applyMove(order, "thr_b", "thr_a");
    expect(order).toEqual(["thr_a", "thr_b"]);
  });

  it("is a no-op when a card is dropped on itself", () => {
    expect(applyMove(["thr_a", "thr_b"], "thr_a", "thr_a")).toEqual([
      "thr_a",
      "thr_b",
    ]);
  });

  it("appends rather than guessing when the anchor is unranked", () => {
    // A filtered-out anchor must not put the card in an arbitrary slot.
    expect(applyMove(["thr_a"], "thr_b", "thr_zzz")).toEqual([
      "thr_a",
      "thr_b",
    ]);
  });

  it("a card dropped at the top of an unranked column leads it", () => {
    expect(applyMove([], "thr_a", null)).toEqual(["thr_a"]);
  });
});

describe("rank survives leaving and re-entering a column", () => {
  it("re-enters the gap it left, without renumbering anything", () => {
    // The property the operator asked for: rank in Unread, read the thread
    // (it leaves Unread), come back, same slot.
    let order = applyMove([], "thr_b", null);
    order = applyMove(order, "thr_c", null);
    expect(order).toEqual(["thr_c", "thr_b"]);

    // thr_b is read: it leaves the column. The order is NOT pruned — nothing
    // here runs when a card leaves, and even if it did, the list is a set of
    // ids, not positions, so removal is not needed for correctness.
    const shown = order.filter((id) => id !== "thr_b");
    expect(shown).toEqual(["thr_c"]);

    // thr_b comes back unread.
    const shownAgain = order.filter((id) => id === "thr_b" || id === "thr_c");
    expect(shownAgain).toEqual(["thr_c", "thr_b"]);
  });
});

describe("ordering a column by rank", () => {
  const card = (id: string, updatedAt: number) => ({ id, updatedAt });

  it("puts ranked cards first, in stored order", () => {
    const cards = [
      card("thr_a", 300),
      card("thr_b", 200),
      card("thr_c", 100),
    ];
    const sorted = [...cards].sort(compareByRank(["thr_c", "thr_a"], newestFirst));
    expect(sorted.map((c) => c.id)).toEqual(["thr_c", "thr_a", "thr_b"]);
  });

  it("keeps unranked cards in the derived order underneath", () => {
    const cards = [
      card("thr_old", 100),
      card("thr_ranked", 50),
      card("thr_new", 900),
    ];
    const sorted = [...cards].sort(compareByRank(["thr_ranked"], newestFirst));
    expect(sorted.map((c) => c.id)).toEqual(["thr_ranked", "thr_new", "thr_old"]);
  });

  it("an unranked column orders exactly as the derived order does", () => {
    const cards = [card("thr_a", 100), card("thr_b", 300)];
    const sorted = [...cards].sort(compareByRank([], newestFirst));
    expect(sorted.map((c) => c.id)).toEqual(["thr_b", "thr_a"]);
  });

  it("ignores ranks held by cards that are not in this column", () => {
    // Ranked ids from another column must not leak into this one.
    const cards = [card("thr_a", 100), card("thr_b", 300)];
    const sorted = [...cards].sort(compareByRank(["thr_elsewhere"], newestFirst));
    expect(sorted.map((c) => c.id)).toEqual(["thr_b", "thr_a"]);
  });
});

describe("appendTo", () => {
  it("puts the card last", () => {
    expect(appendTo(["thr_a", "thr_b"], "thr_c")).toEqual([
      "thr_a",
      "thr_b",
      "thr_c",
    ]);
  });

  it("moves an already-ranked card to the end without duplicating it", () => {
    expect(appendTo(["thr_a", "thr_b", "thr_c"], "thr_a")).toEqual([
      "thr_b",
      "thr_c",
      "thr_a",
    ]);
  });

  it("is a no-op for a card already last", () => {
    expect(appendTo(["thr_a", "thr_b"], "thr_b")).toEqual(["thr_a", "thr_b"]);
  });
});

describe("turning a drop position into a move", () => {
  const ids = ["thr_a", "thr_b", "thr_c"];

  it("the top half of a card anchors on that card", () => {
    expect(moveTargetFor(ids, "thr_b", "before", "thr_a")).toEqual({
      beforeId: "thr_b",
      toEnd: false,
    });
  });

  it("the bottom half anchors on the card below, so the card lands past it", () => {
    // Dragging thr_a down past thr_b must not land it ON thr_b.
    expect(moveTargetFor(ids, "thr_b", "after", "thr_a")).toEqual({
      beforeId: "thr_c",
      toEnd: false,
    });
  });

  it("the bottom half of the last card appends", () => {
    expect(moveTargetFor(ids, "thr_c", "after", "thr_a")).toEqual({
      beforeId: null,
      toEnd: true,
    });
  });

  it("the top half of the first card puts the card at the top", () => {
    expect(moveTargetFor(ids, "thr_a", "before", "thr_c")).toEqual({
      beforeId: "thr_a",
      toEnd: false,
    });
  });

  it("refuses a drop on the dragged card itself", () => {
    expect(moveTargetFor(ids, "thr_b", "before", "thr_b")).toBeNull();
    expect(moveTargetFor(ids, "thr_b", "after", "thr_b")).toBeNull();
  });

  it("lands directly under the hovered card when that is the dragged one", () => {
    // Hovering the card below the dragged card: anchoring on it would be a
    // no-op, so the dragged card belongs under the hovered one.
    expect(moveTargetFor(ids, "thr_b", "after", "thr_c")).toEqual({
      beforeId: "thr_b",
      toEnd: false,
    });
  });

  it("refuses a hover id that is not in the column", () => {
    expect(moveTargetFor(ids, "thr_zzz", "before", "thr_a")).toBeNull();
  });
});

describe("applyMoveVisible", () => {
  it("a first drop into an unranked column ranks everything above the drop point", () => {
    // THE regression: with only the dragged card ranked, compareByRank still
    // sorts it above every unranked card, so "below the second card" silently
    // no-ops. The cards the drop lands ABOVE must be ranked with it. thr_b is
    // the anchor the card was dropped in front of, so it sits BELOW the drop
    // point and stays unranked — yet still displays third, under thr_c.
    const order = applyMoveVisible([], ["thr_a", "thr_b", "thr_c"], "thr_c", "thr_b", false);
    expect(order).toEqual(["thr_a", "thr_c"]);
  });

  it("cards below the drop point stay unranked", () => {
    const order = applyMoveVisible(
      [],
      ["thr_a", "thr_b", "thr_c", "thr_d"],
      "thr_d",
      "thr_b",
      false,
    );
    expect(order).toEqual(["thr_a", "thr_d"]);
  });

  it("an already-ranked column moves only the dragged card", () => {
    const order = applyMoveVisible(
      ["thr_x", "thr_y"],
      ["thr_x", "thr_y", "thr_z"],
      "thr_z",
      "thr_y",
      false,
    );
    expect(order).toEqual(["thr_x", "thr_z", "thr_y"]);
  });

  it("a first drop onto a card's top half ranks the cards above the anchor", () => {
    // Dropping on thr_c's top half lands between thr_b and thr_c, so the
    // ranked head is [a, b] plus the moved card — thr_c stays unranked.
    const order = applyMoveVisible(
      [],
      ["thr_a", "thr_b", "thr_c"],
      "thr_d",
      "thr_c",
      false,
    );
    expect(order).toEqual(["thr_a", "thr_b", "thr_d"]);
  });

  it("dropping at the top of an unranked column ranks only the moved card", () => {
    expect(applyMoveVisible([], ["thr_a", "thr_b"], "thr_c", null, false)).toEqual([
      "thr_c",
    ]);
  });

  it("a toEnd drop ranks every visible card", () => {
    // Landing below the last visible card means landing below the unranked
    // ones too, so all of them are ranked. A previously-ranked card the
    // visible list does not mention is untouched by the move and keeps its
    // stored order after the newly ranked head.
    const order = applyMoveVisible(
      ["thr_old"],
      ["thr_a", "thr_b", "thr_c"],
      "thr_c",
      null,
      true,
    );
    expect(order).toEqual(["thr_a", "thr_b", "thr_c", "thr_old"]);
  });

  it("an unknown anchor in an unranked column still ranks the displayed prefix", () => {
    // applyMove appends when the anchor is not in the visible list; the head
    // densify then follows the DISPLAYED order, not the fallback's guess.
    const order = applyMoveVisible(
      [],
      ["thr_a", "thr_b"],
      "thr_c",
      "thr_zzz",
      false,
    );
    expect(order).toEqual(["thr_a", "thr_b", "thr_c"]);
  });

  it("appends ranks the visible list does not mention after the new head", () => {
    // A filtered-out ranked card is not silently unranked by a move it took
    // no part in; it lands after the newly ranked head, which is the next
    // slot the display order can resolve.
    const order = applyMoveVisible(
      ["thr_hidden", "thr_a"],
      ["thr_a", "thr_b"],
      "thr_c",
      "thr_b",
      false,
    );
    expect(order).toEqual(["thr_a", "thr_c", "thr_hidden"]);
  });

  it("an empty thread id changes nothing", () => {
    expect(applyMoveVisible([], ["thr_a"], "", null, false)).toEqual([]);
  });
});

describe("displayAfterMove", () => {
  it("rearranges the visible list without consulting stored ranks", () => {
    // The announcement counts cards, not ranks: a card that keeps its rank
    // below the drop point is still on the board and still occupies a slot.
    expect(displayAfterMove(["thr_a", "thr_b", "thr_c"], "thr_c", "thr_b", false)).toEqual([
      "thr_a",
      "thr_c",
      "thr_b",
    ]);
    expect(displayAfterMove(["thr_a", "thr_b"], "thr_b", null, true)).toEqual([
      "thr_a",
      "thr_b",
    ]);
  });
});

describe("ranked column lookup", () => {
  it("an unranking column reports an empty order and is not ranked", () => {
    expect(orderForColumn({}, "status:unread")).toEqual([]);
    expect(columnIsRanked({}, "status:unread")).toBe(false);
  });

  it("a column with any ranked card reports as ranked", () => {
    const store = { "status:unread": ["thr_a"] };
    expect(orderForColumn(store, "status:unread")).toEqual(["thr_a"]);
    expect(columnIsRanked(store, "status:unread")).toBe(true);
    // A column with an explicitly empty order is NOT ranked: the operator
    // ranked nothing there, so drag must stay off.
    expect(columnIsRanked({ "status:unread": [] }, "status:unread")).toBe(false);
  });
});
