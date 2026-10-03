// @vitest-environment jsdom
// Board-level cross-column drops. The Pinned lane must accept a card dropped
// onto it and report the dropped id, the same contract the Done and Unread
// lanes already honour — that is the whole unread → pinned drag gesture.
//
// A cross-lane drop ON a CARD is positioned: the state change and the rank
// write happen in the same drop (the insertion line shows while hovering),
// so the operator places the card in the new column without a second drag.
// A drop on the COLUMN's empty space stays a bare state change: no rank is
// written, and the lane keeps whatever default order it had.
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
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
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

  it("dropping on the Pinned column's empty space writes no rank order", () => {
    const { props } = renderBoard(boardFixture());
    dragFromCardToColumn("thr_bug", "pinned");
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("dropping ON a Pinned card pins AND ranks at that edge, one gesture", () => {
    const { props } = renderBoard(
      boardFixture().concat([thread({ id: "thr_pinned_in2", isPinned: true, updatedAt: NOW - 2000 })]),
    );
    const slot = document.querySelector('[data-thread-card="thr_pinned_in2"]');
    if (!(slot instanceof HTMLElement)) throw new Error("missing pinned card");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_bug"), { dataTransfer: dt });
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    fireEvent(slot, over);
    // The insertion line shows during the hover (jsdom's clientY lands in
    // the bottom half, so the line renders on the "after" edge). The line
    // lives on the list-item slot around the card.
    const slotLi = slot.closest("li");
    if (!(slotLi instanceof HTMLElement)) throw new Error("missing slot");
    expect(over.defaultPrevented).toBe(true);
    expect(slotLi.className).toContain("after:bg-ring");
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    fireEvent(slot, drop);
    expect(props.onDropPinned).toHaveBeenCalledWith("thr_bug");
    // The pinned lane ranks are grouping-independent (key "pinned"); the
    // dragged card lands below the hovered one, anchored on the card after
    // it, and the move is reported against the lane's displayed order
    // (thr_pinned_in2 is newer, so the display order puts it first).
    expect(props.onRankMove).toHaveBeenCalledWith(
      "pinned",
      "thr_bug",
      "thr_pinned_in",
      false,
      ["thr_pinned_in2", "thr_pinned_in"],
    );
  });

  it("the cross-lane drop claims its event: the column handler fires once", () => {
    const { props } = renderBoard(boardFixture());
    const slot = document.querySelector('[data-thread-card="thr_pinned_in"]');
    if (!(slot instanceof HTMLElement)) throw new Error("missing pinned card");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_bug"), { dataTransfer: dt });
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    fireEvent(slot, over);
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    fireEvent(slot, drop);
    expect(props.onDropPinned).toHaveBeenCalledTimes(1);
    expect(over.defaultPrevented).toBe(true);
  });

  it("a positioned drop on a Done card marks done AND ranks there too", () => {
    const { props } = renderBoard(
      [
        thread({ id: "thr_old_done", updatedAt: NOW - 9000 }),
        thread({ id: "thr_bug", isUnread: true, updatedAt: NOW - 1000 }),
      ],
      { doneIds: new Set<string>(["thr_old_done"]) },
    );
    const slot = document.querySelector('[data-thread-card="thr_old_done"]');
    if (!(slot instanceof HTMLElement)) throw new Error("missing done card");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_bug"), { dataTransfer: dt });
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    fireEvent(slot, over);
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    fireEvent(slot, drop);
    expect(props.onDropDone).toHaveBeenCalledWith("thr_bug");
    // Last card in the lane, bottom half: nothing below to anchor on, so the
    // drop appends below it.
    expect(props.onRankMove).toHaveBeenCalledWith(
      "done",
      "thr_bug",
      null,
      true,
      ["thr_old_done"],
    );
  });

  it("a cross-lane drop on a derived column's card is still refused", () => {
    const { props } = renderBoard([
      thread({ id: "thr_work", status: "active", runtimeStatus: "active", updatedAt: NOW - 3000 }),
      thread({ id: "thr_bug", isUnread: true, updatedAt: NOW - 1000 }),
    ]);
    const slot = document.querySelector('[data-thread-card="thr_work"]');
    if (!(slot instanceof HTMLElement)) throw new Error("missing working card");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_bug"), { dataTransfer: dt });
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    fireEvent(slot, over);
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    fireEvent(slot, drop);
    // Membership in a derived column is the thread's data, not a slot the
    // board can honour — no drop, no rank write, no state change.
    expect(over.defaultPrevented).toBe(false);
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(props.onDropDone).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
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