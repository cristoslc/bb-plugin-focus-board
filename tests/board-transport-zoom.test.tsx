// @vitest-environment jsdom
// The zoom transport variant at the Board seam: a card relocating zooms OUT
// (the old slot's reserved space collapses IN TIME WITH the shrink), and the
// arriving card zooms IN with its slot's space growing on the SAME clock, so
// the space and the card land together. The dissolve variant (the default,
// pinned in tests/board-transport.test.tsx) stays untouched — these tests
// play the board with transportVariant="zoom" through the selection seam.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import type { GroupBoxMap } from "../components/group-boxes";
import {
  TRANSPORT_ZOOM_IN_MS,
  TRANSPORT_ZOOM_OUT_MS,
  LOAD_TRANSPORT_MOUNT_GUARD_MS,
} from "../components/card-transport";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * The load-echo mount guard (issue #373): the board arms no transport play
 * within LOAD_TRANSPORT_MOUNT_GUARD_MS of its first lane-map seed. The
 * relocation pins walk their mounts past the window with the same fake clock
 * the phase timers ride, so the law these suites prove stays the post-window
 * one: every move after the load echo plays.
 */
async function pastLoadEcho(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(LOAD_TRANSPORT_MOUNT_GUARD_MS + 50);
  });
}

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function boardProps(
  threads: readonly PluginSidebarThread[],
  extra?: { groupBoxOf?: GroupBoxMap; matchMedia?: (query: string) => { matches: boolean } },
) {
  return {
    groupBy: "status" as const,
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    transportVariant: "zoom" as const,
    ...(extra?.groupBoxOf !== undefined ? { groupBoxOf: extra.groupBoxOf } : {}),
  } as unknown as BoardProps;
}

/** A card's relocation commit: one unread card pinning itself in one commit. */
function moveScenario() {
  const before = [
    thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
  ];
  const after = [
    thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
  ];
  return { before, after };
}

describe("a card relocating under the zoom variant", () => {
  it("the old slot collapses in time with the shrink — not after the fade like the dissolve", async () => {
    vi.useFakeTimers();
    const { before, after } = moveScenario();
    const { rerender } = render(<Board {...boardProps(before)} />);
    // Past the load-echo window (issue #373): this pin relocates a card
    // deliberately, so the pin proves the zoom law post-window.
    await pastLoadEcho();
    rerender(<Board {...boardProps(after)} />);
    // A tick past the plan's clock-zero collapse: the dissolve holds its
    // ghost slot open through a 400ms wipe BEFORE collapsing; the zoom's
    // slot close starts with the shrink, so the ghost is already "collapsing".
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    const oldLane = document.querySelector('[data-column-id="unread"]');
    const ghost = oldLane?.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-transport-out")).toBe("collapsing");

    // The new lane's card is hidden and clipped shut until the zoom-in lifts
    // it while its slot's space grows on the same clock.
    const newLane = document.querySelector('[data-column-id="pinned"]');
    const arrival = newLane?.querySelector("[data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    // The zoom's fade/scale lives on the card wrapper inside the slot; the
    // slot li itself only clips (grow target, never fade target).
    expect(arrival?.getAttribute("style")).not.toContain("opacity");
    expect(arrival?.querySelector("[data-transport-fade]")?.getAttribute("style")).toContain(
      "opacity: 0",
    );
    expect(arrival?.getAttribute("style")).toContain("max-height");
    expect(arrival?.getAttribute("style")).toContain("overflow");
  });

  it("plays no shimmer — the glint field is the dissolve's beam, not the zoom's portal", async () => {
    vi.useFakeTimers();
    const { before, after } = moveScenario();
    const { rerender } = render(<Board {...boardProps(before)} />);
    await pastLoadEcho();
    rerender(<Board {...boardProps(after)} />);
    expect(document.querySelectorAll("[data-transport-sparks]")).toHaveLength(0);
    expect(document.querySelectorAll("[data-transport-spark]")).toHaveLength(0);
  });

  it("resolves on the zoom clocks: the arrival settles and the ghost slot is gone", async () => {
    vi.useFakeTimers();
    const { before, after } = moveScenario();
    const { rerender } = render(<Board {...boardProps(before)} />);
    await pastLoadEcho();
    rerender(<Board {...boardProps(after)} />);
    // The remove clock (the shrink's end) is the clocks' shared tail: one
    // advance past it clears BOTH sides — the growth clock equals it and the
    // arrival settled with it.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_ZOOM_OUT_MS + 5);
    });
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
    expect(document.querySelector("[data-transport-out]")).toBeNull();
    expect(document.querySelector('[data-column-id="pinned"]')?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
    // The advance covered both clocks (they are equal): the growth clock
    // resolved with the shrink's, space and card together.
    expect(TRANSPORT_ZOOM_IN_MS).toBe(TRANSPORT_ZOOM_OUT_MS);
  });
});

