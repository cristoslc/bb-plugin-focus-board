// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParentLaneBoard } from "../components/parent-lane-board";
import { buildParentLanes } from "../components/parent-lanes";
import { computeParentLaneLayout } from "../components/parent-lane-layout";
import { thread } from "./thread-fixture";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

afterEach(cleanup);

function renderBoard(threads: ReturnType<typeof thread>[], overrides: Partial<Parameters<typeof ParentLaneBoard>[0]> = {}) {
  const lanes = buildParentLanes(threads, new Set(), NOW);
  const openThread = vi.fn();
  return {
    openThread,
    ...render(
      <ParentLaneBoard
        lanes={lanes}
        activeThreadId={null}
        doneIds={new Set()}
        dimmedIds={new Set()}
        childrenByParent={new Map()}
        projectNameFor={() => "Proj"}
        repoBaseFor={() => null}
        parentLaneOrder="recency"
        onParentLaneOrderChange={vi.fn()}
        onOpenThread={openThread}
        onClosePane={vi.fn()}
        onNewTask={vi.fn()}
        menuActionsFor={() => []}
        {...overrides}
      />,
    ),
  };
}

describe("ParentLaneBoard rendering", () => {
  it("renders a lane header per family lane and no Standalone lane", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const standalone = thread({ id: "s", displayTitle: "Solo task" });
    renderBoard([parent, child, standalone]);
    expect(screen.getByText("Parent epic")).toBeTruthy();
    expect(screen.queryByText("Standalone")).toBeNull();
    expect(screen.queryByText("Solo task")).toBeNull();
  });

  it("shows the child-count chip on the family header", () => {
    const parent = thread({ id: "p" });
    const a = thread({ id: "a", parentThreadId: "p" });
    const b = thread({ id: "b", parentThreadId: "p" });
    renderBoard([parent, a, b]);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("clicking a family header opens the parent pane", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const { openThread } = renderBoard([parent, child]);
    fireEvent.click(screen.getByText("Parent epic"));
    expect(openThread).toHaveBeenCalledWith("p");
  });

  it("clicking a lane card opens the child pane", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const { openThread } = renderBoard([parent, child]);
    fireEvent.click(screen.getByText("Child task"));
    expect(openThread).toHaveBeenCalledWith("c");
  });

  it("renders archived children as dimmed riders under the family header", () => {
    const parent = thread({ id: "p" });
    const archived = thread({ id: "a", parentThreadId: "p", displayTitle: "Archived task", isArchived: true });
    renderBoard([parent, archived]);
    expect(screen.getByText("Archived task")).toBeTruthy();
    expect(screen.getByText("archived")).toBeTruthy();
  });

  it("renders the row rail with every row label", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    renderBoard([parent, child]);
    expect(screen.getByText("Needs you")).toBeTruthy();
    expect(screen.getByText("Unread")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Idle · Recent")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("an empty board renders the no-families empty state", () => {
    renderBoard([]);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Standalone")).toBeNull();
  });

  it("loose threads render no lane and no cards (excluded from the parent view)", () => {
    const solo = thread({ id: "solo", displayTitle: "Solo task" });
    renderBoard([solo]);
    expect(screen.queryByText("Solo task")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("clicking By project calls onParentLaneOrderChange", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const onChange = vi.fn();
    renderBoard([parent, child], { parentLaneOrder: "recency", onParentLaneOrderChange: onChange });
    fireEvent.click(screen.getByText("By project"));
    expect(onChange).toHaveBeenCalledWith("project");
  });
});

describe("ruler+wrap board geometry", () => {
  const RAIL_W = 140;

  /** Two families. A: 2 working children, fresh (recency → lane 0, locked).
   *  B: 30 working children, older (lane 1 → context, must overflow+chip). */
  function twoFamilies() {
    const p0 = thread({ id: "p0", displayTitle: "Family A" });
    const p1 = thread({ id: "p1", displayTitle: "Family B" });
    const a = (i: number) => thread({ id: `a${i}`, parentThreadId: "p0", status: "active", updatedAt: NOW });
    const b = (i: number) => thread({ id: `b${i}`, parentThreadId: "p1", status: "active", updatedAt: NOW - DAY });
    return [p0, a(0), a(1), p1, ...Array.from({ length: 30 }, (_, i) => b(i))];
  }

  const busyBoard = () => {
    const lanes = buildParentLanes(twoFamilies(), new Set(), NOW);
    const board = renderBoard(twoFamilies());
    return { lanes, board };
  };

  it("marks the locked lane and attributes row counts to it in the rail", () => {
    const { board } = busyBoard();
    const { container } = board;
    const locked = container.querySelectorAll("section[data-locked]");
    expect(locked).toHaveLength(1);
    expect(locked[0].getAttribute("data-lane-id")).toBe("p0");
    expect(screen.getByText("2 · Family A")).toBeTruthy();
  });

  it("renders one band per status row in every lane, in row order", () => {
    const { lanes, board } = busyBoard();
    const { container } = board;
    const rowIds = lanes[0].rows.map((row) => row.id);
    for (const lane of container.querySelectorAll("section[data-lane-id]")) {
      const bands = [...lane.querySelectorAll("[data-band]")].map((el) => el.getAttribute("data-band"));
      expect(bands).toEqual(rowIds);
    }
  });

  it("chips overflow in context lanes as +N more", () => {
    const { lanes, board } = busyBoard();
    const { container } = board;
    const layout = computeParentLaneLayout(lanes, 0, window.innerWidth, RAIL_W);
    const w = lanes[0].rows.findIndex((row) => row.id === "working");
    const chip = layout.lanes[1].chipFor[w];
    expect(chip).toBeGreaterThan(0);
    expect(screen.getByText(`+${chip} more`)).toBeTruthy();
    // The chip lives in the context lane's band, not the locked one.
    const lockedId = container.querySelector("section[data-locked]")?.getAttribute("data-lane-id");
    expect(lockedId).toBe("p0");
  });

  it("renders a slab for empty bands so seams visibly span the lane", () => {
    const { board } = busyBoard();
    const { container } = board;
    const doneBand = container.querySelector('section[data-locked] [data-band="done"]');
    expect(doneBand?.querySelector("[data-slab]")).toBeTruthy();
  });

  it("keeps the New Task affordance in the rail header", () => {
    const { board } = busyBoard();
    const onNewTask = vi.fn();
    // Re-render with a spy for the new-task callback.
    board.unmount();
    renderBoard(twoFamilies(), { onNewTask });
    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it("renders compact mini cards in context lanes and regular cards in the ruler", () => {
    const { board } = busyBoard();
    const { container } = board;
    const ruler = container.querySelector('section[data-locked] [data-band="working"] [data-thread-card]');
    expect(ruler?.closest("[data-cell]")?.getAttribute("data-variant")).toBe("ruler");
    const mini = container.querySelector('section:not([data-locked]) [data-band="working"] [data-thread-card]');
    expect(mini?.closest("[data-cell]")?.getAttribute("data-variant")).toBe("mini");
  });
});