/**
 * The load-bench's stage arithmetic (contract first): the timeline math the
 * driver (`scripts/perf/load-bench.mjs`) feeds with raw page marks, and the
 * budget comparator the `--assert` mode fails on. Pure modules — the timing
 * claims of the perf suite are unit-tested here without a browser, because a
 * stage math that only ever ran inside a benchmark run could never be shown
 * wrong except by re-running one.
 */
import { describe, expect, it } from "vitest";

import {
  aggregateStageRuns,
  budgetViolations,
  computeLoadStages,
  medianOf,
  FAN_IN_PARALLEL_MARGIN,
} from "../scripts/perf/load-stages.mjs";

describe("medianOf", () => {
  it("returns the middle of an odd sample count", () => {
    expect(medianOf([5, 1, 9, 3, 7])).toBe(5);
  });

  it("returns the mean of the middle pair when the count is even", () => {
    expect(medianOf([4, 2])).toBe(3);
  });

  it("copies a single sample", () => {
    expect(medianOf([12])).toBe(12);
  });

  it("refuses an empty sample set loud", () => {
    expect(() => medianOf([])).toThrow(/empty/);
  });
});

describe("computeLoadStages", () => {
  // A synthetic timeline at scale with a staged sidebar and a modeled scan:
  // the numbers are chosen so every expected stage duration is distinct —
  // a stage math that swapped two stages would fail the expectations below.
  function timelineFixture() {
    return computeLoadStages({
      navStart: 0,
      marks: [
        { label: "fb:app-imported", t: 40 },
        { label: "fb:first-commit", t: 80 },
        { label: "fb-sidebar-ready", t: 280 },
        { label: "fb-rpc-start:link_list", t: 285 },
        { label: "fb-rpc-start:rank_list", t: 286 },
        { label: "fb-rpc-end:rank_list", t: 296 },
        { label: "fb-rpc-end:link_list", t: 735 },
      ],
      firstCardAt: 350,
      lastMutationAt: 800,
      fcpMs: 90,
      lcpMs: 360,
      tbtMs: 42,
      cardCount: 316,
    });
  }

  it("derives every stage from the marks it is given", () => {
    const stages = timelineFixture().stages;
    expect(stages.appEval).toBe(40);
    expect(stages.threadsWait).toBe(200); // ready(280) − firstCommit(80)
    expect(stages.mountToFirstCard).toBe(70); // firstCard(350) − ready(280)
    expect(stages.fanInWindow).toBe(450); // lastRpcEnd(735) − firstRpcStart(285)
    expect(stages.settleTail).toBe(65); // lastMutation(800) − max(350, 735)
  });

  it("reports the headline numbers it was handed", () => {
    const run = timelineFixture();
    expect(run.headline.firstCardPaint).toBe(350);
    expect(run.headline.fcp).toBe(90);
    expect(run.headline.lcp).toBe(360);
    expect(run.headline.tbt).toBe(42);
    expect(run.headline.cardCount).toBe(316);
  });

  it("degrades to null stages when a mark never fired, never 0", () => {
    const stages = computeLoadStages({
      navStart: 0,
      marks: [{ label: "fb:app-imported", t: 40 }],
      firstCardAt: 350,
      lastMutationAt: 800,
      fcpMs: 90,
      lcpMs: 360,
      tbtMs: 0,
      cardCount: 10,
    }).stages;
    expect(stages.threadsWait).toBeNull();
    expect(stages.mountToFirstCard).toBeNull();
    expect(stages.fanInWindow).toBeNull();
    // The stages that did fire still read out.
    expect(stages.appEval).toBe(40);
  });

  it("treats missing first-card time as a loud null, not a zero", () => {
    const run = computeLoadStages({
      navStart: 0,
      marks: [{ label: "fb:app-imported", t: 40 }],
      firstCardAt: null,
      lastMutationAt: 800,
      fcpMs: 90,
      lcpMs: 360,
      tbtMs: 0,
      cardCount: 0,
    });
    expect(run.stages.appEval).toBe(40);
    expect(run.headline.firstCardPaint).toBeNull();
  });

  it("raises the fan-in's parallel allowance by the parallelism margin", () => {
    const stages = timelineFixture().stages;
    const allowance = timelineFixture().fanInAllowance;
    // The fixture's per-call start-to-end window: link_list spans 450 (the
    // longest call), rank spans 10 — the allowance prices the LONGEST call
    // plus the parallelism margin, because a parallel fan-in settles near
    // its slowest call.
    expect(allowance).toBeGreaterThan(stages.fanInWindow - 1);
    expect(allowance).toBe(450 + FAN_IN_PARALLEL_MARGIN);
  });

  it("prices the fan-in off the MOUNT calls only, not the chip hooks' later calls", () => {
    // tracker_validate/status ride a later effect (they refire once cards
    // with ticket refs are painted); including them in the mount fan-in's
    // window stretched it past its own meaning on 2026-11-05, so the stage
    // module takes the required mount names and prices the window off those
    // pairs alone.
    const stages = computeLoadStages({
      navStart: 0,
      marks: [
        { label: "fb:app-imported", t: 40 },
        { label: "fb:first-commit", t: 80 },
        { label: "fb-sidebar-ready", t: 280 },
        { label: "fb-rpc-start:link_list", t: 285 },
        { label: "fb-rpc-end:link_list", t: 735 },
        { label: "fb-rpc-start:tracker_validate", t: 900 },
        { label: "fb-rpc-end:tracker_validate", t: 920 },
      ],
      firstCardAt: 350,
      lastMutationAt: 1000,
      fcpMs: 90,
      lcpMs: 360,
      tbtMs: 42,
      cardCount: 316,
      mountRpcNames: ["link_list"],
    }).stages;
    expect(stages.fanInWindow).toBe(450); // link_list alone
    expect(stages.settleTail).toBe(265); // lastMutation(1000) − max(350, 735)
  });

  it("stamps the per-call runs so a run can be re-read later", () => {
    const runs = timelineFixture().inputs.rpcCalls;
    expect(runs).toHaveLength(2);
    expect(runs.find((call) => call.method === "link_list")).toEqual({
      method: "link_list",
      start: 285,
      end: 735,
    });
    expect(runs.find((call) => call.method === "rank_list")).toEqual({
      method: "rank_list",
      start: 286,
      end: 296,
    });
  });
});

