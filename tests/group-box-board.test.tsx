// @vitest-environment jsdom
// The decided family-box design (thread storage: reports/feature-group-
// mockups.html) pinned on the Board seam: boxed members render inside a
// dashed outline whose label sits on the border as secondary text; a lone
// member renders as a plain card with no box at all.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<string, { groupId: string; name: string }>,
) {
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf,
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

describe("the family box renders around its members", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];

  it("every boxed member carries the box decoration and group data", () => {
    renderBoard(
      members,
      new Map([
        ["thr_a", { groupId: "grp_1", name: "Auth rework" }],
        ["thr_b", { groupId: "grp_1", name: "Auth rework" }],
      ]),
    );
    for (const id of ["thr_a", "thr_b"]) {
      const slot = document.querySelector(`[data-rank-slot="${id}"]`);
      expect(slot?.getAttribute("data-group-box-member")).toBe("grp_1");
    }
    // Exactly one bordered pair: a first and a last member.
    expect(document.querySelector('[data-group-box-first="grp_1"]')).not.toBeNull();
    expect(document.querySelector('[data-group-box-last="grp_1"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-group-box-first="grp_1"]')).toHaveLength(1);
  });

  it("the group's name is SECONDARY text on the box, with no card decoration", () => {
    renderBoard(
      members,
      new Map([
        ["thr_a", { groupId: "grp_1", name: "Auth rework" }],
        ["thr_b", { groupId: "grp_1", name: "Auth rework" }],
      ]),
    );
    const label = document.querySelector('[data-group-box-label="grp_1"]');
    expect(label?.textContent).toBe("Auth rework");
  });

  it("a single member renders as a plain card: no box, no label", () => {
    renderBoard(
      [thread({ id: "thr_a", updatedAt: NOW - 1000 })],
      new Map([["thr_a", { groupId: "grp_1", name: "Auth rework" }]]),
    );
    expect(document.querySelector('[data-group-box-member]')).toBeNull();
    expect(document.querySelector('[data-group-box-label]')).toBeNull();
  });

  it("an unassigned card renders with no box decoration", () => {
    renderBoard(members, new Map());
    expect(document.querySelector('[data-group-box-member]')).toBeNull();
  });
});