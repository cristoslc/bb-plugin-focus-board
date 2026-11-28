// @vitest-environment jsdom
// The Parent view's row sweep. The Focus view sweeps a status COLUMN; the
// Parent view sweeps a status ROW, whose cards are spread across every
// family lane. This suite pins that the row's affordance is the SAME
// vocabulary and the SAME eligibility law, expressed over the row's cards:
// the same pill, the same destinations, the same preselect/confirm flow, the
// same refusals, and the same exclusions (a live-child parent, a pinned
// thread, a non-sweepable row).
//
// The row's own candidates come from the app (which owns the sweep config,
// the done-age source, and the snooze set); these tests drive
// ParentLaneBoard directly and hand it the eligibility a row would report,
// so what is pinned here is the board's half of the contract: where the
// pill lives, what it says, what it reports, and which cards light up.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ParentLaneBoard } from "../components/parent-lane-board";
import { buildParentLanes, laneRowThreads } from "../components/parent-lanes";
import { armSweep } from "../lib/sweep";
import { thread } from "./thread-fixture";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

type BoardProps = Parameters<typeof ParentLaneBoard>[0];

afterEach(cleanup);

function renderBoard(
  threads: PluginSidebarThread[],
  overrides: Partial<BoardProps> = {},
) {
  const lanes = buildParentLanes(threads, new Set(), NOW);
  const props = {
    lanes,
    activeThreadId: null,
    doneIds: new Set<string>(),
    dimmedIds: new Set<string>(),
    childrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    projectNameFor: () => "Proj",
    repoBaseFor: () => null,
    parentLaneOrder: "recency" as const,
    onParentLaneOrderChange: vi.fn(),
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    // The sweep's wiring gate, as the Focus board's `baseProps` carries it:
    // the pill exists only when the caller wired the arm path.
    sweepCandidatesFor: () => [],
    onSweepArm: vi.fn(),
    ...overrides,
  } as unknown as BoardProps;
  return { props, lanes, ...render(<ParentLaneBoard {...props} />) };
}

/** Two families, one idle thread each, both long past the idle threshold.
 *  The row's cards therefore span two lanes — the union the row sweep acts
 *  on. Family A's child is the freshest, so lane A locks at index 0. */
function twoIdleFamilies() {
  const pa = thread({ id: "p_a", displayTitle: "Family A", updatedAt: NOW - DAY });
  const pb = thread({ id: "p_b", displayTitle: "Family B", updatedAt: NOW - 2 * DAY });
  const a0 = thread({ id: "a0", parentThreadId: "p_a", updatedAt: NOW - 40 * DAY });
  const b0 = thread({ id: "b0", parentThreadId: "p_b", updatedAt: NOW - 50 * DAY });
  return [pa, a0, pb, b0];
}

/** The pill for one row, by the row's rail position: the rail cells carry
 *  the buttons in row order, and each button's accessible name says which
 *  row's sweep it is. */
function sweepButtonForRow(label: string): HTMLButtonElement {
  const rail = document.querySelector("[data-rail]");
  if (rail === null) throw new Error("no rail");
  const cell = [...rail.children].find((child) =>
    child.textContent?.startsWith(label) &&
    child.querySelector("[data-sweep-button]") !== null,
  );
  const button = cell?.querySelector<HTMLButtonElement>("[data-sweep-button]");
  if (button === undefined || button === null) {
    throw new Error(`no sweep button for row ${label}`);
  }
  return button;
}

