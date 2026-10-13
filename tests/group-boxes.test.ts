import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread } from "./thread-fixture";
import { buildColumns, doneRecencyCompare } from "../components/grouping";
import {
  canJoinGroup,
  columnRunInfo,
  filterWithGroupBoxes,
  flattenRuns,
  inBoxMoveTarget,
  planGroupBoxes,
  runsFromColumns,
  unitMoveTarget,
} from "../components/group-boxes";

// Red-first: group-boxes.ts does not exist until the family-box feature is
// implemented. These pins are the behavioral contract the decided design
// (thread storage: reports/feature-group-mockups.html) states.
const context = { projects: [], providers: [] };
const NOW = 10_000_000;

const NAMES: ReadonlyMap<string, string> = new Map([
  ["grp_auth", "Auth rework"],
  ["grp_search", "Search v2"],
]);
const groupOf = (assignments: Record<string, string>): Map<string, string> =>
  new Map(Object.entries(assignments));

describe("planGroupBoxes", () => {
  it("two members under the status grouping form one box identity over both", () => {
    const threads = [
      thread({ id: "thr_a", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", status: "active", updatedAt: NOW - 1000 }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    expect(plan.active).toBe(true);
    expect(plan.groupBoxOf.get("thr_a")?.groupId).toBe("grp_auth");
    expect(plan.groupBoxOf.get("thr_a")?.name).toBe("Auth rework");
    // Members of the same box share its identity object.
    expect(plan.groupBoxOf.get("thr_b")?.groupId).toBe("grp_auth");
    expect(plan.groupBoxOf.get("thr_a")).toBe(plan.groupBoxOf.get("thr_b"));
    // The split default: the plan claims NO lane.
    expect(plan.columnOverrides.size).toBe(0);
  });

  it("a group of one keeps its box: the lone member is boxed in its own lane", () => {
    const threads = [thread({ id: "thr_a" })];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    // The solitary box stays: the outline is the drag-into target, so the
    // group hides only when its LAST candidate leaves (record GCs at zero).
    expect(plan.active).toBe(true);
    const box = plan.groupBoxOf.get("thr_a");
    expect(box?.groupId).toBe("grp_auth");
    expect(box?.name).toBe("Auth rework");
    expect(box?.members.map((t) => t.id)).toEqual(["thr_a"]);
    expect(plan.columnOverrides.has("thr_a")).toBe(false);
  });

  it("boxed members stay out of the plan when done or pinned", () => {
    const threads = [
      thread({ id: "thr_done", updatedAt: NOW - 1000 }),
      thread({ id: "thr_pinned", isPinned: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_a", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", updatedAt: NOW - 2000 }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({
        thr_done: "grp_auth",
        thr_pinned: "grp_auth",
        thr_a: "grp_auth",
        thr_b: "grp_auth",
      }),
      NAMES,
      "status",
      context,
      new Set(["thr_done"]),
      NOW,
    );
    expect(plan.groupBoxOf.has("thr_done")).toBe(false);
    expect(plan.groupBoxOf.has("thr_pinned")).toBe(false);
    expect(plan.groupBoxOf.has("thr_a")).toBe(true);
    expect(plan.groupBoxOf.get("thr_a")?.members.map((t) => t.id)).toEqual(["thr_a", "thr_b"]);
  });

  it("the group splits across lanes: each member renders where its own state lands it", () => {
    // Issue #86's example: an attention member and an idle member. The old
    // gather rule pulled both into the attention lane; the split default
    // leaves each in its own, buildColumns deciding by thread data alone.
    const threads = [
      thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", updatedAt: NOW - 5000 }), // idle
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    expect(plan.columnOverrides.size).toBe(0);
    const columns = buildColumns(threads, "status", context, new Map(), new Set(), NOW);
    expect(
      columns.find((column) => column.id === "working")?.threads.map((entry) => entry.id),
    ).toEqual(["thr_a"]);
    const recent = columns.find((column) => column.id === "idle-recent");
    expect(recent?.threads.map((entry) => entry.id)).toContain("thr_b");
  });

  it("idle members each keep their own bucket under the split default", () => {
    const threads = [
      thread({ id: "thr_old", updatedAt: NOW - 8 * 24 * 60 * 60 * 1000 }),
      thread({ id: "thr_new", updatedAt: NOW - 1000 }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_old: "grp_auth", thr_new: "grp_auth" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    expect(plan.columnOverrides.size).toBe(0);
    const columns = buildColumns(threads, "status", context, new Map(), new Set(), NOW);
    const recent = columns.find((column) => column.id === "idle-recent");
    const older = columns.find((column) => column.id === "idle-awhile");
    expect(recent?.threads.map((entry) => entry.id)).toEqual(["thr_new"]);
    expect(older?.threads.map((entry) => entry.id)).toEqual(["thr_old"]);
  });

  it("boxes render under the project grouping with each member in its own project column", () => {
    const projects = [
      { id: "proj_a", name: "Alpha" },
      { id: "proj_b", name: "Beta" },
    ] as never;
    const threads = [
      thread({ id: "thr_a", projectId: "proj_b", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", projectId: "proj_a", updatedAt: NOW - 2000 }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "project",
      { projects, providers: [] },
      new Set(),
      NOW,
    );
    expect(plan.active).toBe(true);
    expect(plan.groupBoxOf.get("thr_a")?.groupId).toBe("grp_auth");
    expect(plan.groupBoxOf.get("thr_a")).toBe(plan.groupBoxOf.get("thr_b"));
    // Split: both members stay in their project's own column.
    expect(plan.columnOverrides.size).toBe(0);
    const columns = buildColumns(threads, "project", { projects, providers: [] }, new Map(), new Set(), NOW);
    const alpha = columns.find((column) => column.id === "proj_a");
    const beta = columns.find((column) => column.id === "proj_b");
    expect(alpha?.threads.map((entry) => entry.id)).toEqual(["thr_b"]);
    expect(beta?.threads.map((entry) => entry.id)).toEqual(["thr_a"]);
  });

  it("a group of one boxes its lone member under the project grouping too", () => {
    const projects = [{ id: "proj_a", name: "Alpha" }] as never;
    const plan = planGroupBoxes(
      [thread({ id: "thr_a" })],
      groupOf({ thr_a: "grp_auth" }),
      NAMES,
      "project",
      { projects, providers: [] },
      new Set(),
      NOW,
    );
    expect(plan.active).toBe(true);
    expect(plan.groupBoxOf.get("thr_a")?.name).toBe("Auth rework");
    expect(plan.columnOverrides.size).toBe(0);
  });

  it("provider and machine groupings box too (per-thread-column groupings), split across lanes", () => {
    const threads = [
      thread({ id: "thr_a", providerId: "opencode", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", providerId: "pi", updatedAt: NOW - 2000 }),
    ];
    // Provider: one box identity, members in their provider columns.
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "provider",
      { projects: [] as never, providers: [{ id: "opencode", displayName: "OpenCode" }] },
      new Set(),
      NOW,
    );
    expect(plan.active).toBe(true);
    expect(plan.groupBoxOf.get("thr_a")).toBe(plan.groupBoxOf.get("thr_b"));
    expect(plan.columnOverrides.size).toBe(0);
    // Machine: members without a host degrade to the "No machine" lane.
    const machinePlan = planGroupBoxes(
      [thread({ id: "thr_a" }), thread({ id: "thr_b" })],
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "machine",
      context,
      new Set(),
      NOW,
    );
    expect(machinePlan.active).toBe(true);
    expect(machinePlan.columnOverrides.size).toBe(0);
  });

  it("boxes stay off under the parent grouping (families are their own unit system)", () => {
    const threads = [
      thread({ id: "thr_a" }),
      thread({ id: "thr_b" }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "parent",
      context,
      new Set(),
      NOW,
    );
    expect(plan.active).toBe(false);
    expect(plan.groupBoxOf.size).toBe(0);
  });

  it("boxes stay on under the group grouping; the plan claims no lane of its own", () => {
    const threads = [
      thread({ id: "thr_a", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", updatedAt: NOW - 2000 }),
    ];
    const assignments = groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" });
    const plan = planGroupBoxes(
      threads,
      assignments,
      NAMES,
      "group",
      {
        ...context,
        groupsByThread: assignments,
        groupNames: NAMES,
      },
      new Set(),
      NOW,
    );
    expect(plan.active).toBe(true);
    // Under the group grouping the members' NATURAL column IS the group's
    // own column (columnFor resolves it from the assignment), so the plan
    // needs — and emits — no override at all.
    expect(plan.columnOverrides.size).toBe(0);
  });

  it("under recency, each member keeps its own bucket (the freshest does not drag the rest)", () => {
    const threads = [
      thread({ id: "thr_old", updatedAt: NOW - 8 * 24 * 60 * 60 * 1000 }),
      thread({ id: "thr_new", updatedAt: NOW - 1000 }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_old: "grp_auth", thr_new: "grp_auth" }),
      NAMES,
      "recency",
      context,
      new Set(),
      NOW,
    );
    expect(plan.columnOverrides.size).toBe(0);
    const columns = buildColumns(threads, "recency", context, new Map(), new Set(), NOW);
    const recent = columns.find((column) => column.id === "recent");
    const older = columns.find((column) => column.id === "awhile");
    expect(recent?.threads.map((entry) => entry.id)).toEqual(["thr_new"]);
    expect(older?.threads.map((entry) => entry.id)).toEqual(["thr_old"]);
  });

  it("under recency, the old gather rule is gone (the override map stays empty)", () => {
    const threads = [
      thread({ id: "thr_old", updatedAt: NOW - 8 * 24 * 60 * 60 * 1000 }),
      thread({ id: "thr_new", updatedAt: NOW - 1000 }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_old: "grp_auth", thr_new: "grp_auth" }),
      NAMES,
      "recency",
      context,
      new Set(),
      NOW,
    );
    expect(plan.columnOverrides.size).toBe(0);
  });

  it("a member with no registry record is ignored (nameless box cannot render)", () => {
    const threads = [
      thread({ id: "thr_a" }),
      thread({ id: "thr_b" }),
      thread({ id: "thr_c" }),
    ];
    const plan = planGroupBoxes(
      threads,
      groupOf({ thr_c: "grp_auth", thr_a: "grp_auth", thr_b: "grp_unknown" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    // grp_unknown has no name → thr_b alone → no box for it.
    expect(plan.groupBoxOf.has("thr_b")).toBe(false);
    expect(plan.groupBoxOf.has("thr_a")).toBe(true);
  });
});

describe("runsFromColumns — in-box member order follows the column's own order", () => {
  // The box's members were ranked [b, a] IN THAT COLUMN (the in-box reorder
  // writes the column's order with the members reordered inside the box's
  // span). The plan's member list still holds the recency-order pair [a, b],
  // because planGroupBoxes collects members by iterating recency-ordered
  // threads. The box must render [b, a] — the column's order, which the
  // operator's drag wrote — or every in-box reorder sticks in the store and
  // immediately un-renders, looking exactly like "reorder not working"
  // (reproduced live 2026-10-10, mock store reordered while the box did not).
  const threads = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );
  it("renders the box members in the column's display order, not the plan's", () => {
    const columns = buildColumns(
      threads,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { "status:attention": [], "status:working": ["thr_b", "thr_a"] },
      plan.columnOverrides,
    );
    const working = columns.find((c) => c.id === "working");
    const runs = runsFromColumns([working as never], plan.groupBoxOf);
    const items = (runs as Map<string, readonly { kind: string; box?: { members: { id: string }[] }; thread?: { id: string } }[]>).get("working");
    expect(items).toHaveLength(1);
    expect(items![0]).toMatchObject({ kind: "box" });
    expect(items![0]!.box!.members.map((m) => m.id)).toEqual(["thr_b", "thr_a"]);
  });
});

describe("runsFromColumns — a run never spans a non-member", () => {
  // An insert into the run's middle (a card between two boxed members — the
  // unpin reveal's relocation, a recency flip) must NOT make the walker
  // gather across the gap: gathering would render the box at the first
  // member's slot and swallow the members around the intervening card,
  // visually reordering a bystander the column's own order never moved
  // (reproduced live 2026-10-13, issue #106: unpinning a card between two
  // boxed members vanished the second member from the lane's top-level
  // order). A split run renders one frame per adjacent slice instead.
  const membersOf = (ids: string[]) => ids.map((id, at) => thread({ id, status: "active", updatedAt: NOW - (at + 1) * 1000 }));
  const runItemsOf = (ids: string[], ordered: string[]) => {
    const threads = membersOf(ids);
    // The cast threads are the group's members; thr_x stays unassigned.
    const assignments: Record<string, string> = {};
    for (const id of ids) {
      if (id !== "thr_x") assignments[id] = "grp_auth";
    }
    const plan = planGroupBoxes(
      threads,
      groupOf(assignments),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    const columns = buildColumns(
      threads,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { "status:working": ordered },
      plan.columnOverrides,
    );
    const working = columns.find((c) => c.id === "working");
    const runs = runsFromColumns([working as never], plan.groupBoxOf);
    return (runs as Map<string, readonly { kind: string; box?: { members: { id: string }[] }; thread?: { id: string } }[]>).get("working") as readonly {
      kind: string;
      box?: { members: { id: string }[] };
      thread?: { id: string };
    }[];
  };
  const labelOf = (item: { kind: string; box?: { members: { id: string }[] }; thread?: { id: string } }) =>
    item.kind === "box"
      ? `box(${item.box!.members.map((m) => m.id).join(",")})`
      : `single(${item.thread!.id})`;

  it("one foreign card between two boxed members splits the run in two", () => {
    // Column order [a, x, b]: the run cannot gather b past x.
    const planIds = ["thr_a", "thr_x", "thr_b"];
    const items = runItemsOf(planIds, ["thr_a", "thr_x", "thr_b"]);
    expect(items.map(labelOf)).toEqual(["box(thr_a)", "single(thr_x)", "box(thr_b)"]);
  });

  it("multi-member segments split with their own frames — order preserved", () => {
    // Column order [a, b, x, c, d]: each side of x keeps its own slice.
    const planIds = ["thr_a", "thr_b", "thr_x", "thr_c", "thr_d"];
    const items = runItemsOf(planIds, ["thr_a", "thr_b", "thr_x", "thr_c", "thr_d"]);
    expect(items.map(labelOf)).toEqual([
      "box(thr_a,thr_b)",
      "single(thr_x)",
      "box(thr_c,thr_d)",
    ]);
  });

  it("a member still adjacent to its run gathers with it (unaffected contiguity)", () => {
    // Column order [a, b, x]: both members contiguous before x — one box.
    const planIds = ["thr_a", "thr_b", "thr_x"];
    const items = runItemsOf(planIds, ["thr_a", "thr_b", "thr_x"]);
    expect(items.map(labelOf)).toEqual(["box(thr_a,thr_b)", "single(thr_x)"]);
  });
});

describe("runsFromColumns", () => {
  const threads = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
    thread({ id: "thr_x", status: "active", updatedAt: NOW - 3000 }),
  ];
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );

  it("box members gather contiguously at the first member's slot, cards keep theirs", () => {
    // Interleave X between the two group members by rank.
    const columns = buildColumns(
      threads.map((t) => ({ ...t, updatedAt: t.updatedAt })),
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      {
        "status:attention": [],
        "status:working": ["thr_x", "thr_a", "thr_b"],
      },
      plan.columnOverrides,
    );
    const working = columns.find((c) => c.id === "working");
    const runs = runsFromColumns([working as never], plan.groupBoxOf);
    const items = (runs as Map<string, readonly unknown[]>).get("working");
    expect(items).toHaveLength(2);
    expect(items![0]).toMatchObject({ kind: "single" });
    expect(items![1]).toMatchObject({ kind: "box" });
    expect(
      (items![1] as { box: { members: PluginSidebarThread[] } }).box.members.map((t) => t.id),
    ).toEqual(["thr_a", "thr_b"]);
  });

  it("a group of one yields a box run around its single member", () => {
    const solo = [thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 })];
      const soloPlan = planGroupBoxes(
        solo,
        groupOf({ thr_a: "grp_auth" }),
        NAMES,
        "status",
        context,
        new Set(),
        NOW,
      );
      const columns = buildColumns(solo, "status", context, new Map(), new Set(), NOW, {}, soloPlan.columnOverrides);
      const working = columns.find((c) => c.id === "working");
      const runs = runsFromColumns([working as never], soloPlan.groupBoxOf);
      const items = (runs as Map<string, readonly unknown[]>).get("working");
      expect(items).toHaveLength(1);
      expect(items![0]).toMatchObject({ kind: "box" });
      expect(
        (items![0] as { box: { members: PluginSidebarThread[] } }).box.members.map((t) => t.id),
      ).toEqual(["thr_a"]);
    });

  it("flattenRuns restores the display order", () => {
    const columns = buildColumns(
      threads,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { "status:working": ["thr_x", "thr_a", "thr_b"] },
      plan.columnOverrides,
    );
    const runs = runsFromColumns(columns, plan.groupBoxOf);
    const flat = flattenRuns(runs.get("working") as never);
    expect(flat.map((t) => t.id)).toEqual(["thr_x", "thr_a", "thr_b"]);
  });
});

describe("runsFromColumns under the split default — the frame follows every lane", () => {
  // Issue #86: no overrides mean the members land in their own lanes, and
  // the frame renders in EVERY lane holding a member — a slice of one
  // included (the outline is the join target and the highlight carrier).
  const threads = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }), // working
    thread({ id: "thr_b", updatedAt: NOW - 2000 }), // idle → Idle · Recent
    thread({ id: "thr_x", indicator: "unread-error", updatedAt: NOW - 3000 }), // attention
  ];
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_a: "grp_auth", thr_b: "grp_auth", thr_x: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );
  const runsOf = (columnId: string) => {
    const columns = buildColumns(threads, "status", context, new Map(), new Set(), NOW, {}, plan.columnOverrides);
    const column = columns.find((candidate) => candidate.id === columnId);
    const runs = runsFromColumns([column as never], plan.groupBoxOf);
    return (runs as Map<string, readonly { kind: string; box?: { members: { id: string }[] } }[]>).get(
      columnId,
    );
  };

  it("a group of three spreads over three lanes; each lane frames its own slice", () => {
    const working = runsOf("working");
    const recent = runsOf("idle-recent");
    const attention = runsOf("attention");
    expect(working).toMatchObject([{ kind: "box" }]);
    expect(recent).toMatchObject([{ kind: "box" }]);
    expect(attention).toMatchObject([{ kind: "box" }]);
    // The same box identity — one group, three frames.
  });

  it("a slice of one keeps its run roles honest (role solo, joins as a plain card)", () => {
    const info = columnRunInfo(
      [
        thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
      ],
      plan.groupBoxOf,
    );
    expect(info.get("thr_a")).toMatchObject({ boxId: "grp_auth", role: "solo" });
  });

  it("co-located members still gather into one run in their shared lane", () => {
    // Two active members (no ranks): both land in Working naturally, so the
    // walker gathers the lane's whole slice into one box run — the same
    // gather the rank contract keeps contiguous.
    const coLocated = [
      thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
      thread({ id: "thr_x", status: "active", updatedAt: NOW - 3000 }),
    ];
    const coPlan = planGroupBoxes(
      coLocated,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    const columns = buildColumns(coLocated, "status", context, new Map(), new Set(), NOW);
    const working = columns.find((candidate) => candidate.id === "working");
    const runs = runsFromColumns([working as never], coPlan.groupBoxOf);
    const items = (runs as Map<string, readonly { kind: string; box?: { members: { id: string }[] } }[]>).get("working");
    expect(items).toHaveLength(2);
    expect(items![0]).toMatchObject({ kind: "box" });
    expect(items![0]!.box!.members.map((entry) => entry.id)).toEqual(["thr_a", "thr_b"]);
    expect(items![1]).toMatchObject({ kind: "single" });
  });
});

describe("filterWithGroupBoxes", () => {
  const threads = [
    thread({ id: "thr_a", status: "active", displayTitle: "Refresh token rotation", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", displayTitle: "Rate-limit login attempts", updatedAt: NOW - 2000 }),
    thread({ id: "thr_x", displayTitle: "Fix flaky screenshot test", updatedAt: NOW - 3000 }),
  ];
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );

  it("a box passes whole when one member matches; the others dim", () => {
    const result = filterWithGroupBoxes(
      threads,
      plan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set() },
      "Refresh token",
      () => "",
    );
    expect(result.kept.map((t) => t.id)).toEqual(["thr_a", "thr_b"]);
    expect(result.dimmedIds).toEqual(new Set(["thr_b"]));
  });

  it("a box drops whole when nothing matches, while an unboxed card passes alone", () => {
    const result = filterWithGroupBoxes(
      threads,
      plan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set() },
      "flaky",
      () => "",
    );
    expect(result.kept.map((t) => t.id)).toEqual(["thr_x"]);
    expect(result.dimmedIds.size).toBe(0);
  });

  it("state filters respect members individually within a passing box", () => {
    // Filter to Working: only the active member passes and the box is kept,
    // with the idle member dimmed — the box lives in the working column anyway.
    const result = filterWithGroupBoxes(
      threads.map((t, i) => (i === 0 ? { ...t, status: "active" as const, runtimeStatus: "idle" } : t)),
      plan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set(["working"]) },
      "",
      () => "",
    );
    expect(result.kept.map((t) => t.id).sort()).toEqual(["thr_a", "thr_b"]);
    expect(result.dimmedIds).toEqual(new Set(["thr_b"]));
  });

  it("an idle-bucket filter passes only the box member in that bucket; the rest dim", () => {
    const idleMembers = [
      thread({ id: "thr_recent", displayTitle: "Freshly idle", updatedAt: NOW - 5 * 60 * 1000 }),
      thread({ id: "thr_today", displayTitle: "Idle since lunch", updatedAt: NOW - 2 * 60 * 60 * 1000 }),
    ];
    const idlePlan = planGroupBoxes(
      idleMembers,
      groupOf({ thr_recent: "grp_auth", thr_today: "grp_auth" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    const result = filterWithGroupBoxes(
      idleMembers,
      idlePlan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set(["idle-today"]) },
      "",
      () => "",
      undefined,
      undefined,
      undefined,
      NOW,
    );
    // The box passes whole (one member matches); the recent member rides
    // along dimmed, per the box keep rule.
    expect(result.kept.map((t) => t.id)).toEqual(["thr_recent", "thr_today"]);
    expect(result.dimmedIds).toEqual(new Set(["thr_recent"]));
  });

  it("an unboxed thread keeps its own pass/fail even under an unrelated search miss", () => {
    const result = filterWithGroupBoxes(
      threads,
      plan.groupBoxOf,
      { projects: new Set(["proj_a"]), providers: new Set(), states: new Set() },
      "",
      () => "",
    );
    expect(result.kept.map((t) => t.id).sort()).toEqual(["thr_a", "thr_b", "thr_x"]);
    expect(result.dimmedIds.size).toBe(0);
  });

  it("a ticket-chip hit keeps a boxed thread the title/branch never name", () => {
    // The Forgejo #38 live repro: an external store link labels the chip;
    // no base field contains "#38". The box must keep both members.
    const refsFor = (t: { id: string }) =>
      t.id === "thr_a"
        ? [
            {
              raw: "Forgejo #38",
              hostname: "git.cove.local",
              tracker: "external" as const,
              href: "https://git.cove.local/cristos/Homelab/issues/38",
            },
          ]
        : [];
    const result = filterWithGroupBoxes(
      threads,
      plan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set() },
      "#38",
      () => "",
      refsFor,
    );
    expect(result.kept.map((t) => t.id)).toEqual(["thr_a", "thr_b"]);
    expect(result.dimmedIds).toEqual(new Set(["thr_b"]));
  });

  it("a feature-group name hit keeps the box whole (non-matching member dims)", () => {
    const groupNameFor = (t: { id: string }): string => (t.id === "thr_a" ? "Auth epic" : "");
    const result = filterWithGroupBoxes(
      threads,
      plan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set() },
      "auth epic",
      () => "",
      undefined,
      groupNameFor,
    );
    expect(result.kept.map((t) => t.id)).toEqual(["thr_a", "thr_b"]);
    expect(result.dimmedIds).toEqual(new Set(["thr_b"]));
  });

  it("a ticket-chip hit keeps an unboxed thread on its own", () => {
    const refsFor = (t: { id: string }) =>
      t.id === "thr_x"
        ? [
            {
              raw: "Forgejo #38",
              hostname: "git.cove.local",
              tracker: "external" as const,
              href: "https://git.cove.local/cristos/Homelab/issues/38",
            },
          ]
        : [];
    const result = filterWithGroupBoxes(
      threads,
      plan.groupBoxOf,
      { projects: new Set(), providers: new Set(), states: new Set() },
      "#38",
      () => "",
      refsFor,
    );
    expect(result.kept.map((t) => t.id)).toEqual(["thr_x"]);
  });
});

describe("columnRunInfo and unitMoveTarget", () => {
  const threads = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
    thread({ id: "thr_c", status: "active", updatedAt: NOW - 3000 }),
    thread({ id: "thr_x", status: "active", updatedAt: NOW - 4000 }),
  ];
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_b: "grp_auth", thr_c: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );
  const order = ["thr_a", "thr_b", "thr_c", "thr_x"];
  const info = columnRunInfo(threads, plan.groupBoxOf);

  it("run roles: first and last members boxed, others plain", () => {
    expect(info.get("thr_b")).toMatchObject({ role: "first", boxId: "grp_auth" });
    expect(info.get("thr_c")).toMatchObject({ role: "last", boxId: "grp_auth" });
    expect(info.get("thr_a")).toBeUndefined();
    expect(info.get("thr_x")).toBeUndefined();
  });

  it("unit ids list the run in display order", () => {
    expect(info.get("thr_b")?.memberIds).toEqual(["thr_b", "thr_c"]);
  });

  it("a drop before a plain card anchors there (plain behaves like moveTargetFor)", () => {
    expect(unitMoveTarget(order, "thr_a", "before", "thr_x", info)).toEqual({
      beforeId: "thr_a",
      toEnd: false,
    });
  });

  it("a drop beside a box member anchors at the BOX edge, never mid-box", () => {
    expect(unitMoveTarget(order, "thr_b", "before", "thr_x", info)).toEqual({
      beforeId: "thr_b",
      toEnd: false,
    });
    expect(unitMoveTarget(order, "thr_c", "after", "thr_x", info)).toEqual({
      beforeId: "thr_x",
      toEnd: false,
    });
  });

  it("hovering the dragged card's own run is a no-op", () => {
    expect(unitMoveTarget(order, "thr_b", "before", "thr_c", info)).toBeNull();
    expect(unitMoveTarget(order, "thr_c", "after", "thr_b", info)).toBeNull();
  });

  it("an after-hover directly above the dragged box anchors past its own span (a visual no-op)", () => {
    // Drag the box (b,c); hover plain "a" above it, bottom half: below a
    // are the box's own members, so the anchor lands past its own span on
    // "x" — reinserting there reproduces the current order (no move).
    expect(unitMoveTarget(order, "thr_a", "after", "thr_b", info)).toEqual({
      beforeId: "thr_x",
      toEnd: false,
    });
  });
});

describe("the split plan leaves the frozen lane to the pane", () => {
  // The 2026-10-10 pane-follows saga ended in "the plan beats the pane".
  // Issue #86 removes the plan's lane claim entirely, so the anti-slide
  // contract now always wins for a boxed member the way it wins for an
  // unboxed one: the capture holds the card's rendered placement, and the
  // split frame simply wraps whatever lanes its members render in.
  const threads = [
    thread({ id: "thr_a", updatedAt: NOW - 1000 }), // idle — the card open in the pane
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }), // working
  ];
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );
  const frozen = new Map([["thr_a", { id: "idle-today", label: "Idle · Today" }]]);

  it("an open member holds its frozen lane; the group splits around it", () => {
    const columns = buildColumns(
      threads,
      "status",
      context,
      frozen,
      new Set(),
      NOW,
      {},
      plan.columnOverrides,
    );
    expect(columns.some((column) => column.id === "idle-today")).toBe(true);
    const frozenLane = columns.find((column) => column.id === "idle-today");
    expect(frozenLane?.threads.map((entry) => entry.id)).toEqual(["thr_a"]);
  });

  it("a frozen thread the plan says nothing about keeps its frozen lane", () => {
    // The pane freeze still owns cards with no lane of their own — the
    // anti-slide contract survives wherever the family has no claim.
    const columns = buildColumns(
      [thread({ id: "1", status: "active" })],
      "status",
      context,
      new Map([["1", { id: "unread", label: "Unread" }]]),
      new Set(),
      NOW,
      {},
      new Map(),
    );
    expect(columns.some((column) => column.id === "unread")).toBe(true);
  });
});

