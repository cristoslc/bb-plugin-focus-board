// @vitest-environment jsdom
// The touch pickup, end to end through the board (issue #330).
//
// The operator's contract: "sliding a finger anywhere pans the board.
// Tap-hold-slide on card drags the card. Hold duration should be very short
// but still long enough to distinguish touch-to-pan-board from
// touch-to-drag-card."
//
// On a coarse pointer no card is a native drag source any more (issue #328),
// so the pickup is the board's own: a short hold arms the card, and the moves
// dispatch the same dragover/drop events a mouse drag raises. These tests drive
// that path with touch events and assert the SAME rank write a cursor drag
// produces — the proof that there is one drag pipeline, not two.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { resolveTouchDragSource, TOUCH_DRAG_ARMED_ATTR } from "../components/touch-hold-drag";
import { TOUCH_HOLD_ARM_MS, TOUCH_HOLD_CANCEL_SLOP_PX } from "../lib/touch-hold";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

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

const threads = [
  thread({ id: "thr_a", displayTitle: "Alpha", isUnread: true, updatedAt: NOW - 1000 }),
  thread({ id: "thr_b", displayTitle: "Beta", isUnread: true, updatedAt: NOW - 2000 }),
  thread({ id: "thr_c", displayTitle: "Gamma", isUnread: true, updatedAt: NOW - 3000 }),
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
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    rankStore: {},
    onRankMove: vi.fn(),
    onDropPinned: vi.fn(),
    onDropUnread: vi.fn(),
    onDropDone: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return { props, ...render(<Board {...props} />) };
}

/** The element a touch lands on / moves over: the card's own body. */
function card(id: string): HTMLElement {
  const el = document.querySelector(`[data-thread-card="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no card ${id}`);
  return el;
}

/**
 * One touch event. `touches` is defined because a plain `Event` has none and
 * the gesture reads the finger's coordinates off it.
 */
function touch(
  el: Element,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  x = 0,
  y = 0,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    configurable: true,
    value:
      type === "touchend" || type === "touchcancel"
        ? []
        : [{ clientX: x, clientY: y, identifier: 1 }],
  });
  el.dispatchEvent(event);
  return event;
}

/** Rest a finger on the card until the pickup arms. */
function hold(el: Element) {
  act(() => {
    touch(el, "touchstart", 40, 40);
  });
  act(() => {
    vi.advanceTimersByTime(TOUCH_HOLD_ARM_MS);
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("tap-hold-slide on a card (coarse pointer)", () => {
  it("arms the card, then drops it in another lane through the shared drag pipeline", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();
    const source = card("thr_a");
    const target = card("thr_pinned");

    // The native drag source stays disarmed: the pickup is the board's own.
    expect(source.querySelector("a")?.getAttribute("draggable")).toBe("false");

    hold(source);
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);

    act(() => {
      touch(target, "touchmove", 240, 320);
    });
    // The pickup follows the finger and shows the drop promise (the insertion
    // line state the mouse's dragover sets).
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);

    act(() => {
      touch(target, "touchend", 240, 320);
    });

    // The lift ends, and the write is the mouse drag's own: a pin plus the
    // positioned rank move that lands the card at the end of Pinned.
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    expect(props.onDropPinned).toHaveBeenCalledWith("thr_a");
    expect(props.onRankMove).toHaveBeenCalledWith("pinned", "thr_a", null, true, ["thr_pinned"]);
  });

  it("reorders within a lane when the hold lands on a sibling card", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();
    const source = card("thr_c");
    const target = card("thr_a");

    hold(source);
    act(() => {
      touch(target, "touchmove", 60, 20);
    });
    act(() => {
      touch(target, "touchend", 60, 20);
    });

    // "After Alpha" is "before Beta": the third card moves between the first
    // two, and no state change is written.
    expect(props.onRankMove).toHaveBeenCalledWith(
      "status:unread",
      "thr_c",
      "thr_b",
      false,
      ["thr_a", "thr_b", "thr_c"],
    );
    expect(props.onDropPinned).not.toHaveBeenCalled();
  });

  it("keeps the card disarmed on a fine pointer", () => {
    stubPointer(false);
    vi.useFakeTimers();
    const { props } = renderBoard();
    const source = card("thr_a");

    hold(source);
    act(() => {
      touch(card("thr_pinned"), "touchmove", 240, 320);
    });
    act(() => {
      touch(card("thr_pinned"), "touchend", 240, 320);
    });

    // A desktop pointer has the native HTML5 drag; the custom pickup is off,
    // so the same touch sequence must do nothing at all.
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
  });
});

