// @vitest-environment jsdom
// The decided family-box design (thread storage: reports/feature-group-
// mockups.html) pinned on the Board seam: members render inside ONE dashed
// container li, whose label rides the container's top margin (inside the
// scrollport at any position — the first per-card fragment attempt
// truncated the label at the list's top edge, observed 2026-10-09). A group
// of one KEEPS its box — the solitary outline is the drag-into target, and
// a group hides only when its last candidate leaves.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { planGroupBoxes } from "../components/group-boxes";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

/** A jsdom-friendly DataTransfer: writable payload, readable types at dragover time. */
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

function renderBoard(
  threads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<string, { groupId: string; name: string }>,
  extra: Partial<BoardProps> = {},
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
    ...extra,
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

function renderProjectColumns(
  members: readonly PluginSidebarThread[],
  projectColumns: ReadonlyMap<string, { id: string; label: string }>,
  groupBoxOf: ReadonlyMap<string, { groupId: string; name: string }> = new Map(),
) {
  const context = {
    projects: [
      { id: "proj_a", name: "Alpha" },
      { id: "proj_b", name: "Beta" },
    ],
    providers: [],
  };
  const props = {
    groupBy: "project" as const,
    columns: buildColumns(
      members,
      "project",
      context,
      new Map(),
      new Set<string>(),
      NOW,
      {},
      projectColumns,
    ),
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

describe("the family box renders as one container around its members", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    [
      "thr_a",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
    [
      "thr_b",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
  ]);

  it("one frame per group per lane even when a card is interposed (the operator ruling)", () => {
    // Raw working order [a, x, b]: the rank contract makes the recency
    // walk interleave a non-member. The lane must render ONE grp_1 frame
    // holding BOTH members at the first member's slot; the interposer
    // renders after the frame. Two dashed frames of one group in one lane
    // is the bug this board shipped once (the screenshot on 2026-10-13).
    const interposedMembers = [
      thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
      thread({ id: "thr_x", status: "active", updatedAt: NOW - 2000 }),
      thread({ id: "thr_b", status: "active", updatedAt: NOW - 3000 }),
    ];
    const interposedBoxes = new Map([
      ["thr_a", { groupId: "grp_1", name: "Auth rework", members }],
      ["thr_b", { groupId: "grp_1", name: "Auth rework", members }],
    ]);
    renderBoard(interposedMembers, interposedBoxes);
    const frames = document.querySelectorAll('[data-group-box="grp_1"]');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(2);
    // The frame holds the member ids in the lane's own order, and the
    // interposed card renders after the frame among the plain slots.
    const membersInside = [...frames[0]!.querySelectorAll("[data-thread-card]")].map(
      (anchor) => anchor.getAttribute("data-thread-card"),
    );
    expect(membersInside).toEqual(["thr_a", "thr_b"]);
    const list = document.querySelector("ul")!;
    const childIds = [...list.children].map((li) =>
      li.getAttribute("data-group-box") !== null
        ? `box:${li.getAttribute("data-group-box")}`
        : li.querySelector("[data-thread-card]")?.getAttribute("data-thread-card"),
    );
    expect(childIds).toEqual(["box:grp_1", "thr_x"]);
  });

  it("ONE box li carries the member card slots inside", () => {
    renderBoard(members, boxes);
    const box = document.querySelector('[data-group-box="grp_1"]');
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(2);
    // Exactly one box container for the pair, holding exactly two slots.
    expect(document.querySelectorAll('[data-group-box="grp_1"]')).toHaveLength(1);
    for (const id of ["thr_a", "thr_b"]) {
      expect(box?.querySelector(`[data-rank-slot="${id}"]`)).not.toBeNull();
    }
  });

  it("the group's name is secondary text on the box container", () => {
    renderBoard(members, boxes);
    const label = document.querySelector('[data-group-box-label="grp_1"]');
    expect(label?.textContent).toBe("Auth rework");
  });

  it("a lone member keeps its box: one dashed container, its label, one card slot", () => {
    const solo = thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 });
    renderBoard(
      [solo],
      new Map([["thr_a", { groupId: "grp_1", name: "Auth rework", members: [solo] }]]),
    );
    // The solitary box is the drag-into target: the group stays visible (and
    // joinable) until its last member is gone.
    const box = document.querySelector('[data-group-box="grp_1"]');
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(1);
    expect(document.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe(
      "Auth rework",
    );
  });

  it("an unassigned card renders with no box decoration", () => {
    renderBoard(members, new Map());
    expect(document.querySelector('[data-group-box]')).toBeNull();
  });

  it("a member alone in its column (a split slice) keeps its frame there", () => {
    // Issue #86's split default: the group renders across lanes on purpose.
    // Two members, but only one of them is in any column of this board: the
    // lone slice still carries the dashed frame — the outline is the
    // drag-into target and the highlight carrier in every lane.
    renderBoard(
      [thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 })],
      boxes,
    );
    const box = document.querySelector('[data-group-box="grp_1"]');
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(1);
    expect(
      box?.querySelector('[data-group-box-label="grp_1"]')?.textContent,
    ).toBe("Auth rework");
  });

  it("the whole group's frame appears in every lane holding a member", () => {
    // thr_a (active → Working) and thr_b (idle → Idle · Recent): two lanes,
    // two framed slices, both carrying the group's name.
    renderBoard(
      [
        thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
        thread({ id: "thr_b", updatedAt: NOW - 2000 }),
      ],
      boxes,
    );
    const frames = document.querySelectorAll('[data-group-box="grp_1"]');
    expect(frames).toHaveLength(2);
    const labels = document.querySelectorAll('[data-group-box-label="grp_1"]');
    expect(labels).toHaveLength(2);
    for (const label of labels) expect(label.textContent).toBe("Auth rework");
    // Each frame holds the member rendering in ITS lane.
    const slots = document.querySelectorAll('[data-group-box-member="grp_1"]');
    expect(slots).toHaveLength(2);
  });
});

