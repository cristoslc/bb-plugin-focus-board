import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  STATUS_COLUMN_ORDER,
  buildColumns,
  threadState,
  type BoardColumn,
  type FilterState,
  type GroupingContext,
} from "../components/grouping";
import {
  assembleBoard,
  buildFamilyIndex,
  familiesToAutoExpand,
  familiesWithUrgentChildren,
  familyColumnOverrides,
  filterFamilies,
  filterIndividually,
  nestUnderParents,
} from "../components/nesting";
import { pinnedAttentionIds } from "../components/nesting";
import { buildParentLanes } from "../components/parent-lanes";
import { thread } from "./thread-fixture";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

const CONTEXT: GroupingContext = {
  projects: [
    { id: "proj_a", name: "Alpha", isPersonal: false, href: "", settingsHref: "" },
    { id: "proj_b", name: "Beta", isPersonal: false, href: "", settingsHref: "" },
  ],
  providers: [{ id: "pi", displayName: "Pi" }],
};

const EMPTY_FILTER: FilterState = {
  projects: new Set(),
  providers: new Set(),
  states: new Set(),
};

function columnOf(columns: readonly BoardColumn[], threadId: string): BoardColumn | undefined {
  return columns.find((column) => column.threads.some((t) => t.id === threadId));
}

function ids(threads: readonly PluginSidebarThread[] | undefined): string[] {
  return (threads ?? []).map((t) => t.id);
}

function idsIn(columns: readonly BoardColumn[], columnId: string): string[] {
  const column = columns.find((c) => c.id === columnId);
  return column === undefined ? [] : column.threads.map((t) => t.id);
}

describe("STATUS_COLUMN_ORDER export", () => {
  it("orders state lanes by attention priority, done last conceptually", () => {
    expect(STATUS_COLUMN_ORDER).toEqual([
      "attention",
      "unread",
      "working",
      "idle-recent",
      "idle-today",
      "idle-earlier",
      "idle-awhile",
    ]);
  });
});

describe("buildFamilyIndex", () => {
  it("links children to parents", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const index = buildFamilyIndex([parent, child]);
    expect(ids(index.childrenByParent.get("p"))).toEqual(["c"]);
    expect(index.parentOf.get("c")).toBe("p");
  });

  it("treats orphans (missing parent) as roots", () => {
    const orphan = thread({ id: "o", parentThreadId: "gone" });
    const index = buildFamilyIndex([orphan]);
    expect(index.parentOf.get("o")).toBeUndefined();
    expect(index.childrenByParent.has("gone")).toBe(false);
  });

  it("tolerates cycles: cycle members become roots, no hang", () => {
    const a = thread({ id: "a", parentThreadId: "b" });
    const b = thread({ id: "b", parentThreadId: "a" });
    const c = thread({ id: "c", parentThreadId: "a" });
    const index = buildFamilyIndex([a, b, c]);
    expect(index.parentOf.has("a")).toBe(false);
    expect(index.parentOf.has("b")).toBe(false);
    expect(index.parentOf.get("c")).toBe("a");
    expect(ids(index.childrenByParent.get("a"))).toEqual(["c"]);
  });

  it("excludes hidden children: caller passes the non-hidden set, hidden never nests", () => {
    // Caller contract: app.tsx filters hidden out before calling (archived is
    // INCLUDED since refinement round 2), so this test pins the contract —
    // the index built from the non-hidden set must nest only its members.
    const parent = thread({ id: "p" });
    const visibleChild = thread({ id: "c", parentThreadId: "p" });
    const index = buildFamilyIndex([parent, visibleChild]);
    expect(ids(index.childrenByParent.get("p"))).toEqual(["c"]);
    expect(index.rootIds.has("c")).toBe(false);
  });

  it("includes archived children in the index (R2: archived children stay under the parent)", () => {
    const parent = thread({ id: "p" });
    const liveChild = thread({ id: "c", parentThreadId: "p" });
    const archivedChild = thread({ id: "a", parentThreadId: "p", isArchived: true });
    const index = buildFamilyIndex([parent, liveChild, archivedChild]);
    expect(ids(index.childrenByParent.get("p"))).toEqual(["c", "a"]);
    expect(index.parentOf.get("a")).toBe("p");
  });
});

