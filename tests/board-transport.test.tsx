// @vitest-environment jsdom
// The transport dissolve: a card relocating between lanes wipes out in its
// old lane (its slot stays put until the wipe finishes, then collapses) and
// wipes in at its new lane (the slot is present from wipe-in's first frame,
// so the lane reflows when the wipe starts). Pinned at the Board seam: the
// column diff the planner sees and the phases the timers advance.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import type { GroupBoxMap } from "../components/group-boxes";
import {
  TRANSPORT_WIPE_IN_MS,
  TRANSPORT_WIPE_OUT_MS,
  TRANSPORT_COLLAPSE_MS,
  TRANSPORT_SPARK_COUNT,
  LOAD_TRANSPORT_MOUNT_GUARD_MS,
} from "../components/card-transport";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function boardProps(
  groupBy: "status" | "none",
  threads: readonly PluginSidebarThread[],
  groupBoxOf?: GroupBoxMap,
  overrides?: Record<string, unknown>,
) {
  return {
    groupBy,
    columns: buildColumns(threads, groupBy, context, new Map(), new Set<string>(), NOW, {}),
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
    ...overrides,
    ...(groupBoxOf !== undefined ? { groupBoxOf } : {}),
  } as unknown as BoardProps;
}

/**
 * The load-echo mount guard (issue #373): the board arms no transport play
 * within LOAD_TRANSPORT_MOUNT_GUARD_MS of its first lane-map seed. The
 * relocation pins walk their mounts past the window with the same fake clock
 * the phase timers ride, so the law these suites prove stays the post-window
 * one: every move after the load echo dissolves.
 */
async function pastLoadEcho(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(LOAD_TRANSPORT_MOUNT_GUARD_MS + 50);
  });
}