describe("inBoxMoveTarget (reordering members INSIDE one box)", () => {
  const threads = [
    thread({ id: "thr_c", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 3000 }),
    thread({ id: "thr_x", status: "active", updatedAt: NOW - 4000 }),
    thread({ id: "thr_y", status: "active", updatedAt: NOW - 5000 }),
  ];
  // One three-member box (a, b, c in display order) plus two plain cards.
  const plan = planGroupBoxes(
    threads,
    groupOf({ thr_a: "grp_auth", thr_b: "grp_auth", thr_c: "grp_auth" }),
    NAMES,
    "status",
    context,
    new Set(),
    NOW,
  );
  const order = ["thr_c", "thr_b", "thr_a", "thr_x", "thr_y"];
  const info = columnRunInfo(threads, plan.groupBoxOf);

  it("a before-edge drop anchors on the hovered member itself, mid-box and all", () => {
    // Drag b onto a's top half: b lands directly above a — an insert the
    // box-edge normalization (unitMoveTarget) refuses by design.
    expect(inBoxMoveTarget(order, "thr_a", "before", "thr_b", info)).toEqual({
      beforeId: "thr_a",
      toEnd: false,
    });
  });

  it("an after-edge drop anchors on the card below the hovered member", () => {
    expect(inBoxMoveTarget(order, "thr_c", "after", "thr_a", info)).toEqual({
      beforeId: "thr_b",
      toEnd: false,
    });
  });

  it("an after-edge below the box's last member lands the member just below the box", () => {
    // Drag a (box member) onto c's bottom half: below c is plain thr_x, and
    // a becomes the box's new last member — still contiguous. Hovering the
    // box's top member's after-edge instead anchors on the next member (b).
    expect(inBoxMoveTarget(order, "thr_c", "after", "thr_a", info)).toEqual({
      beforeId: "thr_b",
      toEnd: false,
    });
    expect(inBoxMoveTarget(order, "thr_a", "after", "thr_c", info)).toEqual({
      beforeId: "thr_x",
      toEnd: false,
    });
  });

  it("hovering the member directly above the dragged one is a no-op (re-anchored beside it)", () => {
    // Drag a onto b's bottom half: the card below b IS a, so the move is
    // where a already sits — anchor before b instead (equal position).
    expect(inBoxMoveTarget(order, "thr_b", "after", "thr_a", info)).toEqual({
      beforeId: "thr_b",
      toEnd: false,
    });
  });

  it("a member hovering itself is no target", () => {
    expect(inBoxMoveTarget(order, "thr_b", "before", "thr_b", info)).toBeNull();
  });

  it("a foreign card's hover is out of scope (unitMoveTarget owns cross-box moves)", () => {
    expect(inBoxMoveTarget(order, "thr_x", "before", "thr_b", info)).toBeNull();
  });

  it("a solo run member drags as a plain card, never as an in-box reorder", () => {
    // grp_solo: a group-of-one box around thr_x.
    const soloPlan = planGroupBoxes(
      threads,
      groupOf({ thr_a: "grp_auth", thr_b: "grp_auth", thr_c: "grp_auth", thr_x: "grp_solo" }),
      NAMES,
      "status",
      context,
      new Set(),
      NOW,
    );
    const soloInfo = columnRunInfo(threads, soloPlan.groupBoxOf);
    expect(inBoxMoveTarget(order, "thr_x", "before", "thr_c", soloInfo)).toBeNull();
  });
});