describe("nestUnderParents — Attention (status) grouping placement (R4: family moves as a unit)", () => {
  it("nests a Needs-you child under its Working parent (the family relocates, nobody promotes)", () => {
    const parent = thread({ id: "p", status: "active" });
    const child = thread({ id: "c", parentThreadId: "p", hasPendingInteraction: true });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(columnOf(nested.columns, "c")).toBeUndefined();
  });

  it("nests an Unread child under its Working parent", () => {
    const parent = thread({ id: "p", status: "active" });
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(idsIn(nested.columns, "unread")).not.toContain("c");
  });

  it("nests a Working child under its Idle parent instead of promoting", () => {
    const parent = thread({ id: "p" }); // idle
    const child = thread({ id: "c", parentThreadId: "p", status: "active" });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(idsIn(nested.columns, "working")).not.toContain("c");
  });

  it("nests an Idle child under any parent", () => {
    const parent = thread({ id: "p", status: "active" });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(idsIn(nested.columns, "idle-recent")).not.toContain("c");
  });

  it("nests a Needs-you child under a Needs-you parent (equal rank)", () => {
    const parent = thread({ id: "p", hasPendingInteraction: true });
    const child = thread({ id: "c", parentThreadId: "p", hasPendingInteraction: true });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
  });

  it("nests an Unread child under a Needs-you parent (parent outranks)", () => {
    const parent = thread({ id: "p", hasPendingInteraction: true });
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(idsIn(nested.columns, "unread")).not.toContain("c");
  });

  it("promotes a live child under a Done parent (any state outranks done)", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true });
    const doneIds = new Set(["p"]);
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), doneIds, NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW, buildFamilyIndex([parent, child]), { doneIds });
    expect(idsIn(nested.columns, "unread")).toContain("c");
    expect(nested.childrenByParent.has("p")).toBe(false);
  });

  it("keeps the existing sorted() order inside a column for a promoted child", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const olderChild = thread({
      id: "older",
      parentThreadId: "p",
      isUnread: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const newerStandalone = thread({ id: "newer", isUnread: true, updatedAt: NOW - HOUR });
    const doneIds = new Set(["p"]);
    const columns = buildColumns(
      [parent, olderChild, newerStandalone],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    const nested = nestUnderParents(
      columns,
      [parent, olderChild, newerStandalone],
      "status",
      CONTEXT,
      NOW,
      buildFamilyIndex([parent, olderChild, newerStandalone]),
      { doneIds },
    );
    // newest-first: newerStandalone (1h) before olderChild (2h)
    expect(idsIn(nested.columns, "unread")).toEqual(["newer", "older"]);
  });
});

describe("nestUnderParents — axis groupings", () => {
  it("project grouping: same-project child nests", () => {
    const parent = thread({ id: "p", projectId: "proj_a", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", projectId: "proj_a", updatedAt: NOW - 2 * HOUR });
    const columns = buildColumns([parent, child], "project", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "project", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(columnOf(nested.columns, "c")).toBeUndefined();
  });

  it("project grouping: cross-project child stands alone in its own project column", () => {
    const parent = thread({ id: "p", projectId: "proj_a" });
    const child = thread({ id: "c", parentThreadId: "p", projectId: "proj_b", updatedAt: NOW - HOUR });
    const columns = buildColumns([parent, child], "project", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "project", CONTEXT, NOW);
    expect(nested.childrenByParent.has("p")).toBe(false);
    const childColumn = columnOf(nested.columns, "c");
    expect(childColumn?.id).toBe("proj_b");
  });

  it("machine grouping: cross-machine child stands alone", () => {
    const parent = thread({ id: "p", host: { id: "host_1", name: "Desktop" } });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      host: { id: "host_2", name: "Laptop" },
      updatedAt: NOW - HOUR,
    });
    const columns = buildColumns([parent, child], "machine", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "machine", CONTEXT, NOW);
    expect(nested.childrenByParent.has("p")).toBe(false);
    expect(columnOf(nested.columns, "c")?.id).toBe("host_2");
  });

  it("machine grouping: same-machine child nests", () => {
    const host = { id: "host_1", name: "Desktop" };
    const parent = thread({ id: "p", host, updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", host, updatedAt: NOW - 2 * HOUR });
    const columns = buildColumns([parent, child], "machine", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "machine", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
  });

  it("provider grouping: cross-provider child stands alone", () => {
    const parent = thread({ id: "p", providerId: "pi" });
    const child = thread({ id: "c", parentThreadId: "p", providerId: "other", updatedAt: NOW - HOUR });
    const columns = buildColumns([parent, child], "provider", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "provider", CONTEXT, NOW);
    expect(nested.childrenByParent.has("p")).toBe(false);
    expect(columnOf(nested.columns, "c")?.id).toBe("other");
  });

  it("recency grouping: family nests regardless of differing buckets", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * HOUR }); // today
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 8 * DAY }); // awhile
    const columns = buildColumns([parent, child], "recency", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "recency", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(columnOf(nested.columns, "c")).toBeUndefined();
  });

  it("none grouping: family nests in the flat column", () => {
    const parent = thread({ id: "p", status: "active" });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const columns = buildColumns([parent, child], "none", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "none", CONTEXT, NOW);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id)).toEqual(["c"]);
    expect(nested.columns).toHaveLength(1);
  });
});

