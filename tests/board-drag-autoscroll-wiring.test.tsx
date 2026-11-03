// @vitest-environment jsdom
// The drag autoscroll through the real board (issue #350).
//
// The operator's report: "dragging cards horizontally doesn't scroll
// horizontally." These tests drive the wiring end to end: a real dragstart on
// a card's anchor arms the loop, dragover events at the scroller's edge feed
// it, and the board (or a lane's own list) pans — then stops on zone exit,
// dragleave, drop, and dragend. The touch hold-drag shares the same feed, so
// its case is here too. jsdom has no layout, so every rect and scroll range
// is stubbed on the element the way tests/board-keep-in-view-resize.test.tsx
// does; the loop's arithmetic itself is pinned by
// tests/board-drag-autoscroll.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { TOUCH_HOLD_ARM_MS } from "../lib/touch-hold";
import { thread } from "./thread-fixture";

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

const threads = [
  thread({ id: "thr_a", displayTitle: "Alpha", isUnread: true, updatedAt: NOW - 1000 }),
  thread({ id: "thr_b", displayTitle: "Beta", isUnread: true, updatedAt: NOW - 2000 }),
  thread({ id: "thr_pinned", displayTitle: "Pinned", isPinned: true, updatedAt: NOW - 4000 }),
];

function renderBoard(overrides: Partial<BoardProps> = {}) {
  const props = {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    childCountByParent: new Map<string, number>(),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
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

interface BoxSpec {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  overflowX?: string;
  overflowY?: string;
  scrollWidth?: number;
  scrollHeight?: number;
}

/**
 * jsdom has no layout and no stylesheets, so a scroller's rect, its computed
 * overflow, and its scroll range are all stubbed onto the element. The loop
 * reads exactly these — `getBoundingClientRect`, `panScrollBox`'s computed
 * overflow + range check — nothing else.
 */
function wireBox(el: HTMLElement, spec: BoxSpec): void {
  const left = spec.left ?? 0;
  const top = spec.top ?? 0;
  const right = spec.right ?? left;
  const bottom = spec.bottom ?? top;
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  if (spec.overflowX !== undefined) el.style.overflowX = spec.overflowX;
  if (spec.overflowY !== undefined) el.style.overflowY = spec.overflowY;
  if (spec.scrollWidth !== undefined) {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: spec.scrollWidth });
  }
  if (spec.scrollHeight !== undefined) {
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: spec.scrollHeight });
  }
}

/** The board scroller, wired as a 0..800 horizontally scrolling row. */
function boardEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-columns-board]");
  if (el === null) throw new Error("no [data-columns-board]");
  return el;
}

/** One lane's card list. */
function laneEl(columnId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `section[data-column-id="${columnId}"] [data-card-list]`,
  );
  if (el === null) throw new Error(`no card list in lane ${columnId}`);
  return el;
}

function cardAnchor(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-thread-card="${id}"] a[draggable]`);
  if (el === null) throw new Error(`no draggable anchor for ${id}`);
  return el;
}

function cardSlot(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-rank-slot="${id}"]`);
  if (el === null) throw new Error(`no rank slot for ${id}`);
  return el;
}

// ── the frame clock ────────────────────────────────────────────────────────
// The loop is driven by requestAnimationFrame; the tests own the clock, so a
// frame only runs when the test calls frame() — deterministic dt, no timers.

let rafQueue: Array<{ id: number; cb: (ts: number) => void }> = [];
let rafSeq = 1;

function stubFrames(): void {
  vi.stubGlobal("requestAnimationFrame", (cb: (ts: number) => void) => {
    const id = rafSeq++;
    rafQueue.push({ id, cb });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
  });
}

/** Run every pending frame at timestamp ts. */
function frame(ts: number): void {
  const pending = rafQueue;
  rafQueue = [];
  for (const entry of pending) entry.cb(ts);
}

/** Run `count` frames of `stepMs` each, starting after `firstTs`. */
function runFrames(count: number, firstTs: number, stepMs = 100): void {
  for (let i = 0; i < count; i++) frame(firstTs + i * stepMs);
}

/** A dragover carrying real pointer coordinates (jsdom events have none). */
function dragOverAt(el: Element, x: number, y: number, dt: unknown): void {
  const event = createEvent.dragOver(el, {
    bubbles: true,
    cancelable: true,
    dataTransfer: dt as DataTransfer,
  });
  Object.defineProperty(event, "clientX", { value: x });
  Object.defineProperty(event, "clientY", { value: y });
  fireEvent(el, event);
}

