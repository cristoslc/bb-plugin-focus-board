// The card click's one-pane dance, as a module: the click asks the host for a
// split, and exactly two outcomes need a continuation.
//
// Measured on the installed host (scripts/screenshot/probe-split-dance.mjs,
// evidence in docs/screenshots/probe-split-dance/): a one-pane window already
// carries a one-pane layout, so the host's own opener SPLITS it and the board
// never leaves the screen. The two continuations here are for the states that
// measured otherwise: a host with no layout to split (splits off), where the
// same click opens the board's own in-panel pane, and the host that plainly
// navigated, where the panel is destroyed and only module-scope code can put
// the board's route back.
//
// The click itself is exercised in
// tests/app-card-click-one-pane-split.test.tsx; this file pins the decisions,
// the single-dance rule, and the deadline, which the gesture can only reach
// through real timers.
import { describe, expect, it, vi } from "vitest";

import {
  createOnePaneDance,
  routeThreadIdFromPath,
  settleOnePaneDance,
  type OnePaneDance,
  type OnePaneDanceObservation,
} from "../lib/native-one-pane-dance";

const DEADLINE = 250;

function dance(threadId = "thr_a", deadlineAt = DEADLINE): OnePaneDance {
  return { threadId, subPath: `t/${threadId}`, deadlineAt };
}

function observation(
  overrides: Partial<OnePaneDanceObservation> = {},
): OnePaneDanceObservation {
  return {
    now: DEADLINE,
    renderedPaneCount: 1,
    boardMounted: true,
    routeThreadId: null,
    ...overrides,
  };
}

describe("settling the dance against what the host did", () => {
  it("splits when the host is rendering two panes, however early it is asked", () => {
    expect(
      settleOnePaneDance(dance(), observation({ now: 0, renderedPaneCount: 2 })),
    ).toEqual({ kind: "split" });
  });

  it("waits while the deadline has not passed and only one pane is up", () => {
    expect(
      settleOnePaneDance(dance(), observation({ now: DEADLINE - 1 })),
    ).toEqual({ kind: "pending" });
  });

  it("opens the board's own pane when the host has nowhere to split", () => {
    // One pane, the panel still alive, the route still the board's: the
    // window has splits off, so the same click keeps the thread in the board.
    expect(settleOnePaneDance(dance(), observation())).toEqual({
      kind: "in-board-pane",
    });
  });

  it("restores the board's route when the host plainly navigated", () => {
    // The panel is gone and the route is the clicked thread: bb replaced the
    // board with the thread page, which is the state the dance exists for.
    expect(
      settleOnePaneDance(
        dance("thr_a"),
        observation({ boardMounted: false, routeThreadId: "thr_a" }),
      ),
    ).toEqual({ kind: "restore" });
  });

  it("expires when the panel is gone and the route is some other thread", () => {
    // The operator moved on before the deadline: nothing to repair, and
    // pushing the board's route would yank them off what they chose.
    expect(
      settleOnePaneDance(
        dance("thr_a"),
        observation({ boardMounted: false, routeThreadId: "thr_b" }),
      ),
    ).toEqual({ kind: "expire" });
  });
});

/** A controller wired to a fake clock, so a dance's deadline is a number the
 *  test advances instead of a real wait. */
function harness() {
  let now = 0;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const observed = {
    renderedPaneCount: 1,
    boardMounted: true,
    routeThreadId: null as string | null,
  };
  const host = {
    openBoardPane: vi.fn<(threadId: string) => void>(),
    restoreBoardRoute: vi.fn<(subPath: string) => void>(),
  };
  const trace = vi.fn<(event: Record<string, unknown>) => void>();
  const controller = createOnePaneDance({
    now: () => now,
    schedule: (run, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + delayMs, run });
      return handle;
    },
    cancel: (handle) => timers.delete(handle),
    observe: () => ({ ...observed }),
    host: {
      openBoardPane: (threadId) => host.openBoardPane(threadId),
      restoreBoardRoute: (subPath) => host.restoreBoardRoute(subPath),
    },
    trace,
    deadlineMs: DEADLINE,
  });
  const advance = (ms: number) => {
    now += ms;
    for (const [handle, timer] of [...timers]) {
      if (timer.at > now) continue;
      timers.delete(handle);
      timer.run();
    }
  };
  return { controller, host, trace, observed, advance, timers };
}

