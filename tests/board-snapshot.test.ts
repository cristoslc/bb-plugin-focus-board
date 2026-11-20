// @vitest-environment jsdom
// The remount bridge's own laws (lib/board-snapshot).
//
// The bug it exists for: bb re-creates the board's panel React subtree on the
// first split and again on the last unsplit (the host's branch swap, quoted in
// the module header), so the panel re-mounts inside one document and its state
// starts from empty. The probe
// (scripts/screenshot/probe-board-remount-on-split.mjs) proves the re-creation
// live; these are the halves jsdom can pin with teeth: what a snapshot accepts
// and refuses, what the slot does across a re-mount, and that the scroll read
// and write are exact round trips that never invent a lane.
import { describe, expect, it } from "vitest";
import {
  BOARD_SNAPSHOT_VERSION,
  EMPTY_SNAPSHOT_DATA,
  applyBoardScroll,
  forgetBoardSnapshot,
  hasRestoredPosition,
  parseBoardSnapshot,
  readBoardScroll,
  recallBoard,
  rememberBoardData,
  rememberBoardScroll,
  type BoardScroll,
  type BoardSnapshotData,
} from "../lib/board-snapshot";

function data(overrides: Partial<BoardSnapshotData> = {}): BoardSnapshotData {
  return { ...EMPTY_SNAPSHOT_DATA, ...overrides };
}

