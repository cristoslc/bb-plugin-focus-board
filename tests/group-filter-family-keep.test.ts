// The operator's ruling (2026-11-11): filtering the board to a feature group
// keeps every family card WHOLE. A parent that passes the Group filter
// carries its descendants inside its card whatever group they belong to — a
// cross-group child keeps its row, its state dot, and its actions. The
// inverse is unchanged: a family whose PARENT sits in another group never
// surfaces (a child alone does not pull a parent in — that is the filter
// doing its job). Children stay nested; nothing is hoisted into its own
// group's lane or frame. Before the fix the family keep pass dropped the
// cross-group child outright (the project column-gate policy mirrored), so
// the parent card rendered with holes in it.
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { FilterState, GroupingContext } from "../components/grouping";
import { assembleBoard, buildFamilyIndex, filterFamilies } from "../components/nesting";
import { thread } from "./thread-fixture";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

const empty = (): ReadonlySet<string> => new Set();

const GROUP_NAMES = new Map<string, string>([
  ["grp_a", "Alpha rework"],
  ["grp_b", "Beta rework"],
]);

/** The board state a filter run reads: assignments, the filter, and the
 *  grouping context the assembly gets from app.tsx. */
interface Spec {
  threads: PluginSidebarThread[];
  assign: Record<string, string>;
  /** The selected buckets (the Group filter's set). */
  groups: readonly string[];
  projects?: readonly string[];
  states?: readonly string[];
}

function filterOf(spec: Spec): FilterState {
  return {
    projects: new Set(spec.projects ?? []),
    providers: empty(),
    states: new Set(spec.states ?? []),
    groups: new Set(spec.groups),
  };
}

function contextOf(spec: Spec): GroupingContext {
  return {
    projects: [{ id: "proj_a", name: "Alpha", isPersonal: false, href: "", settingsHref: "" }],
    providers: [{ id: "pi", displayName: "Pi" }],
    groupsByThread: new Map(Object.entries(spec.assign)),
    groupNames: GROUP_NAMES,
    ...(spec.groups.length > 0 ? { groupRestrict: new Set(spec.groups) } : {}),
  };
}

function keptOf(spec: Spec): readonly PluginSidebarThread[] {
  return filterFamilies(
    spec.threads,
    buildFamilyIndex(spec.threads),
    filterOf(spec),
    "",
    undefined,
    undefined,
    undefined,
    contextOf(spec).groupsByThread,
  ).kept;
}

function assemblyOf(spec: Spec): ReturnType<typeof assembleBoard> {
  return assembleBoard(keptOf(spec), "group", contextOf(spec), new Map(), new Set(), NOW);
}

const ids = (threads: readonly PluginSidebarThread[]) => threads.map((t) => t.id).sort();
const columnIds = (assembly: ReturnType<typeof assembleBoard>) =>
  assembly.columns.map((column) => column.id).sort();
const columnsHolding = (assembly: ReturnType<typeof assembleBoard>, threadId: string) =>
  assembly.columns.filter((column) => column.threads.some((t) => t.id === threadId)).map((c) => c.id);
const rowIds = (assembly: ReturnType<typeof assembleBoard>, parentId: string) =>
  (assembly.nestedChildrenByParent.get(parentId) ?? []).map((t) => t.id);

/** The reported shape: a parent in Alpha with one Alpha child and one Beta
 *  child, plus a second Beta thread so the Beta lane has a reason to stand. */
function family(): Spec {
  return {
    threads: [
      thread({ id: "thr_p", displayTitle: "Orchestrator", status: "active", updatedAt: NOW - 5 * HOUR }),
      thread({ id: "thr_c", parentThreadId: "thr_p", displayTitle: "Alpha child", status: "active", updatedAt: NOW - 2 * HOUR }),
      thread({ id: "thr_x", parentThreadId: "thr_p", displayTitle: "Beta child", status: "active", updatedAt: NOW - HOUR }),
      thread({ id: "thr_lone", displayTitle: "Beta loner", status: "active", updatedAt: NOW - 3 * HOUR }),
    ],
    assign: { thr_p: "grp_a", thr_c: "grp_a", thr_x: "grp_b", thr_lone: "grp_b" },
    groups: ["grp_a"],
  };
}

