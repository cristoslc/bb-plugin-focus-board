// The lane's family fold-key set (lib/family-fold-keys).
//
// The lane context menu's bulk fold/idle actions act on every family card a
// lane holds, so the key set has to be the same key each card reads and
// reports — never a second spelling of the `done:` prefix, and never another
// lane's keys. These cases pin the four things the menu relies on: live cards
// contribute their plain id, Done projections contribute `done:<id>`, a card
// with no child rows contributes nothing, and a lane's set is its own.
import { describe, expect, it } from "vitest";
import {
  DONE_LANE_ID,
  foldKeyForCard,
  foldKeyForSpace,
  laneFamilyFoldKeys,
} from "../lib/family-fold-keys";

type Card = { readonly id: string };

const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const none = new Map<string, readonly { id: string }[]>();

function index(opts: {
  nested?: Record<string, string[]>;
  done?: Record<string, string[]>;
}) {
  return {
    nestedChildrenByParent: new Map(
      Object.entries(opts.nested ?? {}).map(([id, children]) => [id, rows(...children)]),
    ),
    doneChildrenByParent: new Map(
      Object.entries(opts.done ?? {}).map(([id, children]) => [id, rows(...children)]),
    ),
  };
}

const cards = (...ids: string[]): Card[] => ids.map((id) => ({ id }));

describe("foldKeyForCard", () => {
  it("a live card keys on its own id", () => {
    expect(foldKeyForCard("unread", "thr_a", new Set())).toBe("thr_a");
  });

  it("a Done projection card keys on the done: space", () => {
    expect(foldKeyForCard(DONE_LANE_ID, "thr_a", new Set())).toBe(foldKeyForSpace("thr_a"));
  });

  it("a done thread's own family card in the Done lane keeps its plain id", () => {
    // The card's own rule: only a LIVE root renders as the Done projection,
    // so a done parent's family card folds under its plain id.
    expect(foldKeyForCard(DONE_LANE_ID, "thr_a", new Set(["thr_a"]))).toBe("thr_a");
  });
});

describe("laneFamilyFoldKeys", () => {
  it("returns a live family's plain id in lane order", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_a", "thr_b"),
      "unread",
      new Set(),
      index({ nested: { thr_b: ["thr_b_c1"], thr_a: ["thr_a_c1"] } }),
    );
    expect(keys).toEqual(["thr_a", "thr_b"]);
  });

  it("ignores cards with no child rows", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_lone", "thr_family"),
      "unread",
      new Set(),
      index({ nested: { thr_family: ["thr_child"] } }),
    );
    expect(keys).toEqual(["thr_family"]);
  });

  it("an entry that holds an empty row list is not a family", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_empty"),
      "unread",
      new Set(),
      index({ nested: { thr_empty: [] } }),
    );
    expect(keys).toEqual([]);
  });

  it("a lane with no families returns an empty set", () => {
    expect(
      laneFamilyFoldKeys(
        cards("thr_a", "thr_b"),
        "unread",
        new Set(),
        index({ nested: { thr_elsewhere: ["thr_x"] } }),
      ),
    ).toEqual([]);
  });

  it("a Done lane's projection cards contribute done: keys", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_live", "thr_other_live"),
      DONE_LANE_ID,
      new Set(),
      index({ done: { thr_live: ["thr_done_c1"], thr_other_live: ["thr_done_c2"] } }),
    );
    expect(keys).toEqual(["done:thr_live", "done:thr_other_live"]);
  });

  it("a done family in the Done lane keeps its plain id", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_done_parent"),
      DONE_LANE_ID,
      new Set(["thr_done_parent"]),
      index({ nested: { thr_done_parent: ["thr_done_child"] } }),
    );
    expect(keys).toEqual(["thr_done_parent"]);
  });

  it("the Done lane ignores a live card's nested rows (its card renders the done portion)", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_live"),
      DONE_LANE_ID,
      new Set(),
      index({ nested: { thr_live: ["thr_live_child"] } }),
    );
    expect(keys).toEqual([]);
  });

  it("never includes another lane's keys", () => {
    const keys = laneFamilyFoldKeys(
      cards("thr_a"),
      "unread",
      new Set(),
      index({ nested: { thr_a: ["thr_a_c1"], thr_b: ["thr_b_c1"], thr_c: ["thr_c_c1"] } }),
    );
    expect(keys).toEqual(["thr_a"]);
    expect(keys).not.toContain("thr_b");
    expect(keys).not.toContain("thr_c");
  });

  it("reports a card once even if the lane lists it twice", () => {
    expect(
      laneFamilyFoldKeys(
        cards("thr_a", "thr_a"),
        "unread",
        new Set(),
        index({ nested: { thr_a: ["thr_a_c1"] } }),
      ),
    ).toEqual(["thr_a"]);
  });

  it("reads no host at all: an empty index and empty lane answer empty", () => {
    expect(laneFamilyFoldKeys([], "unread", new Set(), { nestedChildrenByParent: none, doneChildrenByParent: none })).toEqual(
      [],
    );
  });
});
