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

  it("excludes archived members outright (an archived child is hidden, never indexed)", () => {
    const parent = thread({ id: "p" });
    const liveChild = thread({ id: "c", parentThreadId: "p" });
    const archivedChild = thread({ id: "a", parentThreadId: "p", isArchived: true });
    const index = buildFamilyIndex([parent, liveChild, archivedChild]);
    expect(ids(index.childrenByParent.get("p"))).toEqual(["c"]);
    expect(index.parentOf.has("a")).toBe(false);
  });

  it("re-roots the children of an archived parent (they render standalone, not nowhere)", () => {
    const archivedParent = thread({ id: "p", isArchived: true });
    const liveChild = thread({ id: "c", parentThreadId: "p" });
    const index = buildFamilyIndex([archivedParent, liveChild]);
    expect(index.childrenByParent.has("p")).toBe(false);
    expect(index.parentOf.has("c")).toBe(false);
    expect(index.rootIds.has("c")).toBe(true);
  });
});

describe("nestUnderParents — Attention (status) grouping placement (R4: the family moves as a unit; attention children stand alone)", () => {
  it("un-nests a Needs-you child: it stands alone in the attention column, the Working parent keeps its own", () => {
    const parent = thread({ id: "p", status: "active" });
    const child = thread({ id: "c", parentThreadId: "p", hasPendingInteraction: true });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.has("p")).toBe(false);
    expect(columnOf(nested.columns, "c")?.id).toBe("attention");
    expect(idsIn(nested.columns, "working")).toEqual(["p"]);
  });

  it("re-nests the child once its question is answered (the un-nest is live state, not a tombstone)", () => {
    const parent = thread({ id: "p", status: "active" });
    const child = thread({ id: "c", parentThreadId: "p", hasPendingInteraction: true });
    const answered = { ...child, hasPendingInteraction: false };
    const columns = buildColumns([parent, answered], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, answered], "status", CONTEXT, NOW);
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

  it("un-nests a Needs-you child even under a Needs-you parent (attention always stands alone)", () => {
    const parent = thread({ id: "p", hasPendingInteraction: true });
    const child = thread({ id: "c", parentThreadId: "p", hasPendingInteraction: true });
    const columns = buildColumns([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, [parent, child], "status", CONTEXT, NOW);
    expect(nested.childrenByParent.has("p")).toBe(false);
    expect(columnOf(nested.columns, "c")?.id).toBe("attention");
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

describe("family filtering composes with nesting", () => {
  it("a Needs-you child matched by a state filter stands alone; its family stays put (parent dimmed)", () => {
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
    // the child surfaces in the attention column as its own card
    expect(idsIn(result.columns, "attention")).toEqual(["c"]);
    // the parent keeps its own working column; the attention child does not lift it
    expect(idsIn(result.columns, "working")).toEqual(["p"]);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
  });
});

describe("assembleBoard — the composition app.tsx wires", () => {
  it("an attention child un-nests: its own attention card beside the parent's working card (no duplication)", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "attention")).toEqual(["c"]);
    expect(idsIn(result.columns, "working")).toEqual(["p"]);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
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

  it("chip vs rows divergence: a promoted child renders zero Done-card rows and zero chip there", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR }); // idle → done column
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true, updatedAt: NOW - 2 * HOUR });
    const doneIds = new Set(["p"]);
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), doneIds, NOW);
    // promoted (live child of a done parent) → no nested rows under p
    expect(result.nestedChildrenByParent.get("p") ?? []).toHaveLength(0);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    // the Done card's chip counts the rows it carries — the promoted child
    // is not one of them; it is visible as its own unread card instead
    expect(result.childCountByParent.get("p")).toBe(0);
    expect(idsIn(result.columns, "unread")).toEqual(["c"]);
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

  it("a Needs-you child does not lift its Working family: it stands alone instead", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), new Set(), NOW);
    expect(idsIn(result.columns, "attention")).toEqual(["c"]);
    expect(idsIn(result.columns, "working")).toEqual(["p"]);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
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

  it("a Needs-you grandchild stands alone and does not lift the family", () => {
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
    // the grandchild surfaces as its own attention card
    expect(idsIn(result.columns, "attention")).toEqual(["g"]);
    // the quiet family stays in the parent's own idle bucket, nested as before
    expect(idsIn(result.columns, "idle-earlier")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
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
    // the archived child is hidden outright, and the done child projects
    // into the Done column under the family's card instead of nesting here
    expect(columnOf(result.columns, "a")).toBeUndefined();
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(ids(result.doneChildrenByParent.get("p"))).toEqual(["d"]);
    expect(idsIn(result.columns, "done")).toEqual(["p"]);
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

describe("assembleBoard — the Pinned lane's attention lift (a pinned card's OWN attention)", () => {
  it("a Needs-you child of a pinned parent un-nests to Needs you; the pinned lane keeps its default order", () => {
    // The pinned parent is the OLDER card: with no lift the default order
    // puts the newer bystander first. The child surfaces as its own card.
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
    expect(idsIn(result.columns, "pinned")).toEqual(["q", "p"]);
    expect(idsIn(result.columns, "attention")).toEqual(["c"]);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
  });

  it("the lift holds above a manual rank in the Pinned lane and disappears when the pinned card's own question is answered", () => {
    const parent = thread({
      id: "p",
      isPinned: true,
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * DAY,
    });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
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

    // The pinned card's own question answered: no attention, no lift — the
    // manual rank reads the lane again.
    const answered = assembleBoard(
      [parent, child, bystander].map((t) =>
        t.id === "p" ? { ...t, hasPendingInteraction: false } : t,
      ),
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
      { ranks },
    );
    expect(idsIn(answered.columns, "pinned")).toEqual(["q", "p"]);
  });

  it("a Needs-you grandchild does not lift the pinned family; it stands alone in Needs you", () => {
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
    expect(idsIn(result.columns, "pinned")).toEqual(["q", "p"]);
    expect(idsIn(result.columns, "attention")).toEqual(["g"]);
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

  it("pinnedAttentionIds is empty without a Pinned lane (the attention card stands elsewhere)", () => {
    const attention = thread({ id: "a", hasPendingInteraction: true });
    const columns: BoardColumn[] = [{ id: "attention", label: "Needs you", threads: [attention] }];
    expect(pinnedAttentionIds(columns).size).toBe(0);
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

  it("a Needs-you child does not lift the family (it stands alone); the root's own attention does", () => {
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const index = buildFamilyIndex([parent, child]);
    const overrides = familyColumnOverrides([parent, child], index, "status", CONTEXT, new Set());
    // the attention child is excluded from the lift: the family keeps the parent's own column
    expect(overrides.get("p")).toEqual({ id: "working", label: "Working" });

    const root = thread({ id: "r", hasPendingInteraction: true, updatedAt: NOW - 2 * DAY });
    const quietChild = thread({ id: "q", parentThreadId: "r", updatedAt: NOW - HOUR });
    const rootIndex = buildFamilyIndex([root, quietChild]);
    const rootOverrides = familyColumnOverrides([root, quietChild], rootIndex, "status", CONTEXT, new Set());
    expect(rootOverrides.get("r")).toEqual({ id: "attention", label: "Needs you" });
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

describe("assembleBoard — done children project into the Done column (families are a projection)", () => {
  it("a done child of a live parent leaves the active card and nests under the family's Done card", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * DAY }); // idle-earlier
    const doneChild = thread({ id: "d", parentThreadId: "p", updatedAt: NOW - HOUR });
    const doneIds = new Set(["d"]);
    const result = assembleBoard(
      [parent, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
      { doneTimes: new Map([["d", NOW - HOUR]]) },
    );
    // the live card carries no done rows…
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    // …and the Done column holds the projection card with the child under it
    expect(idsIn(result.columns, "done")).toEqual(["p"]);
    expect(ids(result.doneChildrenByParent.get("p"))).toEqual(["d"]);
    expect(columnOf(result.columns, "d")).toBeUndefined();
  });

  it("a mixed family splits across spaces: live rows stay, done rows project", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 3 * HOUR }); // idle-today
    const liveChild = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const doneChild = thread({ id: "d", parentThreadId: "p", updatedAt: NOW - HOUR });
    const doneIds = new Set(["d"]);
    const result = assembleBoard(
      [parent, liveChild, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["c"]);
    expect(ids(result.doneChildrenByParent.get("p") ?? [])).toEqual(["d"]);
    expect(idsIn(result.columns, "done")).toEqual(["p"]);
    // each card's chip counts its own space: one live child here
    expect(result.childCountByParent.get("p")).toBe(1);
  });

  it("all children done: the live card carries no rows and the Done card carries them all", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 3 * HOUR });
    const doneA = thread({ id: "d1", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const doneB = thread({ id: "d2", parentThreadId: "p", updatedAt: NOW - HOUR });
    const doneIds = new Set(["d1", "d2"]);
    const doneTimes = new Map([
      ["d1", NOW - 2 * HOUR],
      ["d2", NOW - HOUR],
    ]);
    const result = assembleBoard(
      [parent, doneA, doneB],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
      { doneTimes },
    );
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(result.childCountByParent.get("p")).toBe(0);
    expect(idsIn(result.columns, "done")).toEqual(["p"]);
    // newest done first, the Done column's own order
    expect(ids(result.doneChildrenByParent.get("p"))).toEqual(["d2", "d1"]);
  });

  it("a done parent keeps a single Done card: its done children nest under it, no separate projection", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const doneChild = thread({ id: "d", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const doneIds = new Set(["p", "d"]);
    const result = assembleBoard(
      [parent, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    expect(idsIn(result.columns, "done")).toEqual(["p"]);
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["d"]);
    expect(result.doneChildrenByParent.size).toBe(0);
    // the Done card's chip counts the rows it carries
    expect(result.childCountByParent.get("p")).toBe(1);
  });

  it("a done child with a hot raw state still nests under the done parent's card (done beats state)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const doneChild = thread({
      id: "d",
      parentThreadId: "p",
      status: "active", // live it would promote to working
      updatedAt: NOW - 2 * HOUR,
    });
    const doneIds = new Set(["p", "d"]);
    const result = assembleBoard(
      [parent, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    expect(ids(result.nestedChildrenByParent.get("p") ?? [])).toEqual(["d"]);
    expect(idsIn(result.columns, "working")).toEqual([]);
  });

  it("an axis-mismatched done child still joins the family's Done card (Done is its own space)", () => {
    const parent = thread({ id: "p", projectId: "proj_a", updatedAt: NOW - 2 * HOUR });
    const doneChild = thread({
      id: "d",
      parentThreadId: "p",
      projectId: "proj_b",
      updatedAt: NOW - HOUR,
    });
    const doneIds = new Set(["d"]);
    const result = assembleBoard(
      [parent, doneChild],
      "project",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    expect(ids(result.doneChildrenByParent.get("p") ?? [])).toEqual(["d"]);
    expect(idsIn(result.columns, "done")).toEqual(["p"]);
    expect(columnOf(result.columns, "d")).toBeUndefined();
  });

  it("the Done projection sorts by the family's most recent touch, not the done stamp", () => {
    // A sweep-stamped family (a fresh doneAt on a long-idle child) must not
    // vault above a family whose members were active more recently.
    const swept = thread({ id: "p1", updatedAt: NOW - 30 * DAY });
    const active = thread({ id: "p2", updatedAt: NOW - 5 * HOUR });
    const sweptChild = thread({ id: "d1", parentThreadId: "p1", updatedAt: NOW - 30 * DAY });
    const activeChild = thread({ id: "d2", parentThreadId: "p2", updatedAt: NOW - HOUR });
    const doneIds = new Set(["d1", "d2"]);
    const doneTimes = new Map([
      // Fresh sweep stamps contradict activity recency on purpose.
      ["d1", NOW - 1000],
      ["d2", NOW - 4 * HOUR],
    ]);
    const result = assembleBoard(
      [swept, active, sweptChild, activeChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
      { doneTimes },
    );
    expect(idsIn(result.columns, "done")).toEqual(["p2", "p1"]);
  });

  it("leaves flat mode alone: with nesting off, done children stand alone in Done", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 2 * HOUR });
    const doneChild = thread({ id: "d", parentThreadId: "p", updatedAt: NOW - HOUR });
    const doneIds = new Set(["d"]);
    const result = assembleBoard(
      [parent, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
      { nestingEnabled: false },
    );
    expect(idsIn(result.columns, "done")).toEqual(["d"]);
    expect(result.doneChildrenByParent.size).toBe(0);
  });
});

describe("assembleBoard — archived children are hidden outright", () => {
  it("an archived child renders nowhere: no column slot, no nested row, no chip count", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 30 * 60 * 1000 }); // idle-recent
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
    expect(idsIn(result.columns, "idle-recent")).toEqual(["p"]);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(result.columns, "a")).toBeUndefined();
    // the chip counts only the children a card actually carries (no entry at
    // all when the family has no visible children; the card falls back to 0)
    expect(result.childCountByParent.get("p") ?? 0).toBe(0);
  });

  it("an archived child never promotes (hidden beats hot)", () => {
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
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(result.columns, "a")).toBeUndefined();
  });

  it("an archived cross-project child is hidden in axis groupings too", () => {
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
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(result.columns, "a")).toBeUndefined();
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

  it("a live child of an archived parent re-roots and renders standalone", () => {
    const archivedParent = thread({ id: "p", isArchived: true });
    const liveChild = thread({
      id: "c",
      parentThreadId: "p",
      status: "active",
      updatedAt: NOW - HOUR,
    });
    const result = assembleBoard(
      [archivedParent, liveChild],
      "status",
      CONTEXT,
      new Map(),
      new Set(),
      NOW,
    );
    expect(idsIn(result.columns, "working")).toEqual(["c"]);
    expect(result.nestedChildrenByParent.size).toBe(0);
  });

  it("a done child of an archived parent renders standalone in Done (no projection for a hidden parent)", () => {
    const archivedParent = thread({ id: "p", isArchived: true });
    const doneChild = thread({ id: "d", parentThreadId: "p", updatedAt: NOW - HOUR });
    const doneIds = new Set(["d"]);
    const result = assembleBoard(
      [archivedParent, doneChild],
      "status",
      CONTEXT,
      new Map(),
      doneIds,
      NOW,
    );
    expect(idsIn(result.columns, "done")).toEqual(["d"]);
    expect(result.doneChildrenByParent.size).toBe(0);
  });
});

describe("filterFamilies with archived members", () => {
  it("archived members are hidden: they neither ride along nor contribute a match", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const archivedChild = thread({
      id: "a",
      parentThreadId: "p",
      isArchived: true,
      updatedAt: NOW - 2 * HOUR,
    });
    const index = buildFamilyIndex([parent, archivedChild]);
    const result = filterFamilies([parent, archivedChild], index, EMPTY_FILTER, "");
    expect(result.kept.map((t) => t.id)).toEqual(["p"]);
    expect(result.dimmedIds.size).toBe(0);
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
  it("the Working lane never drains away: the status board keeps it even when nesting leaves it empty", () => {
    const idle = thread({ id: "i", updatedAt: NOW - 5 * 60 * 1000 });
    const result = assembleBoard([idle], "status", CONTEXT, new Map(), new Set(), NOW);
    const working = result.columns.find((column) => column.id === "working");
    expect(working?.threads).toEqual([]);
  });

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

  it("the Done column keeps its projection card when a family's only done child moves into it", () => {
    // A done child of a live parent projects into the Done space: the child
    // drains out of the Done column and the family's projection card takes
    // its place — the lane never parks empty, and the child never nests
    // under the live parent's active card.
    const parent = thread({ id: "p", status: "active", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const doneIds = new Set(["c"]);
    const result = assembleBoard([parent, child], "status", CONTEXT, new Map(), doneIds, NOW);
    expect(
      result.columns.find((column) => column.id === "done")?.threads.map((t) => t.id),
    ).toEqual(["p"]);
    expect(result.nestedChildrenByParent.has("p")).toBe(false);
    expect(ids(result.doneChildrenByParent.get("p") ?? [])).toEqual(["c"]);
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

describe("nested rows read in the parent column's order (attention children stand alone, so no urgent tier)", () => {
  it("quiet children honour the parent column's manual rank order", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const newerIdle = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const olderIdle = thread({ id: "o", parentThreadId: "p", updatedAt: NOW - 3 * HOUR });
    const threads = [parent, newerIdle, olderIdle];
    const ranks = { "status:idle-today": ["o", "n"] };
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW, undefined, { ranks });
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["o", "n"]);
  });

  it("an attention child is absent from the rows entirely (it stands alone in its own column)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const urgent = thread({ id: "u", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 2 * HOUR });
    const quiet = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 3 * HOUR });
    const threads = [parent, urgent, quiet];
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW);
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["n"]);
    expect(columnOf(nested.columns, "u")?.id).toBe("attention");
  });

  it("un-nests a Needs-you child under non-status groupings too (recency)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const urgent = thread({ id: "u", parentThreadId: "p", hasPendingInteraction: true, updatedAt: NOW - 2 * HOUR });
    const quiet = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 3 * HOUR });
    const threads = [parent, urgent, quiet];
    const columns = buildColumns(threads, "recency", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "recency", CONTEXT, NOW);
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["n"]);
    expect(columnOf(nested.columns, "u")).toBeDefined();
  });

  it("multiple quiet children keep the parent column's own order among themselves", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const first = thread({ id: "u1", parentThreadId: "p", status: "active", updatedAt: NOW - 3 * HOUR });
    const second = thread({ id: "u2", parentThreadId: "p", status: "active", updatedAt: NOW - 2 * HOUR });
    const idle = thread({ id: "n", parentThreadId: "p", updatedAt: NOW - 4 * HOUR });
    const threads = [parent, idle, first, second];
    const columns = buildColumns(threads, "status", CONTEXT, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", CONTEXT, NOW);
    // newest-first within the working tier, then the idle child
    expect(ids(nested.childrenByParent.get("p"))).toEqual(["u2", "u1", "n"]);
  });
});
