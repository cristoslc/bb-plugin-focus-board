/**
 * The load-bench's stage arithmetic: the timeline math the driver
 * (`scripts/perf/load-bench.mjs`) feeds with raw page marks, and the budget
 * comparator its `--assert` mode fails on. Pure and dependency-free so the
 * arithmetic is unit-testable without a browser.
 *
 * The load timeline a board mount produces, from page navigation to the
 * settled board, reads as stages:
 *
 *   nav → appEval → firstCommit → threadsReady → firstCard → quiet
 *
 * - `appEval` — the plugin's module graph evaluated (the harness entry's
 *   first statement).
 * - `firstCommit` — React's first commit into `#root` (the loading view when
 *   the sidebar delay is staged, the board otherwise).
 * - `threadsWait` — the modeled host sidebar fetch (firstCommit →
 *   fb-sidebar-ready). Zero when the harness serves the sidebar synchronously
 *   (every UAT shot), staged with `?sidebarDelay=` in the bench.
 * - `mountToFirstCard` — the client's render cost for a populated board:
 *   sidebar-ready → the first `[data-thread-card]` in the DOM (hooks, memo
 *   chains, family index, box plan, columns, card DOM).
 * - `fanInWindow` — the mount metadata fan-in: first rpc start → last rpc
 *   end. Its STRUCTURE (parallel, not serial) is what the fan-in allowance
 *   asserts; its length is what a modeled server scan inflates.
 * - `settleTail` — after the max of firstCard and the last rpc end, how long
 *   the DOM kept mutating (post-fan-in repaints: pulse rates, chip states).
 *
 * A stage the run never observed is `null` there, never 0 — a missing mark
 * must fail a budget loudly (an absent mark is a broken instrument, and a 0
 * would pass as if the stage cost nothing).
 */

/** The parallel fan-in's allowance beyond one call's own cost: React commits
 *  between promise resolutions and timers add frames, so a strict
 *  max-would-pass-only-on-exact-simultaneity check would flake across runs.
 *  Two animation frames' worth of scheduling slack. */
export const FAN_IN_PARALLEL_MARGIN = 34;

