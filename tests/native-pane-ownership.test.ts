// The card click's native placement rule, as a pure module: who owns which
// pane, and when a click replaces instead of opening. The gesture wiring is
// tests/app-card-click-replaces-board-pane.test.tsx; this file pins the rule
// itself, including the cases the gesture can only reach through a corrupted,
// stale, or mid-split record.
import { describe, expect, it } from "vitest";

import {
  boardNativePaneStoredValue,
  nativePaneStorageKey,
  parseBoardNativePaneStored,
  planNativeCardPlacement,
  resolveBoardNativePane,
  type BoardNativePane,
} from "../lib/native-pane-ownership";
import type { SplitPaneLayoutView } from "../lib/split-pane-cap";

function layout(
  panes: readonly { paneId: string; threadId: string | null; isFocused: boolean }[],
): SplitPaneLayoutView {
  return { panes };
}

const BOARD_AND_OWNED = layout([
  { paneId: "pane-1", threadId: null, isFocused: false },
  { paneId: "pane-2", threadId: "thr_a", isFocused: true },
]);

const OWNED: BoardNativePane = {
  paneId: "pane-2",
  threadId: "thr_a",
  priorPaneIds: [],
};

const LIVE = ["thr_a", "thr_b", "thr_c"];

describe("the stored record", () => {
  it("round-trips a pane id, its thread, and the panes that predate it", () => {
    const stored = boardNativePaneStoredValue(OWNED);
    expect(parseBoardNativePaneStored(stored)).toEqual(OWNED);
  });

  it("round-trips a record that knows only the thread", () => {
    const unclaimed: BoardNativePane = {
      paneId: null,
      threadId: "thr_a",
      priorPaneIds: ["pane-1"],
    };
    expect(parseBoardNativePaneStored(boardNativePaneStoredValue(unclaimed))).toEqual(
      unclaimed,
    );
  });

  it("stores no record as the empty string", () => {
    expect(boardNativePaneStoredValue(null)).toBe("");
    expect(parseBoardNativePaneStored("")).toBeNull();
    expect(parseBoardNativePaneStored(null)).toBeNull();
  });

  it("keys the record under the plugin id, so a republished copy never collides", () => {
    expect(nativePaneStorageKey("focus-board")).toBe(
      "focus-board:boardNativeThreadPane",
    );
    expect(nativePaneStorageKey("focus-board-fork")).not.toBe(
      nativePaneStorageKey("focus-board"),
    );
  });

  it("reads a record written by the first version of the rule", () => {
    // `{"paneId":"pane-2","threadId":"thr_a"}`: no priorPaneIds. Its pane id is
    // concrete, so an empty list changes nothing about how it resolves.
    expect(
      parseBoardNativePaneStored('{"paneId":"pane-2","threadId":"thr_a"}'),
    ).toEqual({ paneId: "pane-2", threadId: "thr_a", priorPaneIds: [] });
  });

  it("answers null for anything malformed rather than repairing it", () => {
    // No guess is ever made from a damaged record: guessing decides whose pane
    // gets replaced.
    expect(parseBoardNativePaneStored("{")).toBeNull();
    expect(parseBoardNativePaneStored("null")).toBeNull();
    expect(parseBoardNativePaneStored('"pane-2"')).toBeNull();
    expect(parseBoardNativePaneStored("[]")).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"pane-2"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"threadId":"thr_a"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"","threadId":"thr_a"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"pane-2","threadId":7}')).toBeNull();
    expect(
      parseBoardNativePaneStored(
        '{"paneId":"pane-2","threadId":"thr_a","priorPaneIds":"pane-1"}',
      ),
    ).toBeNull();
  });
});