describe("aggregateStageRuns", () => {
  it("aggregates each stage across runs with median and spread", () => {
    const runs = [
      { headline: {}, stages: { appEval: 10, firstCardPaint: null } },
      { headline: {}, stages: { appEval: 30, firstCardPaint: null } },
      { headline: {}, stages: { appEval: 20, firstCardPaint: null } },
    ];
    const aggregate = aggregateStageRuns(runs);
    expect(aggregate.appEval.median).toBe(20);
    expect(aggregate.appEval.min).toBe(10);
    expect(aggregate.appEval.max).toBe(30);
    expect(aggregate.appEval.spread).toBe(20);
    expect(aggregate.appEval.samples).toBe(3);
  });

  it("drops null stages out of the sample set and reports the shrinkage", () => {
    const aggregate = aggregateStageRuns([
      { headline: {}, stages: { threadsWait: 100 } },
      { headline: {}, stages: { threadsWait: null } },
      { headline: {}, stages: { threadsWait: 200 } },
    ]);
    expect(aggregate.threadsWait.median).toBe(150);
    expect(aggregate.threadsWait.samples).toBe(2);
  });

  it("leaves a stage with no samples as an explicit null aggregate", () => {
    const aggregate = aggregateStageRuns([
      { headline: {}, stages: { fanInWindow: null } },
    ]);
    expect(aggregate.fanInWindow).toEqual({ samples: 0 });
  });
});

describe("budgetViolations", () => {
  const aggregate = aggregateStageRuns([
    { headline: {}, stages: { appEval: 40, fanInWindow: 450 } },
    { headline: {}, stages: { appEval: 60, fanInWindow: 470 } },
    { headline: {}, stages: { appEval: 50, fanInWindow: 460 } },
  ]);

  it("passes stages under budget", () => {
    expect(
      budgetViolations(aggregate, { appEval: 200, fanInWindow: 2000 }),
    ).toEqual([]);
  });

  it("fails an over-budget stage with the numbers in the message", () => {
    const violations = budgetViolations(aggregate, { appEval: 49 });
    expect(violations).toHaveLength(1);
    expect(violations[0].stage).toBe("appEval");
    expect(violations[0].median).toBe(50);
    expect(violations[0].budget).toBe(49);
    expect(violations[0].message).toMatch(/appEval.*50.*49/);
  });

  it("ignores a budget named for a stage with no samples", () => {
    expect(budgetViolations(aggregate, { threadsWait: 5 })).toEqual([]);
  });

  it("ignores a budget when every sample was null, never fails a void stage", () => {
    const voidStage = aggregateStageRuns([
      { headline: {}, stages: { fanInWindow: null } },
    ]);
    expect(budgetViolations(voidStage, { fanInWindow: 50 })).toEqual([]);
  });
});

describe("fan-in parallelism check", () => {
  it("spots a serial fan-in that ate the modeled latency sum", () => {
    // Four modeled methods each costing a 120ms round trip: a parallel
    // fan-in settles in ~120; a serial one takes ~480. The allowance is a
    // single call's cost plus margin, so the serial shape must fail it.
    const aggregate = aggregateStageRuns([
      { headline: {}, stages: { fanInWindow: 480 } },
    ]);
    const [violation] = budgetViolations(aggregate, {
      fanInWindow: 120 + FAN_IN_PARALLEL_MARGIN,
    });
    expect(violation.stage).toBe("fanInWindow");
  });

  it("clears a parallel fan-in that settled inside one round trip", () => {
    const aggregate = aggregateStageRuns([
      { headline: {}, stages: { fanInWindow: 128 } },
    ]);
    expect(
      budgetViolations(aggregate, { fanInWindow: 120 + FAN_IN_PARALLEL_MARGIN }),
    ).toEqual([]);
  });
});
