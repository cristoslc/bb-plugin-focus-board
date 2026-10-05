// @vitest-environment jsdom
// The Working lane is a fixture of the attention board, not a lane that
// appears only while a card runs in it. This pins the placeholder on the
// Board seam: an empty Working column reads "No work in progress" (observed
// 2026-10-05 — the column used to vanish when every thread went idle).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(threads: readonly PluginSidebarThread[]) {
  const props = {
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
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

describe("the empty Working lane says so", () => {
  it("an all-idle board keeps the Working column and its 'No work in progress' line", () => {
    renderBoard([thread({ id: "thr_idle", updatedAt: NOW - 5000 })]);
    const column = document.querySelector('[data-column-id="working"]');
    expect(column).not.toBeNull();
    expect(column?.textContent).toContain("No work in progress");
  });

  it("a running board shows no placeholder in its Working column", () => {
    renderBoard([thread({ id: "thr_run", status: "active", updatedAt: NOW - 5000 })]);
    const column = document.querySelector('[data-column-id="working"]');
    expect(column).not.toBeNull();
    expect(column?.textContent).not.toContain("No work in progress");
  });
});