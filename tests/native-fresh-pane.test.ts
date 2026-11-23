// The fresh pane ask, as a module: what a card click asks the host for when
// its record no longer names a pane of the board's, and the three outcomes
// that need a decision.
//
// Measured live (scripts/screenshot/probe-card-click-after-right-panel.mjs,
// evidence in docs/screenshots/probe-card-click-after-right-panel/): a pane
// NAVIGATED from inside itself stops matching the record's `{paneId,
// threadId}` pair, the click used to answer that with the board's own in-panel
// pane, and the host's own split placement from that state (with the board
// focused, where every click starts) adds a pane beside the board and leaves
// the operator's pane alone.
//
// The click itself is exercised in
// tests/app-card-click-replaces-board-pane.test.tsx; this file pins the
// decision, the one-ask rule, and the deadline.
import { describe, expect, it, vi } from "vitest";

import {
  createFreshPaneAsk,
  FRESH_PANE_ASK_MS,
  settleFreshPaneAsk,
  type FreshPaneAsk,
  type FreshPaneSettlement,
} from "../lib/native-fresh-pane";

const DEADLINE = FRESH_PANE_ASK_MS;

function ask(
  threadId = "thr_a",
  priorPaneIds: readonly string[] = ["pane-1"],
  deadlineAt = DEADLINE,
): FreshPaneAsk {
  return { threadId, priorPaneIds, deadlineAt };
}

function layout(
  panes: readonly { paneId: string; threadId: string | null }[],
): { panes: { paneId: string; threadId: string | null; isFocused: boolean }[] } {
  return {
    panes: panes.map((pane, index) => ({ ...pane, isFocused: index === 0 })),
  };
}

describe("settling the ask against what the host did", () => {
  it("adopts a pane that appeared after the click asked", () => {
    expect(
      settleFreshPaneAsk(
        layout([
          { paneId: "pane-1", threadId: null },
          { paneId: "pane-3", threadId: "thr_a" },
        ]),
        ask("thr_a", ["pane-1", "pane-2"]),
        0,
      ),
    ).toEqual({ kind: "adopted", paneId: "pane-3" });
  });

  it("never claims a pane that was already there, even showing the asked thread", () => {
    // The operator's own pane, focused because the thread is already open:
    // theirs, and adopting it is the guess lib/native-pane-ownership.ts bans.
    expect(
      settleFreshPaneAsk(
        layout([
          { paneId: "pane-1", threadId: null },
          { paneId: "pane-2", threadId: "thr_a" },
        ]),
        ask("thr_a", ["pane-1", "pane-2"]),
        0,
      ),
    ).toEqual({ kind: "theirs", paneId: "pane-2" });
  });

  it("waits while the deadline has not passed and no pane holds the thread", () => {
    expect(
      settleFreshPaneAsk(
        layout([{ paneId: "pane-1", threadId: null }]),
        ask("thr_a", ["pane-1"]),
        DEADLINE - 1,
      ),
    ).toEqual({ kind: "pending" });
  });

  it("answers unanswered at the deadline", () => {
    expect(
      settleFreshPaneAsk(
        layout([{ paneId: "pane-1", threadId: null }]),
        ask("thr_a", ["pane-1"]),
        DEADLINE,
      ),
    ).toEqual({ kind: "unanswered" });
  });

  it("takes the layout over the deadline: a pane that landed is settled however late it is read", () => {
    // A slow frame must never open the board's own pane beside a split that
    // did land.
    expect(
      settleFreshPaneAsk(
        layout([
          { paneId: "pane-1", threadId: null },
          { paneId: "pane-4", threadId: "thr_a" },
        ]),
        ask("thr_a", ["pane-1"]),
        DEADLINE * 10,
      ),
    ).toEqual({ kind: "adopted", paneId: "pane-4" });
  });

  it("answers unanswered past the deadline with no layout to read", () => {
    expect(settleFreshPaneAsk(null, ask("thr_a"), DEADLINE + 1)).toEqual({
      kind: "unanswered",
    });
  });

  it("stays pending with no layout to read before the deadline", () => {
    expect(settleFreshPaneAsk(null, ask("thr_a"), 0)).toEqual({ kind: "pending" });
  });
});