describe("canJoinGroup (the drop-into-the-box gesture's decision)", () => {
  const boxes = new Map([
    ["thr_solo", { groupId: "grp_auth", name: "Auth rework", members: [thread({ id: "thr_solo" })] }],
    [
      "thr_boxed",
      {
        groupId: "grp_auth",
        name: "Auth rework",
        members: [thread({ id: "thr_boxed" }), thread({ id: "thr_other" })],
      },
    ],
  ]);

  it("an unassigned card joins", () => {
    expect(canJoinGroup("thr_free", "grp_auth", boxes)).toBe(true);
  });

  it("a card already in the same group is a no-op drop (no change)", () => {
    expect(canJoinGroup("thr_solo", "grp_auth", boxes)).toBe(false);
    expect(canJoinGroup("thr_boxed", "grp_auth", boxes)).toBe(false);
  });

  it("a multi-member box unit cannot join: membership is per-thread", () => {
    expect(canJoinGroup("thr_boxed", "grp_search", boxes)).toBe(false);
  });

  it("a lone box member moves to another group (one group per thread)", () => {
    expect(canJoinGroup("thr_solo", "grp_search", boxes)).toBe(true);
  });

  it("a split group's lone slice member joins another group (it drags as a plain card)", () => {
    // Issue #86: the drag unit is the LANE SLICE. `thr_boxed`'s slice here
    // renders alone (one member in its lane), so the join is offered even
    // though the group's whole membership is bigger.
    expect(canJoinGroup("thr_boxed", "grp_search", boxes, false)).toBe(true);
  });

  it("a slice co-located with a sibling (role not solo) never joins another group", () => {
    expect(canJoinGroup("thr_boxed", "grp_search", boxes, true)).toBe(false);
    // Same-group drops refuse either way, before the unit question.
    expect(canJoinGroup("thr_boxed", "grp_auth", boxes, false)).toBe(false);
  });
});

