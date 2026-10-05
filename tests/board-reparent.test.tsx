// @vitest-environment jsdom
// Drop ONTO a card nests the dropped thread as a child of the target card.
// The middle third of a card is the nest zone; the top and bottom thirds keep
// the insertion-line reorder the board always had, so every pre-nesting
// gesture stays put. The zone renders as a ring around the card instead of a
// line, and a gesture the guard refuses (a card onto its own child, a card
// onto itself) says so in the refusal banner.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

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
    statusFor: undefined,
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

function cardAnchor(fromId: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
  return anchor;
}

/** The ranked slot element a card renders inside — zone math and rings live here. */
function cardSlot(id: string): HTMLElement {
  const slot = document.querySelector(`[data-rank-slot="${id}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing rank slot ${id}`);
  return slot;
}

/** jsdom rects are 0×0; give the slot a 300px-tall box so thirds are real. */
function withRect(slot: HTMLElement, height = 300): void {
  slot.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 100, bottom: height, width: 100, height }) as DOMRect;
}

/**
 * The full drag: dragstart on the source card's anchor, then dragover and
 * drop on the target slot at `clientY`. jsdom does not apply `clientY` to
 * drag events (it stays undefined even when passed), so the property is
 * forced onto each created event. Returns whether some handler
 * preventDefault'ed the dragover (the browser's drop permission).
 */
function dragOnto(fromId: string, targetId: string, clientY: number) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(cardAnchor(fromId), { dataTransfer: dt });
  const slot = cardSlot(targetId);
  withRect(slot);
  const over = createEvent.dragOver(slot, { dataTransfer: dt });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(slot, over);
  const drop = createEvent.drop(slot, { dataTransfer: dt });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(slot, drop);
  return { dropAllowed: over.defaultPrevented };
}

afterEach(cleanup);

function twoCardFixture(): PluginSidebarThread[] {
  return [
    thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 5000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 1000 }),
  ];
}

describe("drop onto a card to nest it", () => {
  it("the middle third nests the dropped card under the target", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map(),
    });
    const { dropAllowed } = dragOnto("thr_a", "thr_b", 150);
    expect(dropAllowed).toBe(true);
    expect(onReparent).toHaveBeenCalledWith("thr_a", "thr_b");
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(props.onDropDone).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
    expect(props.onDropUnread).not.toHaveBeenCalled();
  });

  it("the top third keeps the insertion-line reorder", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map(),
    });
    const { dropAllowed } = dragOnto("thr_a", "thr_b", 10);
    expect(dropAllowed).toBe(true);
    expect(onReparent).not.toHaveBeenCalled();
    expect(props.onRankMove).toHaveBeenCalled();
  });

  it("the bottom third keeps the insertion-line reorder", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map(),
    });
    dragOnto("thr_a", "thr_b", 290);
    expect(onReparent).not.toHaveBeenCalled();
    expect(props.onRankMove).toHaveBeenCalled();
  });

  it("hovering the nest zone rings the card amber, not the lane color", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    renderBoard(twoCardFixture(), { onReparent, rawParentOf: new Map() });
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    const slot = cardSlot("thr_b");
    withRect(slot);
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    Object.defineProperty(over, "clientY", { value: 150 });
    fireEvent(slot, over);
    expect(slot.className).toMatch(/after:ring-2/);
    // Amber marks the family write; the lane affordance keeps the theme's
    // ring color, so the two reads are distinguishable at a glance.
    expect(slot.className).toMatch(/after:ring-amber-500/);
    expect(slot.className).toMatch(/after:bg-amber-500\/10/);
    expect(slot.className).not.toMatch(/after:ring-ring/);
    expect(slot.className).not.toMatch(/after:inset-x-0/);
  });

  it("dropping a card onto its own child falls back to a reorder", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map([["thr_b", "thr_a"]]),
    });
    // thr_a dropped onto thr_b (its own child) would close a loop. The nest
    // is never offered — the drop reads as the edge reorder the cursor's
    // position implies, so indicator and action agree and nothing eats
    // silently.
    const { dropAllowed } = dragOnto("thr_a", "thr_b", 150);
    expect(dropAllowed).toBe(true);
    expect(onReparent).not.toHaveBeenCalled();
    expect(props.onRankMove).toHaveBeenCalled();
  });

  it("hovering a refused nest target falls back to the edge zones", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map([["thr_b", "thr_a"]]),
    });
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    const slot = cardSlot("thr_b");
    withRect(slot);
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    Object.defineProperty(over, "clientY", { value: 150 });
    fireEvent(slot, over);
    expect(slot.className).toMatch(/after:absolute|before:absolute/);
    expect(slot.className).not.toMatch(/after:ring-2/);
  });

  it("a card dropped onto itself is never a nest", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map(),
    });
    dragOnto("thr_a", "thr_a", 150);
    expect(onReparent).not.toHaveBeenCalled();
  });

  it("a cross-lane drop onto the middle nests without a state change", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const threads = [
      thread({ id: "thr_bug", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_pinned", isPinned: true, updatedAt: NOW - 500 }),
    ];
    const { props } = renderBoard(threads, {
      onReparent,
      rawParentOf: new Map(),
    });
    const { dropAllowed } = dragOnto("thr_bug", "thr_pinned", 150);
    expect(dropAllowed).toBe(true);
    expect(onReparent).toHaveBeenCalledWith("thr_bug", "thr_pinned");
    expect(props.onDropPinned).not.toHaveBeenCalled();
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("a rejected re-parent write reports the error", async () => {
    const onReparent = vi.fn().mockRejectedValue(new Error("the host refused"));
    renderBoard(twoCardFixture(), {
      onReparent,
      rawParentOf: new Map(),
    });
    dragOnto("thr_a", "thr_b", 150);
    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/the host refused/);
    });
  });

  it("without onReparent the middle stays an edge (the board before nesting)", () => {
    const { props } = renderBoard(twoCardFixture());
    const { dropAllowed } = dragOnto("thr_a", "thr_b", 150);
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalled();
  });
});
function familyFixture(): PluginSidebarThread[] {
  return [
    thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 5000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 1000 }),
  ];
}
const [childThread, parentThread] = familyFixture();