describe("ownership against the live layout", () => {
  it("holds while the recorded pane still shows the recorded thread", () => {
    expect(resolveBoardNativePane(BOARD_AND_OWNED, OWNED)).toEqual({
      paneId: "pane-2",
      threadId: "thr_a",
      isFocused: true,
    });
  });

  it("lapses when the pane is gone — the operator closed it", () => {
    const withoutPane = layout([{ paneId: "pane-1", threadId: null, isFocused: true }]);
    expect(resolveBoardNativePane(withoutPane, OWNED)).toBeNull();
  });

  it("lapses when the pane shows another thread — the operator took it over", () => {
    const rethreaded = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-2", threadId: "thr_elsewhere", isFocused: true },
    ]);
    expect(resolveBoardNativePane(rethreaded, OWNED)).toBeNull();
  });

  it("lapses when a recycled pane id names a non-thread pane", () => {
    // bb names panes `pane-N` and reuses the lowest free number, so an id can
    // outlive the pane it named. The thread half is what refuses it.
    const recycled = layout([{ paneId: "pane-2", threadId: null, isFocused: true }]);
    expect(resolveBoardNativePane(recycled, OWNED)).toBeNull();
  });

  it("has nothing to say without a split or without a record", () => {
    expect(resolveBoardNativePane(null, OWNED)).toBeNull();
    expect(resolveBoardNativePane(BOARD_AND_OWNED, null)).toBeNull();
  });

  it("claims a thread-only record from the pane the host created for it", () => {
    const unclaimed: BoardNativePane = {
      paneId: null,
      threadId: "thr_a",
      priorPaneIds: ["pane-1"],
    };
    expect(resolveBoardNativePane(BOARD_AND_OWNED, unclaimed)).toEqual({
      paneId: "pane-2",
      threadId: "thr_a",
      isFocused: true,
    });
  });

  it("never claims a pane that already existed when the board opened the thread", () => {
    // The board asked for thr_a while the operator's own pane-4 already showed
    // it, so the host focused their pane instead of creating one. That pane is
    // theirs.
    const unclaimed: BoardNativePane = {
      paneId: null,
      threadId: "thr_a",
      priorPaneIds: ["pane-1", "pane-4"],
    };
    const theirPane = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-4", threadId: "thr_a", isFocused: true },
    ]);
    expect(resolveBoardNativePane(theirPane, unclaimed)).toBeNull();
  });

  it("claims a thread-only record once the host has given that thread a new pane", () => {
    // The same thread, but in a pane that did not exist at click time: the
    // host created it, so it is the board's.
    const unclaimed: BoardNativePane = {
      paneId: null,
      threadId: "thr_a",
      priorPaneIds: ["pane-1", "pane-4"],
    };
    expect(resolveBoardNativePane(BOARD_AND_OWNED, unclaimed)?.paneId).toBe("pane-2");
  });
});

describe("what a click does", () => {
  it("replaces the board's pane with any other thread", () => {
    expect(planNativeCardPlacement(BOARD_AND_OWNED, OWNED, "thr_b", LIVE)).toEqual({
      kind: "replace",
      paneId: "pane-2",
      threadId: "thr_a",
    });
  });

  it("focuses when the clicked thread is already the pane's", () => {
    // The host's opener focuses a pane that already shows the thread: nothing
    // moves, and pretending this was a replacement would navigate for nothing.
    expect(planNativeCardPlacement(BOARD_AND_OWNED, OWNED, "thr_a", LIVE)).toEqual({
      kind: "focus",
      paneId: "pane-2",
    });
  });

  it("opens the board's own pane when there is no split yet", () => {
    // bb's hook answers null for a one-pane layout, which is where every
    // session starts, so the board cannot name a pane: a split request here
    // would grow one native pane per click (the 2026-11-17 report).
    expect(planNativeCardPlacement(null, null, "thr_a", LIVE)).toEqual({
      kind: "in-board",
      reason: "unowned",
    });
    expect(planNativeCardPlacement(null, OWNED, "thr_b", LIVE)).toEqual({
      kind: "in-board",
      reason: "unowned",
    });
  });

  it("opens the board's own pane when the board owns no pane", () => {
    expect(planNativeCardPlacement(BOARD_AND_OWNED, null, "thr_b", LIVE)).toEqual({
      kind: "in-board",
      reason: "unowned",
    });
  });

  it("opens when the record no longer matches the layout", () => {
    const operatorPane = layout([
      { paneId: "pane-1", threadId: null, isFocused: true },
      { paneId: "pane-7", threadId: "thr_theirs", isFocused: false },
    ]);
    expect(planNativeCardPlacement(operatorPane, OWNED, "thr_b", LIVE)).toEqual({
      kind: "in-board",
      reason: "unowned",
    });
  });

  it("opens instead of replacing when the pane's thread has left the board's list", () => {
    // The record names a pane showing a thread the board no longer lists. The
    // host cannot resolve that thread either, so navigating to it would land
    // on the app's fallback route: the click must open, and leave that pane be.
    expect(
      planNativeCardPlacement(BOARD_AND_OWNED, OWNED, "thr_b", ["thr_b", "thr_c"]),
    ).toEqual({ kind: "in-board", reason: "unowned" });
  });

  it("still focuses a pane whose thread has left the list when it is the clicked one", () => {
    // Clicking that very thread is the host's opener's business: it focuses
    // the pane and nothing else happens.
    expect(
      planNativeCardPlacement(BOARD_AND_OWNED, OWNED, "thr_a", ["thr_b"]),
    ).toEqual({ kind: "focus", paneId: "pane-2" });
  });
});