describe("a card relocating between lanes plays the transport dissolve", () => {
  it("the old lane keeps the card in place while it wipes, the new lane reflows as the wipe-in starts", async () => {
    vi.useFakeTimers();
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    // The dissolve pins declare the variant at the harness seam explicitly:
    // the default cardTransport read is zoom now, and these pins speak the
    // dissolve variant by name (the zoom pins do the same for zoom in
    // tests/board-transport-zoom.test.tsx).
    const { rerender } = render(
      <Board {...boardProps("status", before, undefined, { transportVariant: "dissolve" })} />,
    );
    // Moved to past the load-echo window (issue #373): the mount-age guard
    // withholds plays for the board's own echo; this pin relocates a card
    // deliberately, so the walk proves the dissolve law post-window.
    await pastLoadEcho();
    rerender(
      <Board {...boardProps("status", after, undefined, { transportVariant: "dissolve" })} />,
    );

    // Old lane: a ghost holds the slot (aria-hidden, inert to clicks) while
    // the wipe-out runs.
    const oldLane = document.querySelector('[data-column-id="unread"]');
    expect(oldLane).not.toBeNull();
    const ghost = oldLane?.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-transport-out")).toBe("wiping-out");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost?.className).toContain("pointer-events-none");

    // New lane: the card is in the flow from wipe-in's first frame — the
    // SLOT is clipped shut and opens via the grow animation, while the FADE
    // lives on the card wrapper INSIDE the slot: the amber glint layer sits
    // outside that fade and stays fully visible for the whole arrival
    // (the glints must not inherit the card's dissolve opacity).
    const newLane = document.querySelector('[data-column-id="pinned"]');
    expect(newLane).not.toBeNull();
    const arrival = newLane?.querySelector("[data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    expect(arrival?.getAttribute("style")).not.toContain("opacity");
    expect(arrival?.getAttribute("style")).toContain("max-height");
    expect(arrival?.getAttribute("style")).toContain("overflow");
    const fade = arrival?.querySelector("[data-transport-fade]");
    expect(fade ?? null).not.toBeNull();
    expect(fade?.getAttribute("style")).toContain("opacity");
    expect(fade?.getAttribute("style")).toContain("opacity: 0");
    // The glint layer rides the slot, not the fade: full brightness for the
    // entire arrival sequence.
    expect(
      arrival?.querySelector("[data-transport-sparks]")?.closest("[data-transport-fade]") ?? null,
    ).toBeNull();

    // The shimmer: BOTH sweeps carry the spark field — the dissolving ghost
    // and the materializing arrival each render one layer of glints. Departure
    // keeps the silver field rising (out tone); the arrival wears amber and
    // descends (in tone): departing is up, arriving is down.
    expect(document.querySelectorAll("[data-transport-sparks]")).toHaveLength(2);
    const arrivalSparks = arrival?.querySelector("[data-transport-sparks]");
    const ghostSparks = ghost?.querySelector("[data-transport-sparks]");
    expect(arrivalSparks ?? null).not.toBeNull();
    expect(arrivalSparks?.getAttribute("data-transport-spark-tone")).toBe("in");
    expect(ghostSparks?.getAttribute("data-transport-spark-tone")).toBe("out");
    // The palettes: the arrival's amber beam versus the ghost's kept silver
    // (jsdom normalizes the hex literals to rgb()).
    expect(arrivalSparks?.querySelector("[data-transport-spark]")?.style.background).toContain(
      "rgb(253, 230, 138)",
    );
    expect(ghostSparks?.querySelector("[data-transport-spark]")?.style.background).toContain(
      "rgb(186, 230, 253)",
    );
    // Each glint carries its own life state, and the effect animates THAT
    // state — the fields the layer rendered and the fields the start effect
    // animates cannot desync (a recomputed default once gave every arrival
    // glint an upward drift). The DOM directions ARE the travel directions:
    // amber arrives falling, silver departs rising.
    const glintDirections = (layer: Element | null | undefined) =>
      Array.from(layer?.querySelectorAll("[data-transport-spark]") ?? []).map(
        (glint) =>
          (JSON.parse(glint.getAttribute("data-spark-state") ?? "null") as
            | { direction?: string }
            | null)?.direction,
      );
    expect(glintDirections(arrivalSparks)).toHaveLength(TRANSPORT_SPARK_COUNT);
    expect(glintDirections(arrivalSparks).every((direction) => direction === "down")).toBe(true);
    expect(glintDirections(ghostSparks).every((direction) => direction === "up")).toBe(true);
    expect(arrival?.querySelectorAll("[data-transport-spark]")).toHaveLength(
      TRANSPORT_SPARK_COUNT,
    );
    expect(ghost?.querySelectorAll("[data-transport-spark]")).toHaveLength(
      TRANSPORT_SPARK_COUNT,
    );

    // Wipe-in finishes first: the arriving slot drops its hiding styles and
    // the transport attribute (the card is an ordinary card again).
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_IN_MS + 5);
    });
    expect(document.querySelector('[data-transport-arrival]')).toBeNull();
    expect(newLane?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
    // The arrival's spark layer goes with it: no glints ever sit on a
    // settled card. The fade wrapper goes with it too: the card renders
    // bare again.
    expect(newLane?.querySelector("[data-transport-sparks]")).toBeNull();
    expect(newLane?.querySelector("[data-transport-fade]")).toBeNull();

    // The wipes are symmetric (equal durations): when the arrival settles,
    // the old slot's wipe is done too, and the collapse is already closing
    // its reserved space.
    const collapsing = oldLane?.querySelector('[data-transport-out="collapsing"]');
    expect(collapsing).not.toBeNull();
    expect(collapsing?.getAttribute("style")).toContain("max-height");

    // Collapse finished: the ghost slot is gone entirely (the old lane is
    // laid out as if the card had never stayed).
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_COLLAPSE_MS + 5);
    });
    expect(oldLane?.querySelector("[data-transport-out]")).toBeNull();
    // The ghost's spark layer went with the ghost: the board holds no
    // leftover glints after the dissolve.
    expect(document.querySelectorAll("[data-transport-spark]")).toHaveLength(0);
  });

  it("a same-commit batch bigger than the cap is a plain reflow, not a wall of wipes", () => {
    vi.useFakeTimers();
    const before = Array.from({ length: 15 }, (_, index) =>
      thread({ id: `thr_${index}`, isUnread: true, updatedAt: NOW - index - 1 }),
    );
    // All 15 flip to Pinned in one commit: a batch this whole (a
    // multi-select gesture, a sweep confirm) reads as a curation wave, not a
    // card relocating its home lane, so the board reflows instead of
    // dissolving every card at once.
    const after = Array.from({ length: 15 }, (_, index) =>
      thread({ id: `thr_${index}`, isPinned: true, pinnedAt: 1, pinSortKey: index, updatedAt: NOW - index - 1 }),
    );
    const { rerender } = render(<Board {...boardProps("status", before)} />);
    rerender(<Board {...boardProps("status", after)} />);
    expect(document.querySelector("[data-transport-out]")).toBeNull();
  });

  it("a grouping change re-derives every lane at once and reads as a view switch (no transports)", () => {
    vi.useFakeTimers();
    const before = [thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 })];
    const after = [thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 })];
    const { rerender } = render(<Board {...boardProps("status", before)} />);
    rerender(<Board {...boardProps("none", after)} />);
    expect(document.querySelector("[data-transport-out]")).toBeNull();
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
  });
});

