// A child that carries its OWN feature group — different from its parent's —
// renders BOTH ways: its row stays under the parent card and its own card
// lands inside its group's dashed frame, in the column its own state picks
// (the operator's 2026-10-31 ask: "when a child card belongs to a different
// group than its parent, it should show up BOTH as a child of its parent AND
// as a card in that group. So if the parent is pinned but the child is not,
// then the child should show up in a group box in whatever column is
// appropriate"). The rule composes with the copy-outs that already exist
// (pinned, attention, done, cross-space): those keep their single card and
// lose the row, exactly as before.
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn, GroupBy, GroupingContext } from "../components/grouping";
import {
  canJoinGroup,
  columnRunInfo,
  groupBoxesApply,
  planGroupBoxes,
} from "../components/group-boxes";
import {
  assembleBoard,
  buildFamilyIndex,
  familyColumnOverrides,
  flatNestReason,
  nestUnderParents,
} from "../components/nesting";
import type { NestingOptions } from "../components/nesting";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

const PROJECTS = [
  { id: "proj_a", name: "Alpha", isPersonal: false, href: "", settingsHref: "" },
  { id: "proj_b", name: "Beta", isPersonal: false, href: "", settingsHref: "" },
];

/** The two-group fixture: parent in Alpha, child in Beta. */
const GROUPS: GroupingContext = {
  projects: PROJECTS,
  providers: [{ id: "pi", displayName: "Pi" }],
  groupsByThread: new Map([
    ["p", "grp_a"],
    ["c", "grp_b"],
  ]),
  groupNames: new Map([
    ["grp_a", "Alpha rework"],
    ["grp_b", "Beta rework"],
  ]),
};

const UNGROUPED: GroupingContext = { projects: PROJECTS, providers: [{ id: "pi", displayName: "Pi" }] };

/** The same fixture, with each side's assignment overridable. */
function withGroups(
  parentGroup: string | undefined,
  childGroup: string | undefined,
): GroupingContext {
  const map = new Map<string, string>();
  if (parentGroup !== undefined) map.set("p", parentGroup);
  if (childGroup !== undefined) map.set("c", childGroup);
  return {
    projects: PROJECTS,
    providers: [{ id: "pi", displayName: "Pi" }],
    groupsByThread: map,
    groupNames: new Map([
      ["grp_a", "Alpha rework"],
      ["grp_b", "Beta rework"],
    ]),
  };
}

function columnOf(columns: readonly BoardColumn[], threadId: string): BoardColumn | undefined {
  return columns.find((column) => column.threads.some((member) => member.id === threadId));
}

function rowIds(board: ReturnType<typeof assembleBoard>, parentId: string): string[] {
  return (board.nestedChildrenByParent.get(parentId) ?? []).map((row) => row.id);
}

/** The idle parent / working child pair, each side overridable. */
function pair(overrides: {
  parent?: Partial<PluginSidebarThread>;
  child?: Partial<PluginSidebarThread>;
} = {}) {
  const parent = thread({ id: "p", updatedAt: NOW - 5 * HOUR, ...overrides.parent });
  const child = thread({
    id: "c",
    parentThreadId: "p",
    status: "active",
    updatedAt: NOW - MINUTE,
    ...overrides.child,
  });
  return [parent, child] as const;
}

/** Run the full assembly the app wires (buildColumns → nestUnderParents). */
function assemble(
  threads: readonly PluginSidebarThread[],
  groupBy: GroupBy,
  context: GroupingContext,
  options: { doneIds?: ReadonlySet<string>; nesting?: NestingOptions } = {},
) {
  const doneIds = options.doneIds ?? new Set<string>();
  return assembleBoard(
    threads,
    groupBy,
    context,
    new Map(),
    doneIds,
    NOW,
    options.nesting ?? {},
  );
}

describe("groupBoxesApply — the box-enabled view set", () => {
  it("boxes every per-thread-column grouping and never the parent view", () => {
    for (const view of ["status", "recency", "none", "project", "provider", "machine", "group"] as const) {
      expect(groupBoxesApply(view)).toBe(true);
    }
    expect(groupBoxesApply("parent")).toBe(false);
  });
});