describe("a box run under the zoom variant", () => {
  it("zooms as ONE dashed container in the old lane and at the new one", async () => {
    vi.useFakeTimers();
    const m1 = thread({ id: "thr_m1", isUnread: true, updatedAt: NOW - 1000 });
    const m2 = thread({ id: "thr_m2", isUnread: true, updatedAt: NOW - 2000 });
    const companion = thread({ id: "thr_x", isUnread: true, updatedAt: NOW });
    const before = [m1, m2, companion];
    const after = [
      thread({ id: "thr_m1", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_m2", isPinned: true, pinnedAt: 2, pinSortKey: 2, updatedAt: NOW - 2000 }),
      thread({ id: "thr_x", isUnread: true, updatedAt: NOW - 3000 }),
    ];
    const box = { groupId: "grp_1", name: "Feature", members: [m1, m2] };
    const groupBoxOf: GroupBoxMap = new Map([
      ["thr_m1", box],
      ["thr_m2", box],
    ]);
    const { rerender } = render(<Board {...boardProps(before, { groupBoxOf })} />);
    await pastLoadEcho();
    rerender(<Board {...boardProps(after, { groupBoxOf })} />);
    // A tick past clock zero: the zoom's slot close is already running (the
    // dissolve would still hold "wiping-out" here until its wipe finishes).
    await act(async () => {
      vi.advanceTimersByTime(5);
    });
    // One ghost: the box container itself, holding both members — the box
    // zooms as a container, never per member.
    const oldLane = document.querySelector('[data-column-id="unread"]');
    const ghostContainer = oldLane?.querySelector("[data-group-box][data-transport-ghost]");
    expect(ghostContainer).not.toBeNull();
    expect(ghostContainer?.getAttribute("data-transport-out")).toBe("collapsing");
    expect(oldLane?.querySelectorAll("[data-transport-ghost]")).toHaveLength(1);
    expect(ghostContainer?.querySelector('[data-thread-card="thr_m1"]')).not.toBeNull();
    expect(ghostContainer?.querySelector('[data-thread-card="thr_m2"]')).not.toBeNull();

    // The new lane: the box arrives as one dashed shape, clipped shut until
    // the zoom-in and its same-clock slot growth open it.
    const newLane = document.querySelector('[data-column-id="pinned"]');
    const arrival = newLane?.querySelector("[data-group-box][data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    expect(arrival?.getAttribute("style")).toContain("max-height");

    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_ZOOM_OUT_MS + 5);
    });
    expect(document.querySelector("[data-transport-out]")).toBeNull();
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
    const settledBox = newLane?.querySelector("[data-group-box]");
    expect(settledBox?.querySelectorAll('[data-thread-card="thr_m1"], [data-thread-card="thr_m2"]')).toHaveLength(2);
  });
});

describe("the zoom keeps the planner's guardrails", () => {
  it("a batch over the cap stays a plain reflow", async () => {
    vi.useFakeTimers();
    const before = Array.from({ length: 15 }, (_, index) =>
      thread({ id: `thr_${index}`, isUnread: true, updatedAt: NOW - index - 1 }),
    );
    const after = Array.from({ length: 15 }, (_, index) =>
      thread({ id: `thr_${index}`, isPinned: true, pinnedAt: 1, pinSortKey: index, updatedAt: NOW - index - 1 }),
    );
    const { rerender } = render(<Board {...boardProps(before)} />);
    await pastLoadEcho();
    rerender(<Board {...boardProps(after)} />);
    expect(document.querySelector("[data-transport-out]")).toBeNull();
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
  });

  it("prefers-reduced-motion reduces the zoom to an instant swap: no hiding, no shimmer, phases resolve", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener() {},
      removeEventListener() {},
    }));
    try {
      const { before, after } = moveScenario();
      const { rerender } = render(<Board {...boardProps(before)} />);
      await pastLoadEcho();
      rerender(<Board {...boardProps(after)} />);
      // The arriving card is never hidden behind static styles: it is a
      // plain visible card in its lane's flow from the first commit (no
      // opacity/max-height clip, nothing that scales or fades).
      const newLane = document.querySelector('[data-column-id="pinned"]');
      const arrival = newLane?.querySelector("[data-transport-arrival]");
      expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
      expect(arrival?.getAttribute("style") ?? "").not.toContain("opacity");
      expect(arrival?.getAttribute("style") ?? "").not.toContain("max-height");
      // No fade wrapper, or an inert one: the card is visible either way.
      expect(arrival?.querySelector("[data-transport-fade]")?.getAttribute("style") ?? "").not.toContain(
        "opacity: 0",
      );
      expect(arrival?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
      expect(document.querySelectorAll("[data-transport-sparks]")).toHaveLength(0);

      // The phases still resolve: the ghost's slot hands off (collapses
      // instantly — no animation), then removes cleanly.
      await act(async () => {
        vi.advanceTimersByTime(TRANSPORT_ZOOM_OUT_MS + 5);
      });
      expect(document.querySelector("[data-transport-out]")).toBeNull();
      expect(document.querySelector("[data-transport-arrival]")).toBeNull();
      expect(newLane?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});