describe("group boxes render on the Project view (groupBy === 'project')", () => {
  // Issue #86's split default: no overrides — each member renders in its own
  // project column and the frame follows: TWO framed slices, one per lane,
  // both carrying the group's name.
  const members = [
    thread({ id: "thr_a", projectId: "proj_b", displayTitle: "Card A", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", projectId: "proj_a", displayTitle: "Card B", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    ["thr_a", { groupId: "grp_1", name: "Auth rework", members }],
    ["thr_b", { groupId: "grp_1", name: "Auth rework", members }],
  ]);

  it("each project lane frames its own slice of the split group", () => {
    renderProjectColumns(members, new Map(), boxes);
    const frames = document.querySelectorAll('[data-group-box="grp_1"]');
    expect(frames).toHaveLength(2);
    const alpha = document.querySelector('[data-column-id="proj_a"]');
    const beta = document.querySelector('[data-column-id="proj_b"]');
    expect(alpha?.querySelector('[data-group-box-member="grp_1"]')?.textContent).toContain("Card B");
    expect(beta?.querySelector('[data-group-box-member="grp_1"]')?.textContent).toContain("Card A");
    expect(
      alpha?.querySelector('[data-group-box-label="grp_1"]')?.textContent,
    ).toBe("Auth rework");
    expect(
      beta?.querySelector('[data-group-box-label="grp_1"]')?.textContent,
    ).toBe("Auth rework");
  });

  it("boxed member cards keep their run roles (first) in split project columns", () => {
    renderProjectColumns(members, new Map(), boxes);
    // A co-located pair is first/last; a split lane's lone slice carries
    // role "first" (the run's single member) in each lane here.
    const firsts = document.querySelectorAll('[data-group-box-first="grp_1"]');
    expect(firsts).toHaveLength(2);
    expect([...firsts].map((el) => el.textContent)).toEqual([
      expect.stringContaining("Card B"),
      expect.stringContaining("Card A"),
    ]);
    expect(document.querySelector('[data-group-box-last="grp_1"]')).toBeNull();
  });
});

describe("click-to-rename on the group box label", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    [
      "thr_a",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
    [
      "thr_b",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
  ]);

  function renderRenamableBoard(onRenameGroup: (groupId: string, name: string) => void) {
    const props = {
      groupBy: "status" as const,
      columns: buildColumns(members, "status", context, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map<number, never>(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf: boxes,
      onRenameGroup,
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

  it("clicking the label swaps it for a text input pre-filled with the current name", () => {
    renderRenamableBoard(vi.fn());
    const label = document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement;
    expect(label).not.toBeNull();
    fireEvent.click(label);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Auth rework");
  });

  it("Enter commits the new name through onRenameGroup and restores the label", () => {
    const onRenameGroup = vi.fn();
    renderRenamableBoard(onRenameGroup);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Auth v2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameGroup).toHaveBeenCalledTimes(1);
    expect(onRenameGroup).toHaveBeenCalledWith("grp_1", "Auth v2");
    // The label is back (still the old name — the caller's refetch settles it).
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
    expect(document.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe("Auth rework");
  });

  it("Enter commits a trimmed name; whitespace-only names do not commit", () => {
    const onRenameGroup = vi.fn();
    renderRenamableBoard(onRenameGroup);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    let input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameGroup).not.toHaveBeenCalled();
    // A blank commit leaves the editor OPEN (fix-up possible, nothing lost).
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).not.toBeNull();
    fireEvent.change(input, { target: { value: "  Search v2  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameGroup).toHaveBeenCalledWith("grp_1", "Search v2");
  });

  it("Escape cancels the edit and keeps the old label", () => {
    const onRenameGroup = vi.fn();
    renderRenamableBoard(onRenameGroup);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameGroup).not.toHaveBeenCalled();
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
    expect(document.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe("Auth rework");
  });
});

describe("delete from the label editor (arm → confirm)", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    ["thr_a", { groupId: "grp_1", name: "Auth rework", members }],
    ["thr_b", { groupId: "grp_1", name: "Auth rework", members }],
  ] as const);

  function renderEditor(onDeleteGroup: (groupId: string) => void, onRenameGroup = vi.fn()) {
    const props = {
      groupBy: "status" as const,
      columns: buildColumns(members, "status", context, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map<number, never>(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf: boxes,
      onRenameGroup,
      onDeleteGroup,
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
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
  }

  it("the editor hosts the ungroup control; the first click only arms it", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const trash = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    expect(trash).not.toBeNull();
    fireEvent.click(trash);
    expect(onDeleteGroup).not.toHaveBeenCalled();
    // The armed state is visible on the same control.
    expect(trash.getAttribute("data-armed")).toBe("true");
  });

  it("the second click deletes and closes the editor", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const trash = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    fireEvent.click(trash);
    fireEvent.click(trash);
    expect(onDeleteGroup).toHaveBeenCalledTimes(1);
    expect(onDeleteGroup).toHaveBeenCalledWith("grp_1");
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
  });

  it("the control reads Ungroup — threads stay — never a card delete", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const control = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    expect(control.textContent).toContain("Ungroup all members");
    fireEvent.click(control);
    expect(control.textContent).toContain("Ungroup");
    expect(control.textContent).not.toContain("Delete");
    expect(control.title).toContain("threads stay");
    expect(onDeleteGroup).not.toHaveBeenCalled();
  });

  it("Escape (or a re-opened edit) disarms; the armed control never deletes without a second click", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const trash = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    fireEvent.click(trash);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onDeleteGroup).not.toHaveBeenCalled();
    // Re-opening starts UNARMED again (no leaked armed state).
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    const fresh = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    expect(fresh.getAttribute("data-armed")).toBe("false");
  });
});

