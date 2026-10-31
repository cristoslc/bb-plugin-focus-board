// @vitest-environment jsdom
// Issue #328: on a phone the columns dragged around instead of the board
// scrolling. The capture is the platform's touch-drag recognizer, which lifts
// any `draggable` element out of a finger's gesture after a long press — so on
// a coarse pointer the card's own surface arms no native drag source, and its
// text is not touch-selectable (a selectable title turns that same long press
// into a selection or an iOS callout). This file pins the CARD-side contract
// and its inverse: a fine pointer keeps every drag source armed, because the
// cursor reorder is load-bearing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The pointer the page reports. `coarse` is what a phone's
 * `(pointer: coarse)` / `(hover: none)` pair answers; false is a mouse.
 */
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

type CardProps = Parameters<typeof ThreadCard>[0];

const parent = thread({
  id: "thr_parent",
  displayTitle: "Parent task",
  status: "idle",
  updatedAt: 5_000_000,
});
const child = thread({
  id: "thr_child",
  parentThreadId: "thr_parent",
  displayTitle: "Child task",
  status: "idle",
  updatedAt: 4_900_000,
});

function renderCard(overrides: Partial<CardProps> = {}) {
  const props = {
    thread: parent,
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    rankKey: "status:idle",
    childThreads: [child],
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

const cardAnchor = () =>
  document.querySelector(`[data-thread-card="${parent.id}"] a`) as HTMLElement | null;
const cardRoot = () =>
  document.querySelector(`div[data-thread-card="${parent.id}"]`) as HTMLElement | null;

describe("a touch card arms no native drag source (issue #328)", () => {
  it("a coarse pointer leaves the card's anchor not draggable", () => {
    stubPointer(true);
    renderCard();
    expect(cardAnchor()?.getAttribute("draggable")).toBe("false");
  });

  it("a fine pointer keeps the cursor drag armed", () => {
    stubPointer(false);
    renderCard();
    expect(cardAnchor()?.getAttribute("draggable")).toBe("true");
  });

  it("a coarse pointer leaves a nested child row not draggable, so a row cannot lift off the card", () => {
    stubPointer(true);
    renderCard();
    const row = document.querySelector(`[data-thread-card="${child.id}"]`);
    expect(row).toBeInstanceOf(HTMLElement);
    expect(row?.getAttribute("draggable")).toBe("false");
  });

  it("a fine pointer keeps the nested row a drag source (the un-parent gesture)", () => {
    stubPointer(false);
    renderCard();
    expect(
      document.querySelector(`[data-thread-card="${child.id}"]`)?.getAttribute("draggable"),
    ).toBe("true");
  });
});

describe("a touch card's own text is not selectable (issue #328)", () => {
  it("the card root carries the touch-only selection block", () => {
    stubPointer(true);
    renderCard();
    // The utility is scoped to `hover: none`, so a desktop pointer keeps
    // selecting card text: the class is the whole contract.
    expect(cardRoot()?.className).toContain("[@media(hover:none)]:select-none");
  });
});

describe("a snapped dot stays a fine-pointer gesture (issue #249 x #328)", () => {
  const dotDrag = {
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
  };
  const renderStrip = () =>
    renderCard({ isCollapsed: true, childDotDrag: dotDrag } as Partial<CardProps>);
  const dot = () =>
    document.querySelector(`[data-child-dot="${child.id}"]`) as HTMLElement | null;

  it("a coarse pointer leaves the strip's dot not draggable", () => {
    stubPointer(true);
    renderStrip();
    expect(dot()).toBeInstanceOf(HTMLElement);
    expect(dot()?.getAttribute("draggable")).toBe("false");
  });

  it("a fine pointer keeps the dot draggable, so the tier reorder survives", () => {
    stubPointer(false);
    renderStrip();
    expect(dot()?.getAttribute("draggable")).toBe("true");
  });
});

describe("the card's own snooze refusal still wins on a fine pointer", () => {
  it("a snoozed card is not a drag source even with a mouse", () => {
    stubPointer(false);
    renderCard({ snoozeFor: () => 9_000_000 } as Partial<CardProps>);
    expect(cardAnchor()?.getAttribute("draggable")).toBe("false");
  });
});
