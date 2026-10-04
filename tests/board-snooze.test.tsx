// @vitest-environment jsdom
// The app→Board snooze wire. The card renders its own snooze state from a
// `snoozeFor` lookup, but that lookup only reaches the DOM if the caller
// forwards the prop: app.tsx once built its Board/ParentLaneBoard renders
// without it, so threads snoozed from the pane showed NO indicators anywhere
// (observed 2026-10-03) while every optional-prop contract still
// typechecked. This file pins the pass-through at the Board seam.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(snoozeFor: ((id: string) => number | null) | undefined) {
  const threads: PluginSidebarThread[] = [thread({ id: "thr_a", updatedAt: NOW - 5000 })];
  const props = {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    snoozeFor,
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_a"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card");
  return root;
}

describe("Board forwards the snooze lookup to its cards", () => {
  it("a snoozed card on the board carries data-snoozed and the wake chip", () => {
    const wake = new Date();
    wake.setHours(14, 15, 0, 0); // today 2:15 PM local
    renderBoard((id) => (id === "thr_a" ? wake.getTime() : null));
    expect(cardRoot().getAttribute("data-snoozed")).toBe("");
    const chip = cardRoot().querySelector("[data-snooze-chip]");
    expect(chip?.textContent).toContain("Snoozed · wakes");
    expect(chip?.textContent).toContain("today at 2:15 PM");
  });

  it("no lookup (the dropped-wire failure mode) leaves cards unsnoozed", () => {
    renderBoard(undefined);
    expect(cardRoot().hasAttribute("data-snoozed")).toBe(false);
    expect(document.querySelector("[data-snooze-chip]")).toBeNull();
  });
});