describe("nestUnderParents — depth cap (two levels, everywhere)", () => {
  it("a three-tier family re-attaches its grandchildren to the family root", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const gc1 = thread({ id: "g1", parentThreadId: "c", updatedAt: NOW - 3 * HOUR });
    const gc2 = thread({ id: "g2", parentThreadId: "c", updatedAt: NOW - 4 * HOUR });
    const threads = [parent, child, gc1, gc2];
    const index = buildFamilyIndex(threads);
    // Every member is a direct child of p in the display index — two levels
    // only: grandchildren render as real members of the family, never as +N.
    const familyMembers = index.childrenByParent.get("p") ?? [];
    expect(familyMembers.map((t) => t.id).sort()).toEqual(["c", "g1", "g2"]);
    expect(index.childrenByParent.has("c")).toBe(false);
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW, index);
    expect(nested.childrenByParent.get("p")?.map((t) => t.id).sort()).toEqual(["c", "g1", "g2"]);
    expect(nested.columns.flatMap((col) => col.threads.map((t) => t.id))).toEqual(["p"]);
  });

  it("a fourth-tier descendant re-attaches to the same root", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const gc = thread({ id: "g", parentThreadId: "c", updatedAt: NOW - 3 * HOUR });
    const ggc = thread({ id: "gg", parentThreadId: "g", updatedAt: NOW - 4 * HOUR });
    const index = buildFamilyIndex([parent, child, gc, ggc]);
    expect(index.parentOf.get("g")).toBe("p");
    expect(index.parentOf.get("gg")).toBe("p");
    expect((index.childrenByParent.get("p") ?? []).map((t) => t.id).sort()).toEqual(["c", "g", "gg"]);
  });

  it("the parent view stays two-level: a grandchild's own child rides the same family", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const gc1 = thread({ id: "g1", parentThreadId: "c", updatedAt: NOW - 3 * HOUR, isDone: false });
    const index = buildFamilyIndex([parent, child, gc1]);
    const lanes = buildParentLanes([parent, child, gc1], new Set(), NOW);
    expect(lanes).toHaveLength(1);
    const cards = lanes[0]!.rows.flatMap((r) => r.threads.map((t) => t.id));
    expect(cards.sort()).toEqual(["c", "g1"]);
  });
});

describe("filterFamilies", () => {
  const parent = thread({ id: "p", updatedAt: NOW - HOUR });
  const child = thread({ id: "c", parentThreadId: "p", isUnread: true, updatedAt: NOW - 2 * HOUR });

  it("a state filter matching only a child keeps the family; parent dimmed, child not", () => {
    const index = buildFamilyIndex([parent, child]);
    const result = filterFamilies(
      [parent, child],
      index,
      { projects: new Set(), providers: new Set(), states: new Set(["unread"]) },
      "",
    );
    expect(result.kept.map((t) => t.id).sort()).toEqual(["c", "p"]);
    expect(result.dimmedIds.has("p")).toBe(true);
    expect(result.dimmedIds.has("c")).toBe(false);
  });

  it("a filter matching nothing in a family drops the whole family", () => {
    const index = buildFamilyIndex([parent, child]);
    const result = filterFamilies(
      [parent, child],
      index,
      { projects: new Set(), providers: new Set(), states: new Set(["working"]) },
      "",
    );
    expect(result.kept).toHaveLength(0);
  });

  it("a search hit on a child keeps the family (parent dimmed)", () => {
    const index = buildFamilyIndex([parent, child]);
    const result = filterFamilies([parent, child], index, EMPTY_FILTER, "c");
    expect(result.kept.map((t) => t.id).sort()).toEqual(["c", "p"]);
    expect(result.dimmedIds.has("p")).toBe(true);
    expect(result.dimmedIds.has("c")).toBe(false);
  });

  it("a search hit on nothing drops the family", () => {
    const index = buildFamilyIndex([parent, child]);
    const result = filterFamilies([parent, child], index, EMPTY_FILTER, "zzz");
    expect(result.kept).toHaveLength(0);
  });

  it("composes with project filters: a same-family cross-project child still keeps the family", () => {
    const crossChild = thread({
      id: "x",
      parentThreadId: "p",
      projectId: "proj_b",
      updatedAt: NOW - 2 * HOUR,
    });
    const index = buildFamilyIndex([parent, crossChild]);
    const result = filterFamilies(
      [parent, crossChild],
      index,
      { projects: new Set(["proj_b"]), providers: new Set(), states: new Set() },
      "",
    );
    expect(result.kept.map((t) => t.id).sort()).toEqual(["p", "x"]);
    expect(result.dimmedIds.has("p")).toBe(true);
    expect(result.dimmedIds.has("x")).toBe(false);
  });

  it("composes with provider filters: a same-family cross-provider child still keeps the family", () => {
    const crossChild = thread({
      id: "x",
      parentThreadId: "p",
      providerId: "other",
      updatedAt: NOW - 2 * HOUR,
    });
    const index = buildFamilyIndex([parent, crossChild]);
    const result = filterFamilies(
      [parent, crossChild],
      index,
      { projects: new Set(), providers: new Set(["other"]), states: new Set() },
      "",
    );
    expect(result.kept.map((t) => t.id).sort()).toEqual(["p", "x"]);
    expect(result.dimmedIds.has("p")).toBe(true);
    expect(result.dimmedIds.has("x")).toBe(false);
  });

  it("unfiltered input passes through undimmed", () => {
    const index = buildFamilyIndex([parent, child]);
    const result = filterFamilies([parent, child], index, EMPTY_FILTER, "");
    expect(result.kept.map((t) => t.id).sort()).toEqual(["c", "p"]);
    expect(result.dimmedIds.size).toBe(0);
  });
});