describe("a relocation that empties its lane holds the departing ghost (issue #391)", () => {
  it("the closed lane's frame outlives its own data so the dissolve finishes, then closes with the ghost", async () => {
    vi.useFakeTimers();
    // thr_a is the Unread lane's ONLY card; thr_b keeps a second lane
    // standing beside it.
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", hasPendingInteraction: true, updatedAt: NOW - 2000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", hasPendingInteraction: true, updatedAt: NOW - 2000 }),
    ];
    const { rerender } = render(
      <Board {...boardProps("status", before, undefined, { transportVariant: "dissolve" })} />,
    );
    await pastLoadEcho();
    rerender(<Board {...boardProps("status", after, undefined, { transportVariant: "dissolve" })} />);

    // `buildColumns` drops a lane once it holds no cards ("columns exist only
    // while they hold cards"), but a departing ghost has nowhere to dissolve
    // if the frame goes with it. The lane that closed underneath its ghost
    // therefore keeps its own frame — the space that already renders
    // departing ghosts — for the transport's own remove tick.
    const heldLane = document.querySelector('[data-column-id="unread"]');
    expect(heldLane).not.toBeNull();
    expect(heldLane?.hasAttribute("data-column-closing")).toBe(true);
    const ghost = heldLane?.querySelector("[data-transport-out]");
    expect(ghost?.getAttribute("data-transport-out")).toBe("wiping-out");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    // The held frame sits where the lane sat in the row — after the lane it
    // followed before the move, not shoved to the row's end.
    expect(
      [...document.querySelectorAll("[data-column-id]")].map((el) =>
        el.getAttribute("data-column-id"),
      ),
    ).toEqual(["pinned", "attention", "unread", "working"]);

    // The wipe plays to its end and hands over to the collapse: a ghost that
    // unmounted with the lane would have ended here, at the lane's closure.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_OUT_MS + 5);
    });
    expect(
      document.querySelector('[data-column-id="unread"] [data-transport-out="collapsing"]'),
    ).not.toBeNull();

    // The phase plan's remove tick closes the frame and the ghost together:
    // the hold lives exactly the dissolve's remainder, never longer.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_COLLAPSE_MS + 5);
    });
    expect(document.querySelector('[data-column-id="unread"]')).toBeNull();
    expect(document.querySelector("[data-transport-out]")).toBeNull();
  });

  it("a relocation that leaves its lane populated holds nothing: the lane stays its own data's", async () => {
    vi.useFakeTimers();
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const { rerender } = render(
      <Board {...boardProps("status", before, undefined, { transportVariant: "dissolve" })} />,
    );
    await pastLoadEcho();
    rerender(<Board {...boardProps("status", after, undefined, { transportVariant: "dissolve" })} />);

    // The lane still holds thr_b, so it is a lane of the board's own data:
    // the ghost weaves into it and no hold is needed (and none may appear —
    // a held frame would be a second lane carrying the same id).
    const lane = document.querySelector('[data-column-id="unread"]');
    expect(lane).not.toBeNull();
    expect(lane?.hasAttribute("data-column-closing")).toBe(false);
    expect(lane?.querySelector("[data-transport-out]")).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_OUT_MS + TRANSPORT_COLLAPSE_MS + 10);
    });
    const settled = document.querySelector('[data-column-id="unread"]');
    expect(settled?.querySelector("[data-transport-out]")).toBeNull();
    expect(settled?.querySelector('[data-thread-card="thr_b"]')).not.toBeNull();
  });
});

