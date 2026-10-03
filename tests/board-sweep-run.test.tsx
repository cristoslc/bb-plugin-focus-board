// @vitest-environment jsdom
// Board sweep RUN rendering. While a confirmed sweep is archiving its
// captured candidates, every not-yet-archived candidate keeps the armed
// highlight, the card currently being archived shows a throbber, and the
// sweep button reports progress and refuses further clicks — the operator
// must see the loop working instead of a board that looks frozen.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { armSweep, type SweepRunView } from "../lib/sweep";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: PluginSidebarThread[],
  overrides: Partial<BoardProps> = {},
) {
  const doneIds = new Set<string>(threads.map((candidate) => candidate.id));
  const props = {
    columns: buildColumns(
      threads,
      "status",
      context,
      new Map(),
      doneIds,
      NOW,
      {},
    ),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds,
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    childCountByParent: new Map<string, number>(),
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
  return { props, ...render(<Board {...props} />) };
}

function doneThread(id: string): PluginSidebarThread {
  return thread({ id, isArchived: false, updatedAt: NOW - 1000 });
}

function sweepButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("[data-sweep-button]");
  if (button === null) throw new Error("missing sweep button");
  return button;
}

afterEach(cleanup);

describe("Board sweep run", () => {
  const candidates = ["thr_d1", "thr_d2", "thr_d3"].map(doneThread);
  const armed = armSweep("done", ["thr_d1", "thr_d2", "thr_d3"]);

  it("keeps the highlight on every remaining candidate while the run is live", () => {
    renderBoard(candidates, {
      armedSweep: armed,
      sweepCandidatesFor: () => [],
      sweepRun: {
        columnId: "done",
        total: 3,
        done: 1,
        activeId: "thr_d2",
      } satisfies SweepRunView,
    });
    const highlighted = document.querySelectorAll("[data-sweep-highlighted]");
    expect([...highlighted].map((node) => node.getAttribute("data-thread-card"))).toEqual([
      "thr_d1",
      "thr_d2",
      "thr_d3",
    ]);
  });

  it("shows the throbber on the card currently being archived", () => {
    renderBoard(candidates, {
      armedSweep: armed,
      sweepCandidatesFor: () => [],
      sweepRun: {
        columnId: "done",
        total: 3,
        done: 1,
        activeId: "thr_d2",
      } satisfies SweepRunView,
    });
    const card = document.querySelector('[data-thread-card="thr_d2"]');
    expect(card?.querySelector("[data-sweep-spinner]")).not.toBeNull();
    // Exactly one throbber: the two waiting cards must not spin.
    expect(document.querySelectorAll("[data-sweep-spinner]").length).toBe(1);
  });

  it("shows no throbber when no run is live", () => {
    renderBoard(candidates, {
      armedSweep: armed,
      sweepCandidatesFor: () => [],
      sweepRun: null,
    });
    expect(document.querySelectorAll("[data-sweep-spinner]").length).toBe(0);
  });

  it("the sweep button reports progress and ignores clicks during the run", () => {
    const onSweepConfirm = vi.fn();
    renderBoard(candidates, {
      armedSweep: armed,
      sweepCandidatesFor: () => [],
      onSweepArm: vi.fn(),
      onSweepConfirm,
      sweepRun: {
        columnId: "done",
        total: 3,
        done: 1,
        activeId: "thr_d2",
      } satisfies SweepRunView,
    });
    expect(sweepButton().textContent).toContain("Sweeping 1 of 3");
    fireEvent.click(sweepButton());
    expect(onSweepConfirm).not.toHaveBeenCalled();
  });
});
