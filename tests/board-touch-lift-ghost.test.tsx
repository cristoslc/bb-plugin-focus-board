// @vitest-environment jsdom
// The pickup's visible lift (issue #335).
//
// The operator used the shipped hold-drag (PR #331) on a phone and reported:
//
//   "the card isn't visible moving after being picked up, even though other
//    families/groups do show amber highlight when thumb moves over them post
//    pick up."
//
// The drag itself worked — the drop targets lit and the rank write landed —
// but the picked-up card stayed in its slot, so the finger was dragging a
// promise with nothing attached to it. The lift is now a floating snapshot of
// the card that follows the finger 1:1 from arm to release, and this file pins
// that lifecycle: created on the arm, tracking every move, resolved on
// release, and absent on a fine pointer (a cursor keeps the native HTML5
// drag's own ghost).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import {
  createTouchDragGhost,
  TOUCH_DRAG_ARMED_ATTR,
  TOUCH_DRAG_GHOST_ATTR,
  TOUCH_GHOST_RELEASE_MS,
  TOUCH_HOLD_STYLE_ID,
} from "../components/touch-hold-drag";
import { TOUCH_HOLD_ARM_MS } from "../lib/touch-hold";
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

function card(id: string): HTMLElement {
  const el = document.querySelector(`[data-thread-card="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no card ${id}`);
  return el;
}

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

/** jsdom lays nothing out: the card tells the ghost where it stands. */
function stubCardRect(
  el: HTMLElement,
  rect: { left: number; top: number; width: number; height: number },
): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
}

function hold(el: Element, x = 40, y = 60) {
  act(() => {
    touch(el, "touchstart", x, y);
  });
  act(() => {
    vi.advanceTimersByTime(TOUCH_HOLD_ARM_MS);
  });
}

function ghosts(): HTMLElement[] {
  return [...document.querySelectorAll(`[${TOUCH_DRAG_GHOST_ATTR}]`)] as HTMLElement[];
}

/** The ghost's travel, read off its own transform: `translate3d(x, y, 0) …`. */
function ghostTravel(ghost: HTMLElement): { x: number; y: number } {
  const match = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(ghost.style.transform);
  if (match === null) throw new Error(`no translate in ${JSON.stringify(ghost.style.transform)}`);
  return { x: Number(match[1]), y: Number(match[2]) };
}