describe("the load-echo mount guard (issue #373)", () => {
  it("a relocation within the first lane-map seed's window lands in place: no ghost, no arrival, the final layout held", async () => {
    vi.useFakeTimers();
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
      thread({ id: "thr_c", isUnread: true, updatedAt: NOW - 3000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
      thread({ id: "thr_c", isUnread: true, updatedAt: NOW - 3000 }),
    ];
    const { rerender } = render(
      <Board {...boardProps("status", before, undefined, { transportVariant: "dissolve" })} />,
    );
    // The mount echo's own relocation (the done projection, a feature-group
    // box coalescing): within the window it applies the final layout
    // directly — the lanes land exactly where the play would have left them,
    // with nothing dissolving.
    rerender(<Board {...boardProps("status", after, undefined, { transportVariant: "dissolve" })} />);
    expect(document.querySelector("[data-transport-ghost]")).toBeNull();
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
    // The final layout is the landed one, unclipped: the card sits in its
    // new lane's flow, and the old lane reflects the removal.
    const newLane = document.querySelector('[data-column-id="pinned"]');
    expect(newLane?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
    expect(newLane?.querySelector("[style*='max-height']")).toBeNull();
    expect(document.querySelectorAll('[data-column-id="unread"] [data-thread-card]')).toHaveLength(2);
    // The window expires: the NEXT relocation arms the dissolve exactly as
    // before the guard (the mechanism's post-window law, the same shape the
    // suites above pin). Three cards so the old lane keeps a resident: a lane
    // that empties now holds its own frame for the dissolve (issue #391's
    // suite), and this pin is about the guard's boundary, not that hold.
    await pastLoadEcho();
    const further = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isPinned: true, pinnedAt: 2, pinSortKey: 2, updatedAt: NOW - 2000 }),
      thread({ id: "thr_c", isUnread: true, updatedAt: NOW - 3000 }),
    ];
    rerender(<Board {...boardProps("status", further, undefined, { transportVariant: "dissolve" })} />);
    const ghost = document.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-transport-out")).toBe("wiping-out");
    expect(document.querySelector('[data-column-id="unread"]')?.querySelector("[data-transport-ghost]")).not.toBeNull();
  });
});