describe("the view matrix — a child in its own group copies out AND keeps its row", () => {
  it("Focus (status): the child renders as a row under the parent and as its own card in its state's lane", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", GROUPS);
    // dual membership: the row is retained...
    expect(rowIds(board, "p")).toEqual(["c"]);
    // ...and the child's own card sits in the lane its own state picks.
    expect(columnOf(board.columns, "c")?.id).toBe("working");
    // the family does not chase the copied-out child's lane: the parent keeps
    // its own idle bucket, so the row and the card land in different lanes.
    expect(columnOf(board.columns, "p")?.id).toBe("idle-today");
  });

  it("Last activity (recency): same dual render, in the child's own recency lane", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 5 * HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - MINUTE });
    const board = assemble([parent, child], "recency", GROUPS);
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")?.id).toBe("recent");
  });

  it("None: same dual render, in the flat column", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "none", GROUPS);
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")?.id).toBe("all");
  });

  it("Project (same project): the child's own card joins its group's frame in the shared project lane", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "project", GROUPS);
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")?.id).toBe("proj_a");
  });

  it("Provider (same provider): dual render in the shared provider lane", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "provider", GROUPS);
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")?.id).toBe("pi");
  });

  it("Machine (same machine): dual render in the shared machine lane", () => {
    const host = { id: "host_1", name: "Desktop" };
    const [parent, child] = pair({ parent: { host }, child: { host } });
    const board = assemble([parent, child], "machine", GROUPS);
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")?.id).toBe("host_1");
  });

  it("Group view keeps its own full copy-out: the child rides only its group's column, no row (its columns ARE the group buckets)", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "group", GROUPS);
    expect(board.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(board.columns, "c")?.id).toBe("grp_b");
  });
});

