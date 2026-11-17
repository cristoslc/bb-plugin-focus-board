// The card click's native placement rule, as a pure module: who owns which
// pane, and when a click replaces instead of opening. The gesture wiring is
// tests/app-card-click-replaces-board-pane.test.tsx; this file pins the rule
// itself, including the cases the gesture can only reach through a corrupted
// or stale record.
import { describe, expect, it } from "vitest";

import {
  boardNativePaneInLayout,
  boardNativePaneStoredValue,
  nativePaneStorageKey,
  newlyOpenedPane,
  parseBoardNativePaneStored,
  planNativeCardPlacement,
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

const OWNED: BoardNativePane = { paneId: "pane-2", threadId: "thr_a" };

describe("the stored record", () => {
  it("round-trips a pane id and its thread", () => {
    const stored = boardNativePaneStoredValue(OWNED);
    expect(parseBoardNativePaneStored(stored)).toEqual(OWNED);
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

  it("answers null for anything malformed rather than repairing it", () => {
    // No guess is ever made from a damaged record: guessing decides whose
    // pane gets replaced.
    expect(parseBoardNativePaneStored("{")).toBeNull();
    expect(parseBoardNativePaneStored("null")).toBeNull();
    expect(parseBoardNativePaneStored('"pane-2"')).toBeNull();
    expect(parseBoardNativePaneStored("[]")).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"pane-2"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"threadId":"thr_a"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"","threadId":"thr_a"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"pane-2","threadId":7}')).toBeNull();
  });
});

describe("ownership against the live layout", () => {
  it("holds while the recorded pane still shows the recorded thread", () => {
    expect(boardNativePaneInLayout(BOARD_AND_OWNED, OWNED)).toEqual(OWNED);
  });

  it("lapses when the pane is gone — the operator closed it", () => {
    const withoutPane = layout([{ paneId: "pane-1", threadId: null, isFocused: true }]);
    expect(boardNativePaneInLayout(withoutPane, OWNED)).toBeNull();
  });

  it("lapses when the pane shows another thread — the operator took it over", () => {
    const rethreaded = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-2", threadId: "thr_elsewhere", isFocused: true },
    ]);
    expect(boardNativePaneInLayout(rethreaded, OWNED)).toBeNull();
  });

  it("lapses when a recycled pane id names a non-thread pane", () => {
    // bb names panes `pane-N` and reuses the lowest free number, so an id can
    // outlive the pane it named. The thread half is what refuses it.
    const recycled = layout([{ paneId: "pane-2", threadId: null, isFocused: true }]);
    expect(boardNativePaneInLayout(recycled, OWNED)).toBeNull();
  });

  it("has nothing to say without a split or without a record", () => {
    expect(boardNativePaneInLayout(null, OWNED)).toBeNull();
    expect(boardNativePaneInLayout(BOARD_AND_OWNED, null)).toBeNull();
  });
});

describe("what a click does", () => {
  it("replaces the board's pane with any other thread", () => {
    expect(planNativeCardPlacement(BOARD_AND_OWNED, OWNED, "thr_b")).toEqual({
      kind: "replace",
      paneId: "pane-2",
      threadId: "thr_a",
      focused: true,
    });
  });

  it("reports the focus the replacement would find, so a focused pane needs no focus step", () => {
    const boardFocused = layout([
      { paneId: "pane-1", threadId: null, isFocused: true },
      { paneId: "pane-2", threadId: "thr_a", isFocused: false },
    ]);
    expect(planNativeCardPlacement(boardFocused, OWNED, "thr_b")).toEqual({
      kind: "replace",
      paneId: "pane-2",
      threadId: "thr_a",
      focused: false,
    });
  });

  it("hands the clicked thread to the opener when it is already in the pane", () => {
    // The host's opener focuses a pane that already shows the thread: nothing
    // moves, and pretending this was a replacement would navigate twice.
    expect(planNativeCardPlacement(BOARD_AND_OWNED, OWNED, "thr_a")).toEqual({
      kind: "open",
    });
  });

  it("opens beside the board when there is no split yet", () => {
    expect(planNativeCardPlacement(null, null, "thr_a")).toEqual({ kind: "open" });
    expect(planNativeCardPlacement(null, OWNED, "thr_b")).toEqual({ kind: "open" });
  });

  it("opens when the board owns no pane", () => {
    expect(planNativeCardPlacement(BOARD_AND_OWNED, null, "thr_b")).toEqual({
      kind: "open",
    });
  });

  it("opens when the record no longer matches the layout", () => {
    const operatorPane = layout([
      { paneId: "pane-1", threadId: null, isFocused: true },
      { paneId: "pane-7", threadId: "thr_theirs", isFocused: false },
    ]);
    expect(planNativeCardPlacement(operatorPane, OWNED, "thr_b")).toEqual({
      kind: "open",
    });
  });
});

describe("claiming the pane the host created", () => {
  const priorIds = ["pane-1"];

  it("claims the pane that started showing the thread", () => {
    const afterSplit = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-2", threadId: "thr_a", isFocused: true },
    ]);
    expect(newlyOpenedPane(afterSplit, "thr_a", priorIds)).toEqual({
      paneId: "pane-2",
      threadId: "thr_a",
    });
  });

  it("never claims a pane that already showed that thread — that one is the operator's", () => {
    const theirs = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-4", threadId: "thr_a", isFocused: true },
    ]);
    // The pane was there before the click, so the host focused it instead of
    // inserting one: it stays the operator's.
    expect(newlyOpenedPane(theirs, "thr_a", ["pane-1", "pane-4"])).toBeNull();
  });

  it("claims nothing when the host inserted no pane", () => {
    expect(newlyOpenedPane(null, "thr_a", priorIds)).toBeNull();
    expect(newlyOpenedPane(layout(priorIds.map((paneId) => ({
      paneId,
      threadId: null,
      isFocused: true,
    }))), "thr_a", priorIds)).toBeNull();
  });
});