/** A monotonic median. The driver reports medians across load repeats. */
export function medianOf(samples) {
  if (samples.length === 0) throw new Error("medianOf: empty sample set");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * One load run's stages. `rpcCalls` carries { method, start, end } per mount
 * call (the driver builds it from the page's marks); everything else is
 * either a mark the page pushed or a driver-read fact. Times are
 * performance.now() based — monotonic within the page.
 *
 * `mountRpcNames` (when given) restricts the fan-in window to the BOARD's
 * mount fan-in: the chip hooks' `tracker_validate` / `tracker_status` calls
 * ride a later effect (they fire once cards with ticket refs are painted),
 * and pricing them inside the mount fan-in stretched the window past its
 * own meaning (measured 2026-11-05: 17ms of parallel closes vs a 157ms
 * window that had swallowed the chips' calls).
 */
export function computeLoadStages({
  navStart = 0,
  marks,
  firstCardAt,
  lastMutationAt,
  fcpMs = null,
  lcpMs = null,
  tbtMs = null,
  cardCount = null,
  mountRpcNames = null,
}) {
  const appImportedAt = findMark(marks, "fb:app-imported");
  const firstCommitAt = findMark(marks, "fb:first-commit");
  const sidebarReadyAt = findMark(marks, "fb-sidebar-ready");

  const stageRuns = rpcCallRuns(marks).filter(
    (run) => mountRpcNames === null || mountRpcNames.includes(run.method),
  );
  const firstCall = rpcFirstStart(stageRuns);
  const lastCallEnd = rpcLastEnd(stageRuns);
  const stages = {
    appEval: diffNullable(navStart, appImportedAt),
    firstCommit: diffNullable(navStart, firstCommitAt),
    threadsWait: diffNullable(firstCommitAt, sidebarReadyAt),
    mountToFirstCard: diffNullable(sidebarReadyAt, firstCardAt),
    fanInWindow: diffNullable(firstCall, lastCallEnd),
    settleTail: diffNullable(
      maxNullable(firstCardAt, lastCallEnd),
      lastMutationAt,
    ),
  };

  // The fan-in's allowance: a single call's own start-to-end plus the
  // scheduling margin. A parallel fan-in (every mount call in flight at
  // once) settles near the longest call's cost; a serial waterfall eats one
  // call cost per link and lands well past the allowance, which is the
  // regression this number exists to catch.
  const fanInAllowance =
    maxCallCost(stageRuns) !== null
      ? maxCallCost(stageRuns) + FAN_IN_PARALLEL_MARGIN
      : null;

  const headline = {
    firstCardPaint: firstCardAt === null ? null : firstCardAt - navStart,
    fcp: fcpMs,
    lcp: lcpMs,
    tbt: tbtMs,
    cardCount,
  };
  return { stages, fanInAllowance, headline, inputs: { rpcCalls: stageRuns } };
}

/** A rpc call's mark labels as the app pushes them: `fb-rpc-start:<method>`
 *  at the call, `fb-rpc-end:<method>` at its resolution (value or throw).
 *  One source of truth for BOTH sides (this parser and the mock's pusher)
 *  keeps the pair shapes from drifting apart. */
const RPC_START_PREFIX = "fb-rpc-start:";
const RPC_END_PREFIX = "fb-rpc-end:";

/** Per-method {start,end} pairs: the marks one rpc call pushes (start at the
 *  call, end at its resolution, whatever value or throw came of it). Pairs
 *  the FIRST unclosed start of each method with the next end of the same
 *  method, so an unbalanced timeline (an instrument bug) surfaces as a null
 *  duration the aggregate counts as an absent sample. */
function rpcCallRuns(marks) {
  const openStarts = new Map();
  const runs = [];
  for (const { label, t } of marks) {
    if (label.startsWith(RPC_START_PREFIX)) {
      const method = label.slice(RPC_START_PREFIX.length);
      const started = openStarts.get(method);
      if (started === null || started === undefined) {
        openStarts.set(method, t);
      }
    } else if (label.startsWith(RPC_END_PREFIX)) {
      const method = label.slice(RPC_END_PREFIX.length);
      const start = openStarts.get(method);
      if (start !== undefined) {
        openStarts.delete(method);
        runs.push({ method, start, end: t });
      }
    }
  }
  return runs;
}

function rpcFirstStart(runs) {
  let first = null;
  for (const { start } of runs) {
    if (first === null || start < first) first = start;
  }
  return first;
}

function rpcLastEnd(runs) {
  let last = null;
  for (const { end } of runs) {
    if (last === null || end > last) last = end;
  }
  return last;
}

function maxCallCost(runs) {
  let max = null;
  for (const { start, end } of runs) {
    const cost = end - start;
    if (max === null || cost > max) max = cost;
  }
  return max;
}

function findMark(marks, label) {
  for (const mark of marks) {
    if (mark.label === label) return mark.t;
  }
  return null;
}

function diffNullable(from, to) {
  return from === null || to === null ? null : to - from;
}

function maxNullable(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Aggregate N load runs' stages: per stage the median, min/max, the spread,
 * and the sample count (absent samples drop out — but a stage whose every
 * run was null carries `samples: 0`, so a budget never silently passes on a
 * dead stage... it passes only because empty stages are ignored BY DESIGN and
 * the run's completeness is asserted elsewhere: the driver checks the marks
 * it needed to see per run).
 */
export function aggregateStageRuns(runs) {
  const stageNames = [...new Set(runs.flatMap((run) => Object.keys(run.stages)))];
  const aggregate = {};
  for (const stage of stageNames) {
    const samples = runs
      .map((run) => run.stages[stage])
      .filter((value) => value !== null && value !== undefined);
    if (samples.length === 0) {
      aggregate[stage] = { samples: 0 };
      continue;
    }
    const median = medianOf(samples);
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    aggregate[stage] = { median, min, max, spread: max - min, samples: samples.length };
  }
  return aggregate;
}

/**
 * The budget comparator: any stage whose median lands over its budget is a
 * violation, with the numbers in the message. A stage with no samples is
 * skipped — its absence is the driver's completeness check's finding, not
 * this comparator's (a dead stage must never read as a quiet pass).
 */
export function budgetViolations(aggregate, budgets) {
  const violations = [];
  for (const [stage, budget] of Object.entries(budgets)) {
    const stageAggregate = aggregate[stage];
    if (stageAggregate === undefined || stageAggregate.samples === 0) continue;
    const { median } = stageAggregate;
    if (median > budget) {
      violations.push({
        stage,
        median,
        budget,
        message: `${stage} median ${Math.round(median)}ms is over the ${budget}ms budget by ${Math.round(median - budget)}ms`,
      });
    }
  }
  return violations;
}