const CARD_RECT = { left: 30, top: 50, width: 200, height: 80 };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the picked-up card follows the finger (coarse pointer)", () => {
  it("lifts a floating snapshot of the card on the arm, anchored where the finger grabbed it", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();
    const source = card("thr_a");
    stubCardRect(source, CARD_RECT);

    expect(ghosts()).toHaveLength(0);
    hold(source, 40, 60);

    // The card itself stays in its slot: the lane's geometry is what the drop
    // rules read, so the pickup must not open a hole in the flow.
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);
    const [ghost] = ghosts();
    expect(ghost).toBeTruthy();
    // The ghost is a snapshot of the card, not a second live card: it hangs
    // outside the card, carries no thread id, and is out of the accessibility
    // tree.
    expect(ghost!.textContent ?? "").toContain("Alpha");
    expect(source.contains(ghost!)).toBe(false);
    expect(ghost!.getAttribute("data-thread-card")).toBeNull();
    expect(ghost!.getAttribute("aria-hidden")).toBe("true");
    // Anchored on the card's own box, with the grab point as the scale origin,
    // so the pixel under the finger never slides out from under it.
    expect(ghost!.style.position).toBe("fixed");
    expect(ghost!.style.left).toBe("30px");
    expect(ghost!.style.top).toBe("50px");
    expect(ghost!.style.transformOrigin).toBe("10px 10px");
    expect(ghostTravel(ghost!)).toEqual({ x: 0, y: 0 });
    // The lift reads as a lift: bigger than the card, painted above the board
    // from the injected rule (the geometry is inline, the paint is the sheet).
    expect(ghost!.style.transform).toContain("scale(");
    const sheet = document.getElementById(TOUCH_HOLD_STYLE_ID)?.textContent ?? "";
    expect(sheet).toContain(`[${TOUCH_DRAG_GHOST_ATTR}]`);
    expect(sheet).toContain("z-index: 60");
    expect(sheet).toContain("pointer-events: none");
  });

  it("tracks the finger one-to-one across moves, in both axes", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();
    const source = card("thr_a");
    stubCardRect(source, CARD_RECT);
    hold(source, 40, 60);

    act(() => {
      touch(card("thr_b"), "touchmove", 140, 60);
    });
    expect(ghostTravel(ghosts()[0]!)).toEqual({ x: 100, y: 0 });

    // Negative travel too: the finger went back past where it grabbed.
    act(() => {
      touch(card("thr_b"), "touchmove", 40, 260);
    });
    expect(ghostTravel(ghosts()[0]!)).toEqual({ x: 0, y: 200 });

    // The ghost is one element across the whole gesture, never re-created per
    // move (a per-move clone would thrash the DOM at finger speed).
    expect(ghosts()).toHaveLength(1);
  });

  it("resolves the snapshot when the drop commits", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();
    const source = card("thr_a");
    stubCardRect(source, CARD_RECT);
    hold(source, 40, 60);

    act(() => {
      touch(card("thr_pinned"), "touchmove", 240, 320);
    });
    act(() => {
      touch(card("thr_pinned"), "touchend", 240, 320);
    });

    // The write is still the shared one.
    expect(props.onRankMove).toHaveBeenCalled();
    // The lift resolves: the ghost fades out of the way and leaves the DOM, and
    // the card keeps no armed marker.
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    act(() => {
      vi.advanceTimersByTime(TOUCH_GHOST_RELEASE_MS);
    });
    expect(ghosts()).toHaveLength(0);
  });

  it("resolves the snapshot on a safe cancel, releasing nothing", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();
    const source = card("thr_a");
    stubCardRect(source, CARD_RECT);
    hold(source, 40, 60);
    expect(ghosts()).toHaveLength(1);

    act(() => {
      touch(source, "touchend", 40, 60);
    });

    expect(props.onRankMove).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TOUCH_GHOST_RELEASE_MS);
    });
    expect(ghosts()).toHaveLength(0);
  });

  it("resolves the snapshot when the browser takes the gesture back", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();
    const source = card("thr_a");
    stubCardRect(source, CARD_RECT);
    hold(source, 40, 60);
    expect(ghosts()).toHaveLength(1);

    act(() => {
      touch(source, "touchcancel", 40, 60);
    });
    act(() => {
      vi.advanceTimersByTime(TOUCH_GHOST_RELEASE_MS);
    });
    expect(ghosts()).toHaveLength(0);
  });
});

describe("a cursor keeps the platform's own drag image", () => {
  it("lifts no snapshot on a fine pointer", () => {
    stubPointer(false);
    vi.useFakeTimers();
    renderBoard();
    const source = card("thr_a");
    stubCardRect(source, CARD_RECT);

    hold(source, 40, 60);
    act(() => {
      touch(card("thr_pinned"), "touchmove", 240, 320);
    });

    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);
    expect(ghosts()).toHaveLength(0);
  });
});

describe("the snapshot's stylesheet scope", () => {
  it("is parented to the plugin root, so the card's own utilities still resolve", () => {
    // The plugin's Tailwind utilities are scoped to an ancestor, so a clone
    // hung off `document.body` resolves none of them: the lift rendered as
    // bare floating text with no surface, which is a real regression this
    // test pins (the probe under scripts/screenshot caught it first).
    const scope = document.createElement("div");
    scope.setAttribute("data-bb-plugin", "focus-board");
    document.body.append(scope);
    const host = document.createElement("div");
    host.setAttribute("data-thread-card", "thr_scoped");
    host.className = "bg-card";
    scope.append(host);

    const ghost = createTouchDragGhost(host, { x: 4, y: 4 });
    expect(ghost.parentElement).toBe(scope);
    expect(ghost.closest("[data-bb-plugin]")).toBe(scope);
    expect(host.contains(ghost)).toBe(false);

    ghost.remove();
    scope.remove();
  });
});
