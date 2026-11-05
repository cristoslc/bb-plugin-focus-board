import { describe, expect, it } from "vitest";
import {
  assignBurstsToCommits,
  burstsFromMutationRecords,
  driverKeyForCommit,
  driversFromTimeline,
  rpcRunsFromMarks,
  settleFence,
  trimCountObject,
} from "../scripts/perf/settle-attribution-lib.mjs";

describe("rpcRunsFromMarks", () => {
  it("pairs each method's start with the next end, in mark order", () => {
    const runs = rpcRunsFromMarks([
      { label: "fb-rpc-start:link_list", t: 10 },
      { label: "fb-rpc-start:pulse_rates", t: 11 },
      { label: "fb-rpc-end:link_list", t: 12 },
      { label: "fb-rpc-end:pulse_rates", t: 13 },
      { label: "fb-rpc-start:tracker_status", t: 400 },
      { label: "fb-rpc-end:tracker_status", t: 402 },
    ]);
    expect(runs).toEqual([
      { method: "link_list", start: 10, end: 12 },
      { method: "pulse_rates", start: 11, end: 13 },
      { method: "tracker_status", start: 400, end: 402 },
    ]);
  });

  it("keeps repeated calls of one method as separate runs", () => {
    const runs = rpcRunsFromMarks([
      { label: "fb-rpc-start:tracker_status", t: 100 },
      { label: "fb-rpc-end:tracker_status", t: 102 },
      { label: "fb-rpc-start:tracker_status", t: 300 },
      { label: "fb-rpc-end:tracker_status", t: 304 },
    ]);
    expect(runs.map((run) => run.end)).toEqual([102, 304]);
  });

  it("ignores an end whose start never opened (unbalanced instrument)", () => {
    const runs = rpcRunsFromMarks([{ label: "fb-rpc-end:done_list", t: 5 }]);
    expect(runs).toEqual([]);
  });
});

describe("settleFence", () => {
  const runs = [
    { method: "link_list", start: 5, end: 30 },
    { method: "pulse_rates", start: 5, end: 20 },
  ];

  it("takes the max of first card and the last mount rpc end", () => {
    expect(settleFence(25, runs, ["link_list", "pulse_rates"])).toBe(30);
    expect(settleFence(40, runs, ["link_list", "pulse_rates"])).toBe(40);
  });

  it("filters the fence to the mount calls only", () => {
    const withChips = [...runs, { method: "tracker_status", start: 200, end: 900 }];
    expect(settleFence(25, withChips, ["link_list", "pulse_rates"])).toBe(30);
  });
});

describe("burstsFromMutationRecords", () => {
  it("groups records closer than the gap into one burst", () => {
    const bursts = burstsFromMutationRecords([
      { t: 100, kind: "add", where: "card:thr_1" },
      { t: 103, kind: "text", where: "card:thr_2" },
      { t: 118, kind: "add", where: "toolbar" },
    ]);
    expect(bursts).toHaveLength(2);
    expect(bursts[0]).toMatchObject({ t0: 100, t1: 103, count: 2 });
    expect(bursts[0].kinds).toEqual({ add: 1, text: 1 });
    expect(bursts[1]).toMatchObject({ t0: 118, t1: 118, count: 1 });
  });

  it("keeps a long stretch of records as one moving burst (gap is from the last record)", () => {
    const bursts = burstsFromMutationRecords(
      [100, 105, 110, 115].map((t) => ({ t, kind: "add", where: "card" })),
    );
    expect(bursts).toHaveLength(1);
    expect(bursts[0].count).toBe(4);
  });
});

describe("assignBurstsToCommits", () => {
  it("assigns a burst to the last commit at or before its start plus slack", () => {
    const commits = [{ idx: 0, t: 90 }, { idx: 1, t: 130 }];
    const bursts = [{ t0: 95, t1: 96, count: 1, kinds: {}, where: {} }, { t0: 135, t1: 136, count: 1, kinds: {}, where: {} }];
    const map = assignBurstsToCommits(bursts, commits);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(1);
  });

  it("maps a burst that precedes every commit to null", () => {
    const bursts = [{ t0: 5, t1: 5, count: 1, kinds: {}, where: {} }];
    const map = assignBurstsToCommits(bursts, [{ idx: 0, t: 90 }]);
    expect(map.get(0)).toBeNull();
  });
});

