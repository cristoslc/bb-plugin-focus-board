// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParentLaneBoard } from "../components/parent-lane-board";
import { buildParentLanes } from "../components/parent-lanes";
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
  it("renders a lane header per family lane and the Standalone lane", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const standalone = thread({ id: "s", displayTitle: "Solo task" });
    renderBoard([parent, child, standalone]);
    expect(screen.getByText("Parent epic")).toBeTruthy();
    expect(screen.getByText("Standalone")).toBeTruthy();
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
    renderBoard([]);
    expect(screen.getByText("Needs you")).toBeTruthy();
    expect(screen.getByText("Unread")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Idle · Recent")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("an empty board still shows the Standalone lane", () => {
    renderBoard([]);
    expect(screen.getByText("Standalone")).toBeTruthy();
  });

  it("standalone threads render as cards in the Standalone lane", () => {
    const solo = thread({ id: "solo", displayTitle: "Solo task" });
    renderBoard([solo]);
    expect(screen.getByText("Solo task")).toBeTruthy();
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