describe("the pan keeps its claim on a moving finger", () => {
  it("cancels the arm when the finger moves before the deadline", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();
    const source = card("thr_a");

    act(() => {
      touch(source, "touchstart", 40, 40);
    });
    // 60ms: far short of the deadline, so this is a pan.
    act(() => {
      vi.advanceTimersByTime(60);
    });
    act(() => {
      touch(card("thr_b"), "touchmove", 40 + TOUCH_HOLD_CANCEL_SLOP_PX + 40, 40);
    });
    // The deadline passing afterwards must not resurrect the arm.
    act(() => {
      vi.advanceTimersByTime(TOUCH_HOLD_ARM_MS * 2);
    });
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);

    act(() => {
      touch(card("thr_b"), "touchend", 400, 40);
    });
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
  });
});

describe("a pickup released where it was lifted", () => {
  it("cancels safely: no write, no link, and it says so", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props, container } = renderBoard();
    const source = card("thr_a");

    hold(source);
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);
    act(() => {
      touch(source, "touchend", 40, 40);
    });

    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    expect(props.onRankMove).not.toHaveBeenCalled();
    // The tap-through is deliberately NOT taken: the operator asked to drag.
    expect(props.onOpenThread).not.toHaveBeenCalled();
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain("released without moving");
  });
});

describe("a folded feature-group frame", () => {
  // A folded frame renders NO member cards: its surface is dots and a label,
  // so the pickup names the unit from the frame's own lead marker (the bug the
  // UAT caught first: the frame armed nothing because there was no member card
  // to read a lead id from).
  const members = [
    thread({ id: "thr_a", displayTitle: "Alpha", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", displayTitle: "Beta", updatedAt: NOW - 2000 }),
    thread({ id: "thr_c", displayTitle: "Gamma", updatedAt: NOW - 3000 }),
  ];
  const groupBoxOf = new Map<
    string,
    { groupId: string; name: string; members: readonly PluginSidebarThread[] }
  >([
    ["thr_a", { groupId: "grp_auth", name: "Auth rework", members: [members[0]!, members[1]!] }],
    ["thr_b", { groupId: "grp_auth", name: "Auth rework", members: [members[0]!, members[1]!] }],
  ]);

  function renderFolded() {
    return renderBoard({
      columns: buildColumns(members, "status", context, new Map(), new Set<string>(), NOW, {}),
      groupBoxOf,
      collapsedGroupIds: new Set<string>(["grp_auth"]),
      onGroupCollapsedChange: () => {},
      onRenameGroup: () => {},
    });
  }

  it("resolves its lead member and arms the whole frame on a hold", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderFolded();
    const frame = document.querySelector('[data-group-box="grp_auth"]');
    expect(frame).not.toBeNull();
    const label = frame?.querySelector(".truncate") ?? frame!;

    const resolved = resolveTouchDragSource(label);
    expect(resolved?.threadId).toBe("thr_a");
    expect(resolved?.unit).toBe(true);

    hold(label);
    expect(frame?.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);
  });
});

describe("the controls inside a card", () => {
  it("keep their own taps: a hold on a button never picks the card up", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();
    // The card's own controls (a chip, the done box) are buttons: this fixture
    // renders none of them wired, so one is placed where a chip would be.
    const source = card("thr_a");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "chip";
    source.append(button);

    hold(button);
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    act(() => {
      touch(button, "touchend", 40, 40);
    });
    expect(props.onRankMove).not.toHaveBeenCalled();
  });
});
