/**
 * The load bench: boots the real app in the screenshot harness at several
 * board sizes and reads the load path's stage-by-stage timeline from page
 * navigation to the settled board, medians over repeats, and — with
 * `--assert` — fails when a stage's median breaks its budget.
 *
 * This is the load-time complement to scripts/screenshot/bench-board.mjs
 * (which measures a settled board's gestures): what it prices is
 *
 *   nav → appEval → firstCommit → threadsReady → firstCard → quiet
 *
 * with all stage times read from the harness's `__perfMarks` timeline
 * (scripts/screenshot/mock-sdk.tsx) and the paint/longtask entries, so two
 * runs at the same tree are directly comparable.
 *
 * Two load profiles, per scale:
 * - `client`: every knob off. Pure client-mount cost (the module graph, the
 *   React mount, the memo chains, the card DOM) with an instant sidebar and
 *   instant RPCs.
 * - `modeled`: the host fetches its sidebar before the board renders, and
 *   each modeled `*_list` RPC costs the bridge round trip plus the bounded
 *   parallel per-thread metadata scan the REAL server shape pays (16
 *   concurrent reads: ceil(N/16) chunk walls — server.ts's list handlers,
 *   issue #369). This is the profile a load fix must improve on the
 *   harness: it carries the production shape's scan term, priced at the
 *   MODELED_KNOBS constant below.
 *
 * The modeled numbers are synthetic by construction (no bb account, no
 * network), so the baseline doc carries them as HARNESS numbers, with the
 * knobs' meaning next to each stage. What a run proves about another run is
 * the DELTA on the same harness, never an absolute wall-clock claim about a
 * real bb.
 *
 * Usage:
 *   npm run perf:load                 # measure + report
 *   npm run perf:load -- --assert     # measure + fail on budget regression
 *   npm run perf:load -- --scales 300 --repeats 7
 *
 * Env: CHROME_PATH (system Chrome), HARNESS_PORT (default 5473), OUT_DIR
 * (default docs/perf/), BENCH_SCALES, BENCH_REPEATS (5), BENCH_WARMUP (2).
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";
import {
  aggregateStageRuns,
  budgetViolations,
  computeLoadStages,
  FAN_IN_PARALLEL_MARGIN,
  medianOf,
} from "./load-stages.mjs";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5473");
const OUT_DIR = process.env.OUT_DIR ?? "docs/perf";
/** `--scales 100,300,500` overrides the env/default scale list — read ONLY
 *  when the flag is present: `argv[indexOf("--scales") + 1]` with no flag
 *  is argv[0] ("node"), whose NaN entries silently emptied the battery, and
 *  a zero-cell report once passed its own budget line that way. */
const scalesFlagIndex = process.argv.indexOf("--scales");
const SCALES = ((scalesFlagIndex >= 0
  ? process.argv[scalesFlagIndex + 1]
  : (process.env.BENCH_SCALES ?? "100,300,500"))
  .split(",")
  .map((scale) => Number(scale.trim()))
  .filter((scale) => Number.isFinite(scale) && scale > 0));
if (SCALES.length === 0) {
  throw new Error(
    "the scale list resolved empty — set BENCH_SCALES or pass --scales 100,300,500; an empty battery measures nothing and must not run",
  );
}
const REPEATS = Math.max(1, Number(process.env.BENCH_REPEATS ?? "5"));
const WARMUPS = Math.max(0, Number(process.env.BENCH_WARMUP ?? "2"));
const ASSERT = process.argv.includes("--assert");

/** The modeled profile's knobs, mirroring the production-shape costs. */
const MODELED_KNOBS = "sidebarDelay=200&rpcLatency=8&metaScanMs=1.5";

/**
 * Every stage's budget, in ms, at the listed scale — generous margins over
 * the calibrated baseline (the medians plus headroom for machine jitter) so
 * the gate fails only on real regressions, never on noise. These are the
 * ABSOLUTE budgets; the fan-in's structural parallelism check needs no
 * static number at all (it re-reads each run's own slowest call, below).
 */
