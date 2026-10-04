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
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
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

describe("the sweep notice can offer an undo", () => {
  const undoCandidates = ["thr_d1", "thr_d2"].map(doneThread);

  it("a notice with undo ids renders an Undo button that reports them", () => {
    const onSweepUndo = vi.fn();
    renderBoard(undoCandidates, {
      sweepNotice: {
        message: "Sweep stopped. 2 archived before the cancel.",
        undo: { ids: ["thr_d1", "thr_d2"], destination: "archive" },
      },
      onSweepUndo,
    });
    const undo = document.querySelector<HTMLButtonElement>("[data-sweep-undo]");
    expect(undo).not.toBeNull();
    fireEvent.click(undo!);
    expect(onSweepUndo).toHaveBeenCalledWith(["thr_d1", "thr_d2"], "archive");
  });

  it("a notice without undo ids has no Undo button", () => {
    renderBoard(undoCandidates, {
      sweepNotice: { message: "Sweep stopped. Nothing archived." },
    });
    expect(document.querySelector("[data-sweep-undo]")).toBeNull();
  });
});

afterEach(cleanup);

describe("cancelling a sweep", () => {
  const cancelCandidates = ["thr_d1", "thr_d2", "thr_d3"].map(doneThread);
  const cancelArmed = armSweep("done", ["thr_d1", "thr_d2", "thr_d3"]);

  it("an armed mode offers an exit that disarms, distinct from confirm", () => {
    const onSweepCancel = vi.fn();
    renderBoard(cancelCandidates, {
      armedSweep: cancelArmed,
      onSweepCancel,
    });
    const cancel = document.querySelector<HTMLButtonElement>("[data-sweep-cancel]");
    expect(cancel).not.toBeNull();
    expect(cancel?.getAttribute("aria-label")).toBe("Exit sweep mode");
    fireEvent.click(cancel!);
    expect(onSweepCancel).toHaveBeenCalledTimes(1);
  });

  it("a running sweep offers a cancel", () => {
    const onSweepCancel = vi.fn();
    renderBoard(cancelCandidates, {
      armedSweep: cancelArmed,
      sweepRun: { columnId: "done", total: 3, done: 1, activeId: "thr_d2" },
      onSweepCancel,
    });
    const cancel = document.querySelector<HTMLButtonElement>("[data-sweep-cancel]");
    expect(cancel?.getAttribute("aria-label")).toBe("Cancel sweep");
    fireEvent.click(cancel!);
    expect(onSweepCancel).toHaveBeenCalledTimes(1);
  });

  it("no cancel affordance when idle", () => {
    renderBoard(cancelCandidates, {});
    expect(document.querySelector("[data-sweep-cancel]")).toBeNull();
  });
});

describe("selection never reorders the column", () => {
  it("selected cards highlight in place; the list keeps its order", () => {
    // Deliberately NOT the gather order: thr_d3 selected first, and the
    // column's own order (recency here) must survive untouched.
    renderBoard(
      ["thr_d1", "thr_d2", "thr_d3"].map(doneThread),
      { armedSweep: armSweep("done", ["thr_d3"]) },
    );
    const rendered = [
      ...document.querySelectorAll("[data-card-list] [data-thread-card]"),
    ].map((node) => node.getAttribute("data-thread-card"));
    expect(rendered).toEqual(["thr_d1", "thr_d2", "thr_d3"]);
    // The selected card is still highlighted where it sits.
    expect(
      document
        .querySelector('[data-thread-card="thr_d3"]')
        ?.hasAttribute("data-sweep-highlighted"),
    ).toBe(true);
  });
});

describe("the sweep button is always available", () => {
  it("renders icon-only when nothing is past the threshold, and arms on click", () => {
    const onSweepArm = vi.fn();
    renderBoard([doneThread("thr_d1")], {
      sweepCandidatesFor: () => [],
      onSweepArm,
    });
    expect(sweepButton().textContent).toBe("");
    fireEvent.click(sweepButton());
    expect(onSweepArm).toHaveBeenCalledWith("done");
  });

  it("still shows the past-threshold count when there is one", () => {
    renderBoard([doneThread("thr_d1")], {
      sweepCandidatesFor: () => ["thr_d1"],
    });
    expect(sweepButton().textContent).toBe("1");
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