describe("family filtering composes with nesting — the filtered family relocates as a unit", () => {
  it("a Needs-you child matched by a state filter lifts its family into the attention column, nested", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const threads = [parent, child];
    const index = buildFamilyIndex(threads);
    const filtered = filterFamilies(
      threads,
      index,
      { projects: new Set(), providers: new Set(), states: new Set(["attention"]) },
      "",
    );
    // family kept, parent dimmed
    expect(filtered.dimmedIds.has("p")).toBe(true);
    const result = assembleBoard(filtered.kept, "status", CONTEXT, new Map(), new Set(), NOW);
    // the family lands in the attention column: parent card (dimmed), child nested
    expect(idsIn(result.columns, "attention")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    // the child renders exactly once — as a nested row, never standalone
    expect(columnOf(result.columns, "c")).toBeUndefined();
  });
});

describe("assembleBoard — the composition app.tsx wires", () => {
  it("an attention child moves its Working family into the attention column and nests (no duplication)", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "attention")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    expect(columnOf(result.columns, "c")).toBeUndefined();
    // chip counts from the raw family index, independent of nesting
    expect(result.childCountByParent.get("p")).toBe(1);
  });

  it("a cross-axis child renders standalone and NOT nested (no duplication)", () => {
    const parent = thread({ id: "p", projectId: "proj_a" });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      projectId: "proj_b",
      updatedAt: NOW - HOUR,
    });
    const result = assembleBoard([parent, child], "project", CONTEXT, new Map(), new Set(), NOW);
    expect(columnOf(result.columns, "c")?.id).toBe("proj_b");
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(result.childCountByParent.get("p")).toBe(1);
  });

  it("a nested child appears exactly once: in the nest, not in any column", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    expect(columnOf(result.columns, "c")).toBeUndefined();
    expect(result.childCountByParent.get("p")).toBe(1);
  });

  it("chip vs rows divergence: a promoted-only child counts on the chip but renders zero nested rows", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR }); // idle → done column
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true, updatedAt: NOW - 2 * HOUR });
    const doneIds = new Set(["p"]);
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), doneIds, NOW);
    // promoted (live child of a done parent) → no nested rows under p
    expect(result.nestedChildrenByParent.get("p") ?? []).toHaveLength(0);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    // …but the parent card still reports its one visible child. The card
    // renders the chip whenever this count is > 0, even with zero nested
    // rows; only the chevron (which toggles rows) stays gated on rows.
    expect(result.childCountByParent.get("p")).toBe(1);
  });
});

