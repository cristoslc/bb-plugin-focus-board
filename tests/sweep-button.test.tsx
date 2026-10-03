// @vitest-environment jsdom
// The column-header sweep button. The armed pill must hold its label on ONE
// line inside the narrow column header — "Sweep N → Archive" wrapped across
// two lines inside the fixed-height pill and read as broken — and its
// confirm hint must render as a real glyph, not a bare "?" text node that
// looks like a stray character.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { armSweep } from "../lib/sweep";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

const doneThread: PluginSidebarThread = thread({ id: "thr_done", status: "idle" });
// Forty days quiet: lands in the "Idle · A while ago" bucket (idle-awhile),
// the only sweepable idle column.
const idleThreadFixture: PluginSidebarThread = thread({
  id: "thr_idle_old",
  status: "idle",
  updatedAt: NOW - 40 * 24 * 60 * 60 * 1000,
  lastReadAt: NOW - 40 * 24 * 60 * 60 * 1000,
});

type BoardProps = Parameters<typeof Board>[0];

function baseProps(overrides: Partial<BoardProps> = {}): BoardProps {
  return {
    columns: buildColumns(
      [doneThread],
      "status",
      context,
      new Map(),
      new Set(["thr_done"]),
      NOW,
      {},
    ),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set(["thr_done"]),
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    childCountByParent: new Map<string, number>(),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    statusFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    rankStore: {},
    onRankMove: vi.fn(),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    sweepCandidatesFor: () => ["thr_done"],
    armedSweep: null,
    onSweepArm: vi.fn(),
    onSweepDisarm: vi.fn(),
    onSweepConfirm: vi.fn(),
    ...overrides,
  } as unknown as BoardProps;
}

afterEach(cleanup);

function sweepButton(): HTMLElement {
  const button = document.querySelector<HTMLElement>("[data-sweep-button]");
  if (button === null) throw new Error("missing sweep button");
  return button;
}

describe("sweep button", () => {
  it("offers the sweep with the eligible count while unarmed", () => {
    render(<Board {...baseProps()} />);
    expect(sweepButton().textContent).toBe("Sweep 1");
  });

  it("armed label stays on one line (no-wrap)", () => {
    const { rerender } = render(<Board {...baseProps()} />);
    rerender(
      <Board
        {...baseProps({ armedSweep: armSweep("done", ["thr_done"]) })}
      />,
    );
    const button = sweepButton();
    expect(button.textContent).toContain("Sweep 1 → Archive");
    expect(button.classList.contains("whitespace-nowrap")).toBe(true);
  });

  it("armed pill carries only the archive icon — no question-mark hint", () => {
    const { rerender } = render(<Board {...baseProps()} />);
    rerender(
      <Board
        {...baseProps({ armedSweep: armSweep("done", ["thr_done"]) })}
      />,
    );
    const button = sweepButton();
    // A trailing question glyph reads as "help", but the whole pill confirms
    // the sweep when clicked — the glyph was a trap, so it is gone. The
    // archive icon alone rides the "Sweep N → Archive" label.
    expect(button.querySelectorAll("svg").length).toBe(1);
    for (const node of Array.from(button.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        expect(node.textContent?.trim()).not.toBe("?");
      }
    }
  });

  it("the long-idle arm's armed pill names Done as its destination", () => {
    const { rerender } = render(
      <Board
        {...baseProps({
          columns: buildColumns(
            [idleThreadFixture],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: (columnId) =>
            columnId === "idle-awhile" ? ["thr_idle_old"] : [],
        })}
      />,
    );
    rerender(
      <Board
        {...baseProps({
          columns: buildColumns(
            [idleThreadFixture],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: (columnId) =>
            columnId === "idle-awhile" ? ["thr_idle_old"] : [],
          armedSweep: armSweep("idle-awhile", ["thr_idle_old"]),
        })}
      />,
    );
    expect(sweepButton().textContent).toContain("Sweep 1 → Done");
    expect(sweepButton().textContent).not.toContain("Archive");
  });
});
