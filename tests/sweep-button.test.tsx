// @vitest-environment jsdom
// The column-header sweep pill. The word "Sweep" repeated on every column
// header read as noise, so the pill is icon-only: a broom glyph, plus the
// eligible count, plus — armed — the destination ("N → Done"). The armed
// label must still hold on ONE line inside the narrow column header, and
// only sweepable columns carry the pill at all: a broom on Working or
// Needs You would offer a sweep that must not exist.
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
// Forty days quiet: lands in the "Idle · A while ago" bucket (idle-awhile).
const idleThreadFixture: PluginSidebarThread = thread({
  id: "thr_idle_old",
  status: "idle",
  updatedAt: NOW - 40 * 24 * 60 * 60 * 1000,
  lastReadAt: NOW - 40 * 24 * 60 * 60 * 1000,
});
const pinnedThread: PluginSidebarThread = thread({
  id: "thr_pin",
  isPinned: true,
  updatedAt: NOW - 1000,
  lastReadAt: NOW - 1000,
});
const unreadThread: PluginSidebarThread = thread({
  id: "thr_unread",
  isUnread: true,
  updatedAt: NOW - 1000,
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

describe("sweep pill copy", () => {
  it("unarmed, the pill is the broom and the eligible count — no word", () => {
    render(<Board {...baseProps()} />);
    expect(sweepButton().textContent).toBe("1");
  });

  it("unarmed with nothing eligible, the pill is the broom alone", () => {
    render(
      <Board
        {...baseProps({
          sweepCandidatesFor: () => [],
        })}
      />,
    );
    expect(sweepButton().textContent).toBe("");
  });

  it("the broom is the pill's only glyph while unarmed", () => {
    render(<Board {...baseProps()} />);
    expect(sweepButton().querySelectorAll("svg").length).toBe(1);
  });

  it("armed for the Done lane names Archive as the destination, on one line", () => {
    const { rerender } = render(<Board {...baseProps()} />);
    rerender(
      <Board
        {...baseProps({ armedSweep: armSweep("done", ["thr_done"]) })}
      />,
    );
    const button = sweepButton();
    expect(button.textContent).toBe("1 → Archive");
    expect(button.classList.contains("whitespace-nowrap")).toBe(true);
    // The broom rides the armed label; the destination is words, not a
    // second glyph — a trailing question glyph once read as "help" and was
    // removed; the armed pill stays one-glyph.
    expect(button.querySelectorAll("svg").length).toBe(1);
  });

  it("armed for an idle lane names Done as the destination", () => {
    render(
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
    expect(sweepButton().textContent).toBe("1 → Done");
    expect(sweepButton().textContent).not.toContain("Archive");
  });

  it("armed for the Pinned lane names Unpinned as the destination", () => {
    render(
      <Board
        {...baseProps({
          columns: buildColumns(
            [pinnedThread],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: (columnId) =>
            columnId === "pinned" ? ["thr_pin"] : [],
          armedSweep: armSweep("pinned", ["thr_pin"]),
        })}
      />,
    );
    expect(sweepButton().textContent).toBe("1 → Unpinned");
  });

  it("armed for the Unread lane names Read as the destination", () => {
    render(
      <Board
        {...baseProps({
          columns: buildColumns(
            [unreadThread],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: (columnId) =>
            columnId === "unread" ? ["thr_unread"] : [],
          armedSweep: armSweep("unread", ["thr_unread"]),
        })}
      />,
    );
    expect(sweepButton().textContent).toBe("1 → Read");
  });

  it("manual arms show the broom alone while unarmed, even with cards in the lane", () => {
    // 2026-10-03 arming decision: Pinned, Unread, and the fresher idle
    // buckets arm with nothing selected, so their unarmed pill proposes no
    // count — the lane size already sits in the column header, and the
    // sweep is built by clicking cards, not by bulk pre-selection.
    render(
      <Board
        {...baseProps({
          columns: buildColumns(
            [pinnedThread],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: () => [],
        })}
      />,
    );
    expect(sweepButton().textContent).toBe("");
  });
});

describe("where the pill may exist", () => {
  it("no pill on a lane that cannot sweep — Working", () => {
    const working: PluginSidebarThread = thread({
      id: "thr_working",
      status: "active",
      updatedAt: NOW - 1000,
    });
    render(
      <Board
        {...baseProps({
          columns: buildColumns(
            [working],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: () => [],
        })}
      />,
    );
    expect(document.querySelector("[data-sweep-button]")).toBeNull();
  });

  it("no pill on a lane that cannot sweep — Needs You", () => {
    const attention: PluginSidebarThread = thread({
      id: "thr_attention",
      hasPendingInteraction: true,
      updatedAt: NOW - 1000,
    });
    render(
      <Board
        {...baseProps({
          columns: buildColumns(
            [attention],
            "status",
            context,
            new Map(),
            new Set<string>(),
            NOW,
            {},
          ),
          doneIds: new Set<string>(),
          sweepCandidatesFor: () => [],
        })}
      />,
    );
    expect(document.querySelector("[data-sweep-button]")).toBeNull();
  });
});