/** A dragleave whose pointer crossed into `to` (null = out of the window). */
function dragLeaveFrom(el: Element, to: Element | null): void {
  const event = createEvent.dragLeave(el, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "relatedTarget", { value: to });
  fireEvent(el, event);
}

const EDGE = 795; // 43px from a right edge at 800: depth (795-752)/48

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the columns board pans while a drag holds its edge", () => {
  it("a drag at the right edge pans the board horizontally", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(6, 1000);

    // Five 100ms frames at depth 0.8958 of the zone: 5 x 37.625px.
    expect(board.scrollLeft).toBeCloseTo(188.125, 3);
    // Axis exclusivity: the columns board never pans vertically.
    expect(board.scrollTop).toBe(0);
  });

  it("a drag at the left edge pans back the other way", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    dragOverAt(board, 10, 40, dt);
    runFrames(2, 1000);

    expect(board.scrollLeft).toBeLessThan(0);
  });

  it("a plain hover at the edge scrolls nothing (the loop is drag-gated)", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    // No dragstart: the dragover is a pointer with no drag behind it.
    dragOverAt(board, EDGE, 40, makeDataTransfer());
    runFrames(6, 1000);

    expect(board.scrollLeft).toBe(0);
  });

  it("the pan stops when the pointer leaves the zone", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1000);
    const panned = board.scrollLeft;
    expect(panned).toBeGreaterThan(0);

    // Back in the middle of the board: sustained presence, no zone.
    dragOverAt(board, 400, 40, dt);
    runFrames(4, 1300);
    expect(board.scrollLeft).toBe(panned);
  });

  it("the pan stops at dragend", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    const anchor = cardAnchor("thr_a");
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1000);
    const panned = board.scrollLeft;
    expect(panned).toBeGreaterThan(0);

    fireEvent.dragEnd(anchor, { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(4, 1300);
    expect(board.scrollLeft).toBe(panned);
  });

  it("the pan stops on drop, and the edge zone swallows no drop", () => {
    stubFrames();
    const { props } = renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    const anchor = cardAnchor("thr_a");
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1000);
    const panned = board.scrollLeft;
    expect(panned).toBeGreaterThan(0);

    // The drop lands where the pointer is — the section floor here, claimed
    // by the lane's own handlers — and stops the loop outright.
    const section = document.querySelector('section[data-column-id="unread"]');
    if (section === null) throw new Error("no unread lane");
    fireEvent.drop(section, { dataTransfer: dt });
    expect(props.onRankMove).toHaveBeenCalled();

    dragOverAt(board, EDGE, 40, dt);
    runFrames(4, 1300);
    expect(board.scrollLeft).toBe(panned);
  });

  it("a dragleave out of the board parks the pan until the pointer returns", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1000);
    const panned = board.scrollLeft;
    expect(panned).toBeGreaterThan(0);

    // Over the toolbar above the lanes (outside the scroller's subtree): the
    // stale in-board coordinate must not keep scrolling from there.
    dragLeaveFrom(board, document.body);
    runFrames(4, 1300);
    expect(board.scrollLeft).toBe(panned);

    // Back over the board: the loop resumes from where the pointer is now.
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1800);
    expect(board.scrollLeft).toBeGreaterThan(panned);
  });

  it("a drag parked past a tall lane's bottom edge pans that lane's stack", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    const list = laneEl("unread");
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });
    wireBox(list, { left: 0, right: 800, top: 0, bottom: 600, overflowY: "auto", scrollHeight: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    // The pointer is over a card of the Unread lane, 5px above its bottom.
    dragOverAt(cardAnchor("thr_b"), 400, 595, dt);
    runFrames(6, 1000);

    expect(list.scrollTop).toBeCloseTo(188.125, 3);
    // Axis exclusivity, both ways: the lane never pans sideways, and the
    // board's vertical axis (hidden in this layout) never moves.
    expect(list.scrollLeft).toBe(0);
    expect(board.scrollTop).toBe(0);
    expect(board.scrollLeft).toBe(0);
  });

  it("the Pinned lane's own drags autoscroll like any card's", () => {
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_pinned"), { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1000);

    expect(board.scrollLeft).toBeGreaterThan(0);
  });

  it("a drop on a lane that the pan revealed commits the same rank write", () => {
    stubFrames();
    const { props } = renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });
    // The target card sits in the Pinned lane — offscreen at drag start, in
    // the viewport only because the pan revealed it.
    const slot = cardSlot("thr_pinned");
    wireBox(slot, { left: 700, right: 800, top: 40, bottom: 340 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    // Hold at the board's right edge: the board pans toward the Pinned lane.
    dragOverAt(board, EDGE, 40, dt);
    runFrames(6, 1000);
    const panned = board.scrollLeft;
    expect(panned).toBeGreaterThan(0);

    // Drop on the revealed card's top half — the same gesture as a
    // visible-lane drop, and the write must be the same one.
    dragOverAt(slot, 750, 50, dt);
    const drop = createEvent.drop(slot, { bubbles: true, cancelable: true, dataTransfer: dt as DataTransfer });
    Object.defineProperty(drop, "clientX", { value: 750 });
    Object.defineProperty(drop, "clientY", { value: 50 });
    fireEvent(slot, drop);
    fireEvent.dragEnd(cardAnchor("thr_a"), { dataTransfer: dt });

    expect(props.onDropPinned).toHaveBeenCalledWith("thr_a");
    // The positioned write: before the revealed card, exactly as a drop on a
    // lane that was visible from the start commits.
    expect(props.onRankMove).toHaveBeenCalledWith("pinned", "thr_a", "thr_pinned", false, [
      "thr_pinned",
    ]);
  });
});