/** A painted board: the scroller, two lanes, their card lists. */
function paintBoard(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-columns-board data-lane-direction="vertical">
      <section data-column-id="unread"><div data-card-list></div></section>
      <section data-column-id="pinned"><div data-card-list></div></section>
    </div>`;
  document.body.append(root);
  return root;
}

const scroller = (root: ParentNode): HTMLElement =>
  root.querySelector("[data-columns-board]") as HTMLElement;
const laneList = (root: ParentNode, id: string): HTMLElement =>
  (root.querySelector(`[data-column-id="${id}"]`) as HTMLElement).querySelector(
    "[data-card-list]",
  ) as HTMLElement;

const scroll: BoardScroll = {
  board: { x: 260, y: 0 },
  viewportWidth: 800,
  lanes: { unread: { x: 0, y: 120 } },
};

describe("parsing a snapshot", () => {
  it("round-trips every field the mount fan-in seeds", () => {
    const full = data({
      doneIds: ["thr_done"],
      doneExtras: { thr_done: { doneAt: 1_700_000_000_000, keep: true } },
      parkIds: ["thr_parked"],
      linksByThread: {
        thr_done: [
          {
            tracker: "github",
            repo: "o/r",
            issue: 12,
            kind: "pull",
            href: "https://github.com/o/r/pull/12",
            createdAt: "2026-11-17T00:00:00.000Z",
            source: "agent",
          },
        ],
      },
      errorAckIds: ["thr_error"],
      snoozeRecords: {
        thr_snoozed: { wakeAt: "2026-11-18T09:00:00.000Z", setAt: "2026-11-17T09:00:00.000Z" },
      },
      ranks: { unread: ["thr_b", "thr_a"] },
      groupRegistry: { grp_1: { name: "Shipped", createdAt: "2026-11-01T00:00:00.000Z" } },
      groupAssignments: { thr_done: "grp_1" },
      collapsedFamilies: ["thr_parent"],
      hideIdleFamilies: ["thr_other_parent"],
      sweepConfig: { doneArchiveMs: 1, idleArchiveMs: 2 },
    });
    const written = {
      version: BOARD_SNAPSHOT_VERSION,
      takenAt: 1_700_000_000_500,
      data: full,
      scroll,
    };
    const read = parseBoardSnapshot(JSON.parse(JSON.stringify(written)));
    expect(read).toStrictEqual({ snapshot: written });
  });

  it("refuses a snapshot from another version, which is a cache miss and not an error", () => {
    const read = parseBoardSnapshot({
      version: BOARD_SNAPSHOT_VERSION + 1,
      takenAt: 1,
      data: data(),
      scroll: null,
    });
    expect("problem" in read).toBe(true);
  });

  it("round-trips an external tracker link too — the shape the first version of this module refused", () => {
    // Both tracker kinds carry their own identity: github by repo/number,
    // external by URL. The board renders both, so a snapshot that dropped the
    // external ones would quietly lose chips after every remount.
    const withExternal = data({
      linksByThread: {
        thr_one: [
          {
            tracker: "external",
            url: "https://linear.app/acme/issue/ACME-142",
            hostname: "linear.app",
            label: "ACME-142",
            createdAt: "2026-11-17T00:00:00.000Z",
            source: "operator",
          },
        ],
      },
    });
    const read = parseBoardSnapshot({
      version: BOARD_SNAPSHOT_VERSION,
      takenAt: 1,
      data: withExternal,
      scroll: null,
    });
    expect("snapshot" in read && read.snapshot.data.linksByThread).toEqual(
      withExternal.linksByThread,
    );
  });

  it("names the field that is wrong instead of coercing it", () => {
    const broken = {
      version: BOARD_SNAPSHOT_VERSION,
      takenAt: 1,
      data: { ...data(), doneIds: ["thr_ok", 7] },
      scroll: null,
    };
    const read = parseBoardSnapshot(broken);
    expect("problem" in read && read.problem).toContain("data.doneIds[1]");
  });

  it("refuses a non-object, a missing sweep config, and a negative scroll answer", () => {
    expect("problem" in parseBoardSnapshot(null)).toBe(true);
    expect(
      "problem" in
        parseBoardSnapshot({
          version: BOARD_SNAPSHOT_VERSION,
          takenAt: 1,
          data: { ...data(), sweepConfig: undefined },
          scroll: null,
        }),
    ).toBe(true);
    expect(
      "problem" in
        parseBoardSnapshot({
          version: BOARD_SNAPSHOT_VERSION,
          takenAt: 1,
          data: data(),
          scroll: { board: { x: Number.NaN, y: 0 }, viewportWidth: 800, lanes: {} },
        }),
    ).toBe(true);
    expect(
      "problem" in
        parseBoardSnapshot({
          version: BOARD_SNAPSHOT_VERSION,
          takenAt: 1,
          data: data(),
          scroll: { board: { x: 0, y: 0 }, viewportWidth: Number.NaN, lanes: {} },
        }),
    ).toBe(true);
  });
});

describe("the slot the next mount reads", () => {
  it("answers nothing before the first board has painted", () => {
    forgetBoardSnapshot();
    expect(recallBoard()).toBeNull();
  });

  it("hands the data and the scroll to the next mount, and keeps each half when the other changes", () => {
    forgetBoardSnapshot();
    rememberBoardData(data({ doneIds: ["thr_done"] }), 1_000);
    expect(recallBoard()?.data.doneIds).toEqual(["thr_done"]);
    expect(recallBoard()?.scroll).toBeNull();
    // The unmount cleanup lands the scroll without discarding the data.
    rememberBoardScroll(scroll);
    expect(recallBoard()?.data.doneIds).toEqual(["thr_done"]);
    expect(recallBoard()?.scroll).toEqual(scroll);
    // A later settled change lands the data without discarding the scroll.
    rememberBoardData(data({ doneIds: [] }), 2_000);
    expect(recallBoard()?.data.doneIds).toEqual([]);
    expect(recallBoard()?.scroll).toEqual(scroll);
    expect(recallBoard()?.takenAt).toBe(2_000);
    forgetBoardSnapshot();
  });

  it("keeps a scroll captured before the first settle, with the empty data that instance painted", () => {
    forgetBoardSnapshot();
    rememberBoardScroll(scroll);
    const held = recallBoard();
    expect(held?.scroll).toEqual(scroll);
    expect(held?.data).toEqual(EMPTY_SNAPSHOT_DATA);
    forgetBoardSnapshot();
  });
});

describe("the scroll half", () => {
  it("reads the board scroller and every lane list's own offsets", () => {
    const root = paintBoard();
    scroller(root).scrollLeft = 260;
    laneList(root, "unread").scrollTop = 120;
    laneList(root, "pinned").scrollTop = 40;
    expect(readBoardScroll(root)).toEqual({
      board: { x: 260, y: 0 },
      // jsdom lays nothing out, so the captured viewport is 0; a browser
      // records the scroller's own width here.
      viewportWidth: 0,
      lanes: { unread: { x: 0, y: 120 }, pinned: { x: 0, y: 40 } },
    });
    root.remove();
  });

  it("answers null on a commit with no board scroller — the loading view, which has nothing to remember", () => {
    const loading = document.createElement("div");
    expect(readBoardScroll(loading)).toBeNull();
  });

  it("puts the offsets back on a freshly painted board", () => {
    const root = paintBoard();
    expect(applyBoardScroll(root, scroll)).toBe(2); // the board + one lane
    expect(scroller(root).scrollLeft).toBe(260);
    expect(laneList(root, "unread").scrollTop).toBe(120);
    expect(laneList(root, "pinned").scrollTop).toBe(0);
    root.remove();
  });

  it("tells a real position from a board resting at zero, which leaves the mount fit alone", () => {
    expect(hasRestoredPosition({ board: { x: 0, y: 0 }, viewportWidth: 800, lanes: {} })).toBe(false);
    expect(
      hasRestoredPosition({ board: { x: 0, y: 0 }, viewportWidth: 800, lanes: { pinned: { x: 0, y: 0 } } }),
    ).toBe(false);
    expect(hasRestoredPosition({ board: { x: 260, y: 0 }, viewportWidth: 800, lanes: {} })).toBe(true);
    expect(
      hasRestoredPosition({ board: { x: 0, y: 0 }, viewportWidth: 800, lanes: { pinned: { x: 0, y: 120 } } }),
    ).toBe(true);
  });

  it("skips a remembered lane that is no longer on the board, never inventing one", () => {    const root = paintBoard();
    const restored = applyBoardScroll(root, {
      board: { x: 10, y: 0 },
      viewportWidth: 800,
      lanes: { "no-such-lane": { x: 0, y: 90 } },
    });
    expect(restored).toBe(1); // the board alone
    expect(root.querySelector('[data-column-id="no-such-lane"]')).toBeNull();
    root.remove();
  });
});