describe("edge cases", () => {
  it("parent ungrouped, child grouped: the difference is trivial, so the child copies out", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", withGroups(undefined, "grp_b"));
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")?.id).toBe("working");
  });

  it("parent grouped, child ungrouped: 'no group' is not 'a different group', so the child stays nested only", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", withGroups("grp_a", undefined));
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")).toBeUndefined();
  });

  it("child grouped the SAME as its parent: stays nested only (today's behavior)", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", withGroups("grp_a", "grp_a"));
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")).toBeUndefined();
  });

  it("both ungrouped: stays nested only", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", UNGROUPED);
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(columnOf(board.columns, "c")).toBeUndefined();
  });

  it("the rule is per parent-child pair: a grandchild diffs from its CHILD-parent, not from the family root", () => {
    // p (grp_a) ← c (grp_a) ← g (grp_b). The child nests alone; the
    // grandchild copies out against its own display parent.
    const parent = thread({ id: "p", updatedAt: NOW - 5 * HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const grandchild = thread({
      id: "g",
      parentThreadId: "c",
      status: "active",
      updatedAt: NOW - MINUTE,
    });
    const context: GroupingContext = {
      ...UNGROUPED,
      groupsByThread: new Map([
        ["p", "grp_a"],
        ["c", "grp_a"],
        ["g", "grp_b"],
      ]),
      groupNames: GROUPS.groupNames,
    };
    const board = assemble([parent, child, grandchild], "status", context);
    // the family root's rows hold the child, whose sub-row is the grandchild
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(rowIds(board, "c")).toEqual(["g"]);
    // the child stays nested only; the grandchild also holds its own card
    expect(columnOf(board.columns, "c")).toBeUndefined();
    expect(columnOf(board.columns, "g")?.id).toBe("working");
  });

  it("a done child in its own group still projects into the Done space: one card, no standalone twin", () => {
    const [parent, child] = pair({ child: { status: "idle" } });
    const board = assemble([parent, child], "status", GROUPS, { doneIds: new Set(["c"]) });
    expect(rowIds(board, "p")).toEqual([]);
    expect(board.doneChildrenByParent.get("p")?.map((row) => row.id)).toEqual(["c"]);
    expect(columnOf(board.columns, "c")).toBeUndefined();
  });

  it("a live child of a Done parent keeps its one own card, group difference or not", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", GROUPS, { doneIds: new Set(["p"]) });
    expect(rowIds(board, "p")).toEqual([]);
    expect(columnOf(board.columns, "c")?.id).toBe("working");
  });

  it("an attention child surfaces as ONE card, never a row plus a card", () => {
    const [parent, child] = pair({ child: { hasPendingInteraction: true } });
    const board = assemble([parent, child], "status", GROUPS);
    expect(board.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(board.columns, "c")?.id).toBe("attention");
  });

  it("an already copied-out PINNED child with a different group stays one card, framed by its group", () => {
    const [parent, child] = pair({ child: { isPinned: true } });
    const board = assemble([parent, child], "status", GROUPS);
    expect(board.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(board.columns, "c")?.id).toBe("pinned");
    const plan = planGroupBoxes(
      [parent, child],
      GROUPS.groupsByThread ?? new Map(),
      GROUPS.groupNames ?? new Map(),
      "status",
      GROUPS,
      new Set(),
      NOW,
    );
    // the Pinned lane frames the group's lone member (issue #318) — still one card.
    expect(plan.groupBoxOf.get("c")?.groupId).toBe("grp_b");
    expect(plan.groupBoxOf.has("p")).toBe(true);
    // and the Pinned column holds the child exactly once.
    expect(columnOf(board.columns, "c")?.threads.filter((member) => member.id === "c")).toHaveLength(1);
  });

  it("a cross-space child stays a single own card: the group rule composes under it and never adds a row", () => {
    const [parent, child] = pair({
      parent: { projectId: "proj_a" },
      child: { projectId: "proj_b" },
    });
    const board = assemble([parent, child], "project", GROUPS);
    expect(board.nestedChildrenByParent.has("p")).toBe(false);
    expect(columnOf(board.columns, "c")?.id).toBe("proj_b");
  });

  it("a group of one wraps the copied-out card: the lone member is a box candidate", () => {
    const [parent, child] = pair();
    const plan = planGroupBoxes(
      [parent, child],
      new Map([["c", "grp_b"]]),
      GROUPS.groupNames ?? new Map(),
      "status",
      GROUPS,
      new Set(),
      NOW,
    );
    expect(plan.groupBoxOf.get("c")?.groupId).toBe("grp_b");
    expect(plan.groupBoxOf.get("p")).toBeUndefined();
  });

  it("nesting OFF keeps the flat board: no rows, and the child's own card still renders once", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", GROUPS, {
      nesting: { nestingEnabled: false },
    });
    expect(board.nestedChildrenByParent.size).toBe(0);
    expect(columnOf(board.columns, "c")?.id).toBe("working");
  });
});

describe("dual membership duties", () => {
  it("the parent's chip keeps counting the copied-out child", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", GROUPS);
    expect(board.childCountByParent.get("p")).toBe(1);
  });

  it("the row list the dot strip reads keeps the copied-out child", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", GROUPS);
    // The chip and the strip both read this list, the #248 count-dots
    // agreement: a copied-out child that vanished from it would read as a
    // family of zero rows beside a chip of one.
    expect(rowIds(board, "p")).toEqual(["c"]);
    expect(board.childCountByParent.get("p")).toBe(1);
  });

  it("the family's lane drive excludes the copied-out child (its own card carries the lane)", () => {
    const [parent, child] = pair();
    const index = buildFamilyIndex([parent, child]);
    const overrides = familyColumnOverrides(
      [parent, child],
      index,
      "status",
      GROUPS,
      new Set(),
      NOW,
    );
    // nothing lifts the idle family: the working child surfaces on its own.
    expect(overrides.get("p")).toBeUndefined();

    // Control: the same pair in the SAME group still lifts the family.
    const sameGroup = withGroups("grp_a", "grp_a");
    const lifted = familyColumnOverrides(
      [parent, child],
      buildFamilyIndex([parent, child]),
      "status",
      sameGroup,
      new Set(),
      NOW,
    );
    expect(lifted.get("p")?.id).toBe("working");
  });

  it("under Last activity the copied-out child's freshness does not lift the family either", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 5 * HOUR }); // Today
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - MINUTE }); // Recent
    const overrides = familyColumnOverrides(
      [parent, child],
      buildFamilyIndex([parent, child]),
      "recency",
      GROUPS,
      new Set(),
      NOW,
    );
    // the copy-out child's freshness never carries the family: the root's own
    // Today bucket is the drive set's floor.
    expect(overrides.get("p")?.id).toBe("today");
  });
});