describe("drop-to-join: the box container takes a dragged card into the group", () => {
  const solo = thread({ id: "thr_solo", status: "active", updatedAt: NOW - 5000 });
  const other = thread({ id: "thr_free", status: "active", updatedAt: NOW - 1000 });
  const boxes = new Map([
    ["thr_solo", { groupId: "grp_1", name: "Auth rework", members: [solo] }],
  ]);

  function renderJoinableBoard(
    onJoinGroup: ((threadId: string, groupId: string) => void) | undefined,
  ) {
    const props = {
      groupBy: "status" as const,
      columns: buildColumns([solo, other], "status", context, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf: boxes,
      onJoinGroup,
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

  function dragFromCardToBox(fromId: string, groupId: string) {
    const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
    if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
    const box = document.querySelector(`[data-group-box="${groupId}"]`);
    if (!(box instanceof HTMLElement)) throw new Error(`missing box ${groupId}`);
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(box, { dataTransfer: dt });
    fireEvent(box, over);
    const drop = createEvent.drop(box, { dataTransfer: dt });
    fireEvent(box, drop);
    return over;
  }

  it("dragging an unassigned card over the box claims the drop (preventDefault)", () => {
    renderJoinableBoard(vi.fn());
    const anchor = document.querySelector('[data-thread-card="thr_free"] a[draggable]') as HTMLElement;
    const box = document.querySelector('[data-group-box="grp_1"]') as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(box, { dataTransfer: dt });
    fireEvent(box, over);
    expect(over.defaultPrevented).toBe(true);
  });

  it("the drop joins the group through onJoinGroup and clears the hover ring", () => {
    const onJoinGroup = vi.fn();
    renderJoinableBoard(onJoinGroup);
    dragFromCardToBox("thr_free", "grp_1");
    expect(onJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoinGroup).toHaveBeenCalledWith("thr_free", "grp_1");
  });

  it("dropping a card already in this group does not reassign it", () => {
    const onJoinGroup = vi.fn();
    renderJoinableBoard(onJoinGroup);
    dragFromCardToBox("thr_solo", "grp_1");
    expect(onJoinGroup).not.toHaveBeenCalled();
  });

  it("without onJoinGroup wired, a drop on the container does nothing (no crash)", () => {
    renderJoinableBoard(undefined);
    const anchor = document.querySelector('[data-thread-card="thr_free"] a[draggable]') as HTMLElement;
    const box = document.querySelector('[data-group-box="grp_1"]') as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(box, { dataTransfer: dt });
    expect(() => fireEvent(box, over)).not.toThrow();
    const drop = createEvent.drop(box, { dataTransfer: dt });
    expect(() => fireEvent(box, drop)).not.toThrow();
    // No join promise was ever shown, and no join write exists to fire.
    expect(document.querySelector("[data-group-box-join-hover]")).toBeNull();
  });
});

describe("drop-to-join reaches the member cards (a tall member used to hide the target)", () => {
  // The operator's repro: a parent family with children dragged onto a group
  // whose member is ANOTHER parent family with children. The member card plus
  // its nested child rows cover nearly the whole dashed outline, so a drop
  // that looks like it landed "on the box" actually landed on the member
  // card — which used to keep its own gestures and never offered the join.
  const parent = thread({
    id: "thr_family",
    status: "active",
    updatedAt: NOW - 5000,
    displayTitle: "Family parent",
  });
  const childA = thread({
    id: "thr_childA",
    status: "active",
    parentThreadId: "thr_family",
    updatedAt: NOW - 4000,
  });
  const childB = thread({
    id: "thr_childB",
    status: "active",
    parentThreadId: "thr_family",
    updatedAt: NOW - 3000,
  });
  const freeActive = thread({ id: "thr_free", status: "active", updatedAt: NOW - 1000 });
  const freeUnread = thread({ id: "thr_free", status: "unread", updatedAt: NOW - 1000 });
  const familyBoxes = new Map([
    ["thr_family", { groupId: "grp_1", name: "Ship it", members: [parent] }],
  ]);

  type Overrides = {
    onJoinGroup?: (threadId: string, groupId: string) => void;
    onReparent?: (childId: string, parentId: string | null) => Promise<void>;
  };

  function renderFamilyBoard(free: PluginSidebarThread, overrides: Overrides = {}) {
    const props = {
      groupBy: "status" as const,
      columns: buildColumns([parent, childA, childB, free], "status", context, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map([["thr_family", [childA, childB]]]),
      childCountByParent: new Map([["thr_family", 2]]),
      doneChildrenByParent: new Map(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf: familyBoxes,
      onJoinGroup: overrides.onJoinGroup,
      onReparent: overrides.onReparent,
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

  /** jsdom rects are 0×0; give the member slot a 300px-tall box so thirds are real. */
  function giveSlotRect(height = 300): void {
    const slot = document.querySelector('[data-rank-slot="thr_family"]') as HTMLElement | null;
    if (slot === null) throw new Error("missing member rank slot for thr_family");
    slot.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: height, width: 100, height }) as DOMRect;
  }

  /** Full drag over `target`: dragstart on the source anchor, then dragover at `clientY`. */
  function beginDrag(fromId: string, target: HTMLElement, at?: { clientY: number }) {
    const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
    if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(target, { dataTransfer: dt });
    if (at !== undefined) Object.defineProperty(over, "clientY", { value: at.clientY });
    fireEvent(target, over);
    return {
      over,
      hoverArmed: () => document.querySelector("[data-group-box-join-hover]") !== null,
      finishDrop() {
        const drop = createEvent.drop(target, { dataTransfer: dt });
        if (at !== undefined) Object.defineProperty(drop, "clientY", { value: at.clientY });
        fireEvent(target, drop);
        return drop;
      },
    };
  }

  function parentAnchor(): HTMLElement {
    const anchor = document.querySelector('[data-thread-card="thr_family"] a[draggable]');
    if (!(anchor instanceof HTMLElement)) throw new Error("missing draggable family parent card");
    return anchor;
  }

  it("a drop on the boxed member card itself joins the group", () => {
    const onJoinGroup = vi.fn();
    renderFamilyBoard(freeActive, { onJoinGroup });
    const drag = beginDrag("thr_free", parentAnchor());
    // The card's own dragover used to claim insertion; the ring only arms
    // when the join is the promise on screen.
    expect(drag.hoverArmed()).toBe(true);
    drag.finishDrop();
    expect(onJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoinGroup).toHaveBeenCalledWith("thr_free", "grp_1");
  });

  it("a drop on a nested child row of the boxed family joins too", () => {
    const onJoinGroup = vi.fn();
    renderFamilyBoard(freeActive, { onJoinGroup });
    // The row inside the family card, not the child's own top-level card.
    const childRow = document.querySelector('[data-nested-rows] a[data-thread-card="thr_childA"]');
    if (!(childRow instanceof HTMLElement)) throw new Error("missing nested child row thr_childA");
    const drag = beginDrag("thr_free", childRow);
    expect(drag.hoverArmed()).toBe(true);
    drag.finishDrop();
    expect(onJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoinGroup).toHaveBeenCalledWith("thr_free", "grp_1");
  });

  it("the member's middle third still nests — the nest zone wins over the join", () => {
    const onJoinGroup = vi.fn();
    const onReparent = vi.fn().mockResolvedValue(undefined);
    renderFamilyBoard(freeActive, { onJoinGroup, onReparent });
    giveSlotRect(300);
    const drag = beginDrag("thr_free", parentAnchor(), { clientY: 150 });
    expect(drag.hoverArmed()).toBe(false);
    drag.finishDrop();
    expect(onReparent).toHaveBeenCalledWith("thr_free", "thr_family");
    expect(onJoinGroup).not.toHaveBeenCalled();
  });

  it("a cross-lane drop on the member card in a state-neutral lane never joins", () => {
    // The working column has no state-change drop target, and cross-lane
    // drags keep the member's own gesture contract rather than bubbling a
    // deferred join: the box's ring stays dark, no group write happens.
    const onJoinGroup = vi.fn();
    renderFamilyBoard(freeUnread, { onJoinGroup });
    const drag = beginDrag("thr_free", parentAnchor());
    expect(drag.hoverArmed()).toBe(false);
    drag.finishDrop();
    expect(onJoinGroup).not.toHaveBeenCalled();
  });

  it("a cross-lane hover on the box's own surface arms the join (a drop from another column joins)", () => {
    const onJoinGroup = vi.fn();
    renderFamilyBoard(freeUnread, { onJoinGroup });
    const box = document.querySelector('[data-group-box="grp_1"]') as HTMLElement;
    const drag = beginDrag("thr_free", box);
    // The lane gate used to refuse cross-column drags here: no permission,
    // no ring, and the browser never fires the drop at all.
    expect(drag.over.defaultPrevented).toBe(true);
    expect(drag.hoverArmed()).toBe(true);
    drag.finishDrop();
    expect(onJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoinGroup).toHaveBeenCalledWith("thr_free", "grp_1");
  });

  it("without onJoinGroup wired, a drop on the member card does nothing (no crash)", () => {
    renderFamilyBoard(freeActive, {});
    const drag = beginDrag("thr_free", parentAnchor());
    expect(drag.hoverArmed()).toBe(false);
    expect(() => drag.finishDrop()).not.toThrow();
  });
});
describe("the amber group highlight (issue #86)", () => {
  // A split group renders a frame per lane; clicking a member card or the
  // frame's own surface marks the GROUP, and every lane's frame of it reads
  // amber at once — the whole footprint in one gesture. A click anywhere
  // that is not a group frame clears it.
  const memberA = thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000, displayTitle: "Card A" });
  const memberB = thread({ id: "thr_b", updatedAt: NOW - 2000, displayTitle: "Card B" }); // idle
  const free = thread({ id: "thr_free", status: "active", updatedAt: NOW - 5000, displayTitle: "Free" });
  const members = [memberA, memberB];
  const boxes = new Map([
    ["thr_a", { groupId: "grp_1", name: "Auth rework", members }],
    ["thr_b", { groupId: "grp_1", name: "Auth rework", members }],
  ]);

  function renderHighlightBoard(
    highlightedGroupId: string | null,
    onHighlightGroup: (groupId: string | null) => void,
  ) {
    renderBoard([memberA, memberB, free], boxes, {
      highlightedGroupId,
      onHighlightGroup,
      onClosePane: () => {},
    });
  }

  it("clicking a member card marks the group: every lane's frame carries the highlight", () => {
    const onHighlightGroup = vi.fn();
    renderHighlightBoard("grp_1", onHighlightGroup);
    const card = document.querySelector('[data-thread-card="thr_b"] a[draggable]') as HTMLElement;
    fireEvent.click(card);
    expect(onHighlightGroup).toHaveBeenCalledWith("grp_1");
    // Both frames (Working and Idle · Recent) render amber.
    const frames = document.querySelectorAll("[data-group-box-highlight]");
    expect(frames).toHaveLength(2);
  });

  it("clicking the frame's own surface toggles the highlight", () => {
    const set = vi.fn();
    const props = {
      groupBy: "status" as const,
      columns: buildColumns([memberA, memberB, free], "status", context, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map<number, never>(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf: boxes,
      highlightedGroupId: "grp_1",
      onHighlightGroup: (groupId: string | null) => {
        set(groupId);
      },
      onClosePane: () => {},
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
    // The dashed container itself (the padding around the member list), not
    // the outer li — the handler lives on the frame surface.
    const surface = document.querySelector('[data-group-box="grp_1"] > div') as HTMLElement;
    fireEvent.click(surface);
    expect(set).toHaveBeenCalledWith(null); // already highlighted → toggles off
  });

  it("clicking a card outside any frame clears the highlight", () => {
    const onHighlightGroup = vi.fn();
    renderHighlightBoard("grp_1", onHighlightGroup);
    const card = document.querySelector('[data-thread-card="thr_free"] a[draggable]') as HTMLElement;
    fireEvent.click(card);
    expect(onHighlightGroup).toHaveBeenCalledWith(null);
  });

  it("a highlighted frame also carries its label in amber, and an unwired board never highlights", () => {
    renderBoard([memberA, memberB], boxes, {
      highlightedGroupId: "grp_1",
      onHighlightGroup: undefined,
    });
    for (const frame of document.querySelectorAll('[data-group-box="grp_1"]')) {
      expect(frame.querySelector("[data-group-box-label]")?.className).toContain("text-amber-600");
    }
  });
});

describe("the Pinned lane frames its group slice (operator ruling 2026-10-30)", () => {
  // The operator's repro: thread thr_dh96xx4b5f ("Hattrick Development",
  // pinned) is the SOLE member of group "HatTrick", and its group's dashed
  // frame rendered NOWHERE. The plan dropped pinned members from candidacy,
  // so a group of one pinned member had no candidate and no box. The Pinned
  // lane is a lane like any other: its slice of a group renders framed, the
  // frame re-gathers on reorder, and it stays the drag-into target.
  const NAMES = new Map([["grp_1", "HatTrick"]]);

  const planFor = (members: readonly PluginSidebarThread[], assignments: Record<string, string>) =>
    planGroupBoxes(
      members,
      new Map(Object.entries(assignments)),
      NAMES,
      "status",
      context,
      new Set<string>(),
      NOW,
    );

  function renderPinnedBoard(
    members: readonly PluginSidebarThread[],
    assignments: Record<string, string>,
    extra: Partial<BoardProps> = {},
    ranks: Record<string, readonly string[]> = {},
  ) {
    const plan = planFor(members, assignments);
    const props = {
      groupBy: "status" as const,
      columns: buildColumns(members, "status", context, new Map(), new Set<string>(), NOW, ranks),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map<number, never>(),
      dimmedIds: new Set<string>(),
      rankStore: ranks,
      onRankMove: vi.fn(),
      groupBoxOf: plan.groupBoxOf,
      projectNameFor: () => "",
      repoBaseFor: () => null,
      onOpenThread: () => {},
      onNewTask: () => {},
      onDropDone: () => {},
      onDropUnread: () => {},
      onDropPinned: vi.fn(),
      menuActionsFor: () => [],
      ...extra,
    } as unknown as BoardProps;
    render(<Board {...props} />);
    return props;
  }

  const pinnedLaneFrames = (groupId: string) =>
    document.querySelectorAll(`[data-column-id="pinned"] [data-group-box="${groupId}"]`);

  it("a group whose only member is pinned renders its frame in the Pinned lane", () => {
    const pinnedOnly = thread({ id: "thr_pin", isPinned: true, updatedAt: NOW - 1000 });
    renderPinnedBoard(
      [pinnedOnly, thread({ id: "thr_free", status: "active", updatedAt: NOW - 2000 })],
      { thr_pin: "grp_1" },
    );
    const frames = pinnedLaneFrames("grp_1");
    expect(frames).toHaveLength(1);
    // The frame is the group's: its name rides the label, its lone member
    // sits inside as a real card slot.
    expect(frames[0]!.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe(
      "HatTrick",
    );
    expect(frames[0]!.querySelector('[data-thread-card="thr_pin"]')).not.toBeNull();
    expect(frames[0]!.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(1);
    // One frame on the whole board, and the unassigned card carries none.
    expect(document.querySelectorAll('[data-group-box="grp_1"]')).toHaveLength(1);
  });

  it("a pinned slice gathers into ONE frame and re-gathers on reorder, never duplicating it", () => {
    const pinnedThreads = [
      thread({ id: "thr_a", isPinned: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_x", isPinned: true, updatedAt: NOW - 2000 }),
      thread({ id: "thr_b", isPinned: true, updatedAt: NOW - 3000 }),
    ];
    const assignments = { thr_a: "grp_1", thr_b: "grp_1" };
    renderPinnedBoard(pinnedThreads, assignments, {}, {
      pinned: ["thr_a", "thr_x", "thr_b"],
    });
    const memberIdsIn = (frame: Element) =>
      [...frame.querySelectorAll("[data-thread-card]")].map((card) =>
        card.getAttribute("data-thread-card"),
      );
    expect(pinnedLaneFrames("grp_1")).toHaveLength(1);
    expect(memberIdsIn(pinnedLaneFrames("grp_1")[0]!)).toEqual(["thr_a", "thr_b"]);

    cleanup();
    renderPinnedBoard(pinnedThreads, assignments, {}, {
      pinned: ["thr_x", "thr_b", "thr_a"],
    });
    // Still exactly one frame, now holding the reordered slice in the lane's
    // own order — the frame moved, it did not fork.
    expect(pinnedLaneFrames("grp_1")).toHaveLength(1);
    expect(memberIdsIn(pinnedLaneFrames("grp_1")[0]!)).toEqual(["thr_b", "thr_a"]);
  });

  it("a multi-member pinned run drags as ONE unit under the pinned rank key", () => {
    const pinnedThreads = [
      thread({ id: "thr_a", isPinned: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_x", isPinned: true, updatedAt: NOW - 2000 }),
      thread({ id: "thr_b", isPinned: true, updatedAt: NOW - 3000 }),
    ];
    // The pinned reorder write is the generic rank_move ("pinned" key) and
    // it carries unit ids like any lane's, so the run moves as a unit here.
    const props = renderPinnedBoard(
      pinnedThreads,
      { thr_a: "grp_1", thr_b: "grp_1" },
      {},
      { pinned: ["thr_a", "thr_x", "thr_b"] },
    );
    const anchor = document.querySelector(
      '[data-thread-card="thr_a"] a[draggable]',
    ) as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    // The lane renders the frame's slice [a, b] first, the plain pinned card
    // after it; the run's head lands below that card.
    const slot = document.querySelector('[data-rank-slot="thr_x"]') as HTMLElement;
    slot.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: 300, width: 100, height: 300 }) as DOMRect;
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    Object.defineProperty(over, "clientY", { value: 290 });
    fireEvent(slot, over);
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    Object.defineProperty(drop, "clientY", { value: 290 });
    fireEvent(slot, drop);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "pinned",
      "thr_a",
      null,
      true,
      ["thr_a", "thr_b", "thr_x"],
      ["thr_a", "thr_b"],
    );
  });

  it("dropping a free card on the pinned frame joins the group, not the pin", () => {
    const onJoinGroup = vi.fn();
    const props = renderPinnedBoard(
      [
        thread({ id: "thr_pin", isPinned: true, updatedAt: NOW - 1000 }),
        thread({ id: "thr_free", status: "active", updatedAt: NOW - 2000 }),
      ],
      { thr_pin: "grp_1" },
      { onJoinGroup },
    );
    const anchor = document.querySelector(
      '[data-thread-card="thr_free"] a[draggable]',
    ) as HTMLElement;
    const frame = pinnedLaneFrames("grp_1")[0] as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(frame, { dataTransfer: dt });
    fireEvent(frame, over);
    expect(over.defaultPrevented).toBe(true);
    const drop = createEvent.drop(frame, { dataTransfer: dt });
    fireEvent(frame, drop);
    // The join claims the drop, so the column's own pin write stays out of it.
    expect(onJoinGroup).toHaveBeenCalledWith("thr_free", "grp_1");
    expect(props.onDropPinned).not.toHaveBeenCalled();
  });
});
