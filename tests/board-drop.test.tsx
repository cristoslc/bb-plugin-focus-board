// @vitest-environment jsdom
// Board-level cross-column drops: the Pinned lane must accept a card dropped
// onto it and report the dropped id, the same contract the Done and Unread
// lanes already honour — that is the whole unread → pinned drag gesture. The
// rank store must stay untouched: a pin drop is a state change, not a
// reorder, and must not write an order for a card the lane does not hold.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

/**
 * A dataTransfer the way the board uses it: write-only mid-drag (the board
 * reads `types` for the lane marker), readable at drop.
 */
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

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(threads: PluginSidebarThread[], overrides: Partial<BoardProps> = {}) {
  const merged = {
    doneIds: new Set<string>(),
    ...overrides,
  };
  const props = {
    columns: buildColumns(
      threads,
      "status",
      context,
      new Map(),
      merged.doneIds,
      NOW,
      {},
    ),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: merged.doneIds,
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    childCountByParent: new Map<string, number>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    rankStore: {},
    onRankMove: vi.fn(),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return { props, ...render(<Board {...props} />) };
}

/** The card's draggable anchor, by the card's own testid marker. */
function cardAnchor(fromId: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
  return anchor;
}

/**
 * A full drag onto a column section: dragstart on the card, then dragover and
 * drop on the column. `dropAllowed` mirrors what a real browser does in
 * `dragover`: the drop happens only when some handler called preventDefault.
 */
function dragFromCardToColumn(fromId: string, columnId: string) {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (section === null) throw new Error(`missing column ${columnId}`);
  const dt = makeDataTransfer();
  fireEvent.dragStart(cardAnchor(fromId), { dataTransfer: dt });
  const over = createEvent.dragOver(section, { dataTransfer: dt });
  fireEvent(section, over);
  const drop = createEvent.drop(section, { dataTransfer: dt });
  fireEvent(section, drop);
  return { dropAllowed: over.defaultPrevented };
}

afterEach(cleanup);

describe("Board cross-column drops to Pinned", () => {
  function boardFixture() {
    return [
      thread({ id: "thr_pinned_in", isPinned: true, updatedAt: NOW - 5000 }),
      thread({ id: "thr_bug", isUnread: true, updatedAt: NOW - 1000 }),
    ];
  }

  it("dropping an Unread card on the Pinned column pins it", () => {
    const { props } = renderBoard(boardFixture());
    const { dropAllowed } = dragFromCardToColumn("thr_bug", "pinned");
    expect(dropAllowed).toBe(true);
    expect(props.onDropPinned).toHaveBeenCalledWith("thr_bug");
  });

  it("dropping on the Pinned column writes no rank order", () => {
    const { props } = renderBoard(boardFixture());
    dragFromCardToColumn("thr_bug", "pinned");
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("dropping on a Pinned card pins too, without touching its lane order", () => {
    const { props } = renderBoard(
      boardFixture().concat([thread({ id: "thr_pinned_in2", isPinned: true, updatedAt: NOW - 2000 })]),
    );
    const slot = document.querySelector('[data-thread-card="thr_pinned_in2"]');
    if (slot === null) throw new Error("missing pinned card");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_bug"), { dataTransfer: dt });
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    fireEvent(slot, over);
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    fireEvent(slot, drop);
    expect(over.defaultPrevented).toBe(true);
    expect(props.onDropPinned).toHaveBeenCalledWith("thr_bug");
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("dragging a Pinned card onto the Unread column reaches the unread handler, not a reorder", () => {
    // The Pinned lane is a ranked lane, so the drag leaves the lane in the
    // drag TYPE name; the target column must not mistake it for a lane
    // drag — a pinned card dropped on Unread is a state change, whatever
    // order its source lane keeps.
    const { props } = renderBoard([
      thread({ id: "thr_pinned_in", isPinned: true, updatedAt: NOW - 5000 }),
      thread({ id: "thr_bug", isUnread: true, updatedAt: NOW - 1000 }),
    ]);
    const { dropAllowed } = dragFromCardToColumn("thr_pinned_in", "unread");
    expect(dropAllowed).toBe(true);
    expect(props.onDropUnread).toHaveBeenCalledWith("thr_pinned_in");
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("a drop on Done still marks done, unchanged by the new target", () => {
    const { props } = renderBoard(
      [
        thread({ id: "thr_old_done", updatedAt: NOW - 9000 }),
        thread({ id: "thr_bug", isUnread: true, updatedAt: NOW - 1000 }),
      ],
      { doneIds: new Set<string>(["thr_old_done"]) },
    );
    dragFromCardToColumn("thr_bug", "done");
    expect(props.onDropDone).toHaveBeenCalledWith("thr_bug");
    expect(props.onDropPinned).not.toHaveBeenCalled();
  });
});