describe("assembleBoard — family columns (R4: the family moves as one unit)", () => {
  it("a Working child lifts its Idle family into the working column, child nested", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY }); // idle-earlier
    const child = thread({
      id: "c",
      parentThreadId: "p",
      status: "active",
      updatedAt: NOW - HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "working")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    expect(columnOf(result.columns, "c")).toBeUndefined();
  });

  it("a pinned Idle parent keeps its family in the Pinned column and nests its Working child", () => {
    const parent = thread({ id: "p", isPinned: true });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      status: "active",
      updatedAt: NOW - HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "pinned")).toEqual(["p"]);
    expect(idsIn(result.columns, "working")).toEqual([]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("a Needs-you child lifts a Working family into the attention column", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "attention")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("an Unread child lifts a Working family into the unread column", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      isUnread: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "unread")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("a Needs-you grandchild lifts the whole family into the attention column", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const grandchild = thread({
      id: "g",
      parentThreadId: "c",
      hasPendingInteraction: true,
      updatedAt: NOW - 3 * HOUR,
    });
    const result = assembleBoard(
      [parent, child, grandchild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "attention")).toEqual(["p"]);
    // The grandchild re-attaches to the root: it rides as a real child row,
    // urgent first, never as a +N chip.
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["g", "c"]);
    expect(columnOf(result.columns, "g")).toBeUndefined();
    expect(columnOf(result.columns, "c")).toBeUndefined();
  });

  it("an all-idle family keeps the parent's own bucket (a fresher idle child does not lift it)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY }); // idle-earlier
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR }); // idle-today
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "idle-earlier")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("archived and done children do not lift the family column", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY }); // idle-earlier
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      hasPendingInteraction: true,
    });
    const doneChild = thread({
      id: "d",
      parentThreadId: "p",
      status: "active",
      updatedAt: NOW - HOUR,
    });
    const doneIds = new Set(["d"]);
    const result = assembleBoard(
      [parent, archivedChild, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    // neither member demands attention for placement: the family stays idle
    expect(idsIn(result.columns, "idle-earlier")).toEqual(["p"]);
    expect(idsIn(result.columns, "attention")).toEqual([]);
    expect(idsIn(result.columns, "working")).toEqual([]);
    // both children still nest under the live parent
    expect(ids(result.nestedChildrenByParent.get("p") ?? []).sort()).toEqual(["a", "d"]);
  });

  it("a frozen column keeps a lifted family's parent where it was frozen", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY }); // idle-earlier
    const child = thread({
      id: "c",
      parentThreadId: "p",
      status: "active",
      updatedAt: NOW - HOUR,
    });
    const frozenColumns = new Map([["p", { id: "idle-earlier", label: "Idle · Earlier" }]]);
    const result = assembleBoard(
      [parent, child],
      "status",
      CONTEXT,
      frozenColumns,
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "idle-earlier")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("a Done parent's family does not relocate: live children still promote", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const doneIds = new Set(["p"]);
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), doneIds, NOW);
    expect(idsIn(result.columns, "attention")).toContain("c");
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
  });
});

describe("assembleBoard — the Pinned lane's attention lift (pinned families cannot leave Pinned)", () => {
  it("a pinned family with a Needs-you child stays in Pinned but floats to the top of the lane", () => {
    // The pinned parent is the OLDER card: the default order would put the
    // other pinned family first, so the lift is what moves p to the top.
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - HOUR,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    const result = assembleBoard(
      [parent, child, bystander],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "pinned")).toEqual(["p", "q"]);
    // The attention child still nests under its pinned parent — it does not
    // go look for a Needs-you column of its own.
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("the lift holds above a manual rank in the Pinned lane and disappears when the question is answered", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - HOUR,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    // The operator ranked q above p in the Pinned lane (the key is not
    // namespaced by grouping).
    const ranks = { pinned: ["q", "p"] };
    const lifted = assembleBoard(
      [parent, child, bystander],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { ranks },
    );
    expect(idsIn(lifted.columns, "pinned")).toEqual(["p", "q"]);

    // Same family, question answered: no attention member, no lift — the
    // manual rank reads the lane again.
    const answered = assembleBoard(
      [parent, { ...child, hasPendingInteraction: false }, bystander],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { ranks },
    );
    expect(idsIn(answered.columns, "pinned")).toEqual(["q", "p"]);
  });

  it("a Needs-you grandchild lifts the pinned family card too (the depth cap rides it as a child row)", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const grandchild = thread({
      id: "g",
      parentThreadId: "c",
      hasPendingInteraction: true,
      updatedAt: NOW - 3 * HOUR,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    const result = assembleBoard(
      [parent, child, grandchild, bystander],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "pinned")).toEqual(["p", "q"]);
  });

  it("a pinned thread whose OWN state needs you also floats to the top", () => {
    const pinnedAttention = thread({
      id: "a",
      isPinned: true,
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * DAY,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    const result = assembleBoard(
      [pinnedAttention, bystander],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "pinned")).toEqual(["a", "q"]);
  });

  it("done and archived children do not lift or pulse the pinned family", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      hasPendingInteraction: true,
    });
    const doneChild = thread({
      id: "d",
      parentThreadId: "p",
      hasPendingInteraction: true,
    });
    const doneIds = new Set(["d"]);
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    const result = assembleBoard(
      [parent, archivedChild, doneChild, bystander],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    // q is newer than p, so with no lift the default order shows q first.
    expect(idsIn(result.columns, "pinned")).toEqual(["q", "p"]);
  });

  it("pinnedAttentionIds is empty without a Pinned lane (nesting off — the child stands alone)", () => {
    const parent = thread({ id: "p", isPinned: true });
    const child = thread({ id: "c", parentThreadId: "p", hasPendingInteraction: true });
    // With nesting off the columns still hold p; the lift is computed by
    // nestUnderParents, so feed it a pinned-free column list instead.
    const columns: BoardColumn[] = [{ id: "attention", label: "Needs you", threads: [child] }];
    expect(pinnedAttentionIds(columns, new Map(), new Set()).size).toBe(0);
  });
});

