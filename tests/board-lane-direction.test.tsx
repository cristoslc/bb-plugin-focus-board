// @vitest-environment jsdom
// The lane-direction setting (issue #153): the board's default is the
// vertical column read (lanes as columns, cards stacking downward), and the
// opt-in horizontal read turns every lane into a row whose cards flow
// left-to-right, with the drop-zone thirds, the reorder keys, and the
// keep-in-view corrections all following the new flow axis.
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

function renderBoard(
  threads: PluginSidebarThread[],
  overrides: Partial<BoardProps> = {},
) {
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

/** Stub the hovered card slot's rect so the drop-zone math runs on it. */
function stubSlotRect(slot: Element, left: number, width: number, top = 0, height = 100): void {
  Object.defineProperty(slot, "getBoundingClientRect", {
    value: () =>
      ({
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect,
    configurable: true,
  });
}

function cardSlot(threadId: string): HTMLElement {
  const slot = document.querySelector(`[data-rank-slot="${threadId}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing card slot ${threadId}`);
  return slot;
}

const LANES = [
  thread({ id: "thr_a", isPinned: true, updatedAt: NOW - 1000 }),
  thread({ id: "thr_b", isPinned: true, updatedAt: NOW - 5000 }),
];

afterEach(cleanup);

describe("Board: the vertical default is today's column board", () => {
  it("declares the vertical direction on the container and keeps the column layout", () => {
    renderBoard(LANES);
    const container = document.querySelector("[data-columns-board]");
    expect(container?.getAttribute("data-lane-direction")).toBe("vertical");
    expect(container?.className).toContain("overflow-x-auto");
    // The lane row stays a horizontal flex of columns (no flex-col).
    const laneRow = document.querySelector("[data-columns-board] > div");
    expect(laneRow?.className).toContain("flex h-full");
    expect(laneRow?.className).not.toContain("flex-col");
  });

  it("a same-lane reorder still splits the drop on the slot's top/bottom halves", () => {
    const { props } = renderBoard(LANES);
    const slot = cardSlot("thr_b");
    stubSlotRect(slot, 0, 200, 0, 100);
    const dt = makeDataTransfer();
    // Vertical: y 20 (top half) lands before.
    fireEvent.dragStart(cardSlot("thr_a").querySelector("a[draggable]") as HTMLElement, {
      dataTransfer: dt,
    });
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    Object.defineProperty(drop, "clientY", { value: 20 });
    Object.defineProperty(drop, "clientX", { value: 100 });
    fireEvent(slot, drop);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "pinned",
      "thr_a",
      "thr_b",
      false,
      ["thr_a", "thr_b"],
    );
  });

  it("ArrowLeft does not reorder a vertical lane", () => {
    const { props } = renderBoard(LANES);
    fireEvent.keyDown(cardSlot("thr_b"), { altKey: true, key: "ArrowLeft" });
    expect(props.onRankMove).not.toHaveBeenCalled();
  });
});

describe("Board: the horizontal read turns every lane into a row", () => {
  it("declares the direction and swaps every layout axis", () => {
    renderBoard(LANES, { laneDirection: "horizontal" });
    const container = document.querySelector("[data-columns-board]");
    expect(container?.getAttribute("data-lane-direction")).toBe("horizontal");
    // The lanes row scrolls vertically now; each lane's card list scrolls
    // its own horizontal flow instead.
    expect(container?.className).toContain("overflow-y-auto");
    expect(container?.className).not.toContain("overflow-x-auto");
    const laneRow = document.querySelector("[data-columns-board] > div");
    expect(laneRow?.className).toContain("flex-col");
    const section = document.querySelector("section[data-column-id]");
    expect(section?.className).toContain("flex-row");
    const list = document.querySelector("[data-card-list]");
    expect(list?.className).toContain("overflow-x-auto");
    // The card slots flow left-to-right: the run list is a row, and every
    // slot holds a fixed card width.
    const runList = list?.querySelector("ul");
    expect(runList?.className).toContain("flex-row");
    const slot = cardSlot("thr_b");
    expect(slot.className).toContain("w-60");
    expect(slot.className).toContain("shrink-0");
  });

  it("a same-lane reorder splits the drop on the slot's left/right halves", () => {
    const { props } = renderBoard(LANES, { laneDirection: "horizontal" });
    const slot = cardSlot("thr_b");
    stubSlotRect(slot, 0, 200, 0, 100);
    const dt = makeDataTransfer();
    // Horizontal: x 20 (left half) lands before, regardless of the pointer's
    // y (which sits in the slot's bottom half — jsdom's own default here).
    fireEvent.dragStart(cardSlot("thr_a").querySelector("a[draggable]") as HTMLElement, {
      dataTransfer: dt,
    });
    const drop = createEvent.drop(slot, { dataTransfer: dt });
    Object.defineProperty(drop, "clientX", { value: 20 });
    Object.defineProperty(drop, "clientY", { value: 90 });
    fireEvent(slot, drop);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "pinned",
      "thr_a",
      "thr_b",
      false,
      ["thr_a", "thr_b"],
    );
  });

  it("the horizontal flow reorders with Alt+ArrowLeft / Alt+ArrowRight", () => {
    const { props } = renderBoard(LANES, { laneDirection: "horizontal" });
    const slot = cardSlot("thr_b");
    fireEvent.keyDown(slot, { altKey: true, key: "ArrowLeft" });
    // thr_b steps back over thr_a: it anchors before it.
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "pinned",
      "thr_b",
      "thr_a",
      false,
      ["thr_a", "thr_b"],
    );
    const slotA = cardSlot("thr_a");
    fireEvent.keyDown(slotA, { altKey: true, key: "ArrowRight" });
    // thr_a steps forward past thr_b: already last-to-be, it appends.
    expect(props.onRankMove).toHaveBeenCalledTimes(2);
    expect(props.onRankMove).toHaveBeenLastCalledWith(
      "pinned",
      "thr_a",
      null,
      true,
      ["thr_a", "thr_b"],
    );
  });

  it("Alt+ArrowUp/ArrowLeft keep the vertical board's contract (no cross-axis confusion)", () => {
    const { props } = renderBoard(LANES, { laneDirection: "horizontal" });
    // The vertical lane's back key is ArrowUp; on a horizontal board it must
    // do nothing — the flow's back key is ArrowLeft.
    fireEvent.keyDown(cardSlot("thr_b"), { altKey: true, key: "ArrowUp" });
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("the vertical board still reorders with Alt+ArrowUp", () => {
    const { props } = renderBoard(LANES);
    fireEvent.keyDown(cardSlot("thr_b"), { altKey: true, key: "ArrowUp" });
    expect(props.onRankMove).toHaveBeenCalledWith(
      "pinned",
      "thr_b",
      "thr_a",
      false,
      ["thr_a", "thr_b"],
    );
  });
});