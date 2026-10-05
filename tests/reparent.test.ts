// lib/reparent: the drop-a-card-onto-another-card guard. Dropping a card in
// the middle third of another card re-parents the dropped thread under the
// target; the guard is what decides whether that gesture is legal. Both the
// client (dragover affordance, drop refusal) and the server (the RPC handler
// against its own thread rows) run the same rules, so stale UI state never
// writes an illegal parent link.
import { describe, expect, it } from "vitest";
import {
  reparentRefusal,
  reparentRefusalFromParents,
} from "../lib/reparent";

describe("reparentRefusalFromParents (graph-level checks)", () => {
  const parents = new Map<string, string>([
    ["thr_child", "thr_parent"],
    ["thr_grand", "thr_child"],
    ["thr_parent", "thr_root"],
  ]);

  it("allows a plain attach", () => {
    expect(reparentRefusalFromParents(parents, "thr_a", "thr_b")).toBeNull();
  });

  it("allows a detach (null parent) unconditionally", () => {
    expect(reparentRefusalFromParents(parents, "thr_child", null)).toBeNull();
  });

  it("refuses dropping a card onto itself", () => {
    const refusal = reparentRefusalFromParents(parents, "thr_a", "thr_a");
    expect(refusal).toMatch(/itself/);
  });

  it("refuses nesting a card under one of its own descendants", () => {
    // thr_parent's chain runs parent → root; thr_grand is BELOW thr_parent,
    // but the drop target's own ancestry (thr_parent → thr_root) is what
    // matters. Dropping the root under thr_parent is the loop.
    const refusal = reparentRefusalFromParents(parents, "thr_root", "thr_child");
    expect(refusal).toMatch(/loop/);
  });

  it("refuses nesting a card under its own child", () => {
    const refusal = reparentRefusalFromParents(parents, "thr_parent", "thr_grand");
    expect(refusal).toMatch(/loop/);
  });

  it("refuses a drop onto the card it already hangs from", () => {
    const refusal = reparentRefusalFromParents(parents, "thr_child", "thr_parent");
    expect(refusal).toMatch(/already/);
  });

  it("allows re-rooting a card onto a different ancestor step", () => {
    // thr_grand currently hangs from thr_child; dropping it on thr_parent
    // (its grandparent) flattens a level — a change, not a no-op.
    expect(reparentRefusalFromParents(parents, "thr_grand", "thr_parent")).toBeNull();
  });

  it("refuses an empty dropped id", () => {
    expect(reparentRefusalFromParents(parents, "", "thr_parent")).toMatch(/identify/);
  });

  it("survives a corrupt cycle already in the graph without hanging", () => {
    const cyclic = new Map<string, string>([
      ["thr_a", "thr_b"],
      ["thr_b", "thr_a"],
    ]);
    expect(reparentRefusalFromParents(cyclic, "thr_a", "thr_c")).toBeNull();
  });
});

type Row = { id: string; parentThreadId: string | null; isArchived?: boolean };

function rows(...list: Row[]): Row[] {
  return list;
}

describe("reparentRefusal (row-level checks, server side)", () => {
  const live = rows(
    { id: "thr_parent", parentThreadId: null },
    { id: "thr_child", parentThreadId: "thr_parent" },
    { id: "thr_archived", parentThreadId: null, isArchived: true },
    { id: "thr_root", parentThreadId: null },
  );

  it("refuses an unknown dropped thread", () => {
    expect(reparentRefusal(live, "thr_missing", "thr_parent")).toMatch(/dropped/);
  });

  it("refuses an unknown target thread", () => {
    expect(reparentRefusal(live, "thr_root", "thr_missing")).toMatch(/target/);
  });

  it("refuses an archived dropped card", () => {
    const refusal = reparentRefusal(live, "thr_archived", "thr_parent");
    expect(refusal).toMatch(/archived/);
  });

  it("refuses nesting under an archived card", () => {
    const refusal = reparentRefusal(
      rows({ id: "thr_root", parentThreadId: null }, { id: "thr_archived", parentThreadId: null, isArchived: true }),
      "thr_root",
      "thr_archived",
    );
    expect(refusal).toMatch(/archived/);
  });

  it("allows an ordinary attach between live cards", () => {
    expect(reparentRefusal(live, "thr_root", "thr_parent")).toBeNull();
  });

  it("allows a detach of a known thread", () => {
    expect(reparentRefusal(live, "thr_child", null)).toBeNull();
  });

  it("passes the graph-level checks through", () => {
    expect(reparentRefusal(live, "thr_child", "thr_parent")).toMatch(/already/);
    expect(reparentRefusal(live, "thr_parent", "thr_child")).toMatch(/loop/);
    expect(reparentRefusal(live, "thr_child", "thr_child")).toMatch(/itself/);
  });

  it("treats an empty-string parent id as absent data, not an edge", () => {
    // thr_weird's corrupt "" parent must not hang the ancestry walk: it
    // renders as a root, so dropping thr_root under thr_weird is a legal
    // new edge.
    const corrupt = rows(
      { id: "thr_root", parentThreadId: null },
      { id: "thr_weird", parentThreadId: "" },
    );
    expect(reparentRefusal(corrupt, "thr_root", "thr_weird")).toBeNull();
  });
});