describe("familyColumnOverrides — the placement override map", () => {
  it("is empty outside the status grouping", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", status: "active" });
    const index = buildFamilyIndex([parent, child]);
    expect(familyColumnOverrides([parent, child], index, "project", CONTEXT, new Set())).toHaveLength(0);
    expect(familyColumnOverrides([parent, child], index, "recency", CONTEXT, new Set())).toHaveLength(0);
  });

  it("maps only the family root to its most attention-requiring live member's column", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY });
    const child = thread({ id: "c", parentThreadId: "p", status: "active", updatedAt: NOW - HOUR });
    const index = buildFamilyIndex([parent, child]);
    const overrides = familyColumnOverrides([parent, child], index, "status", CONTEXT, new Set());
    expect([...overrides.keys()]).toEqual(["p"]);
    expect(overrides.get("p")).toEqual({ id: "working", label: "Working" });
  });
});

describe("assembleBoard — archived children (R2)", () => {
  it("an archived child nests under its parent and never takes a column slot", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard(
      [parent, archivedChild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["a"]);
    expect(columnOf(result.columns, "a")).toBeUndefined();
    // chip counts include archived children
    expect(result.childCountByParent.get("p")).toBe(1);
  });

  it("an archived child never promotes in Attention grouping (archived overrides promotion)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR }); // idle
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      isUnread: true, // live it would promote to unread
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard(
      [parent, archivedChild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "unread")).not.toContain("a");
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["a"]);
  });

  it("an archived cross-project child stays under the parent (archived overrides axis-match)", () => {
    const parent = thread({ id: "p", projectId: "proj_a" });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      projectId: "proj_b",
      isArchived: true,
      updatedAt: NOW - HOUR,
    });
    const result = assembleBoard(
      [parent, archivedChild],
      "project",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["a"]);
    expect(columnOf(result.columns, "a")).toBeUndefined();
    expect(columnOf(result.columns, "a")?.id).toBeUndefined();
  });

  it("an archived child with no present parent renders nowhere (archived orphans vanish)", () => {
    const archivedOrphan = thread({ id: "a", parentThreadId: "gone", isArchived: true });
    const result = assembleBoard([archivedOrphan], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(columnOf(result.columns, "a")).toBeUndefined();
    expect(result.nestedChildrenByParent.has("gone")).toBe(false);
  });

  it("an archived family vanishes whole: archived parent excluded from columns, archived child renders nowhere", () => {
    const archivedParent = thread({ id: "p", isArchived: true });
    const archivedChild = thread({ id: "a", parentThreadId: "p", isArchived: true });
    const result = assembleBoard(
      [archivedParent, archivedChild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(columnOf(result.columns, "p")).toBeUndefined();
    expect(columnOf(result.columns, "a")).toBeUndefined();
  });

  it("a live parent keeps archived children in the chip count alongside live children", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const liveChild = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      updatedAt: NOW - 3 * HOUR,
    });
    const result = assembleBoard(
      [parent, liveChild, archivedChild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(result.childCountByParent.get("p")).toBe(2);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c", "a"]);
  });
});

describe("filterFamilies with archived members (R2)", () => {
  it("archived members ride along with a passing family (dimmed), never contribute a match", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const index = buildFamilyIndex([parent, archivedChild]);
    const result = filterFamilies([parent, archivedChild], index, EMPTY_FILTER, "");
    expect(result.kept.map((t) => t.id).sort()).toEqual(["a", "p"]);
    expect(result.dimmedIds.has("a")).toBe(true);
    expect(result.dimmedIds.has("p")).toBe(false);
  });

  it("an archived child matching alone does not surface the family", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR }); // idle
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      isUnread: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const index = buildFamilyIndex([parent, archivedChild]);
    const result = filterFamilies(
      [parent, archivedChild],
      index,
      { projects: new Set(), providers: new Set(), states: new Set(["unread"]) },
      "",
    );
    expect(result.kept).toHaveLength(0);
  });
});

describe("filterIndividually — nesting toggle OFF filtering (R3)", () => {
  it("filters per-thread: a matching child is kept on its own (no family keep, no dimming)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR }); // idle
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true, updatedAt: NOW - 2 * HOUR });
    const result = filterIndividually(
      [parent, child],
      { projects: new Set(), providers: new Set(), states: new Set(["unread"]) },
      "",
    );
    expect(result.kept.map((t) => t.id)).toEqual(["c"]);
    expect(result.dimmedIds.size).toBe(0);
  });

  it("composes with search like the family filter's per-thread predicate", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const result = filterIndividually([parent, child], EMPTY_FILTER, "c");
    expect(result.kept.map((t) => t.id)).toEqual(["c"]);
    expect(result.dimmedIds.size).toBe(0);
  });

  it("never keeps archived threads (archived children do not render in flat mode)", () => {
    const archived = thread({ id: "a", isArchived: true });
    const result = filterIndividually([archived], EMPTY_FILTER, "");
    expect(result.kept).toHaveLength(0);
  });
});