const BUDGETS_BY_STAGE = {
  client: {
    // The readiness gate (issue #403): the mount echo commits pre-paint now,
    // so the settle tail's end is the chips' idle landing: 76/102/179 median
    // with the gate landed (was 103/160/251 under the mount-age guard).
    // Each budget ≈ 3× its measured median, never above the pre-gate budget
    // it replaces, so a post-paint echo re-render trips the budget again.
    100: { appEval: 3000, firstCommit: 1500, mountToFirstCard: 900, fanInWindow: 300, settleTail: 250 },
    300: { appEval: 3000, firstCommit: 1500, mountToFirstCard: 2000, fanInWindow: 300, settleTail: 350 },
    500: { appEval: 3000, firstCommit: 1500, mountToFirstCard: 3000, fanInWindow: 300, settleTail: 600 },
  },
  modeled: {
    // fanInWindow recalibrated for the bounded parallel scan (issue #369):
    // the serial shape's 800/3300/5400 priced N×metaScanMs walls; the
    // parallel shape pays ceil(N/16) chunk walls, measured on the landed
    // head at 29/53/78ms median — each budget ≈ 3× its measured median,
    // never above healthy jitter (max run 126ms at 500), always deep under
    // the serial shape it replaced. A re-serializing regression trips both
    // this budget and the per-run structural allowance below it.
    // mountToFirstCard re-anchored for the readiness gate (issue #403):
    // the hold waits out the fan-in, measured at 111/181/228ms median with
    // the gate landed — each budget ≈ 3× its measured median, tightened
    // from the serial-era cells (1500/4000/6000) that priced a wall the
    // parallel scan retired. A re-serializing or post-paint-echo regression
    // trips this budget.
    100: { threadsWait: 1800, mountToFirstCard: 400, fanInWindow: 150, settleTail: 1800 },
    300: { threadsWait: 1800, mountToFirstCard: 600, fanInWindow: 200, settleTail: 1800 },
    500: { threadsWait: 1800, mountToFirstCard: 750, fanInWindow: 300, settleTail: 2400 },
  },
};

/**
 * The mount fan-in's required calls: the nine plugin-server lists every
 * board mount refetches immediately, plus the working-dot pulse mount poll.
 * A load run whose marks close fewer pairs than these names is an
 * INCOMPLETE run — it exits loud rather than becoming a fast sample.
 */
const REQUIRED_MOUNT_RPCS = [
  // The mount fan-in since issue #424: the six per-thread metadata lists
  // arrive in ONE aggregate read, so the drain waits on that call plus the
  // three one-row reads and the pulse poll.
  "board_state_get",
  "rank_list",
  "sweep_config_get",
  "family_state_list",
  "pulse_rates",
];

/**
 * The budget table's completeness gate at startup: every scale × profile the
 * run will visit must carry its stage budgets, because a silently skipped
 * check would be a gate that passes for the wrong reason.
 */
function validateBudgets(scales) {
  for (const scale of scales) {
    for (const profile of ["client", "modeled"]) {
      const stageBudgets = BUDGETS_BY_STAGE[profile]?.[scale];
      if (stageBudgets === undefined) {
        throw new Error(
          `no stage budget set for ${profile}@${scale} — set BUDGETS_BY_STAGE before asserting that cell`,
        );
      }
    }
  }
}