describe("the controller", () => {
  function harness(layouts: Array<Parameters<typeof settleFreshPaneAsk>[0]>) {
    const settlements: FreshPaneSettlement[] = [];
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    let now = 0;
    let index = 0;
    const controller = createFreshPaneAsk({
      now: () => now,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length;
      },
      cancel: () => {},
      layout: () => layouts[Math.min(index, layouts.length - 1)] ?? null,
      onSettle: (_ask, settlement) => settlements.push(settlement),
      deadlineMs: DEADLINE,
    });
    return {
      controller,
      settlements,
      scheduled,
      advance: (ms: number) => {
        now += ms;
      },
      atLayout: (next: number) => {
        index = next;
      },
      fireDeadline: () => {
        const timer = scheduled.at(-1);
        if (timer === undefined) throw new Error("no timer armed");
        timer.callback();
      },
    };
  }

  it("keeps one ask: a second click replaces the first and its deadline", () => {
    const h = harness([null]);
    h.controller.begin({ threadId: "thr_a", priorPaneIds: ["pane-1"] });
    h.controller.begin({ threadId: "thr_b", priorPaneIds: ["pane-1"] });

    expect(h.controller.pending()?.threadId).toBe("thr_b");
    expect(h.scheduled).toHaveLength(2);
    // Only the live ask settles, and it settles once.
    h.atLayout(0);
    h.fireDeadline();
    expect(h.settlements).toEqual([{ kind: "unanswered" }]);
    expect(h.controller.pending()).toBeNull();
    h.fireDeadline();
    expect(h.settlements).toHaveLength(1);
  });

  it("settles on demand against the layout the board rendered", () => {
    const h = harness([
      layout([{ paneId: "pane-1", threadId: null }]),
      layout([
        { paneId: "pane-1", threadId: null },
        { paneId: "pane-3", threadId: "thr_a" },
      ]),
    ]);
    h.controller.begin({ threadId: "thr_a", priorPaneIds: ["pane-1"] });
    expect(h.controller.settle()).toEqual({ kind: "pending" });
    h.atLayout(1);
    expect(h.controller.settle()).toEqual({ kind: "adopted", paneId: "pane-3" });
    expect(h.controller.pending()).toBeNull();
    expect(h.settlements).toEqual([{ kind: "adopted", paneId: "pane-3" }]);
  });

  it("settles an ask at its deadline even when the clock has not caught up", () => {
    // A throttled tab's timer can fire early on the wall clock; the ask must
    // still end rather than outlive the click (and adopt a pane the operator
    // opens much later).
    const h = harness([layout([{ paneId: "pane-1", threadId: null }])]);
    h.controller.begin({ threadId: "thr_a", priorPaneIds: ["pane-1"] });
    h.advance(-DEADLINE);
    h.fireDeadline();
    expect(h.settlements).toEqual([{ kind: "unanswered" }]);
    expect(h.controller.pending()).toBeNull();
  });

  it("does nothing when cancelled before it settles", () => {
    const h = harness([null]);
    h.controller.begin({ threadId: "thr_a", priorPaneIds: ["pane-1"] });
    h.controller.cancel();
    expect(h.controller.pending()).toBeNull();
    h.fireDeadline();
    expect(h.settlements).toEqual([]);
  });

  it("traces one line per settled ask, naming the outcome", () => {
    const trace = vi.fn();
    const controller = createFreshPaneAsk({
      now: () => 0,
      schedule: () => 1,
      cancel: () => {},
      layout: () => layout([
        { paneId: "pane-1", threadId: null },
        { paneId: "pane-2", threadId: "thr_a" },
      ]),
      onSettle: () => {},
      trace,
      deadlineMs: DEADLINE,
    });
    controller.begin({ threadId: "thr_a", priorPaneIds: ["pane-1"] });
    controller.settle();
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "fresh-pane-ask",
        outcome: "adopted",
        threadId: "thr_a",
        paneId: "pane-2",
      }),
    );
  });
});
