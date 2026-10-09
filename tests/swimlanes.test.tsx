// @vitest-environment jsdom
// Swimlanes: a second grouping axis that splits the column board into rows.
// Every lane carries the same columns (so cells line up under one header
// row), lanes come from the same `columnFor` labels as the matching Group-by,
// and the board renders one shared header row plus a collapsible row per lane.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import {
  buildColumns,
  buildSwimlanes,
  swimlanesActive,
} from "../components/grouping";
import { parseSwimlaneStored } from "../components/preferences";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = {
  projects: [
    { id: "p_alpha", name: "Alpha" },
    { id: "p_beta", name: "Beta" },
  ],
  providers: [{ id: "pi", displayName: "Pi" }],
} as unknown as Parameters<typeof buildColumns>[2];

function fixture(): PluginSidebarThread[] {
  return [
    thread({ id: "a_work", projectId: "p_alpha", status: "active", updatedAt: NOW - 10 }),
    thread({ id: "a_unread", projectId: "p_alpha", isUnread: true, updatedAt: NOW - 20 }),
    thread({ id: "b_work", projectId: "p_beta", status: "active", updatedAt: NOW - 30 }),
    thread({ id: "b_done", projectId: "p_beta", updatedAt: NOW - 40 }),
  ];
}

function columns() {
  return buildColumns(fixture(), "status", context, new Map(), new Set(["b_done"]), NOW, {});
}

describe("buildSwimlanes", () => {
  it("splits each column by lane and keeps the full column set in every lane", () => {
    const lanes = buildSwimlanes(columns(), "project", context, NOW);
    expect(lanes.map((lane) => lane.label)).toEqual(["Alpha", "Beta"]);
    const ids = columns().map((column) => column.id);
    for (const lane of lanes) {
      expect(lane.columns.map((column) => column.id)).toEqual(ids);
    }
    const cell = (laneIdx: number, columnId: string) =>
      lanes[laneIdx].columns.find((column) => column.id === columnId)?.threads.map((t) => t.id);
    expect(cell(0, "working")).toEqual(["a_work"]);
    expect(cell(0, "unread")).toEqual(["a_unread"]);
    expect(cell(0, "done")).toEqual([]);
    expect(cell(1, "working")).toEqual(["b_work"]);
    expect(cell(1, "done")).toEqual(["b_done"]);
    expect(lanes.map((lane) => lane.count)).toEqual([2, 2]);
  });

  it("keeps the column's order inside each lane", () => {
    const threads = [
      thread({ id: "x1", projectId: "p_alpha", updatedAt: NOW - 100 }),
      thread({ id: "y1", projectId: "p_beta", updatedAt: NOW - 200 }),
      thread({ id: "x2", projectId: "p_alpha", updatedAt: NOW - 300 }),
    ];
    const built = buildColumns(threads, "none", context, new Map(), new Set(), NOW, {
      "none:all": ["x2", "y1", "x1"],
    } as never);
    const lanes = buildSwimlanes(built, "project", context, NOW);
    expect(lanes[0].columns[0].threads.map((t) => t.id)).toEqual(
      built[0].threads.filter((t) => t.projectId === "p_alpha").map((t) => t.id),
    );
  });

  it("puts unassigned lanes last", () => {
    const threads = [
      thread({ id: "nohost", host: null }),
      thread({ id: "zed", host: { id: "h_z", name: "Zed" } as never }),
    ];
    const built = buildColumns(threads, "status", context, new Map(), new Set(), NOW, {});
    const lanes = buildSwimlanes(built, "machine", context, NOW);
    expect(lanes.map((lane) => lane.id)).toEqual(["h_z", "none"]);
  });

  it("is inactive for no lanes, the parent board, and the same axis as the columns", () => {
    expect(swimlanesActive("status", "none")).toBe(false);
    expect(swimlanesActive("parent", "project")).toBe(false);
    expect(swimlanesActive("project", "project")).toBe(false);
    expect(swimlanesActive("status", "project")).toBe(true);
  });

  it("parses stored values tolerantly", () => {
    expect(parseSwimlaneStored("project")).toBe("project");
    expect(parseSwimlaneStored("parent")).toBe("none");
    expect(parseSwimlaneStored(null)).toBe("none");
  });
});

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(overrides: Partial<BoardProps> = {}) {
  const cols = columns();
  const props = {
    columns: cols,
    swimlanes: buildSwimlanes(cols, "project", context, NOW),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(["b_done"]),
    nestedChildrenByParent: new Map(),
    childCountByParent: new Map(),
    doneChildrenByParent: new Map(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

afterEach(cleanup);

describe("Board swimlanes", () => {
  it("renders one shared header row and a row of cells per lane", () => {
    renderBoard();
    const header = document.querySelector("[data-swimlane-header-row]") as HTMLElement;
    expect(header).not.toBeNull();
    expect(within(header).getByText("Working")).toBeTruthy();
    expect(header.querySelectorAll("[data-card-list]").length).toBe(0);

    const alpha = document.querySelector('[data-swimlane="p_alpha"]') as HTMLElement;
    const beta = document.querySelector('[data-swimlane="p_beta"]') as HTMLElement;
    expect(alpha.querySelector('[data-thread-card="a_work"]')).not.toBeNull();
    expect(alpha.querySelector('[data-thread-card="b_work"]')).toBeNull();
    expect(beta.querySelector('[data-thread-card="b_done"]')).not.toBeNull();
    // Lane cells line up with the header: same column count in every row.
    const headerCols = header.querySelectorAll("section[data-column-id]").length;
    expect(alpha.querySelectorAll("section[data-column-id]").length).toBe(headerCols);
    expect(beta.querySelectorAll("section[data-column-id]").length).toBe(headerCols);
  });

  it("reports a lane fold and hides a collapsed lane's cells", () => {
    const onSwimlaneCollapsedChange = vi.fn();
    const { rerender } = renderBoard({ onSwimlaneCollapsedChange });
    const alpha = document.querySelector('[data-swimlane="p_alpha"]') as HTMLElement;
    fireEvent.click(within(alpha).getByRole("button", { name: /Alpha/ }));
    expect(onSwimlaneCollapsedChange).toHaveBeenCalledWith("p_alpha", true);

    cleanup();
    renderBoard({ collapsedSwimlaneIds: new Set(["p_alpha"]) });
    const folded = document.querySelector('[data-swimlane="p_alpha"]') as HTMLElement;
    expect(folded.querySelector("[data-card-list]")).toBeNull();
    expect(within(folded).getByRole("button", { name: /Alpha/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    void rerender;
  });

  it("renders the flat board when swimlanes are off", () => {
    renderBoard({ swimlanes: null });
    expect(document.querySelector("[data-swimlanes]")).toBeNull();
    expect(document.querySelector('section[data-column-id="working"] [data-card-list]')).not.toBeNull();
  });
});
