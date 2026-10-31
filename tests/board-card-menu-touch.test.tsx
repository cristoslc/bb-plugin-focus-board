// @vitest-environment jsdom
// The menu stays out of the drag (issue #335).
//
// The operator on a real phone:
//
//   "touch and hold needs a lot more delay between 'card picked up' and the
//    context menu opening"
//
// The arm fires at 180ms and the platform's own long press at ~500ms, so a
// resting finger arms the card and then, a few hundred milliseconds later, has
// a context menu pop over the drag it is in the middle of. A menu has no place
// in a drag: on touch the card's menu lives behind an explicit ⋯ affordance,
// and while a pickup is armed nothing opens at all. The desktop path (a mouse
// right-click) is untouched, which these tests pin in both directions.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { resolveTouchDragSource, TOUCH_DRAG_ARMED_ATTR } from "../components/touch-hold-drag";
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
  thread({ id: "thr_pinned", displayTitle: "Pinned", isPinned: true, updatedAt: NOW - 4000 }),
];

const pinAction = () => [
  { id: "pin", label: "Pin", icon: "Pin", run: vi.fn() } as const,
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
    menuActionsFor: pinAction,
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
      type === "touchend" || type === "touchcancel" ? [] : [{ clientX: x, clientY: y, identifier: 1 }],
  });
  el.dispatchEvent(event);
  return event;
}

function hold(el: Element, x = 40, y = 60) {
  act(() => {
    touch(el, "touchstart", x, y);
  });
  act(() => {
    vi.advanceTimersByTime(TOUCH_HOLD_ARM_MS);
  });
}

/** The platform's (or a mouse's) context-menu gesture, returned for its verdict. */
function contextMenu(el: Element): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 60,
  });
  fireEvent(el, event);
  return event;
}

function trigger(id: string): HTMLElement | null {
  // The trigger is the menu wrapper's overlay — a sibling of the card, so it
  // never lands inside the anchor and never gets cloned into the drag's ghost.
  return card(id).parentElement?.querySelector("[data-card-menu-trigger]") ?? null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a long press never opens a card's menu on touch", () => {
  it("opens nothing and swallows the platform menu while the card is armed", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();
    const source = card("thr_a");

    hold(source);
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);

    // The platform's long press lands here, mid-drag, a few hundred ms after
    // the arm. The drag owns the gesture: no menu, and the browser's own menu
    // is refused as well.
    const event = contextMenu(source);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    // The pickup survives the attempted interruption.
    expect(source.hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(true);
  });

  it("opens nothing on a coarse pointer even outside a pickup", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();
    const source = card("thr_a");

    // No hold, no arm: a plain platform long press on the card. The menu's
    // home on touch is the ⋯ affordance, never a hold.
    contextMenu(source);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("still opens from a mouse's right-click on a fine pointer", () => {
    stubPointer(false);
    renderBoard();
    const source = card("thr_a");

    contextMenu(source);
    const menu = screen.getByRole("menu", { name: "Thread actions" });
    expect(menu.textContent ?? "").toContain("Alpha");
    expect(screen.getByRole("menuitem", { name: "Pin" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Open thread" })).toBeTruthy();
  });
});

describe("the card's menu affordance on touch", () => {
  it("renders an explicit trigger that opens the same menu the right-click does", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();

    const button = trigger("thr_a");
    expect(button).toBeTruthy();
    // A real tap target, labelled, and wired to the menu's own contract.
    expect(button!.getAttribute("aria-haspopup")).toBe("menu");
    expect(button!.getAttribute("aria-label")).toContain("Alpha");

    fireEvent.click(button!);
    const menu = screen.getByRole("menu", { name: "Thread actions" });
    expect(menu.textContent ?? "").toContain("Alpha");
    expect(screen.getByRole("menuitem", { name: "Pin" })).toBeTruthy();
  });

  it("keeps the trigger out of the card's anchor, so it is not a nested control", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();
    const button = trigger("thr_a");
    expect(button!.closest("a")).toBeNull();
  });

  it("stays reachable while the card is armed, and a hold on it never picks the card up", () => {
    stubPointer(true);
    vi.useFakeTimers();
    renderBoard();

    hold(card("thr_a"));
    expect(trigger("thr_a")).toBeTruthy();
    // The trigger is a control: a finger that rests on it is tapping a button,
    // not lifting the card.
    expect(resolveTouchDragSource(trigger("thr_a"))).toBeNull();
  });

  it("does not render on a fine pointer, where the right-click already owns the menu", () => {
    stubPointer(false);
    renderBoard();
    expect(trigger("thr_a")).toBeNull();
  });
});

describe("the menu returns once the drag is over", () => {
  it("opens from the trigger again after the pickup resolves", () => {
    stubPointer(true);
    vi.useFakeTimers();
    const { props } = renderBoard();

    hold(card("thr_a"));
    act(() => {
      touch(card("thr_a"), "touchend", 40, 60);
    });
    expect(card("thr_a").hasAttribute(TOUCH_DRAG_ARMED_ATTR)).toBe(false);

    // The release's own click is refused: the card must never open under the
    // thumb that just dragged it (the pickup's click guard).
    act(() => {
      fireEvent.click(card("thr_a"));
    });
    expect(props.onOpenThread).not.toHaveBeenCalled();

    // The next tap is a fresh gesture, and the ⋯ is where the menu lives.
    fireEvent.click(trigger("thr_a")!);
    expect(screen.getByRole("menu", { name: "Thread actions" })).toBeTruthy();
  });
});