describe("driverKeyForCommit", () => {
  const rpcRuns = [
    { method: "link_list", start: 10, end: 20 },
    { method: "tracker_status", start: 300, end: 330 },
  ];

  it("keys the commit on the rpc end inside its render window", () => {
    expect(driverKeyForCommit({ prevT: 280, t: 322 }, rpcRuns)).toBe("tracker_status");
  });

  it("returns null when no resolution sits near the commit", () => {
    expect(driverKeyForCommit({ prevT: 500, t: 560 }, rpcRuns)).toBeNull();
  });

  it("picks the nearest end to the window's middle when two sit inside", () => {
    const runs = [
      { method: "a_list", start: 0, end: 100 },
      { method: "b_list", start: 0, end: 112 },
    ];
    expect(driverKeyForCommit({ prevT: 95, t: 125 }, runs)).toBe("b_list");
  });

  it("never keys an end mark that already belonged to the previous commit", () => {
    // A timer-adjacent commit whose renders ran (233..429) must not adopt an
    // rpc end that preceded its render window (226 ≤ prevT): that end keyed
    // the previous commit already.
    expect(driverKeyForCommit({ prevT: 233, t: 429 }, [
      { method: "tracker_status", start: 210, end: 226 },
    ])).toBeNull();
  });
});

describe("driversFromTimeline", () => {
  const commits = [
    { idx: 0, t: 100, prevT: 50, names: ["App×1", "ThreadCard×3"] },
    { idx: 1, t: 320, prevT: 100, names: ["App×1", "ThreadCard×2", "Toolbar×1"] },
  ];
  const rpcRuns = [
    { method: "link_list", start: 10, end: 55 },
    { method: "tracker_status", start: 300, end: 318 },
  ];
  const bursts = [
    { t0: 101, t1: 105, count: 3, kinds: { add: 2, text: 1 }, where: { "card:thr_1": 2, toolbar: 1 } },
    { t0: 321, t1: 340, count: 4, kinds: { add: 4 }, where: { "card:thr_2": 3, chip: 1 } },
  ];
  const burstCommits = new Map([
    [0, 0],
    [1, 1],
  ]);

  it("groups tail bursts by driver and keeps pre-fence mutations out", () => {
    const { drivers, orphans, beforeFence } = driversFromTimeline({
      commits,
      bursts,
      burstCommits,
      rpcRuns,
      fence: 100,
    });
    expect(drivers).toHaveLength(2);
    expect(drivers[0]).toMatchObject({
      key: "rpc:link_list",
      childMutations: 2,
      textMutations: 1,
      firstMutationT: 101,
      lastMutationT: 105,
    });
    expect(drivers[1]).toMatchObject({
      key: "rpc:tracker_status",
      childMutations: 4,
      firstMutationT: 321,
      lastMutationT: 340,
    });
    // The link driver's render census aggregates across its commits, sorted
    // by per-name count descending.
    expect(drivers[0].renderedByName).toEqual([
      { name: "ThreadCard", count: 3 },
      { name: "App", count: 1 },
    ]);
    expect(beforeFence.childMutations).toBe(0);
    expect(orphans.childMutations).toBe(0);
  });

  it("keeps pre-fence bursts out of the tail and reports them once", () => {
    const { beforeFence } = driversFromTimeline({
      commits,
      bursts: [bursts[0]],
      burstCommits: new Map([[0, 0]]),
      rpcRuns,
      fence: 110,
    });
    expect(beforeFence).toEqual({ childMutations: 2, textMutations: 1 });
  });

  it("counts unassigned bursts as orphans, not driver mutations", () => {
    const { orphans, drivers } = driversFromTimeline({
      commits,
      bursts: [{ t0: 321, t1: 322, count: 1, kinds: { add: 1 }, where: { "body-sub:script": 1 } }],
      burstCommits: new Map([[0, null]]),
      rpcRuns,
      fence: 120,
    });
    expect(orphans).toEqual({ childMutations: 1, textMutations: 0, bursts: 1 });
    expect(drivers).toHaveLength(0);
  });

  it("labels timer-driven commits no-rpc-effect", () => {
    const { drivers } = driversFromTimeline({
      commits,
      bursts: [bursts[1]],
      burstCommits: new Map([[0, 1]]),
      rpcRuns: [],
      fence: 120,
    });
    expect(drivers[0].key).toBe("no-rpc-effect");
  });

  it("refuses a missing fence loud", () => {
    expect(() =>
      driversFromTimeline({ commits, bursts: [], burstCommits: new Map(), rpcRuns, fence: null }),
    ).toThrow(/fence/);
  });
});

describe("trimCountObject", () => {
  it("folds the tail of a large bucket set into __rest", () => {
    const counts = { a: 5, b: 4, c: 3, d: 2, e: 1, f: 1, g: 1 };
    const trimmed = trimCountObject(counts, 6);
    expect(trimmed.__rest).toBe(1);
    expect(trimmed.a).toBe(5);
    expect(trimmed.g).toBeUndefined();
  });

  it("leaves small bucket sets untouched", () => {
    expect(trimCountObject({ a: 1, b: 2 }, 6)).toEqual({ a: 1, b: 2 });
  });
});