describe("drag honesty for the copied-out card", () => {
  it("a lone frame slice drags as a plain card: role solo, and it may move to another group", () => {
    const [parent, child] = pair();
    const plan = planGroupBoxes(
      [parent, child],
      new Map([["c", "grp_b"]]),
      GROUPS.groupNames ?? new Map(),
      "status",
      GROUPS,
      new Set(),
      NOW,
    );
    const runInfo = columnRunInfo([child], plan.groupBoxOf);
    expect(runInfo.get("c")?.role).toBe("solo");
    // One group per thread: the copied-out card can be dragged into the
    // parent's own group, which retires the copy-out (same group nests).
    expect(canJoinGroup("c", "grp_a", plan.groupBoxOf, false)).toBe(true);
  });

  it("the box's drop-to-join still accepts an unassigned card", () => {
    const [parent, child] = pair();
    const plan = planGroupBoxes(
      [parent, child],
      new Map([["c", "grp_b"]]),
      GROUPS.groupNames ?? new Map(),
      "status",
      GROUPS,
      new Set(),
      NOW,
    );
    expect(canJoinGroup("thr_free", "grp_b", plan.groupBoxOf)).toBe(true);
  });
});

describe("flatNestReason — a visible copy-out reports nothing", () => {
  it("a group-different drop under Focus nests visibly: no stale 'keeps its own slot' notice", () => {
    const [parent, child] = pair();
    expect(flatNestReason(child, parent, "status", new Set())).toBeNull();
  });

  it("the same under Last activity, None, and the same-space axis views", () => {
    const [parent, child] = pair();
    for (const view of ["recency", "none", "project", "provider"] as const) {
      expect(flatNestReason(child, parent, view, new Set())).toBeNull();
    }
  });

  it("still reports the single-card copy-outs it always did", () => {
    const [parent] = pair();
    expect(
      flatNestReason(
        thread({ id: "c", parentThreadId: "p", isPinned: true }),
        parent,
        "status",
        new Set(),
      ),
    ).toBe("a pinned card keeps its own card and slot");
    expect(
      flatNestReason(
        thread({ id: "c", parentThreadId: "p", status: "active", projectId: "proj_b" }),
        thread({ id: "p", projectId: "proj_a" }),
        "project",
        new Set(),
      ),
    ).toBe("the card belongs to another project's lane");
  });
});

describe("the assembly seam keeps its row/list contract", () => {
  it("the copied-out child appears exactly once in its own column", () => {
    const [parent, child] = pair();
    const board = assemble([parent, child], "status", GROUPS);
    const working = board.columns.find((column) => column.id === "working");
    expect(working?.threads.filter((member) => member.id === "c")).toHaveLength(1);
  });

  it("a dual child that has its own children still nests them (rows render under the row and the card)", () => {
    const [parent, child] = pair();
    const grandchild = thread({
      id: "g",
      parentThreadId: "c",
      updatedAt: NOW - 2 * MINUTE,
    });
    const board = assemble([parent, child, grandchild], "status", GROUPS);
    expect(rowIds(board, "c")).toEqual(["g"]);
    expect(columnOf(board.columns, "g")).toBeUndefined();
  });

  it("nestUnderParents alone (the buildColumns seam) produces the same dual placement", () => {
    const [parent, child] = pair();
    const threads = [parent, child];
    const columns = buildColumns(threads, "status", GROUPS, new Map(), new Set(), NOW);
    const nested = nestUnderParents(columns, threads, "status", GROUPS, NOW);
    expect(nested.childrenByParent.get("p")?.map((row) => row.id)).toEqual(["c"]);
    const own = nested.columns.find((column) => column.threads.some((member) => member.id === "c"));
    expect(own?.id).toBe("working");
  });
});
