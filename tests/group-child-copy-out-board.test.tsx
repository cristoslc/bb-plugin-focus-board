// @vitest-environment jsdom
// The operator's 2026-10-31 ask, pinned on the real Board: a child whose own
// feature group differs from its parent's shows up BOTH as a child of its
// parent and as a card inside its group's dashed frame, in whatever column
// its own state picks — and a pinned parent (the ask's own example) carries
// its row while the child's card sits in the Working lane's frame.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import type { GroupBy, GroupingContext } from "../components/grouping";
import { planGroupBoxes } from "../components/group-boxes";
import { assembleBoard } from "../components/nesting";
import { thread } from "./thread-fixture";

afterEach(cleanup);

type BoardProps = Parameters<typeof Board>[0];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

const CONTEXT: GroupingContext = {
  projects: [
    { id: "proj_a", name: "Alpha", isPersonal: false, href: "", settingsHref: "" },
  ],
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

/**
 * The assembly plus box plan the app wires, rendered through the real Board —
 * so the frame, the column, and the row are read off one DOM.
 */
function renderAssembled(
  threads: readonly PluginSidebarThread[],
  groupBy: GroupBy = "status",
  assignments: ReadonlyMap<string, string> = CONTEXT.groupsByThread ?? new Map(),
  extra: Partial<BoardProps> = {},
): void {
  const context: GroupingContext = { ...CONTEXT, groupsByThread: assignments };
  const assembly = assembleBoard(threads, groupBy, context, new Map(), new Set(), NOW);
  const plan = planGroupBoxes(
    threads,
    assignments,
    context.groupNames ?? new Map(),
    groupBy,
    context,
    new Set(),
    NOW,
  );
  const props = {
    groupBy,
    columns: assembly.columns,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf: plan.groupBoxOf,
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    ...extra,
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

describe("a child in its own group renders in both places", () => {
  const parent = thread({ id: "p", displayTitle: "Parent", updatedAt: NOW - 5 * HOUR });
  const child = thread({
    id: "c",
    parentThreadId: "p",
    displayTitle: "Child",
    status: "active",
    updatedAt: NOW - MINUTE,
  });

  it("the child's own card sits inside its group's dashed frame in its state's column", () => {
    renderAssembled([parent, child]);
    const working = document.querySelector('[data-column-id="working"]');
    expect(working).not.toBeNull();
    const frame = working?.querySelector('[data-group-box="grp_b"]');
    expect(frame).not.toBeNull();
    expect(frame?.querySelector('[data-group-box-label="grp_b"]')?.textContent).toBe("Beta rework");
    expect(frame?.querySelector('[data-thread-card="c"]')).not.toBeNull();
    // The parent's own group frames the parent where the parent renders —
    // the split default: one group, one lane slice each.
    const idle = document.querySelector('[data-column-id="idle-today"]');
    expect(idle?.querySelector('[data-group-box="grp_a"]')).not.toBeNull();
    expect(idle?.querySelector('[data-thread-card="p"]')).not.toBeNull();
  });

  it("the child's row still renders under the parent card, and the chip still counts it", () => {
    renderAssembled([parent, child]);
    const parentCard = document.querySelector('[data-thread-card="p"]');
    expect(parentCard).not.toBeNull();
    const rows = parentCard?.querySelector('[data-nested-rows]');
    expect(rows).not.toBeNull();
    expect(rows?.querySelector('[data-thread-card="c"]')).not.toBeNull();
    expect(parentCard?.textContent).toContain("1 child thread");
  });

  it("the child renders exactly twice: its row and its own card (never a third copy)", () => {
    renderAssembled([parent, child]);
    expect(document.querySelectorAll('[data-thread-card="c"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-thread-card="p"]')).toHaveLength(1);
  });

  it("a PINNED parent (the ask's own example) carries the row while the child's card lands in Working's frame", () => {
    const pinnedParent = thread({
      id: "p",
      displayTitle: "Parent",
      isPinned: true,
      updatedAt: NOW - 5 * HOUR,
    });
    renderAssembled([pinnedParent, child]);
    const pinnedLane = document.querySelector('[data-column-id="pinned"]');
    const parentCard = pinnedLane?.querySelector('[data-thread-card="p"]');
    expect(parentCard).not.toBeNull();
    expect(parentCard?.querySelector('[data-nested-rows] [data-thread-card="c"]')).not.toBeNull();
    const workingFrame = document
      .querySelector('[data-column-id="working"]')
      ?.querySelector('[data-group-box="grp_b"]');
    expect(workingFrame?.querySelector('[data-thread-card="c"]')).not.toBeNull();
  });

  it("a COLLAPSED parent keeps the child's dot in its strip while the child's card sits in its frame", () => {
    renderAssembled([parent, child], "status", CONTEXT.groupsByThread, {
      collapsedFamilyIds: new Set(["p"]),
    });
    const parentCard = document.querySelector('[data-thread-card="p"]');
    const strip = parentCard?.querySelector('[data-child-thread-dots]');
    expect(strip?.querySelector('[data-child-dot="c"]')).not.toBeNull();
    expect(parentCard?.textContent).toContain("1 child thread");
    // the folded rows hide, the child's own card does not.
    expect(parentCard?.querySelector('[data-nested-rows]')).toBeNull();
    expect(
      document
        .querySelector('[data-column-id="working"]')
        ?.querySelector('[data-group-box="grp_b"] [data-thread-card="c"]'),
    ).not.toBeNull();
  });

  it("a same-group child still renders once, nested, with no frame of its own", () => {
    const sameGroupChild = thread({
      id: "c",
      parentThreadId: "p",
      displayTitle: "Child",
      status: "active",
      updatedAt: NOW - MINUTE,
    });
    renderAssembled(
      [parent, sameGroupChild],
      "status",
      new Map([
        ["p", "grp_a"],
        ["c", "grp_a"],
      ]),
    );
    expect(document.querySelectorAll('[data-thread-card="c"]')).toHaveLength(1);
    const parentCard = document.querySelector('[data-thread-card="p"]');
    expect(parentCard?.querySelector('[data-nested-rows] [data-thread-card="c"]')).not.toBeNull();
    // Its one appearance is the row: the family lifted to Working together
    // (the same-group child drives), and no card of its own renders there.
    expect(
      document.querySelector('[data-column-id="working"] [data-thread-card="c"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-column-id="working"] [data-thread-card="c"]')?.closest('[data-nested-rows]'),
    ).not.toBeNull();
  });
});
