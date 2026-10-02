// @vitest-environment jsdom
// Manual sweep selection. Sweep mode is something the operator enters and
// curates: the sweep button is always present on a sweepable column (icon
// only when nothing is past threshold), clicking a card in sweep mode
// toggles it in or out of the selection instead of opening the pane, and a
// thread that may not join a sweep (live children) refuses loudly instead
// of silently doing nothing. Card clicks inside the armed column must not
// disarm the mode — only clicking away does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board, useSweepClickAway } from "../components/board";
import { buildColumns } from "../components/grouping";
import { armSweep } from "../lib/sweep";
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
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    sweepCandidatesFor: () => [],
    onSweepArm: vi.fn(),
    onSweepDisarm: vi.fn(),
    onSweepToggle: vi.fn(),
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

function cardAnchor(fromId: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
  return anchor;
}

afterEach(cleanup);

describe("the sweep button is always available", () => {
  it("renders icon-only when nothing is past the threshold, and arms on click", () => {
    const onSweepArm = vi.fn();
    renderBoard([doneThread("thr_d1")], {
      sweepCandidatesFor: () => [],
      onSweepArm,
    });
    expect(sweepButton().textContent).not.toContain("Sweep 0");
    fireEvent.click(sweepButton());
    expect(onSweepArm).toHaveBeenCalledWith("done");
  });

  it("still shows the past-threshold count when there is one", () => {
    renderBoard([doneThread("thr_d1")], {
      sweepCandidatesFor: () => ["thr_d1"],
    });
    expect(sweepButton().textContent).toContain("Sweep 1");
  });

  it("refuses to confirm an empty selection while armed", () => {
    const onSweepConfirm = vi.fn();
    renderBoard([doneThread("thr_d1")], {
      armedSweep: armSweep("done", []),
      onSweepConfirm,
    });
    fireEvent.click(sweepButton());
    expect(onSweepConfirm).not.toHaveBeenCalled();
  });
});

describe("clicking cards in sweep mode toggles selection", () => {
  const candidates = ["thr_d1", "thr_d2"].map(doneThread);
  const armed = armSweep("done", ["thr_d1"]);

  it("an unselected card reports a toggle, and does not open the pane", () => {
    const onOpenThread = vi.fn();
    const onSweepToggle = vi.fn();
    renderBoard(candidates, {
      armedSweep: armed,
      onOpenThread,
      onSweepToggle,
    });
    fireEvent.click(cardAnchor("thr_d2"));
    expect(onSweepToggle).toHaveBeenCalledWith("thr_d2");
    expect(onOpenThread).not.toHaveBeenCalled();
  });

  it("a selected card reports the same toggle (the caller flips it)", () => {
    const onSweepToggle = vi.fn();
    renderBoard(candidates, { armedSweep: armed, onSweepToggle });
    fireEvent.click(cardAnchor("thr_d1"));
    expect(onSweepToggle).toHaveBeenCalledWith("thr_d1");
  });

  it("a card outside sweep mode still opens the pane", () => {
    const onOpenThread = vi.fn();
    renderBoard(candidates, { onOpenThread });
    fireEvent.click(cardAnchor("thr_d1"));
    expect(onOpenThread).toHaveBeenCalledWith("thr_d1");
  });

  it("a thread with live children refuses loudly and never toggles", () => {
    const onSweepToggle = vi.fn();
    renderBoard(candidates, {
      armedSweep: armed,
      onSweepToggle,
      sweepBlockedIds: new Set(["thr_d2"]),
    });
    fireEvent.click(cardAnchor("thr_d2"));
    expect(onSweepToggle).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='sweep-refusal']")?.textContent).toContain(
      "live children",
    );
  });
});

describe("card clicks in the armed column do not disarm sweep mode", () => {
  function HookProbe({ columnId, onDisarm }: { columnId: string | null; onDisarm: () => void }) {
    useSweepClickAway(columnId, onDisarm);
    return (
      <section data-column-id="done">
        <div data-thread-card="thr_d1" />
      </section>
    );
  }

  it("a card inside the armed column keeps the mode armed", () => {
    const onDisarm = vi.fn();
    render(<HookProbe columnId="done" onDisarm={onDisarm} />);
    fireEvent.pointerDown(document.querySelector("[data-thread-card='thr_d1']")!);
    expect(onDisarm).not.toHaveBeenCalled();
  });

  it("a pointer outside the armed column's cards still disarms", () => {
    const onDisarm = vi.fn();
    render(<HookProbe columnId="done" onDisarm={onDisarm} />);
    fireEvent.pointerDown(document.body);
    expect(onDisarm).toHaveBeenCalled();
  });

  it("no listener at all when not armed", () => {
    const onDisarm = vi.fn();
    render(<HookProbe columnId={null} onDisarm={onDisarm} />);
    fireEvent.pointerDown(document.body);
    expect(onDisarm).not.toHaveBeenCalled();
  });
});
