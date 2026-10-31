// @vitest-environment jsdom
// Issue #328, the board half: the feature-group box (a folded box's frame and
// its label) is a unit drag source on a fine pointer only, and the two scroll
// surfaces declare `touch-manipulation` so a finger's pan keeps both axes. The
// card half lives in `tests/thread-card-touch-drag.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

function stubPointer(coarse: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: coarse && (query.includes("pointer: coarse") || query.includes("hover: none")),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

type BoardProps = Parameters<typeof Board>[0];

const members = [
  thread({ id: "thr_a", displayTitle: "First task", status: "active", updatedAt: NOW - 1000 }),
  thread({ id: "thr_b", displayTitle: "Second task", status: "active", updatedAt: NOW - 2000 }),
];
const groupBoxOf = new Map<
  string,
  { groupId: string; name: string; members: readonly PluginSidebarThread[] }
>([
  ["thr_a", { groupId: "grp_auth", name: "Auth rework", members }],
  ["thr_b", { groupId: "grp_auth", name: "Auth rework", members }],
]);

function renderBoard(collapsed: boolean) {
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(
      members,
      "status",
      context,
      new Map(),
      new Set<string>(),
      NOW,
      {},
    ),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<string, number>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf,
    onRenameGroup: () => {},
    // Collapsed (folded box) or expanded (labelled dashed box): both frames
    // are unit drag sources, so both carry the gate.
    collapsedGroupIds: collapsed ? new Set<string>(["grp_auth"]) : new Set<string>(),
    onGroupCollapsedChange: () => {},
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

const collapsedBox = () =>
  document.querySelector('[data-collapsed-group="grp_auth"]') as HTMLElement | null;
const boxLabel = () =>
  document.querySelector('[data-group-box-label="grp_auth"]') as HTMLElement | null;

describe("a feature-group box arms no native drag source on a coarse pointer (issue #328)", () => {
  it("a coarse pointer leaves the folded box frame not draggable", () => {
    stubPointer(true);
    renderBoard(true);
    expect(collapsedBox()).toBeInstanceOf(HTMLElement);
    expect(collapsedBox()?.getAttribute("draggable")).toBe("false");
  });

  it("a fine pointer keeps the folded box draggable as one unit", () => {
    stubPointer(false);
    renderBoard(true);
    expect(collapsedBox()?.getAttribute("draggable")).toBe("true");
  });

  it("a coarse pointer leaves the expanded box's label not draggable", () => {
    stubPointer(true);
    renderBoard(false);
    expect(boxLabel()).toBeInstanceOf(HTMLElement);
    expect(boxLabel()?.getAttribute("draggable")).toBe("false");
  });

  it("a fine pointer keeps the expanded box's label draggable", () => {
    stubPointer(false);
    renderBoard(false);
    expect(boxLabel()?.getAttribute("draggable")).toBe("true");
  });
});

describe("the board's scroll surfaces declare their pan (issue #328)", () => {
  it("the board and every lane list carry touch-manipulation, never a single-axis pan", () => {
    stubPointer(true);
    renderBoard(false);
    const board = document.querySelector("[data-columns-board]");
    expect(board?.className).toContain("touch-manipulation");
    const lists = [...document.querySelectorAll("[data-card-list]")];
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list.className).toContain("touch-manipulation");
    }
  });
});