function cardAnchor(threadId: string): HTMLElement {
  const anchor = document.querySelector(
    `[data-thread-card="${threadId}"] a[draggable]`,
  );
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${threadId}`);
  return anchor;
}

describe("the row rail carries a sweep per sweepable row", () => {
  it("puts a pill on the Done and idle rows, and none on Needs you or Working", () => {
    renderBoard(twoIdleFamilies(), { sweepCandidatesFor: () => [] });
    // A sweep exists wherever sweepColumnKind says the row is sweepable.
    expect(sweepButtonForRow("Idle · A while ago")).toBeTruthy();
    expect(sweepButtonForRow("Done")).toBeTruthy();
    // ... and nowhere else: the rail still renders the labels, no pill.
    const rail = document.querySelector("[data-rail]")!;
    const cellLabelled = (label: string) =>
      [...rail.children].find((child) => child.textContent?.startsWith(label));
    for (const label of ["Needs you", "Working"]) {
      expect(cellLabelled(label)).toBeTruthy();
      expect(cellLabelled(label)?.querySelector("[data-sweep-button]")).toBeNull();
    }
  });

  it("says nothing sweepable with the broom alone, and arms on click", () => {
    const onSweepArm = vi.fn();
    renderBoard(twoIdleFamilies(), {
      sweepCandidatesFor: () => [],
      onSweepArm,
    });
    const pill = sweepButtonForRow("Idle · A while ago");
    expect(pill.textContent).toBe("");
    fireEvent.click(pill);
    // The arm carries the row's rendered scope: both lanes' cards are on
    // screen in this fixture.
    expect(onSweepArm).toHaveBeenCalledWith("idle-awhile", ["a0", "b0"]);
  });

  it("shows the row's candidate count, and the destination word armed", () => {
    renderBoard(twoIdleFamilies(), {
      sweepCandidatesFor: (rowId) => (rowId === "idle-awhile" ? ["a0", "b0"] : []),
    });
    expect(sweepButtonForRow("Idle · A while ago").textContent).toBe("2");
    // Armed, the pill names the destination — the same map the Focus view
    // uses, so an idle row reads "Done" and a Done row reads "Archive".
    cleanup();
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("idle-awhile", ["a0", "b0"]),
      onSweepConfirm: vi.fn(),
    });
    expect(sweepButtonForRow("Idle · A while ago").textContent).toBe("2 → Done");
  });

  it("the Done row's pill reads its own destination", () => {
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("done", ["x"]),
      onSweepConfirm: vi.fn(),
    });
    expect(sweepButtonForRow("Done").textContent).toBe("1 → Archive");
  });
});

describe("card clicks curate the armed row across every lane", () => {
  it("every card of the row, in either family lane, highlights and toggles", () => {
    const onSweepToggle = vi.fn();
    const onOpenThread = vi.fn();
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("idle-awhile", ["a0"]),
      onSweepToggle,
      onOpenThread,
    });
    // Highlighted where it sits.
    expect(
      document
        .querySelector('[data-thread-card="a0"]')
        ?.hasAttribute("data-sweep-highlighted"),
    ).toBe(true);
    // The other lane's card in the same row is selectable, and clicking it
    // toggles the sweep instead of opening the pane.
    fireEvent.click(cardAnchor("b0"));
    expect(onSweepToggle).toHaveBeenCalledWith("b0");
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("a card outside the armed row still opens the pane", () => {
    const onOpenThread = vi.fn();
    const onSweepToggle = vi.fn();
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("done", []),
      onSweepToggle,
      onOpenThread,
    });
    fireEvent.click(cardAnchor("a0"));
    expect(onOpenThread).toHaveBeenCalledWith("a0");
    expect(onSweepToggle).not.toHaveBeenCalled();
  });

  it("a thread with live children refuses loudly and never toggles", () => {
    // Family A's child has a child of its own, so it is a live-child parent:
    // it may never join a removing arm's sweep.
    const parent = thread({ id: "p_a", displayTitle: "Family A", updatedAt: NOW - DAY });
    const mid = thread({ id: "a0", parentThreadId: "p_a", updatedAt: NOW - 40 * DAY });
    const leaf = thread({ id: "a0c", parentThreadId: "a0", updatedAt: NOW - 40 * DAY });
    const onSweepToggle = vi.fn();
    renderBoard([parent, mid, leaf], {
      armedSweep: armSweep("idle-awhile", []),
      sweepBlockedIds: new Set(["a0"]),
      onSweepToggle,
    });
    fireEvent.click(cardAnchor("a0"));
    expect(onSweepToggle).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='sweep-refusal']")?.textContent).toContain(
      "live children",
    );
  });

  it("shift-click extends the range across the row's lanes in display order", () => {
    const onSweepRangeSelect = vi.fn();
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("idle-awhile", []),
      onSweepRangeSelect,
    });
    // Lane A locks first, so the row's display order is [a0, b0].
    expect(laneRowThreads(buildParentLanes(twoIdleFamilies(), new Set(), NOW), "idle-awhile").map((t) => t.id))
      .toEqual(["a0", "b0"]);
    fireEvent.click(cardAnchor("a0"));
    fireEvent.click(cardAnchor("b0"), { shiftKey: true });
    expect(onSweepRangeSelect).toHaveBeenCalledWith(["a0", "b0"]);
  });
});

describe("the sweep's outcome surfaces on the parent board", () => {
  it("a finished sweep's notice renders with its undo", () => {
    const onSweepUndo = vi.fn();
    renderBoard(twoIdleFamilies(), {
      sweepNotice: {
        message: "Sweep stopped. 1 archived before the cancel.",
        undo: { ids: ["a0"], destination: "archive" },
      },
      onSweepUndo,
    });
    const undo = document.querySelector<HTMLButtonElement>("[data-sweep-undo]");
    expect(undo).not.toBeNull();
    fireEvent.click(undo!);
    expect(onSweepUndo).toHaveBeenCalledWith(["a0"], "archive");
  });

  it("a running sweep shows progress on the row's pill", () => {
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("idle-awhile", ["a0", "b0"]),
      sweepRun: { columnId: "idle-awhile", total: 2, done: 1, activeId: "b0" },
      onSweepCancel: vi.fn(),
    });
    expect(sweepButtonForRow("Idle · A while ago").textContent).toContain("1 of 2");
    // The card in flight carries the throbber.
    expect(
      document
        .querySelector('[data-thread-card="b0"]')
        ?.hasAttribute("data-sweep-active"),
    ).toBe(true);
  });

  it("an armed row offers the exit, and it cancels", () => {
    const onSweepCancel = vi.fn();
    renderBoard(twoIdleFamilies(), {
      armedSweep: armSweep("idle-awhile", []),
      onSweepCancel,
    });
    const cancel = document.querySelector<HTMLButtonElement>("[data-sweep-cancel]");
    expect(cancel?.getAttribute("aria-label")).toBe("Exit sweep mode");
    fireEvent.click(cancel!);
    expect(onSweepCancel).toHaveBeenCalledTimes(1);
  });

  it("no sweep chrome at all when the caller wires no sweep", () => {
    // The wiring gate, exactly as the Focus board's: no candidates callback
    // means the sweep is off, and the rail shows labels and counts alone.
    renderBoard(twoIdleFamilies(), { sweepCandidatesFor: undefined, onSweepArm: undefined });
    expect(document.querySelector("[data-sweep-button]")).toBeNull();
    expect(document.querySelector("[data-sweep-cancel]")).toBeNull();
  });
});