describe("assembleBoard — nesting toggle OFF (R3)", () => {
  it("children render flat in their own column slots, no promotion logic", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR }); // idle
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true, updatedAt: NOW - 2 * HOUR });
    const result = assembleBoard(
      [parent, child],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { nestingEnabled: false },
    );
    expect(idsIn(result.columns, "unread")).toContain("c");
    expect(result.nestedChildrenByParent.size).toBe(0);
    expect(result.childCountByParent.size).toBe(0);
  });

  it("chips are empty: a parent with children reports no child count when nesting is OFF", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const result = assembleBoard(
      [parent, child],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { nestingEnabled: false },
    );
    expect(result.childCountByParent.get("p")).toBeUndefined();
    expect(result.nestedChildrenByParent.get("p")).toBeUndefined();
  });

  it("deep descendants render flat too (no depth cap, no +N source)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const grandchild = thread({ id: "g", parentThreadId: "c", updatedAt: NOW - 3 * HOUR });
    const result = assembleBoard(
      [parent, child, grandchild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { nestingEnabled: false },
    );
    const allIds = result.columns.flatMap((col) => col.threads.map((t) => t.id)).sort();
    expect(allIds).toEqual(["c", "g", "p"]);
    expect(result.nestedChildrenByParent.size).toBe(0);
  });

  it("archived children do not render at all when nesting is OFF", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard(
      [parent, archivedChild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { nestingEnabled: false },
    );
    expect(columnOf(result.columns, "a")).toBeUndefined();
    expect(result.nestedChildrenByParent.size).toBe(0);
  });

  it("nesting ON remains the default: omitted options behave like nestingEnabled true", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    expect(result.childCountByParent.get("p")).toBe(1);
  });
});

describe("column accounting with nesting", () => {
  it("a parent with N nested children counts once in its column's top-level list", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * HOUR });
    const c1 = thread({ id: "c1", parentThreadId: "p", updatedAt: NOW - 3 * HOUR });
    const c2 = thread({ id: "c2", parentThreadId: "p", updatedAt: NOW - 4 * HOUR });
    const threads = [parent, c1, c2];
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW);
    const idleColumn = nested.columns.find((col) => col.id === "idle-today");
    expect(idleColumn?.threads.map((t) => t.id)).toEqual(["p"]);
    expect(idleColumn?.threads).toHaveLength(1);
  });

  it("done-column membership of a done parent is unaffected by nesting", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const doneIds = new Set(["p"]);
    const threads = [parent, child];
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), doneIds, NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW);
    const doneColumn = nested.columns.find((col) => col.id === "done");
    expect(doneColumn?.threads.map((t) => t.id)).toEqual(["p"]);
  });
});

describe("assembleBoard — empty columns hide entirely", () => {
  it("a column drained by nesting disappears: an Idle·Today child nested under its Idle·Recent parent leaves no empty lane", () => {
    // buildColumns assigns both threads to their own buckets; nesting then
    // pulls the child under the parent's card. The Idle·Today bucket held
    // only the child, so without this rule the board parked an empty lane.
    const parent = thread({ id: "p", updatedAt: NOW - 30 * 60 * 1000 }); // Idle · Recent
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR }); // Idle · Today
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    expect(result.columns.find((column) => column.id === "idle-today")).toBeUndefined();
    expect(idsIn(result.columns, "idle-recent")).toEqual(["p"]);
  });

  it("the Done column hides too when its only card is a done child of a live parent", () => {
    // A done child of a live parent nests (the Done lane cannot relocate for
    // a done PARENT; a done CHILD of a live parent rides its family). The
    // Done column that held only that child drains empty and must go.
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const doneIds = new Set(["c"]);
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(result.columns.find((column) => column.id === "done")).toBeUndefined();
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
  });

  it("a column that still holds a card is never hidden by the rule", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 30 * 60 * 1000 }); // Idle · Recent
    const nestedChild = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR }); // Idle · Today
    const sibling = thread({ id: "f", parentThreadId: "p", updatedAt: NOW - 20 * 60 * 1000 }); // nests with c
    const result = assembleBoard([parent, nestedChild, sibling], "status", CONTEXT, new Map(), new Set(), NOW);
    // The parent keeps the lane populated, so it stays — the rule hides only
    // lanes that nesting drained to zero.
    expect(result.columns.find((column) => column.id === "idle-today")).toBeUndefined();
    expect(result.columns.find((column) => column.id === "idle-recent")?.threads.map((t) => t.id)).toEqual(["p"]);
  });
});

