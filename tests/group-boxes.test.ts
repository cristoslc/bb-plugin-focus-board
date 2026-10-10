import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread } from "./thread-fixture";
import { buildColumns, doneRecencyCompare } from "../components/grouping";
import {
  columnRunInfo,
  filterWithGroupBoxes,
  flattenRuns,
  planGroupBoxes,
  reconcileGroupBoxPlan,
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
  it("two members under the status grouping form a box, overrides to each member", () => {
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
  });

  it("a group of one renders nothing: no box, no overrides", () => {
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
    expect(plan.active).toBe(false);
    expect(plan.groupBoxOf.size).toBe(0);
    expect(plan.columnOverrides.size).toBe(0);
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

  it("an attention member pulls the box into Needs you", () => {
    const threads = [
      thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", updatedAt: NOW - 1000 }), // idle
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
    expect(plan.columnOverrides.get("thr_b")).toEqual({ id: "working", label: "Working" });
  });

  it("two attention members land the box in Needs you", () => {
    const threads = [
      thread({ id: "thr_a", indicator: "unread-error", updatedAt: NOW - 1000 }),
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
    expect(plan.columnOverrides.get("thr_a")?.id).toBe("attention");
  });

  it("idle members tie on the bucket the freshest idle member would take", () => {
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
    // Both idle → the freshest member's bucket wins ("Today"-ish slot).
    expect(plan.columnOverrides.get("thr_old")?.id).toBe(
      plan.columnOverrides.get("thr_new")?.id,
    );
    expect(plan.columnOverrides.get("thr_new")?.id).toBe("idle-recent");
  });

  it("boxes stay off under axis groupings (project/provider/machine/parent)", () => {
    const threads = [
      thread({ id: "thr_a" }),
      thread({ id: "thr_b" }),
    ];
    const assignments = groupOf({ thr_a: "grp_auth", thr_b: "grp_auth" });
    for (const groupBy of ["project", "provider", "machine", "parent"] as const) {
      const plan = planGroupBoxes(
        threads,
        assignments,
        NAMES,
        groupBy,
        { projects: [{ id: "proj_a", name: "P" } as never], providers: [] },
        new Set(),
        NOW,
      );
      expect(plan.active).toBe(false);
      expect(plan.groupBoxOf.size).toBe(0);
    }
  });

  it("under recency, the box lands in the freshest member's bucket", () => {
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
    expect(plan.columnOverrides.get("thr_old")?.id).toBe("recent");
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

describe("reconcileGroupBoxesWithFrozen", () => {
  const threads = [
    thread({ id: "thr_a", updatedAt: NOW - 1000 }),
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

  it("a member frozen in another column pulls its WHOLE box to that column", () => {
    // The member is open in the pane: its column is frozen (the open card
    // must never slide). The box follows it — the family gathers around
    // the selected card, exactly as nested children do.
    const frozen = new Map([["thr_a", { id: "idle-today", label: "Idle · Today" }]]);
    const reconciled = reconcileGroupBoxPlan(plan, frozen);
    expect(reconciled.columnOverrides.get("thr_b")).toEqual({ id: "idle-today", label: "Idle · Today" });
    expect(reconciled.columnOverrides.get("thr_a")).toEqual({ id: "idle-today", label: "Idle · Today" });
  });

  it("frozen ids outside any box leave the plan untouched", () => {
    const frozen = new Map([["thr_x", { id: "working", label: "Working" }]]);
    const reconciled = reconcileGroupBoxPlan(plan, frozen);
    expect(reconciled).toBe(plan);
  });

  it("no frozen columns: the plan passes through", () => {
    expect(reconcileGroupBoxPlan(plan, new Map())).toBe(plan);
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