describe("the rows board pans its own axes", () => {
  it("a drag past the board's bottom edge pans the board vertically", () => {
    stubFrames();
    renderBoard({ laneDirection: "horizontal" });
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowY: "auto", scrollHeight: 3000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    dragOverAt(board, 400, 595, dt);
    runFrames(6, 1000);

    expect(board.scrollTop).toBeCloseTo(188.125, 3);
    expect(board.scrollLeft).toBe(0);
  });

  it("a drag past a row's right edge pans that row", () => {
    stubFrames();
    renderBoard({ laneDirection: "horizontal" });
    const board = boardEl();
    const list = laneEl("unread");
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowY: "auto", scrollHeight: 3000 });
    wireBox(list, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_a"), { dataTransfer: dt });
    dragOverAt(cardAnchor("thr_b"), EDGE, 40, dt);
    runFrames(6, 1000);

    expect(list.scrollLeft).toBeCloseTo(188.125, 3);
    // Axis exclusivity: the row never pans vertically, and the board's
    // hidden horizontal axis never moves.
    expect(list.scrollTop).toBe(0);
    expect(board.scrollLeft).toBe(0);
  });

  it("a group box dragged by its label autoscrolls like a single card", () => {
    stubFrames();
    const members = threads.concat([
      thread({ id: "thr_x", status: "active", updatedAt: NOW - 5000 }),
    ]);
    const groupBoxOf = new Map([
      ["thr_x", { groupId: "grp_auth", name: "Auth rework", members: [members[3]] }],
    ]);
    renderBoard({
      columns: buildColumns(members, "status", context, new Map(), new Set<string>(), NOW, {}),
      groupBoxOf,
    });
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });

    const label = document.querySelector<HTMLElement>('[data-group-box-label="grp_auth"]');
    if (label === null) throw new Error("no group box label");
    const dt = makeDataTransfer();
    fireEvent.dragStart(label, { dataTransfer: dt });
    dragOverAt(board, EDGE, 40, dt);
    runFrames(2, 1000);

    expect(board.scrollLeft).toBeGreaterThan(0);
  });
});

describe("the touch hold-drag feeds the same loop", () => {
  /** One touch event with real finger coordinates. */
  function touch(el: Element, type: string, x: number, y: number): void {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", {
      configurable: true,
      value: type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y }],
    });
    el.dispatchEvent(event);
  }

  function stubPointer(coarse: boolean): void {
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

  it("an armed finger held at the board's edge pans it, then the release stops the loop", () => {
    stubPointer(true);
    vi.useFakeTimers();
    stubFrames();
    renderBoard();
    const board = boardEl();
    wireBox(board, { left: 0, right: 800, top: 0, bottom: 600, overflowX: "auto", scrollWidth: 2000 });
    const source = cardAnchor("thr_a").closest("[data-thread-card]");
    if (!(source instanceof HTMLElement)) throw new Error("no source card");

    // The pickup: rest, then the arm deadline.
    touch(source, "touchstart", 40, 40);
    vi.advanceTimersByTime(TOUCH_HOLD_ARM_MS);

    // The finger moves to the board's right edge and rests there. The
    // hold-drag dispatches a dragover at every move — the SAME feed the
    // mouse path uses — so the loop pans without any touch-specific code.
    touch(board, "touchmove", EDGE, 40);
    runFrames(6, 1000);
    const panned = board.scrollLeft;
    expect(panned).toBeGreaterThan(0);

    // The release ends the drag lifecycle, and the loop with it.
    touch(board, "touchend", EDGE, 40);
    touch(board, "touchmove", EDGE, 40);
    runFrames(4, 1800);
    expect(board.scrollLeft).toBe(panned);
    vi.useRealTimers();
  });
});