describe("threadState sanity for promotion tests", () => {
  it("fixture states line up with what the promotion tests assume", () => {
    expect(threadState(thread({ status: "active" }))).toBe("working");
    expect(threadState(thread({ hasPendingInteraction: true }))).toBe("attention");
    expect(threadState(thread({ isUnread: true }))).toBe("unread");
    expect(threadState(thread({}))).toBe("idle");
  });
});

describe("urgent nested children float to the top of the family's rows", () => {
  it("a Needs-you child sorts above a newer idle sibling under the parent (no ranks stored)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    // Input order puts the newer idle child first, so this fails while the
    // nested rows keep raw input order.
    const newerIdle = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const urgent = thread({ id: "u", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 3 * HOUR });
    const threads = [parent, newerIdle, urgent];
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW);
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["u", "n"]);
  });

  it("the urgency tier wins over the parent column's manual rank order", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const urgent = thread({ id: "u", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 3 * HOUR });
    const newerIdle = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const threads = [parent, newerIdle, urgent];
    const ranks = { "status:idle-today": ["n", "u"] };
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW, undefined, { ranks });
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["u", "n"]);
  });

  it("urgent children float under non-status groupings too (recency)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const newerIdle = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const urgent = thread({ id: "u", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 3 * HOUR });
    const threads = [parent, newerIdle, urgent];
    const columns = buildColumns(threads, "recency", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "recency", CONTEXT, NOW);
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["u", "n"]);
  });

  it("multiple urgent children keep the parent column's own order among themselves", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const olderUrgent = thread({ id: "u1", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 3 * HOUR });
    const newerUrgent = thread({ id: "u2", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 2 * HOUR });
    const idle = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 4 * HOUR });
    const threads = [parent, idle, olderUrgent, newerUrgent];
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW);
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["u2", "u1", "n"]);
  });
});
describe("familiesWithUrgentChildren (auto-expand source set)", () => {
  const child = (overrides: Partial<PluginSidebarThread>) =>
    thread({ parentThreadId: "thr_parent", ...overrides });

  it("counts a parent whose nested child is unread", () => {
    const children = new Map([["thr_parent", [child({ id: "thr_c", isUnread: true })]]]);
    expect(familiesWithUrgentChildren(children, new Set())).toEqual(new Set(["thr_parent"]));
  });

  it("counts needs-you (pending interaction) children", () => {
    const children = new Map([["thr_parent", [child({ id: "thr_c", hasPendingInteraction: true })]]]);
    expect(familiesWithUrgentChildren(children, new Set())).toEqual(new Set(["thr_parent"]));
  });

  it("skips working and idle children — a quiet family never demands expansion", () => {
    const children = new Map([
      [
        "thr_parent",
        [
          child({ id: "thr_work", status: "active", updatedAt: 1000 }),
          child({ id: "thr_idle" }),
        ],
      ],
    ]);
    expect(familiesWithUrgentChildren(children, new Set()).size).toBe(0);
  });

  it("never counts archived children — stale state must not demand attention", () => {
    const children = new Map([["thr_parent", [child({ id: "thr_c", isUnread: true, isArchived: true })]]]);
    expect(familiesWithUrgentChildren(children, new Set()).size).toBe(0);
  });

  it("never counts done children — completed state must not demand attention", () => {
    const children = new Map([["thr_parent", [child({ id: "thr_c", isUnread: true })]]]);
    expect(familiesWithUrgentChildren(children, new Set(["thr_c"])).size).toBe(0);
  });

  it("returns nothing for an empty nesting map", () => {
    expect(familiesWithUrgentChildren(new Map(), new Set()).size).toBe(0);
  });
});

describe("familiesToAutoExpand (transition rule)", () => {
  it("expands a collapsed family whose child newly entered the urgent set", () => {
    const expanded = familiesToAutoExpand(
      new Set(),
      new Set(["thr_p1", "thr_p2"]),
      new Set(["thr_p1", "thr_p9"]),
    );
    expect(expanded).toEqual(["thr_p1"]);
  });

  it("does not re-fire for a child that was already unread — a deliberate collapse stands", () => {
    const expanded = familiesToAutoExpand(
      new Set(["thr_p1"]),
      new Set(["thr_p1"]),
      new Set(["thr_p1"]),
    );
    expect(expanded).toEqual([]);
  });

  it("ignores newly-urgent families that are not collapsed", () => {
    const expanded = familiesToAutoExpand(new Set(), new Set(["thr_p1"]), new Set());
    expect(expanded).toEqual([]);
  });

  it("expands every newly-urgent collapsed family, not just the first", () => {
    const expanded = familiesToAutoExpand(
      new Set(),
      new Set(["thr_p1", "thr_p2"]),
      new Set(["thr_p1", "thr_p2"]),
    );
    expect(expanded.sort()).toEqual(["thr_p1", "thr_p2"]);
  });
});
