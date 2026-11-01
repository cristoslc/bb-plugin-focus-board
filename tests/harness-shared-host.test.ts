import { describe, expect, it } from "vitest";
import { mintLegacyColumn } from "../lib/rank-fractions";
import { applyHostOp, type HostOp, type HostState } from "../scripts/screenshot/host-state";
import { createHostLog, HOST_LOG_PREFIX, type HostLogStorage } from "../scripts/screenshot/host-log";

/**
 * The harness's shared host row (`?sharedHost=1`) is what lets a two-window
 * demo, or a two-window UAT suite, show a write in one window landing in the
 * other. Two things have to hold for that to be truthful:
 *
 * 1. Both windows apply the SAME write semantics — `applyHostOp` is the one
 *    copy, and these tests pin the echo each write publishes, because the
 *    receiving window refetches off that signal and a wrong payload is a
 *    silent no-op on screen.
 * 2. Two windows writing at one moment append two records, never one clobbered
 *    array — the row is per-write records in localStorage, and the log's
 *    ordering is what a replay depends on.
 */

const BASE: HostState = {
  ranks: { working: mintLegacyColumn(["thr_a", "thr_b", "thr_c"]) },
  doneIds: ["thr_done"],
  family: { collapsedFamilies: [], hideIdleChildren: [] },
  groups: {
    registry: { grp_one: { name: "Alpha", createdAt: "2026-10-01T00:00:00.000Z" } },
    assignments: { thr_a: "grp_one" },
  },
};

function apply(state: HostState, op: HostOp) {
  return applyHostOp(state, op);
}

