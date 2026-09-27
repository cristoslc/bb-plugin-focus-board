// Board-level rank integration: the column builder and the nesting pass must
// both honour a stored order, and an unranked board must be byte-identical to
// the pre-rank one. The storage mechanics live in tests/rank.test.ts; this
// file pins the wiring, which is where a rank can be silently ignored.
import { describe, expect, it } from "vitest";
import { buildColumns } from "../components/grouping";
import { assembleBoard } from "../components/nesting";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;

const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

const unread = (id: string, updatedAt: number) =>
  thread({ id, isUnread: true, updatedAt });

describe("buildColumns honours a stored column order", () => {
  const threads = [
    unread("thr_new", 300),
    unread("thr_mid", 200),
    unread("thr_old", 100),
  ];

  const idsIn = (columnId: string, ranks: Parameters<typeof buildColumns>[6]) => {
    const column = buildColumns(threads, "status", context, new Map(), new Set(), NOW, ranks).find(
      (candidate) => candidate.id === columnId,
    );
    return (column?.threads ?? []).map((candidate) => candidate.id);
  };

  it("orders an unranked column newest-first, as before", () => {
    expect(idsIn("unread", {})).toEqual(["thr_new", "thr_mid", "thr_old"]);
  });

  it("puts ranked cards first, in stored order", () => {
    expect(idsIn("unread", { "status:unread": ["thr_old", "thr_mid"] })).toEqual([
      "thr_old",
      "thr_mid",
      "thr_new",
    ]);
  });

  it("keeps unranked cards newest-first underneath the ranked ones", () => {
    expect(idsIn("unread", { "status:unread": ["thr_mid"] })).toEqual([
      "thr_mid",
      "thr_new",
      "thr_old",
    ]);
  });

  it("ignores an order stored for a different grouping's column", () => {
    // Same column id, different grouping: must not leak in.
    expect(idsIn("unread", { "recency:unread": ["thr_old"] })).toEqual([
      "thr_new",
      "thr_mid",
      "thr_old",
    ]);
  });

  it("ignores ranks held by threads not in this column", () => {
    expect(idsIn("unread", { "status:unread": ["thr_absent"] })).toEqual([
      "thr_new",
      "thr_mid",
      "thr_old",
    ]);
  });

  it("ranks the Pinned column, which is not namespaced by grouping", () => {
    const pinnedThreads = [
      thread({ id: "thr_p1", isPinned: true, updatedAt: 300 }),
      thread({ id: "thr_p2", isPinned: true, updatedAt: 100 }),
    ];
    const column = buildColumns(
      pinnedThreads,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { pinned: ["thr_p2"] },
    ).find((candidate) => candidate.id === "pinned");
    expect(column?.threads.map((candidate) => candidate.id)).toEqual([
      "thr_p2",
      "thr_p1",
    ]);
  });
});

describe("rank survives a card leaving its column and coming back", () => {
  it("an unread card that gets read and unread again returns to its slot", () => {
    const order = ["thr_b", "thr_c"];
    const all = [unread("thr_b", 200), unread("thr_c", 100), unread("thr_d", 50)];

    const before = buildColumns(all, "status", context, new Map(), new Set(), NOW, {
      "status:unread": order,
    }).find((c) => c.id === "unread");
    expect(before?.threads.map((t) => t.id)).toEqual(["thr_b", "thr_c", "thr_d"]);

    // thr_b is read: it leaves the Unread column entirely. The stored order
    // is untouched, because nothing prunes on departure.
    const read = [unread("thr_c", 100), unread("thr_d", 50)];
    const whileGone = buildColumns(read, "status", context, new Map(), new Set(), NOW, {
      "status:unread": order,
    }).find((c) => c.id === "unread");
    expect(whileGone?.threads.map((t) => t.id)).toEqual(["thr_c", "thr_d"]);

    // Back to unread: same gap, same slot, no renumbering needed.
    const after = buildColumns(all, "status", context, new Map(), new Set(), NOW, {
      "status:unread": order,
    }).find((c) => c.id === "unread");
    expect(after?.threads.map((t) => t.id)).toEqual(["thr_b", "thr_c", "thr_d"]);
  });
});

describe("nested families follow their parent's column order", () => {
  const family = [
    thread({ id: "thr_parent", isUnread: true, updatedAt: 300 }),
    thread({ id: "thr_kid_new", isUnread: true, updatedAt: 900, parentThreadId: "thr_parent" }),
    thread({ id: "thr_kid_old", isUnread: true, updatedAt: 100, parentThreadId: "thr_parent" }),
  ];

  it("sorts children by the parent's column order, not their recency", () => {
    const assembly = assembleBoard(
      family,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { ranks: { "status:unread": ["thr_parent", "thr_kid_old"] } },
    );
    const children = assembly.nestedChildrenByParent.get("thr_parent") ?? [];
    expect(children.map((t) => t.id)).toEqual(["thr_kid_old", "thr_kid_new"]);
  });

  it("leaves child order in the derived recency when no rank is stored", () => {
    const assembly = assembleBoard(family, "status", context, new Map(), new Set(), NOW);
    const children = assembly.nestedChildrenByParent.get("thr_parent") ?? [];
    expect(children.map((t) => t.id)).toEqual(["thr_kid_new", "thr_kid_old"]);
  });

  it("a ranked parent moves as a unit and takes no slot of its own for a nested child", () => {
    const assembly = assembleBoard(
      family,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { ranks: { "status:unread": ["thr_parent"] } },
    );
    const column = assembly.columns.find((c) => c.id === "unread");
    expect(column?.threads.map((t) => t.id)).toEqual(["thr_parent"]);
  });
});