describe("a box run relocating between lanes transports as ONE unit", () => {
  function boxScenario() {
    const before = [
      thread({ id: "thr_m1", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_m2", isUnread: true, updatedAt: NOW - 2000 }),
      // Companion on TOP of the old lane (newest): the box's true old slot
      // is second, so a top-woven ghost cannot fake the assertion.
      thread({ id: "thr_x", isUnread: true, updatedAt: NOW }),
    ];
    const after = [
      thread({ id: "thr_m1", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_m2", isPinned: true, pinnedAt: 2, pinSortKey: 2, updatedAt: NOW - 2000 }),
      thread({ id: "thr_x", isUnread: true, updatedAt: NOW - 3000 }),
    ];
    const m1 = before[0];
    const m2 = before[1];
    const box = { groupId: "grp_1", name: "Feature", members: [m1, m2] };
    const groupBoxOf: GroupBoxMap = new Map([
      ["thr_m1", box],
      ["thr_m2", box],
    ]);
    return { before, after, groupBoxOf };
  }

  it("the dashed container wipes out whole in the old lane and wipes in whole at the new one", async () => {
    vi.useFakeTimers();
    const { before, after, groupBoxOf } = boxScenario();
    // Dissolve-variant pin: the variant that carries the glint shimmer, so
    // this suite keeps speaking the box's one-shape dissolve by name.
    const { rerender } = render(
      <Board
        {...boardProps("status", before, groupBoxOf, { transportVariant: "dissolve" })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board {...boardProps("status", after, groupBoxOf, { transportVariant: "dissolve" })} />,
    );

    // Old lane: ONE ghost — the dashed box container itself, holding both
    // member cards — not two per-card ghosts.
    const oldLane = document.querySelector('[data-column-id="unread"]');
    expect(oldLane).not.toBeNull();
    const ghostContainer = oldLane?.querySelector(
      "[data-group-box][data-transport-ghost]",
    );
    expect(ghostContainer).not.toBeNull();
    expect(ghostContainer?.getAttribute("data-transport-out")).toBe("wiping-out");
    expect(ghostContainer?.getAttribute("aria-hidden")).toBe("true");
    expect(ghostContainer?.querySelectorAll("[data-transport-ghost]")).toHaveLength(0);
    expect(ghostContainer?.querySelector('[data-thread-card="thr_m1"]')).not.toBeNull();
    expect(ghostContainer?.querySelector('[data-thread-card="thr_m2"]')).not.toBeNull();
    // Exactly one transport ghost in the lane: the container only.
    expect(oldLane?.querySelectorAll("[data-transport-ghost]")).toHaveLength(1);
    // The box's spark layer rides INSIDE the dashed container: the whole
    // box shimmers as one shape, not one glint field per member card.
    expect(ghostContainer?.querySelector("[data-transport-sparks]")).not.toBeNull();
    // The ghost holds the box's TRUE old slot: second in the lane (thr_x's
    // slot came first before the move), not the lane top. A ghost woven at
    // the top would read as a random card dissolving, not this box leaving.
    // (toBeTruthy, not not.toBeNull(): an optional-chained undefined passes
    // the latter and would make a top-woven ghost read as "placed right".)
    expect(
      ghostContainer?.previousElementSibling?.querySelector('[data-thread-card="thr_x"]') ?? null,
    ).not.toBeNull();
    expect(ghostContainer).not.toBeNull();
    expect(ghostContainer?.previousElementSibling).not.toBeNull();

    // New lane: the box arrives as one dashed container — the SLOT li is
    // clipped shut (grow target only), and the fade lives on the dashed
    // container inside it, with the glint layer riding outside the fade.
    const newLane = document.querySelector('[data-column-id="pinned"]');
    expect(newLane?.querySelector("[data-group-box][data-transport-arrival]")).not.toBeNull();
    const arrival = newLane?.querySelector("[data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    expect(arrival?.getAttribute("style")).not.toContain("opacity");
    expect(arrival?.getAttribute("style")).toContain("max-height");
    expect(arrival?.getAttribute("style")).toContain("overflow");
    const boxFade = arrival?.querySelector("[data-transport-fade]");
    expect(boxFade ?? null).not.toBeNull();
    expect(boxFade?.getAttribute("style")).toContain("opacity: 0");
    expect(arrival?.querySelector("[data-transport-sparks]")?.closest("[data-transport-fade]") ?? null).toBeNull();

    // Wipe-in lands: the box drops its hiding styles and is an ordinary box.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_IN_MS + 5);
    });
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
    const settledBox = newLane?.querySelector("[data-group-box]");
    expect(settledBox?.querySelectorAll('[data-thread-card="thr_m1"], [data-thread-card="thr_m2"]')).toHaveLength(2);

    // The wipes are symmetric (equal durations): when the box un-hides, the
    // container ghost's wipe is done too (the phase rides the same container
    // li the ghost attrs sit on).
    const collapsing = oldLane?.querySelector('[data-transport-out="collapsing"]');
    expect(collapsing?.getAttribute("style")).toContain("max-height");

    // Collapse finished: the container ghost is gone entirely.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_COLLAPSE_MS + 5);
    });
    expect(oldLane?.querySelector("[data-transport-out]")).toBeNull();
  });

  it("a whole-box move counts as ONE unit, so a 13-member box stays under the batch cap", async () => {
    vi.useFakeTimers();
    const members = Array.from({ length: 13 }, (_, index) =>
      thread({ id: `thr_m${index}`, isUnread: true, updatedAt: NOW - index - 1 }),
    );
    const box = { groupId: "grp_1", name: "Big", members };
    const groupBoxOf: GroupBoxMap = new Map(
      members.map((member) => [member.id, box]),
    );
    // A companion thread keeps the old lane populated, so the box's ghost
    // weaves into a lane that is its own data's (an emptied lane would hold a
    // frame of its own instead — issue #391's suite pins that shape).
    const companion = thread({ id: "thr_x", isUnread: true, updatedAt: NOW });
    const before = [...members, companion];
    const after = [
      ...members.map((member, index) => ({
        ...member,
        isUnread: false,
        isPinned: true,
        pinnedAt: index + 1,
        pinSortKey: index,
      })) as PluginSidebarThread[],
      companion,
    ];
    const { rerender } = render(<Board {...boardProps("status", before, groupBoxOf)} />);
    await pastLoadEcho();
    rerender(<Board {...boardProps("status", after, groupBoxOf)} />);
    // 13 per-card moves would exceed the cap and reflow; the collapsed unit
    // dissolves as one box instead.
    expect(document.querySelector("[data-group-box][data-transport-ghost]")).not.toBeNull();
    expect(document.querySelectorAll("[data-transport-ghost]")).toHaveLength(1);
  });
});

describe("cardTransport: the shipped default is zoom; none teleports instantly", () => {
  const before = [
    thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
  ];
  const after = [
    thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
  ];

  it("none plans no ghost and no arrival slot — the card teleports", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Board {...boardProps("status", before, undefined, { cardTransport: "none" })} />,
    );
    rerender(<Board {...boardProps("status", after, undefined, { cardTransport: "none" })} />);
    expect(document.querySelector("[data-transport-out]")).toBeNull();
    expect(document.querySelector("[data-transport-in]")).toBeNull();
    expect(document.querySelector("[data-transport-ghost]")).toBeNull();
  });

  it("teleport plans the dissolve, sparks included — distinct from the variant seam", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, {
          cardTransport: "teleport",
          transportVariant: "zoom", // even against the harness seam's zoom
        })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, {
          cardTransport: "teleport",
          transportVariant: "zoom",
        })}
      />,
    );
    expect(document.querySelector("[data-transport-out]")).not.toBeNull();
    expect(document.querySelector("[data-transport-sparks]")).not.toBeNull();
  });

  it("zoom chosen explicitly matches the variant seam's zoom read (no sparks)", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, { cardTransport: "zoom" })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, { cardTransport: "zoom" })}
      />,
    );
    expect(document.querySelector("[data-transport-out]")).not.toBeNull();
    expect(document.querySelector("[data-transport-sparks]")).toBeNull();
  });

  it("the motion override suppresses the wipes without killing the choreography", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, { motionPref: "manual", motionPacing: "reduce" })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, { motionPref: "manual", motionPacing: "reduce" })}
      />,
    );
    // The ghost slots still exist (layout stays honest)...
    expect(document.querySelector("[data-transport-out]")).not.toBeNull();
    // ...but the shimmer field rides nothing: the glint layer only mounts
    // when motion is allowed.
    expect(document.querySelector("[data-transport-sparks]")).toBeNull();
  });
});

