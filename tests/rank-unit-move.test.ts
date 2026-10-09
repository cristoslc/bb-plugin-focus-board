import { describe, expect, it } from "vitest";
import { applyUnitMoveVisible, displayAfterUnitMove } from "../lib/rank-unit-move";

describe("displayAfterUnitMove", () => {
  it("moves the unit to the anchor as ONE contiguous block", () => {
    expect(displayAfterUnitMove(["a", "b", "c", "d"], ["b", "d"], "a", false)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("a null anchor puts the unit at the top", () => {
    expect(displayAfterUnitMove(["a", "b", "c"], ["b", "c"], null, false)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("toEnd puts the unit below everything", () => {
    expect(displayAfterUnitMove(["a", "b", "c"], ["a"], null, true)).toEqual(["b", "c", "a"]);
  });

  it("an anchor inside the unit is a no-op (the box cannot land inside itself)", () => {
    expect(displayAfterUnitMove(["a", "b", "c", "d"], ["b", "c"], "c", false)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("an anchor the rest does not hold appends the unit below", () => {
    expect(displayAfterUnitMove(["a", "b"], ["b"], "ghost", false)).toEqual(["a", "b"]);
  });

  it("deduplicates unit ids defensively", () => {
    expect(displayAfterUnitMove(["a", "b", "c"], ["b", "b"], "a", false)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("keeps the unit's previous relative order inside the block", () => {
    expect(displayAfterUnitMove(["c", "a", "b", "x"], ["c", "a"], "x", false)).toEqual([
      "b",
      "c",
      "a",
      "x",
    ]);
  });
});

describe("applyUnitMoveVisible", () => {
  it("a fresh column: dropping above an anchor ranks the unit contiguous; the anchor stays unranked", () => {
    const next = applyUnitMoveVisible([], ["a", "b", "c", "x"], ["c", "x"], "a", false);
    // The unit ranks as one head; a and b stay unranked below it, exactly
    // as a single-card first-drop ranks only the moved card's head.
    expect(next).toEqual(["c", "x"]);
  });

  it("cards BELOW the drop point keep their stored rank", () => {
    // Display at drop time: [old, a, b, c, x]; the box (c,x) drops below
    // "old", which anchors on the next card after it ("a"), not on "old".
    const next = applyUnitMoveVisible(
      ["old", "c", "x", "a", "b"],
      ["old", "a", "b", "c", "x"],
      ["c", "x"],
      "a",
      false,
    );
    // Head = old + unit; a, b keep their (now lower) ranks.
    expect(next).toEqual(["old", "c", "x", "a", "b"]);
  });

  it("a no-op move returns an equal order (caller skips the write)", () => {
    expect(
      applyUnitMoveVisible(["c", "x", "a", "b"], ["c", "x", "a", "b"], ["c", "x"], "a", false),
    ).toEqual(["c", "x", "a", "b"]);
  });

  it("the anchor inside the unit returns the stored order unchanged", () => {
    expect(
      applyUnitMoveVisible(["b", "c", "x", "a"], ["b", "c", "x", "a"], ["c", "x"], "x", false),
    ).toEqual(["b", "c", "x", "a"]);
  });

  it("gaps survive: an empty unit input returns the stored order", () => {
    expect(applyUnitMoveVisible(["a", "b"], ["a", "b"], [], "a", false)).toEqual(["a", "b"]);
  });
});