describe("filterFamilies under a group restrict", () => {
  it("keeps a matched parent's cross-group child (the child never drops)", () => {
    const spec = family();
    const result = filterFamilies(
      spec.threads,
      buildFamilyIndex(spec.threads),
      filterOf(spec),
      "",
      undefined,
      undefined,
      undefined,
      contextOf(spec).groupsByThread,
    );
    expect(ids(result.kept)).toEqual(["thr_c", "thr_p", "thr_x"]);
    // The kept-anyway child is context: it did not match the group filter.
    expect([...result.dimmedIds].sort()).toEqual(["thr_x"]);
  });

  it("a family whose parent sits in another group still restricts to the matching child alone", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_bp", displayTitle: "Beta parent", status: "active" }),
        thread({ id: "thr_ac", parentThreadId: "thr_bp", displayTitle: "Alpha child", status: "active" }),
      ],
      assign: { thr_bp: "grp_b", thr_ac: "grp_a" },
      groups: ["grp_a"],
    };
    // Children alone never pull a parent in: the parent card stays absent,
    // and the matching child keeps standing on its own (unchanged behavior).
    expect(ids(keptOf(spec))).toEqual(["thr_ac"]);
  });

  it("carries the whole subtree, not only the direct child", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_p", displayTitle: "Root", status: "active" }),
        thread({ id: "thr_c", parentThreadId: "thr_p", displayTitle: "Beta child", status: "active" }),
        thread({ id: "thr_g", parentThreadId: "thr_c", displayTitle: "Alpha grandchild", status: "active" }),
      ],
      assign: { thr_p: "grp_a", thr_c: "grp_b", thr_g: "grp_a" },
      groups: ["grp_a"],
    };
    expect(ids(keptOf(spec))).toEqual(["thr_c", "thr_g", "thr_p"]);
  });

  it("a carried child still drops when the project filter excludes its column", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_p", displayTitle: "Root", status: "active", projectId: "proj_a" }),
        thread({ id: "thr_x", parentThreadId: "thr_p", displayTitle: "Elsewhere", status: "active", projectId: "proj_b" }),
      ],
      assign: { thr_p: "grp_a", thr_x: "grp_b" },
      groups: ["grp_a"],
      projects: ["proj_a"],
    };
    // The project filter stays a column gate: a dim-kept member in an
    // unselected project never projects that project's lane.
    expect(ids(keptOf(spec))).toEqual(["thr_p"]);
  });

  it("a carried child still keeps its row on a state miss (dimmed, as every family member)", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_p", displayTitle: "Root", status: "active" }),
        thread({ id: "thr_x", parentThreadId: "thr_p", displayTitle: "Elsewhere", status: "idle" }),
      ],
      assign: { thr_p: "grp_a", thr_x: "grp_b" },
      groups: ["grp_a"],
      states: ["working"],
    };
    const result = filterFamilies(
      spec.threads,
      buildFamilyIndex(spec.threads),
      filterOf(spec),
      "",
      undefined,
      undefined,
      undefined,
      contextOf(spec).groupsByThread,
    );
    expect(ids(result.kept)).toEqual(["thr_p", "thr_x"]);
    expect([...result.dimmedIds].sort()).toEqual(["thr_x"]);
  });

  it("with no group restriction nothing changes: the cross-group child keeps its own group's lane", () => {
    const spec: Spec = { ...family(), groups: [] };
    const assembly = assemblyOf(spec);
    expect(rowIds(assembly, "thr_p")).toEqual(["thr_c"]);
    expect(columnsHolding(assembly, "thr_x")).toEqual(["grp_b"]);
  });
});

describe("the group filter's family card carries its children", () => {
  it("nests the cross-group child under the parent card, not in its own group's lane", () => {
    const assembly = assemblyOf(family());
    expect(rowIds(assembly, "thr_p").sort()).toEqual(["thr_c", "thr_x"]);
    // The child's own bucket lane does not stand on the board, and no lane
    // holds the child as a card of its own: nested, never hoisted.
    expect(columnIds(assembly)).toEqual(["grp_a"]);
    expect(columnsHolding(assembly, "thr_x")).toEqual([]);
    expect(columnsHolding(assembly, "thr_p")).toEqual(["grp_a"]);
  });

  it("keeps the child nested even when its own group is selected too (never hoisted)", () => {
    const spec: Spec = { ...family(), groups: ["grp_a", "grp_b"] };
    const assembly = assemblyOf(spec);
    expect(rowIds(assembly, "thr_p").sort()).toEqual(["thr_c", "thr_x"]);
    expect(columnsHolding(assembly, "thr_x")).toEqual([]);
    // The Beta lane still stands for its other member, without the child.
    expect(columnsHolding(assembly, "thr_lone")).toEqual(["grp_b"]);
  });

  it("nests a cross-group grandchild as a sub-row under its own parent's row", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_p", displayTitle: "Root", status: "active" }),
        thread({ id: "thr_c", parentThreadId: "thr_p", displayTitle: "Beta child", status: "active" }),
        thread({ id: "thr_g", parentThreadId: "thr_c", displayTitle: "Alpha grandchild", status: "active" }),
      ],
      assign: { thr_p: "grp_a", thr_c: "grp_b", thr_g: "grp_a" },
      groups: ["grp_a"],
    };
    const assembly = assemblyOf(spec);
    expect(rowIds(assembly, "thr_p")).toEqual(["thr_c"]);
    expect(rowIds(assembly, "thr_c")).toEqual(["thr_g"]);
    expect(columnsHolding(assembly, "thr_g")).toEqual([]);
  });

  it("a family whose parent does not match stays absent (no parent card, no rows)", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_bp", displayTitle: "Beta parent", status: "active" }),
        thread({ id: "thr_ac", parentThreadId: "thr_bp", displayTitle: "Alpha child", status: "active" }),
      ],
      assign: { thr_bp: "grp_b", thr_ac: "grp_a" },
      groups: ["grp_a"],
    };
    const assembly = assemblyOf(spec);
    expect(columnsHolding(assembly, "thr_bp")).toEqual([]);
    expect(assembly.nestedChildrenByParent.has("thr_bp")).toBe(false);
    // The matching child still stands on its own, in its own group's lane.
    expect(columnsHolding(assembly, "thr_ac")).toEqual(["grp_a"]);
  });

  it("a filter matching nothing in the family drops it whole", () => {
    const spec: Spec = {
      threads: [
        thread({ id: "thr_bp", displayTitle: "Beta parent", status: "active" }),
        thread({ id: "thr_bx", parentThreadId: "thr_bp", displayTitle: "Beta child", status: "active" }),
      ],
      assign: { thr_bp: "grp_b", thr_bx: "grp_b" },
      groups: ["grp_a"],
    };
    const assembly = assemblyOf(spec);
    expect(assembly.columns).toEqual([]);
    expect(assembly.nestedChildrenByParent.size).toBe(0);
  });
});