describe("the pacing preference stretches the transport's clock (issue #152)", () => {
  // The phase machine runs on plain timers even in jsdom (no WAAPI), so the
  // clock the pacing scales is pinned here at the state transitions, not the
  // visuals.
  const pacingBoard = async (motionPacing: number) => {
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, { transportVariant: "dissolve", motionPacing })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, { transportVariant: "dissolve", motionPacing })}
      />,
    );
    return document.querySelector("[data-transport-out]")!.getAttribute("data-transport-out");
  };

  it("stock pacing keeps the stock clock: the collapse starts at 400ms", async () => {
    vi.useFakeTimers();
    expect(await pacingBoard(1)).toBe("wiping-out");
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(
      document.querySelector("[data-transport-out]")!.getAttribute("data-transport-out"),
    ).toBe("collapsing");
  });

  it("a 2x pacing holds the ghost in its wipe past the stock collapse tick", async () => {
    vi.useFakeTimers();
    expect(await pacingBoard(2)).toBe("wiping-out");
    act(() => {
      vi.advanceTimersByTime(450);
    });
    // Stock would have flipped to collapsing at 400ms; the stretch holds it.
    expect(
      document.querySelector("[data-transport-out]")!.getAttribute("data-transport-out"),
    ).toBe("wiping-out");
    act(() => {
      vi.advanceTimersByTime(350); // 800ms total: 2x the stock collapse tick.
    });
    expect(
      document.querySelector("[data-transport-out]")!.getAttribute("data-transport-out"),
    ).toBe("collapsing");
  });

  it("a 4x pacing holds the ghost past every smaller notch's collapse tick", async () => {
    vi.useFakeTimers();
    expect(await pacingBoard(4)).toBe("wiping-out");
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(
      document.querySelector("[data-transport-out]")!.getAttribute("data-transport-out"),
    ).toBe("wiping-out");
    act(() => {
      vi.advanceTimersByTime(1150); // 1600ms total: 4x the stock collapse tick.
    });
    expect(
      document.querySelector("[data-transport-out]")!.getAttribute("data-transport-out"),
    ).toBe("collapsing");
  });

  it("the manual reduce notch suppresses the wipes with prolonged pacing nowhere in play", async () => {
    vi.useFakeTimers();
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, {
          transportVariant: "dissolve",
          motionPref: "manual",
          motionPacing: "reduce",
        })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, {
          transportVariant: "dissolve",
          motionPref: "manual",
          motionPacing: "reduce",
        })}
      />,
    );
    expect(document.querySelector("[data-transport-out]")).not.toBeNull();
    expect(document.querySelector("[data-transport-sparks]")).toBeNull();
  });
});