describe("one dance at a time", () => {
  it("arms a deadline and reports the dance while it waits", () => {
    const { controller, timers } = harness();
    const begun = controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });
    expect(begun).toEqual({ threadId: "thr_a", subPath: "t/thr_a", deadlineAt: DEADLINE });
    expect(controller.pending()).toEqual(begun);
    expect(timers.size).toBe(1);
  });

  it("replaces a pending dance instead of stacking a second one", () => {
    const { controller, host, advance, timers } = harness();
    controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });
    controller.begin({ threadId: "thr_b", subPath: "t/thr_b" });
    expect(controller.pending()?.threadId).toBe("thr_b");
    expect(timers.size).toBe(1);

    advance(DEADLINE);
    // The first click's continuation is gone with its timer: one pane, one
    // thread, which is what the operator's last click asked for.
    expect(host.openBoardPane.mock.calls).toEqual([["thr_b"]]);
    expect(host.restoreBoardRoute).not.toHaveBeenCalled();
  });

  it("stops watching once the host's layout shows the dance's thread in a pane", () => {
    const { controller, host, advance } = harness();
    controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });

    expect(controller.noteThreadInPane("thr_b")).toBe(false);
    expect(controller.pending()).not.toBeNull();
    expect(controller.noteThreadInPane("thr_a")).toBe(true);
    expect(controller.pending()).toBeNull();

    advance(DEADLINE);
    expect(host.openBoardPane).not.toHaveBeenCalled();
    expect(host.restoreBoardRoute).not.toHaveBeenCalled();
  });

  it("drops the dance on cancel, so a deadline cannot fire later", () => {
    const { controller, host, advance } = harness();
    controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });
    controller.cancel();
    expect(controller.pending()).toBeNull();
    advance(DEADLINE * 10);
    expect(host.openBoardPane).not.toHaveBeenCalled();
    expect(host.restoreBoardRoute).not.toHaveBeenCalled();
  });

  it("restores the captured subPath, so the board comes back showing the thread", () => {
    const { controller, host, observed, advance } = harness();
    observed.boardMounted = false;
    observed.routeThreadId = "thr_a";
    controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });
    advance(DEADLINE);
    expect(host.restoreBoardRoute).toHaveBeenCalledWith("t/thr_a");
    expect(host.openBoardPane).not.toHaveBeenCalled();
  });

  it("traces the outcome it acted on, for the live diagnosis", () => {
    const { controller, trace, advance } = harness();
    controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });
    advance(DEADLINE);
    expect(trace).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "one-pane-dance",
        outcome: "in-board-pane",
        threadId: "thr_a",
        renderedPaneCount: 1,
        boardMounted: true,
      }),
    );
  });

  it("asks for the remaining time instead of firing early when the clock disagrees", () => {
    // A timer that runs ahead of the deadline the dance was built with (a
    // throttled background tab, a fake clock) must re-arm, never act.
    const { controller, host, timers } = harness();
    controller.begin({ threadId: "thr_a", subPath: "t/thr_a" });
    const [handle, timer] = [...timers][0];
    timers.delete(handle);
    timer.run(); // now() is still 0, the deadline is 250
    expect(host.openBoardPane).not.toHaveBeenCalled();
    expect(controller.pending()).not.toBeNull();
    expect(timers.size).toBe(1);
  });
});

describe("reading the thread out of a route", () => {
  it("finds the thread on both host thread routes", () => {
    expect(routeThreadIdFromPath("/projects/proj_a/threads/thr_abc")).toBe("thr_abc");
    expect(routeThreadIdFromPath("/threads/thr_abc")).toBe("thr_abc");
    expect(routeThreadIdFromPath("/threads/thr_abc/")).toBe("thr_abc");
  });

  it("answers null everywhere else, including the board's own routes", () => {
    expect(routeThreadIdFromPath("/")).toBeNull();
    expect(routeThreadIdFromPath("/plugins/focus-board/board")).toBeNull();
    expect(routeThreadIdFromPath("/plugins/focus-board/board/t/thr_abc")).toBeNull();
    expect(routeThreadIdFromPath("/projects/proj_a/threads")).toBeNull();
  });
});
