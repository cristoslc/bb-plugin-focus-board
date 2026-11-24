// The card click's native pane record, as a pure module: which pane Focus
// Board opened, and whether the live layout still holds it. The click's
// branches are exercised through the gesture in
// tests/app-card-click-replaces-board-pane.test.tsx; this file pins the record
// itself, including the corrupted, stale, and legacy shapes the gesture can
// only reach from storage.
//
// The rule these tests pin is the operator's ruling of 2026-11-24
// (dec_okjt7e62rg2x, "always take the pane back", corpus entry
// dl-20261124T050924-68ea): ownership is the PANE ID. A recorded pane present
// in the live layout is the board's whatever thread it shows, including none.
// The thread half is advisory — it names the thread the board last put there —
// and decides nothing.
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
      shownThreadId: "thr_a",
      isFocused: true,
    });
  });

  it("holds while the recorded pane shows another thread — the operator rethreaded it", () => {
    // The operator's ruling (dec_okjt7e62rg2x, "always take the pane back"): the
    // pane is the board's by id whatever it shows. A navigation the operator
    // made inside the pane does not hand the board's pane to them.
    const rethreaded = layout([
      { paneId: "pane-1", threadId: null, isFocused: false },
      { paneId: "pane-2", threadId: "thr_elsewhere", isFocused: true },
    ]);
    expect(resolveBoardNativePane(rethreaded, OWNED)).toEqual({
      paneId: "pane-2",
      threadId: "thr_a",
      shownThreadId: "thr_elsewhere",
      isFocused: true,
    });
  });

  it("holds while the recorded pane shows no thread at all — a page route", () => {
    // The rail's Decisions entry navigates the pane to a page, which the host
    // reports with `threadId: null`. That is still the board's pane.
    const page = layout([{ paneId: "pane-2", threadId: null, isFocused: false }]);
    expect(resolveBoardNativePane(page, OWNED)).toEqual({
      paneId: "pane-2",
      threadId: "thr_a",
      shownThreadId: null,
      isFocused: false,
    });
  });

  it("holds while the record names a thread the board no longer lists", () => {
    // The thread half is advisory: it names what the board last put there, and
    // a thread that left the board's list says nothing about the pane.
    const stale = layout([{ paneId: "pane-2", threadId: "thr_gone", isFocused: false }]);
    expect(resolveBoardNativePane(stale, OWNED)?.paneId).toBe("pane-2");
  });

  it("lapses when the pane is gone — the operator closed it", () => {
    const withoutPane = layout([{ paneId: "pane-1", threadId: null, isFocused: true }]);
    expect(resolveBoardNativePane(withoutPane, OWNED)).toBeNull();
  });

  it("lapses when the recorded id names the board's own pane", () => {
    // pane ids are recycled (`pane-N`, lowest free number wins), so a recorded
    // id can come to name the pane the board itself sits in — after a drag, or
    // after the pane it named was destroyed and re-created. Navigating "into"
    // that pane would replace the board, which is the one outcome the click
    // must never ship, so the record does not resolve there.
    const boardPane = layout([
      { paneId: "pane-1", threadId: "thr_b", isFocused: false },
      { paneId: "pane-2", threadId: null, isFocused: true },
    ]);
    expect(resolveBoardNativePane(boardPane, OWNED, "pane-2")).toBeNull();
  });

  it("does not care where the pane sits in the layout", () => {
    // A dragged pane keeps its id, and position is not ownership.
    const dragged = layout([
      { paneId: "pane-2", threadId: "thr_b", isFocused: false },
      { paneId: "pane-1", threadId: null, isFocused: true },
    ]);
    expect(resolveBoardNativePane(dragged, OWNED)?.paneId).toBe("pane-2");
  });

  it("has nothing to say without a split or without a record", () => {
    expect(resolveBoardNativePane(null, OWNED)).toBeNull();
    expect(resolveBoardNativePane(BOARD_AND_OWNED, null)).toBeNull();
  });
});