// ── The in-page instrument ────────────────────────────────────────────────
// Installed before any document script (evaluateOnNewDocument): the marks
// the stage math needs that the mock's own pusher cannot see, because they
// belong to the page's DOM and paint, not to the app's module graph.
// Two MutationObservers on purpose: the last-mutation tracker runs for the
// WHOLE load (the settle-tail stage's input), the first-card watcher
// disconnects after its one mark; binding them together would freeze the
// mutation clock exactly when the fan-in's repaints are still landing.
// A fresh window per navigation resets `__perfMarks`, so loads never leak
// into each other's timelines.
function installLoadInstrument() {
  // document_start has no <body>: the instrument waits for DOMContentLoaded.
  // Safe from a race, because React only mounts AFTER the deferred module
  // script (main.tsx) runs, which the browser schedules after DOM parse.
  if (document.body === null) {
    document.addEventListener("DOMContentLoaded", () => installLoadInstrument());
    return;
  }
  const w = window;
  const mark = (label) => {
    (w.__perfMarks ?? (w.__perfMarks = [])).push({ label, t: performance.now() });
  };
  /** Last-mutation tracker: the settle-tail stage's upper fence. */
  const noteMutation = () => {
    w.__perfLastMutation = performance.now();
  };
  noteMutation();
  const mutationClock = new MutationObserver(noteMutation);
  mutationClock.observe(document.body, { childList: true, subtree: true });

  /** First-commit watcher: the plugin mount point's first child. */
  const root = document.querySelector('[data-bb-plugin="focus-board"]');
  if (root === null) throw new Error("load instrument: the plugin mount point is missing");
  if (root.childElementCount > 0) mark("fb:first-commit");
  else {
    const rootObserver = new MutationObserver(() => {
      if (root.childElementCount > 0) {
        rootObserver.disconnect();
        mark("fb:first-commit");
      }
    });
    rootObserver.observe(root, { childList: true });
  }

  /** First-board-card watcher: the mount-to-first-card stage's fence. */
  if (document.querySelector("[data-thread-card]") !== null) mark("fb-first-card");
  else {
    const cardObserver = new MutationObserver(() => {
      if (document.querySelector("[data-thread-card]") !== null) {
        cardObserver.disconnect();
        mark("fb-first-card");
      }
    });
    cardObserver.observe(document.body, { childList: true, subtree: true });
  }

  w.__perfLongTasks = [];
  try {
    const taskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perfLongTasks.push(entry.duration);
    });
    taskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    // longtask unsupported: TBT stays null.
  }
}

/**
 * One load measurement: navigate, wait for the fences (sidebar-ready mark +
 * first card, then any starts closed into ends), then extract the raw
 * timeline. The waits are for QUANTITIES, never fixed sleeps, so extraction
 * never inflates a stage — every stage derives from marks.
 */
async function measureLoad(page, base, query) {
  await page.goto(`${base}?${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const marks = window.__perfMarks ?? [];
      const ready = marks.some((mark) => mark.label === "fb-sidebar-ready");
      const card = document.querySelector("[data-thread-card]") !== null;
      return ready && card;
    },
    { timeout: 60_000, polling: "raf" },
  );
  // The fan-in's echo tail: the same drain window bench-board.mjs uses, so
  // the two benches' settle semantics stay comparable. Stage math never
  // reads the tail's wall — every stage is a mark-to-mark diff — but the
  // extraction must not slice a fan-in still in flight.
  await page.waitForFunction(
    () => {
      const marks = window.__perfMarks ?? [];
      const starts = new Set(
        marks.filter((mark) => mark.label.startsWith("fb-rpc-start:")).map((mark) => mark.label.slice("fb-rpc-start:".length)),
      );
      const ends = new Set(
        marks.filter((mark) => mark.label.startsWith("fb-rpc-end:")).map((mark) => mark.label.slice("fb-rpc-end:".length)),
      );
      for (const method of window.__requiredMountRpcs ?? []) {
        // Missing start AND closed end: the fan-in is only drained when every
        // required call was issued AND its pair closed.
        if (!starts.has(method) || !ends.has(method)) return false;
      }
      return true;
    },
    { timeout: 60_000, polling: "raf" },
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  return page.evaluate(() => {
    const raw = window.__perfMarks ?? [];
    const marks = raw.map((mark) => ({ ...mark }));
    const paintEntries = performance.getEntriesByType("paint");
    const fcp = paintEntries.find((entry) => entry.name === "first-contentful-paint");
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lastLcp = lcpEntries[lcpEntries.length - 1];
    const tbt = (window.__perfLongTasks ?? []).reduce(
      (sum, duration) => sum + Math.max(0, duration - 50),
      0,
    );
    return {
      marks,
      firstCardAt:
        raw.find((mark) => mark.label === "fb-first-card")?.t ?? null,
      lastMutationAt: window.__perfLastMutation ?? null,
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      lcpMs: lastLcp ? Math.round(lastLcp.startTime) : null,
      tbtMs: Math.round(tbt),
      cardCount: document.querySelectorAll("[data-thread-card]").length,
    };
  });
}

/** The completeness gate a run must pass before it counts as a sample. */
function assertRunComplete(raw, expectedLabel, requiredMountRpcs) {
  const labels = new Set(raw.marks.map((mark) => mark.label));
  for (const required of ["fb:app-imported", "fb:first-commit", "fb-sidebar-ready", "fb-first-card"]) {
    if (!labels.has(required)) {
      throw new Error(
        `${expectedLabel}: the timeline is incomplete — the ${required} mark never fired (instrument or mount failure); refusing to record the run`,
      );
    }
  }
  const starts = new Set();
  for (const mark of raw.marks) {
    if (mark.label.startsWith("fb-rpc-start:")) starts.add(mark.label.slice("fb-rpc-start:".length));
  }
  const missing = requiredMountRpcs.filter((method) => !starts.has(method));
  if (missing.length > 0) {
    throw new Error(
      `${expectedLabel}: the mount fan-in never issued ${missing.join(", ")} — this tree's mount sequence changed; update REQUIRED_MOUNT_RPCS or fix the regression`,
    );
  }
  if (raw.firstCardAt === null) {
    throw new Error(`${expectedLabel}: no board card was ever painted into the DOM`);
  }
}