describe("planGroupBoxes under the split default — families keep their own lane rule", () => {
  // The 2026-10-11 family rule lives in nestUnderParents's
  // familyColumnOverrides (tested in nesting.test.ts) — the family is the
  // unit of ITS lane priority. The group plan no longer drives lanes at all
  // (issue #86): what these pins hold is that every scenario that used to
  // lift a box — an active child, a copied-out Needs-you/done/pinned child,
  // an archived one, a fresher recency child — now claims NO lane, and the
  // parent member's card still renders inside the box identity.
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  const boxedPlan = (
    threads: readonly PluginSidebarThread[],
    doneIds: ReadonlySet<string> = new Set(),
    groupBy: "status" | "recency" = "status",
  ) =>
    planGroupBoxes(threads, groupOf({ thr_root: "grp_auth" }), NAMES, groupBy, context, doneIds, NOW);

  it("a member's active child lifts nothing: the plan emits no lane claim", () => {
    const threads = [
      thread({ id: "thr_root", updatedAt: NOW - 5 * MINUTE }),
      thread({ id: "thr_kid", status: "active", updatedAt: NOW - MINUTE, parentThreadId: "thr_root" }),
    ];
    const plan = boxedPlan(threads);
    expect(plan.columnOverrides.size).toBe(0);
    expect(plan.groupBoxOf.has("thr_root")).toBe(true);
  });

  it("a Needs-you child is copied out; the parent keeps boxing itself, no lane claimed", () => {
    const threads = [
      thread({ id: "thr_root", updatedAt: NOW - 5 * MINUTE }),
      thread({ id: "thr_kid", hasPendingInteraction: true, updatedAt: NOW - MINUTE, parentThreadId: "thr_root" }),
    ];
    const plan = boxedPlan(threads);
    expect(plan.columnOverrides.size).toBe(0);
    expect(plan.groupBoxOf.has("thr_root")).toBe(true);
  });

  it("a done child is copied out", () => {
    const threads = [
      thread({ id: "thr_root", updatedAt: NOW - 5 * MINUTE }),
      thread({ id: "thr_kid", status: "active", updatedAt: NOW - MINUTE, parentThreadId: "thr_root" }),
    ];
    const plan = boxedPlan(threads, new Set(["thr_kid"]));
    expect(plan.columnOverrides.size).toBe(0);
    expect(plan.groupBoxOf.has("thr_root")).toBe(true);
  });

  it("a pinned child is copied out", () => {
    const threads = [
      thread({ id: "thr_root", updatedAt: NOW - 5 * MINUTE }),
      thread({
        id: "thr_kid",
        status: "active",
        isPinned: true,
        updatedAt: NOW - MINUTE,
        parentThreadId: "thr_root",
      }),
    ];
    const plan = boxedPlan(threads);
    expect(plan.columnOverrides.size).toBe(0);
    expect(plan.groupBoxOf.has("thr_root")).toBe(true);
  });

  it("an archived child renders nowhere and claims nothing", () => {
    const threads = [
      thread({ id: "thr_root", updatedAt: NOW - 5 * MINUTE }),
      thread({
        id: "thr_kid",
        status: "active",
        isArchived: true,
        updatedAt: NOW - MINUTE,
        parentThreadId: "thr_root",
      }),
    ];
    const plan = boxedPlan(threads);
    expect(plan.columnOverrides.size).toBe(0);
    expect(plan.groupBoxOf.has("thr_root")).toBe(true);
  });

  it("under Last activity a fresher nested child lifts nothing either", () => {
    const threads = [
      thread({ id: "thr_root", updatedAt: NOW - 3 * HOUR }),
      thread({ id: "thr_kid", updatedAt: NOW - 5 * MINUTE, parentThreadId: "thr_root" }),
    ];
    const plan = boxedPlan(threads, new Set(), "recency");
    expect(plan.columnOverrides.size).toBe(0);
    expect(plan.groupBoxOf.has("thr_root")).toBe(true);
  });
});

describe("doneRecencyCompare is untouched by the group plan", () => {
  it("the comparator still sorts newest done first", () => {
    const times = new Map([
      ["thr_a", 5],
      ["thr_b", 9],
    ]);
    const sorted = [
      thread({ id: "thr_a" }),
      thread({ id: "thr_b" }),
    ].sort(doneRecencyCompare(times));
    expect(sorted.map((t) => t.id)).toEqual(["thr_b", "thr_a"]);
  });
});