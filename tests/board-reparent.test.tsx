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