describe("shared host row", () => {
  it("marks a thread done and publishes the echo a second window refetches on", () => {
    const { state, signal } = apply(BASE, { kind: "done_set", threadId: "thr_b", done: true });
    expect(state.doneIds).toEqual(["thr_done", "thr_b"]);
    expect(signal).toEqual({
      channel: "done-changed",
      payload: { threadId: "thr_b", done: true },
    });
    // The input row is untouched: a render reading the old state mid-write
    // must not see a half-applied row.
    expect(BASE.doneIds).toEqual(["thr_done"]);
  });

  it("clearing a done mark removes it rather than rewriting the set", () => {
    const { state } = apply(BASE, { kind: "done_set", threadId: "thr_done", done: false });
    expect(state.doneIds).toEqual([]);
  });

  it("folds a family and publishes the key/id/on payload", () => {
    const { state, signal } = apply(BASE, {
      kind: "family_state_set",
      key: "collapsedFamilies",
      id: "thr_family",
      on: true,
    });
    expect(state.family.collapsedFamilies).toEqual(["thr_family"]);
    expect(signal).toEqual({
      channel: "family-state-changed",
      payload: { key: "collapsedFamilies", id: "thr_family", on: true },
    });
  });

  it("a merge unions both windows' folds instead of replacing them", () => {
    const folded = apply(BASE, {
      kind: "family_state_set",
      key: "collapsedFamilies",
      id: "thr_first",
      on: true,
    }).state;
    const { state, signal } = apply(folded, {
      kind: "family_state_merge",
      collapsedFamilies: ["thr_second"],
      hideIdleChildren: ["thr_idle"],
    });
    expect(state.family).toEqual({
      collapsedFamilies: ["thr_first", "thr_second"],
      hideIdleChildren: ["thr_idle"],
    });
    expect(signal).toEqual({
      channel: "family-state-changed",
      payload: { key: null, id: null, on: null },
    });
  });

  it("creating a group the other window already named converges on one record", () => {
    const { state, signal } = apply(BASE, {
      kind: "group_create",
      group: { id: "grp_alpha", name: "Alpha", createdAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(Object.keys(state.groups.registry)).toEqual(["grp_one"]);
    expect(signal).toEqual({ channel: "group-changed", payload: { threadId: null } });
  });

  it("creating a new group registers it and names the member that changed", () => {
    const { state } = apply(BASE, {
      kind: "group_create",
      group: { id: "grp_two", name: "Beta", createdAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(state.groups.registry.grp_two).toEqual({
      name: "Beta",
      createdAt: "2026-11-01T00:00:00.000Z",
    });
  });

  it("a rename onto another group's name is refused, not written", () => {
    const twoGroups: HostState = {
      ...BASE,
      groups: {
        registry: {
          ...BASE.groups.registry,
          grp_two: { name: "Beta", createdAt: "2026-11-01T00:00:00.000Z" },
        },
        assignments: BASE.groups.assignments,
      },
    };
    expect(() => apply(twoGroups, { kind: "group_rename", groupId: "grp_two", name: "Alpha" })).toThrow(
      /already taken/u,
    );
  });

  it("assigning and clearing a group's member both publish the thread's change", () => {
    const assigned = apply(BASE, { kind: "group_set", threadId: "thr_b", groupId: "grp_one" });
    expect(assigned.state.groups.assignments).toEqual({
      thr_a: "grp_one",
      thr_b: "grp_one",
    });
    expect(assigned.signal).toEqual({ channel: "group-changed", payload: { threadId: "thr_b" } });

    const cleared = apply(assigned.state, { kind: "group_set", threadId: "thr_a", groupId: null });
    expect(cleared.state.groups.assignments).toEqual({ thr_b: "grp_one" });
  });

  it("a rank move runs the shared op and reports the resulting column order", () => {
    const { state, signal, order } = apply(BASE, {
      kind: "rank_move",
      args: {
        columnKey: "working",
        threadId: "thr_c",
        beforeId: "thr_a",
        toEnd: false,
        visibleIds: ["thr_a", "thr_b", "thr_c"],
      },
    });
    expect(order).toEqual(["thr_c", "thr_a", "thr_b"]);
    expect(signal).toEqual({ channel: "rank-changed", payload: { columnKey: "working" } });
    expect(state.ranks.working).not.toBe(BASE.ranks.working);
  });

  it("an unknown op fails loudly instead of leaving the board stale", () => {
    expect(() => applyHostOp(BASE, { kind: "not-a-write" } as unknown as HostOp)).toThrow(
      /unknown host op/u,
    );
  });
});

/** A Web Storage stand-in with the same key ordering semantics as the browser. */
function fakeStorage(): HostLogStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("shared host log", () => {
  it("publishes one record per write, so two windows never clobber one row", () => {
    const storage = fakeStorage();
    const first = createHostLog({ storage, clock: () => 1000, nonce: () => "aaaaaa" });
    const second = createHostLog({ storage, clock: () => 1000, nonce: () => "bbbbbb" });
    const keyA = first.publish({ kind: "done_set", threadId: "thr_a", done: true });
    const keyB = second.publish({ kind: "done_set", threadId: "thr_b", done: true });

    expect(keyA).not.toBe(keyB);
    expect(storage.map.size).toBe(2);
    // Both writes survive: the bug this row exists to prevent is one window's
    // write erasing the other's.
    expect(first.records().map((record) => record.op)).toEqual([
      { kind: "done_set", threadId: "thr_a", done: true },
      { kind: "done_set", threadId: "thr_b", done: true },
    ]);
  });

  it("orders records by write time, then by the writing window's sequence", () => {
    let now = 5000;
    const storage = fakeStorage();
    const log = createHostLog({
      storage,
      clock: () => now,
      nonce: () => "zzzzzz",
    });
    const first = log.publish({ kind: "done_set", threadId: "thr_a", done: true });
    const second = log.publish({ kind: "done_set", threadId: "thr_b", done: true });
    now = 6000;
    const third = log.publish({ kind: "done_set", threadId: "thr_c", done: true });

    expect([first, second, third]).toEqual([...log.records().map((record) => record.key)]);
    expect(log.lastKey()).toBe(third);
    expect(log.records(second).map((record) => record.key)).toEqual([third]);
  });

  it("a page opened later replays every write it missed", () => {
    const storage = fakeStorage();
    const writer = createHostLog({ storage, clock: () => 7000, nonce: () => "write1" });
    writer.publish({ kind: "family_state_set", key: "hideIdleChildren", id: "thr_f", on: true });
    writer.publish({ kind: "group_set", threadId: "thr_f", groupId: null });

    const late = createHostLog({ storage });
    expect(late.records().map((record) => record.op.kind)).toEqual([
      "family_state_set",
      "group_set",
    ]);
  });

  it("only names its own keys, so unrelated storage writes stay out of the row", () => {
    const storage = fakeStorage();
    const log = createHostLog({ storage });
    storage.setItem("focus-board:wallpaper", "{}");
    expect(log.isHostRecord("focus-board:wallpaper")).toBe(false);
    const key = log.publish({ kind: "done_set", threadId: "thr_a", done: false });
    expect(key.startsWith(HOST_LOG_PREFIX)).toBe(true);
    expect(log.records()).toHaveLength(1);
  });

  it("a corrupt record fails the replay instead of skipping a write", () => {
    const storage = fakeStorage();
    const log = createHostLog({ storage });
    storage.setItem(`${HOST_LOG_PREFIX}0000000000001-0000-xxxxxx`, "not json");
    expect(() => log.records()).toThrow();
  });
});
