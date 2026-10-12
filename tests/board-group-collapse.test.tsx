// @vitest-environment jsdom
// A feature-group box's collapse: the dashed family box folds into ONE
// normal-size card that names the group and its member count, keeps a dashed
// ring (never reads as a real thread card or a parent thread card), and
// expands back on the card's own toggle, a label-row chevron, or the box
// menu's entry. The collapsed card keeps the box's gestures: it drags as the
// whole unit (lead payload) and accepts drop-to-join. State is the caller's
// (collapsedGroupIds); wiring is components/board.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { DRAG_ID_KEY } from "../lib/rank";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function makeDataTransfer() {
  const payload = new Map<string, string>();
  const types: string[] = [];
  return {
    get types() {
      return [...types];
    },
    setData(type: string, value: string) {
      if (!types.includes(type)) types.push(type);
      payload.set(type, value);
    },
    getData(type: string) {
      return payload.get(type) ?? "";
    },
    effectAllowed: "move",
    dropEffect: "none",
  };
}

interface CollapseHarnessOptions {
  collapsedIds?: ReadonlySet<string>;
}

function renderBoard(
  threads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<
    string,
    { groupId: string; name: string; members: readonly PluginSidebarThread[] }
  >,
  wired: {
    onGroupCollapsedChange?: (groupId: string, collapsed: boolean) => void;
    onJoinGroup?: (droppedId: string, groupId: string) => void;
    onRenameGroup?: (groupId: string, name: string) => void;
  } = {},
  options: CollapseHarnessOptions = {},
) {
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<string, number>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf,
    onJoinGroup: wired.onJoinGroup,
    onRenameGroup: wired.onRenameGroup,
    collapsedGroupIds: options.collapsedIds ?? new Set<string>(),
    onGroupCollapsedChange: wired.onGroupCollapsedChange,
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

function collapsedCard(): HTMLElement {
  const el = document.querySelector('[data-collapsed-group="grp_auth"]');
  if (!(el instanceof HTMLElement)) throw new Error("missing collapsed group card");
  return el;
}

describe("a collapsed group box renders one normal-size card", () => {
  it("renders ONE dashed card naming the group and member count, hiding the member cards", () => {
    renderBoard(members, groupBoxOf, { onGroupCollapsedChange: () => {} }, {
      collapsedIds: new Set(["grp_auth"]),
    });
    const card = collapsedCard();
    expect(document.querySelectorAll('[data-collapsed-group="grp_auth"]')).toHaveLength(1);
    // The box container and every member card slot are gone.
    expect(document.querySelector('[data-group-box="grp_auth"]')).toBeNull();
    expect(document.querySelector('[data-thread-card="thr_a"]')).toBeNull();
    expect(document.querySelector('[data-thread-card="thr_b"]')).toBeNull();
    const inner = card.querySelector('[data-collapsed-group-card="grp_auth"]');
    if (!(inner instanceof HTMLElement)) throw new Error("missing collapsed card body");
    // Normal card size, visually distinguished: the dashed ring the box
    // vocabulary already carries, a real card never has.
    expect(inner.className).toContain("border-dashed");
    expect(inner.className).toContain("rounded-md");
    expect(inner.className).toContain("bg-card");
    // The card's content names the group and the members.
    expect(card.textContent).toContain("Auth rework");
    expect(card.textContent).toContain("2 threads");
    // One status dot per member, in the same strip the family fold uses.
    expect(card.querySelectorAll("[data-collapsed-group-dot]")).toHaveLength(2);
  });

  it("the collapsed card's toggle and its dot strip both expand the group", () => {
    const onGroupCollapsedChange = vi.fn();
    renderBoard(members, groupBoxOf, { onGroupCollapsedChange }, {
      collapsedIds: new Set(["grp_auth"]),
    });
    fireEvent.click(document.querySelector('[data-collapsed-group-toggle="grp_auth"]') as HTMLElement);
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
    // The dot strip answers the same gesture.
    const card = collapsedCard();
    fireEvent.click(card.querySelector("[data-collapsed-group-dots]") as HTMLElement);
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
  });

  it("the collapsed card stays draggable with the lead member's payload", () => {
    renderBoard(members, groupBoxOf, { onGroupCollapsedChange: () => {} }, {
      collapsedIds: new Set(["grp_auth"]),
    });
    const dt = makeDataTransfer();
    const start = createEvent.dragStart(collapsedCard(), { dataTransfer: dt });
    fireEvent(collapsedCard(), start);
    expect(start.defaultPrevented).toBe(false);
    expect(dt.getData(DRAG_ID_KEY)).toBe("thr_a");
  });

  it("drop-to-join still works against the collapsed card", () => {
    const onJoinGroup = vi.fn();
    const unassigned: readonly PluginSidebarThread[] = [
      ...members,
      thread({ id: "thr_c", displayTitle: "Loner", status: "active", updatedAt: NOW - 500 }),
    ];
    renderBoard(
      unassigned,
      groupBoxOf,
      { onGroupCollapsedChange: () => {}, onJoinGroup },
      { collapsedIds: new Set(["grp_auth"]) },
    );
    const dt = makeDataTransfer();
    const loner = document.querySelector('[data-thread-card="thr_c"] a[draggable]');
    if (!(loner instanceof HTMLElement)) throw new Error("missing draggable loner");
    fireEvent.dragStart(loner, { dataTransfer: dt });
    const over = createEvent.dragOver(collapsedCard(), { dataTransfer: dt });
    fireEvent(collapsedCard(), over);
    expect(
      document.querySelector("[data-collapsed-group-join-hover]"),
    ).not.toBeNull();
    fireEvent(collapsedCard(), createEvent.drop(collapsedCard(), { dataTransfer: dt }));
    expect(onJoinGroup).toHaveBeenCalledWith("thr_c", "grp_auth");
  });

  it("the collapsed card's context menu still opens the group's actions, with Expand group", () => {
    const onGroupCollapsedChange = vi.fn();
    renderBoard(
      members,
      groupBoxOf,
      { onGroupCollapsedChange, onRenameGroup: () => {} },
      { collapsedIds: new Set(["grp_auth"]) },
    );
    fireEvent.contextMenu(collapsedCard());
    const menu = screen.queryAllByRole("menu");
    expect(menu).toHaveLength(1);
    expect(menu[0].textContent ?? "").toContain("Expand group");
    expect(menu[0].textContent ?? "").not.toContain("Collapse group");
    fireEvent.click(screen.getByText("Expand group"));
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
  });
});

describe("the expanded box's collapse affordances", () => {
  it("without collapse wiring the box renders as before — no folded card, no chevron, no menu entry", () => {
    renderBoard(members, groupBoxOf, {});
    expect(document.querySelector('[data-collapsed-group]')).toBeNull();
    expect(document.querySelector('[data-group-box="grp_auth"]')).not.toBeNull();
    expect(document.querySelector('[data-group-box-collapse]')).toBeNull();
  });

  it("the label row carries a chevron that collapses the box", () => {
    const onGroupCollapsedChange = vi.fn();
    renderBoard(members, groupBoxOf, { onGroupCollapsedChange });
    const chevron = document.querySelector(
      '[data-group-box-collapse="grp_auth"]',
    ) as HTMLElement;
    expect(chevron).not.toBeNull();
    fireEvent.click(chevron);
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", true);
  });

  it("the box menu offers Collapse group and reports the collapse", () => {
    const onGroupCollapsedChange = vi.fn();
    renderBoard(members, groupBoxOf, { onGroupCollapsedChange });
    fireEvent.contextMenu(document.querySelector('[data-group-box="grp_auth"]') as HTMLElement);
    const menu = screen.queryAllByRole("menu");
    expect(menu).toHaveLength(1);
    expect(menu[0].textContent ?? "").toContain("Collapse group");
    fireEvent.click(screen.getByText("Collapse group"));
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", true);
  });

  it("renaming a collapsed group renders the box expanded with the editor open", () => {
    renderBoard(
      members,
      groupBoxOf,
      { onGroupCollapsedChange: () => {}, onRenameGroup: () => {} },
      { collapsedIds: new Set(["grp_auth"]) },
    );
    // Right-click the folded card, rename through the menu.
    fireEvent.contextMenu(collapsedCard());
    fireEvent.click(screen.getByText("Rename group…"));
    // The fold suppresses while the editor is open: the box is back, editor in.
    expect(document.querySelector('[data-collapsed-group]')).toBeNull();
    expect(screen.getByLabelText("Rename group, was Auth rework")).toBeTruthy();
  });
});