/**
 * One scale + profile's cell: warm-ups (not recorded — the first load's
 * module graph is the cold cost vite's dev server hides on repeat visits),
 * then recorded runs, each through the completeness gate. A cell whose
 * card count wavers across repeats is a nondeterministic fixture: exit loud.
 */
async function benchmarkCell(browser, base, query, expectedLabel, requiredMountRpcs) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(installLoadInstrument);
  await page.evaluateOnNewDocument((required) => {
    window.__requiredMountRpcs = required;
  }, requiredMountRpcs);
  for (let warmup = 0; warmup < WARMUPS; warmup += 1) {
    await measureLoad(page, base, query);
  }
  const runs = [];
  const cardCounts = new Set();
  for (let run = 0; run < REPEATS; run += 1) {
    const raw = await measureLoad(page, base, query);
    assertRunComplete(raw, `${expectedLabel} run ${run + 1}/${REPEATS}`, requiredMountRpcs);
    cardCounts.add(raw.cardCount);
    const computed = computeLoadStages({
      navStart: 0,
      marks: raw.marks,
      firstCardAt: raw.firstCardAt,
      lastMutationAt: raw.lastMutationAt,
      fcpMs: raw.fcpMs,
      lcpMs: raw.lcpMs,
      tbtMs: raw.tbtMs,
      cardCount: raw.cardCount,
      mountRpcNames: requiredMountRpcs,
    });
    runs.push({
      headline: computed.headline,
      stages: computed.stages,
      fanInAllowance: computed.fanInAllowance,
      rpcCalls: computed.inputs.rpcCalls,
    });
  }
  if (cardCounts.size !== 1) {
    throw new Error(
      `${expectedLabel}: card count is not deterministic across repeats (${[...cardCounts].join(", ")}) — the fixture or the app renders an unstable board; refusing to record`,
    );
  }
  await page.close();
  return { runs, cardCount: [...cardCounts][0] ?? null };
}

/** Headline medians, separately rounded: FCP/LCP/first-card/TBT/cards. */
function headlineAggregates(runs) {
  const out = {};
  for (const key of ["firstCardPaint", "fcp", "lcp", "tbt", "cardCount"]) {
    const samples = runs
      .map((run) => run.headline[key])
      .filter((value) => value !== null && value !== undefined);
    out[key] =
      samples.length === 0
        ? { samples: 0 }
        : {
            median: Math.round(medianOf(samples)),
            min: Math.min(...samples),
            max: Math.max(...samples),
            samples: samples.length,
          };
  }
  return out;
}

/**
 * The assertion pass: the modeled profile is the one a load fix must move;
 * the client profile guards the pure client stages. Both get their absolute
 * budgets, and EVERY cell gets the STRUCTURAL fan-in check — per run,
 * `fanInWindow ≤ this-run's fanInAllowance`, i.e. settled within one call's
 * own cost plus the scheduling margin. That is self-referential on purpose:
 * a static knob-derived allowance would false-fail a healthy parallel
 * fan-in whenever the board's render contends with the modeled timers, the
 * exact interleaving the staged profile exists to exercise.
 */
