// The card click's native pane record, as a pure module: which pane Focus
// Board opened, and whether the live layout still agrees. The click's branches
// are exercised through the gesture in
// tests/app-card-click-replaces-board-pane.test.tsx; this file pins the record
// itself, including the corrupted, stale, and legacy shapes the gesture can
// only reach from storage.
import { describe, expect, it } from "vitest";

import {
  boardNativePaneStoredValue,
  nativePaneStorageKey,
  parseBoardNativePaneStored,
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

const OWNED: BoardNativePane = { paneId: "pane-2", threadId: "thr_a" };

describe("the stored record", () => {
  it("round-trips a pane id and its thread", () => {
    expect(parseBoardNativePaneStored(boardNativePaneStoredValue(OWNED))).toEqual(OWNED);
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

  it("reads a record written without a pane id as no record", () => {
    // An earlier version of the rule could write `paneId: null` ("claim
    // whichever pane shows the thread that was not there at click time"). That
    // branch is gone, and this shape must not be repaired into ownership of a
    // pane the board cannot name.
    expect(
      parseBoardNativePaneStored('{"paneId":null,"threadId":"thr_a","priorPaneIds":[]}'),
    ).toBeNull();
    expect(
      parseBoardNativePaneStored('{"threadId":"thr_a","priorPaneIds":["pane-1"]}'),
    ).toBeNull();
  });

  it("reads an older record that still carried priorPaneIds", () => {
    // The field is ignored, not rejected: the pane id and thread are the whole
    // record, and a rewrite drops the extra key.
    expect(
      parseBoardNativePaneStored(
        '{"paneId":"pane-2","threadId":"thr_a","priorPaneIds":["pane-1"]}',
      ),
    ).toEqual(OWNED);
  });

  it("answers null for anything malformed rather than repairing it", () => {
    // No guess is ever made from a damaged record: guessing decides whose pane
    // gets replaced.
    expect(parseBoardNativePaneStored("{")).toBeNull();
    expect(parseBoardNativePaneStored("null")).toBeNull();
    expect(parseBoardNativePaneStored('"pane-2"')).toBeNull();
    expect(parseBoardNativePaneStored("[]")).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"pane-2"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"","threadId":"thr_a"}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":"pane-2","threadId":7}')).toBeNull();
    expect(parseBoardNativePaneStored('{"paneId":7,"threadId":"thr_a"}')).toBeNull();
  });
});

describe("the record against the live layout", () => {
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

  it("lapses when the same thread sits in a different pane", () => {
    // The operator opened that thread from bb's own sidebar: their pane is
    // theirs, even when it shows the thread the board put in its own.
    const theirPane = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-4", threadId: "thr_a", isFocused: true },
    ]);
    expect(resolveBoardNativePane(theirPane, OWNED)).toBeNull();
  });

  it("has nothing to say without a split or without a record", () => {
    expect(resolveBoardNativePane(null, OWNED)).toBeNull();
    expect(resolveBoardNativePane(BOARD_AND_OWNED, null)).toBeNull();
  });
});