function nestedRowAnchor(childId: string): HTMLElement {
  const anchor = document.querySelector(
    `[data-nested-rows] a[data-thread-card="${childId}"]`,
  );
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing nested row ${childId}`);
  return anchor;
}

describe("drag a child off its family: the column floor detaches", () => {
  // thr_b renders as the only top-level slot; thr_a lives as its nested row.

  function renderFamily(onReparent: unknown = vi.fn().mockResolvedValue(undefined)) {
    return renderBoard([parentThread], {
      nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
        ["thr_b", [childThread]],
      ]),
      rawParentOf: new Map<string, string>([["thr_a", "thr_b"]]),
      onReparent,
    }) as { props: BoardProps };
  }

  /** dragstart on the child row, dragover and drop on the column section itself. */
  function dragToFloor(fromId: string, columnId: string, viaAnchor?: HTMLElement) {
    const dt = makeDataTransfer();
    fireEvent.dragStart(viaAnchor ?? nestedRowAnchor(fromId), { dataTransfer: dt });
    const section = document.querySelector(`section[data-column-id="${columnId}"]`);
    if (!(section instanceof HTMLElement)) throw new Error(`missing column ${columnId}`);
    const over = createEvent.dragOver(section, { dataTransfer: dt });
    fireEvent(section, over);
    const drop = createEvent.drop(section, { dataTransfer: dt });
    fireEvent(section, drop);
    return { dropAllowed: over.defaultPrevented };
  }

  it("a nested child row is draggable and rides its lane's type", () => {
    renderFamily();
    const dt = makeDataTransfer();
    fireEvent.dragStart(nestedRowAnchor("thr_a"), { dataTransfer: dt });
    expect(dt.types).toContain("text/focus-board-id");
    expect(dt.types).toContain("application/x-focus-board-rank:status:unread");
  });

  it("releasing a child on its own lane's floor un-nests it and makes no rank move", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderFamily(onReparent);
    const { dropAllowed } = dragToFloor("thr_a", "unread");
    // The child was never a visible slot in this lane, so there is no rank
    // to move: the detach IS the write.
    expect(dropAllowed).toBe(true);
    expect(onReparent).toHaveBeenCalledWith("thr_a", null);
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("a child dropped on the Done floor detaches and marks done in one gesture", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const doneFiller = thread({ id: "thr_old_done", updatedAt: NOW - 9000 });
    const { props } = renderBoard([parentThread, doneFiller], {
      doneIds: new Set<string>(["thr_old_done"]),
      nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
        ["thr_b", [childThread]],
      ]),
      rawParentOf: new Map<string, string>([["thr_a", "thr_b"]]),
      onReparent,
    });
    const section = document.querySelector('section[data-column-id="done"]');
    if (!(section instanceof HTMLElement)) throw new Error("missing done column");
    const dt = makeDataTransfer();
    fireEvent.dragStart(nestedRowAnchor("thr_a"), { dataTransfer: dt });
    const over = createEvent.dragOver(section, { dataTransfer: dt });
    fireEvent(section, over);
    const drop = createEvent.drop(section, { dataTransfer: dt });
    fireEvent(section, drop);
    expect(over.defaultPrevented).toBe(true);
    expect(props.onDropDone).toHaveBeenCalledWith("thr_a");
    expect(onReparent).toHaveBeenCalledWith("thr_a", null);
  });

  it("a child dropped on a non-lane column's floor detaches with no lane write", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderBoard([parentThread], {
      groupBy: "project" as const,
      columns: buildColumns([parentThread], "project", context as never, new Map(), new Set<string>(), NOW, {}),
      nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
        ["thr_b", [childThread]],
      ]),
      rawParentOf: new Map<string, string>([["thr_a", "thr_b"]]),
      onReparent,
    });
    const { dropAllowed } = dragToFloor("thr_a", "proj_a");
    expect(dropAllowed).toBe(true);
    expect(onReparent).toHaveBeenCalledWith("thr_a", null);
    expect(props.onDropDone).not.toHaveBeenCalled();
    expect(props.onDropUnread).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("a top-level card's floor drop keeps the plain append, never a detach", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderBoard(twoCardFixture(), { onReparent, rawParentOf: new Map() });
    const section = document.querySelector('section[data-column-id="unread"]');
    if (!(section instanceof HTMLElement)) throw new Error("missing unread column");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    const over = createEvent.dragOver(section, { dataTransfer: dt });
    fireEvent(section, over);
    const drop = createEvent.drop(section, { dataTransfer: dt });
    fireEvent(section, drop);
    expect(over.defaultPrevented).toBe(true);
    expect(props.onRankMove).toHaveBeenCalled();
    expect(onReparent).not.toHaveBeenCalled();
  });

  it("the floor glows amber under a nested child, stays lane-colored otherwise", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    renderFamily(onReparent);
    const section = document.querySelector('section[data-column-id="unread"]');
    if (!(section instanceof HTMLElement)) throw new Error("missing unread column");
    const dt = makeDataTransfer();
    fireEvent.dragStart(nestedRowAnchor("thr_a"), { dataTransfer: dt });
    fireEvent(section, createEvent.dragOver(section, { dataTransfer: dt }));
    expect(section.className).toMatch(/ring-amber-500/);
    expect(section.className).not.toMatch(/ring-ring/);
  });

  it("the detach announcement names the way back", async () => {
    renderFamily();
    dragToFloor("thr_a", "unread");
    // The write resolves on a microtask; the announcement follows it.
    await vi.waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent ?? "").toMatch(/Drag it onto a card to nest it back/);
    });
  });
});

describe("the column header is the closer detach target (family drag)", () => {
  const [childThread, parentThread] = familyFixture();

  function nestedRowAnchor(childId: string): HTMLElement {
    const anchor = document.querySelector(
      `[data-nested-rows] a[data-thread-card="${childId}"]`,
    );
    if (!(anchor instanceof HTMLElement)) throw new Error(`missing nested row ${childId}`);
    return anchor;
  }

  function renderFamily(onReparent: unknown = vi.fn().mockResolvedValue(undefined)) {
    return renderBoard([parentThread], {
      nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
        ["thr_b", [childThread]],
      ]),
      rawParentOf: new Map<string, string>([["thr_a", "thr_b"]]),
      onReparent,
    }) as { props: BoardProps };
  }

  function unreadHeader(): HTMLElement {
    const header = document.querySelector(
      'section[data-column-id="unread"] header',
    );
    if (!(header instanceof HTMLElement)) throw new Error("missing unread column header");
    return header;
  }

  it("grows a column header while a drag is in flight, and settles after", () => {
    renderFamily();
    const header = unreadHeader();
    expect(header.className).not.toMatch(/pb-2\.5/);
    fireEvent.dragStart(nestedRowAnchor("thr_a"), { dataTransfer: makeDataTransfer() });
    expect(header.className).toMatch(/pb-2\.5/);
    fireEvent.dragEnd(nestedRowAnchor("thr_a"));
    expect(header.className).not.toMatch(/pb-2\.5/);
  });

  it("rings the hovered header amber, not the lane color", () => {
    renderFamily();
    const header = unreadHeader();
    const dt = makeDataTransfer();
    fireEvent.dragStart(nestedRowAnchor("thr_a"), { dataTransfer: dt });
    fireEvent(header, createEvent.dragOver(header, { dataTransfer: dt }));
    expect(header.className).toMatch(/ring-amber-500/);
    expect(header.className).not.toMatch(/ring-ring/);
    fireEvent(header, createEvent.dragLeave(header, { dataTransfer: dt }));
    expect(header.className).not.toMatch(/ring-amber-500/);
  });

  it("releasing a child on the header un-nests it with no rank move", () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    const { props } = renderFamily(onReparent);
    const header = unreadHeader();
    const dt = makeDataTransfer();
    fireEvent.dragStart(nestedRowAnchor("thr_a"), { dataTransfer: dt });
    fireEvent(header, createEvent.dragOver(header, { dataTransfer: dt }));
    // The header sits inside the section, so the drop bubbles to the
    // section's own handler — this pins that the header drop detaches the
    // child and never issues a rank move.
    expect(header.className).toMatch(/ring-amber-500/);
    fireEvent(header, createEvent.drop(header, { dataTransfer: dt }));
    expect(onReparent).toHaveBeenCalledWith("thr_a", null);
    expect(props.onRankMove).not.toHaveBeenCalled();
    // A successful drop clears the hover affordances.
    expect(header.className).not.toMatch(/ring-amber-500/);
  });

  /** Full drag onto a column's TITLE strip: dragstart, dragover, drop on the <header>. */
  function dragToHeader(fromId: string, columnId: string) {
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor(fromId), { dataTransfer: dt });
    const section = document.querySelector(`section[data-column-id="${columnId}"]`);
    if (!(section instanceof HTMLElement)) throw new Error(`missing column ${columnId}`);
    const header = unreadHeader();
    const over = createEvent.dragOver(header, { dataTransfer: dt });
    fireEvent(header, over);
    const drop = createEvent.drop(header, { dataTransfer: dt });
    fireEvent(header, drop);
    return { dropAllowed: over.defaultPrevented, dropPrevented: drop.defaultPrevented };
  }

  it("a top-level card dropped on its own column's title writes nothing", () => {
    const { props } = renderBoard(twoCardFixture());
    const { dropAllowed } = dragToHeader("thr_a", "unread");
    // The section floor already authorizes the hover, so the browser accepts
    // the drop — the point is that releasing on the TITLE does no write.
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(props.onDropDone).not.toHaveBeenCalled();
    expect(props.onDropUnread).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
  });

  it("a title drop is state-only cross-lane: done, but no rank order", () => {
    const doneFiller = thread({ id: "thr_old_done", updatedAt: NOW - 9000 });
    const { props } = renderBoard(
      [...twoCardFixture(), doneFiller],
      { doneIds: new Set<string>(["thr_old_done"]) },
    );
    const header = document.querySelector('section[data-column-id="done"] header');
    if (!(header instanceof HTMLElement)) throw new Error("missing done column header");
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    const over = createEvent.dragOver(header, { dataTransfer: dt });
    fireEvent(header, over);
    fireEvent(header, createEvent.drop(header, { dataTransfer: dt }));
    expect(props.onDropDone).toHaveBeenCalledWith("thr_a");
    expect(props.onRankMove).not.toHaveBeenCalled();
  });
});

describe("the hover's promise dies when the pointer leaves the card", () => {
  /** Set the insertion line on a slot's top edge with a live drag. */
  function showLine(fromId: string, targetId: string) {
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor(fromId), { dataTransfer: dt });
    const slot = cardSlot(targetId);
    withRect(slot);
    const over = createEvent.dragOver(slot, { dataTransfer: dt });
    Object.defineProperty(over, "clientY", { value: 60 });
    fireEvent(slot, over);
    return slot;
  }

  it("crossing out of the slot toward the title clears the line", () => {
    renderBoard(twoCardFixture());
    const slot = showLine("thr_a", "thr_b");
    expect(slot.className).toMatch(/inset-x-0/);
    // The header is NOT inside the slot — this is the leave the browser
    // fires when the pointer crosses from the card up to the title strip.
    const header = document.querySelector('section[data-column-id="unread"] header');
    if (!(header instanceof HTMLElement)) throw new Error("missing unread header");
    const leave = createEvent.dragLeave(slot, { dataTransfer: makeDataTransfer() });
    // jsdom does not apply `relatedTarget` in the init dict (same as
    // `clientY`); force it the way the spec event would arrive.
    Object.defineProperty(leave, "relatedTarget", { value: header });
    fireEvent(slot, leave);
    expect(slot.className).not.toMatch(/inset-x-0/);
  });

  it("a leave that lands deeper inside the card keeps the line", () => {
    renderBoard(twoCardFixture());
    const slot = showLine("thr_a", "thr_b");
    // Some browsers fire dragleave on the slot even when the pointer only
    // sinks into a descendant (the card anchor itself): relatedTarget inside
    // the slot means the hover never left — keep the promise.
    const anchor = cardAnchor("thr_b");
    const leave = createEvent.dragLeave(slot, { dataTransfer: makeDataTransfer() });
    Object.defineProperty(leave, "relatedTarget", { value: anchor });
    fireEvent(slot, leave);
    expect(slot.className).toMatch(/inset-x-0/);
  });
});
