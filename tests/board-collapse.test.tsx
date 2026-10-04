// @vitest-environment jsdom
// Board-level collapse wiring: the board hands each family card the
// caller's collapsed-parent set and reports toggle gestures back with the
// parent id, so persistence and the auto-expand rule can live in the app
// layer. Without the props, cards fall back to their local (unpersisted)
// state.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function family(): { parent: PluginSidebarThread; children: PluginSidebarThread[] } {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: NOW - 5000 }),
    children: [
      thread({ id: "thr_c1", parentThreadId: "thr_parent", displayTitle: "Child one", updatedAt: NOW - 4000 }),
      thread({ id: "thr_c2", parentThreadId: "thr_parent", displayTitle: "Child two", updatedAt: NOW - 3000 }),
    ],
  };
}

function renderBoard(overrides: Partial<BoardProps> = {}) {
  const { parent, children } = family();
  const props = {
    columns: buildColumns([parent], "status", context, new Map(), new Set(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map([["thr_parent", children]]),
    childCountByParent: new Map([["thr_parent", children.length]]),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

function chevron(collapsed: boolean): HTMLElement {
  const button = document.querySelector(
    `button[aria-label="${collapsed ? "Expand subthreads" : "Collapse subthreads"}"]`,
  );
  if (!(button instanceof HTMLElement)) throw new Error("missing collapse chevron");
  return button;
}

function summary(): HTMLElement {
  const button = document.querySelector("[data-child-threads-summary]");
  if (!(button instanceof HTMLElement)) throw new Error("missing collapsed summary");
  return button;
}

function row(id: string): HTMLElement | null {
  return document.querySelector(`[data-thread-card="${id}"]`);
}

afterEach(cleanup);

describe("Board collapse wiring", () => {
  it("clicking the chevron reports the family collapsed with its parent id", () => {
    const onFamilyCollapsedChange = vi.fn();
    renderBoard({
      collapsedFamilyIds: new Set<string>(),
      onFamilyCollapsedChange,
    });
    fireEvent.click(chevron(false));
    expect(onFamilyCollapsedChange).toHaveBeenCalledWith("thr_parent", true);
  });

  it("a collapsed family renders the summary instead of rows; the summary reports expansion", () => {
    const onFamilyCollapsedChange = vi.fn();
    renderBoard({
      collapsedFamilyIds: new Set(["thr_parent"]),
      onFamilyCollapsedChange,
    });
    expect(row("thr_c1")).toBeNull();
    expect(summary().textContent).toContain("2 child threads");
    fireEvent.click(summary());
    expect(onFamilyCollapsedChange).toHaveBeenCalledWith("thr_parent", false);
  });

  it("without the collapse props, the card keeps its local unpersisted toggle", () => {
    renderBoard();
    fireEvent.click(chevron(false));
    expect(row("thr_c1")).toBeNull();
    expect(summary().textContent).toContain("2 child threads");
  });
});