describe("the transport ghost never claims aria-current (issue #105)", () => {
  // activeThreadId selects a card, which mounts the keep-in-view effect —
  // jsdom has no ResizeObserver; the stub pattern the keep-in-view tests use.
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });
  // The active card relocating (pane open on it: a drop to Done, a pin) is
  // also THE card carrying `aria-current="true"`. Its ghost renders the same
  // markup card in the OLD lane — DOM-first for a forward move — and a
  // ghost anchor that still claims current makes the board's own active-card
  // locator (`a[aria-current="true"]`, scripts/uat run.mjs and any reader
  // trusting the marker) resolve a dissolving decoration that the correct
  // destination scroll has already left offscreen. The live card owns the
  // marker; the ghost keeps its old-slot visuals but never reports current.
  const before = [
    thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
  ];
  const after = [
    thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
  ];

  it("the dissolve ghost drops aria-current while keeping its active-slot visuals", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, {
          transportVariant: "dissolve",
          activeThreadId: "thr_a",
        })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, {
          transportVariant: "dissolve",
          activeThreadId: "thr_a",
        })}
      />,
    );

    // The setup is the one the bug needs: a ghost slot rendering the card...
    const ghost = document.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    // ...whose own anchor is still highlighted as the open card's slot, but
    // reports nothing about position: exactly ONE aria-current marker in the
    // document, and it is the live card's.
    const ghostAnchor = ghost?.querySelector("a[aria-current]");
    expect(ghostAnchor).toBeNull();
    const markers = document.querySelectorAll('a[aria-current="true"]');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest("[data-transport-ghost]")).toBeNull();
    // Inverse guard: the ghost's visuals are untouched — the dissolve is a
    // fade of the slot that WAS active, ring and all; only the aria marking
    // drops.
    expect(ghost?.querySelector("[data-thread-card] a")?.className).toContain("ring-2");
  });

  it("the zoom ghost never claims aria-current either", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Board
        {...boardProps("status", before, undefined, {
          cardTransport: "zoom",
          activeThreadId: "thr_a",
        })}
      />,
    );
    await pastLoadEcho();
    rerender(
      <Board
        {...boardProps("status", after, undefined, {
          cardTransport: "zoom",
          activeThreadId: "thr_a",
        })}
      />,
    );
    const ghost = document.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    expect(ghost?.querySelector("a[aria-current]")).toBeNull();
    const markers = document.querySelectorAll('a[aria-current="true"]');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest("[data-transport-ghost]")).toBeNull();
  });

  it("a nested child row marked active inside a relocating parent's ghost stays silent too", async () => {
    vi.useFakeTimers();
    // The ACTIVE card is the CHILD; the parent relocates lanes, so the ghost
    // dissolves with the child row inside it — a marker on the ghost's copy
    // of that row reads DOM-first in the old lane, the same trap as the
    // top-level case. A second, stationary unread thread keeps the old lane
    // rendered (a lane that empties out has nowhere to hold the ghost).
    const thrB = thread({ id: "thr_b", projectId: "proj_a", isUnread: true, updatedAt: NOW - 2000 });
    const before = [
      thread({ id: "thr_parent", projectId: "proj_a", isUnread: true, updatedAt: NOW - 1000 }),
      thrB,
    ];
    const after = [
      thread({
        id: "thr_parent",
        projectId: "proj_a",
        isPinned: true,
        pinnedAt: 1,
        pinSortKey: 1,
        updatedAt: NOW - 1000,
      }),
      thrB,
    ];
    const child = thread({
      id: "thr_child",
      projectId: "proj_a",
      parentThreadId: "thr_parent",
      updatedAt: NOW - 500,
    });
    const props = {
      ...boardProps("status", before, undefined, { transportVariant: "dissolve" }),
      activeThreadId: "thr_child",
      nestedChildrenByParent: new Map([["thr_parent", [child]]]),
    };
    const { rerender } = render(<Board {...(props as BoardProps)} />);
    await pastLoadEcho();
    rerender(<Board {...({ ...props, columns: buildColumns(after, "status", context, new Map(), new Set(), NOW, {})} as BoardProps)} />);

    // The ghost holds the card AND its nested rows; the child row inside it
    // is a decorative copy, so it never reports current. The live row under
    // the real card does.
    const ghost = document.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    expect(ghost?.querySelector("a[aria-current]")).toBeNull();
    const markers = document.querySelectorAll('a[aria-current="true"]');
    expect(markers).toHaveLength(1);
    expect(markers[0].closest("[data-transport-ghost]")).toBeNull();
  });
});