function assertBudgets(cells) {
  const violations = [];
  for (const [cellKey, cell] of Object.entries(cells)) {
    const { profile, scale, runs } = cell;
    const stageBudgets = BUDGETS_BY_STAGE[profile]?.[scale];
    if (stageBudgets === undefined) {
      throw new Error(
        `no stage budget set for ${profile}@${scale} — set BUDGETS_BY_STAGE before asserting that cell`,
      );
    }
    violations.push(...budgetViolations(cell.stages, stageBudgets));
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index];
      if (run.fanInAllowance === null) continue;
      const window = run.stages.fanInWindow;
      if (window !== null && window > run.fanInAllowance) {
        violations.push({
          stage: "fanInWindow",
          median: window,
          budget: run.fanInAllowance,
          message: `fan-in ran serially at ${cellKey} run ${index + 1}: window ${Math.round(window)}ms past the parallel allowance (its slowest call + ${FAN_IN_PARALLEL_MARGIN}ms margin)`,
        });
      }
    }
  }
  return violations;
}

async function main() {
  validateBudgets(SCALES);
  const startedAt = new Date();
  const { child, base } = await startHarness(PORT);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: ["--hide-scrollbars"],
  });

  const cells = {};
  try {
    for (const scale of SCALES) {
      for (const profile of ["client", "modeled"]) {
        const query =
          profile === "modeled" ? `scale=${scale}&${MODELED_KNOBS}` : `scale=${scale}`;
        const cellKey = `${profile}@${scale}`;
        const { runs, cardCount } = await benchmarkCell(
          browser,
          base,
          query,
          cellKey,
          REQUIRED_MOUNT_RPCS,
        );
        cells[cellKey] = {
          profile,
          scale,
          query,
          cardCount,
          runs,
          stages: aggregateStageRuns(runs),
          headline: headlineAggregates(runs),
        };
        console.log(`\n== ${cellKey} (cards: ${cardCount}) ==`);
        for (const [stage, stats] of Object.entries(cells[cellKey].stages)) {
          if (stats.samples === 0) {
            console.log(`  ${stage.padEnd(18)} -- no samples --`);
          } else {
            console.log(
              `  ${stage.padEnd(18)} median ${String(Math.round(stats.median)).padStart(6)}ms  (min ${Math.round(stats.min)} / max ${Math.round(stats.max)})`,
            );
          }
        }
        const headlines = cells[cellKey].headline;
        const headlineParts = [];
        if (headlines.fcp.samples > 0) headlineParts.push(`fcp ${headlines.fcp.median}ms`);
        if (headlines.lcp.samples > 0) headlineParts.push(`lcp ${headlines.lcp.median}ms`);
        if (headlines.firstCardPaint.samples > 0) headlineParts.push(`firstCard ${headlines.firstCardPaint.median}ms`);
        if (headlines.tbt.samples > 0) headlineParts.push(`tbt ${headlines.tbt.median}ms`);
        if (headlineParts.length > 0) {
          console.log(`  headline: ${headlineParts.join("  ")}`);
        }
      }
    }
  } finally {
    await browser.close();
    child.kill();
  }

  const violations = assertBudgets(cells);
  // The fail-loud gate for a battery that measured nothing: a zero-cell run
  // (an empty or mistyped scale list) must abort, never print a green
  // budget line — the two zero-cell reports of 2026-11-05 printed PASS with
  // no cell behind them, which is the exact wrong-reason pass this suite
  // exists to prevent.
  if (Object.keys(cells).length !== SCALES.length * 2) {
    throw new Error(
      `the load bench recorded ${Object.keys(cells).length} cells but ${SCALES.length} scales × 2 profiles were requested — refusing to report`,
    );
  }
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = `${OUT_DIR}/load-bench-${stamp}.json`;
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: startedAt.toISOString(),
        scales: SCALES,
        repeats: REPEATS,
        warmups: WARMUPS,
        modeledKnobs: MODELED_KNOBS,
        requiredMountRpcs: REQUIRED_MOUNT_RPCS,
        budgets: BUDGETS_BY_STAGE,
        cells,
        violations,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport: ${jsonPath}`);

  if (ASSERT && violations.length > 0) {
    console.error("\nPERF BUDGET FAILED:");
    for (const violation of violations) console.error(`  - ${violation.message}`);
    process.exitCode = 1;
  } else if (ASSERT) {
    console.log("\nPERF BUDGET: all stage medians inside budget");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
