/**
 * One-off probe: what the readiness gate's loading view ACTUALLY does in a
 * browser, in real time, instead of what its stylesheet says it should do.
 *
 * Written for the "the dots land once and stop" report (two fixes shipped and
 * neither changed what the operator sees). Three questions, three answers:
 *
 * 1. DWELL — how long does the view stay on screen, from its first paint to
 *    the board's first card? A MutationObserver stamps both ends, so this is
 *    measured, not reasoned about. Run at the client profile (instant sidebar
 *    and RPCs: the warm load) and at the modeled profile (`sidebarDelay=200`,
 *    `rpcLatency=8`, `metaScanMs=1.5`: the same knobs `npm run perf:load`
 *    calls modeled).
 * 2. ANIMATION STATE — on a live dot in a held view, every entry of
 *    `element.getAnimations()`: its animationName, playState, currentTime,
 *    iterations and duration, plus the computed `animation-name` /
 *    `animation-delay`. Two running animations clears "the cycle never runs";
 *    one, or a paused cycle, is the bug.
 * 3. REAL-TIME OPACITY — computed opacity of all three dots sampled every
 *    frame for 2.6s of a HELD view (nothing paused), so the numbers describe
 *    what a human watching the row would see, not a frozen phase.
 *
 * Usage:
 *   npm run build
 *   node scripts/perf/measure-loading-view.mjs            # CHROME_PATH if needed
 *   HOLDS=0 node scripts/perf/measure-loading-view.mjs    # dwell only
 */
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";
import { medianOf } from "./load-stages.mjs";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5491");
/** Enough repeats that a median means something; the whole battery is fast
 *  (an instant-sidebar load is ~1s wall clock). */
const REPEATS = Math.max(1, Number(process.env.REPEATS ?? "7"));
/** Sampling window for the held view: past one full 1400ms cycle plus the
 *  landing handoff, so a repeat either shows up in the trace or does not. */
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? "2600");
/** Hold the view open for the animation/sampling half of the probe. */
const HOLD_SIDEBAR_MS = 60_000;
const CLIENT = "";
const MODELED = "sidebarDelay=200&rpcLatency=8&metaScanMs=1.5";

const { child, base } = await startHarness(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
/** Stamp the view's first appearance and the board's first card off the same
 *  clock, in the page, before any module runs. */
await page.evaluateOnNewDocument(() => {
  window.__dwell = { viewAt: null, cardAt: null, viewGoneAt: null };
  const note = () => {
    const now = performance.now();
    if (window.__dwell.viewAt === null && document.querySelector("[data-loading-view]") !== null) {
      window.__dwell.viewAt = now;
    }
    if (window.__dwell.viewAt !== null && window.__dwell.viewGoneAt === null) {
      if (document.querySelector("[data-loading-view]") === null) window.__dwell.viewGoneAt = now;
    }
    if (window.__dwell.cardAt === null && document.querySelector("[data-thread-card]") !== null) {
      window.__dwell.cardAt = now;
    }
  };
  // Observe the DOCUMENT node, not `document.documentElement`: this script runs
  // before the parser has created the root element, and `observe(null)` throws
  // inside an injected script, which leaves an instrument that silently stamps
  // nothing (the exact trap that made the first version of this probe report
  // three nulls against a page with 40 cards in it).
  new MutationObserver(note).observe(document, { childList: true, subtree: true });
});

/** One load: navigate, let it settle, read the dwell. */
async function dwell(query) {
  await page.goto(`${base}?${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 60_000 });
  return page.evaluate(() => window.__dwell);
}

async function dwellBattery(label, query) {
  const samples = [];
  for (let attempt = 0; attempt < REPEATS; attempt += 1) {
    const d = await dwell(query);
    if (d.viewAt === null || d.cardAt === null) {
      throw new Error(`${label} run ${attempt}: the instrument missed an end (${JSON.stringify(d)})`);
    }
    samples.push({
      viewMs: d.viewAt,
      // The gate releases on the mount fan-in, and the card is the first paint
      // the operator recognizes; viewGone and card are the same commit in
      // practice, so both are reported and the card is the one that counts.
      goneMs: d.viewGoneAt === null ? null : d.viewGoneAt - d.viewAt,
      cardMs: d.cardAt - d.viewAt,
    });
  }
  const dwells = samples.map((s) => s.cardMs);
  console.log(`\n  ${label} (n=${dwells.length})`);
  console.log(`    dwell per run (view paint → first card): ${dwells.map((v) => v.toFixed(1)).join(", ")} ms`);
  console.log(
    `    median ${medianOf(dwells).toFixed(1)}ms  min ${Math.min(...dwells).toFixed(1)}ms  max ${Math.max(...dwells).toFixed(1)}ms`,
  );
  console.log(`    view paint at ${medianOf(samples.map((s) => s.viewMs)).toFixed(1)}ms from navigation (median)`);
  return { samples, dwells, median: medianOf(dwells) };
}

/** Everything the browser knows about one dot's animations, live. */
async function animationState(atMs) {
  if (atMs > 0) await new Promise((resolve) => setTimeout(resolve, atMs));
  return page.evaluate(() => {
    const dot = document.querySelector("[data-loading-dot]");
    const core = document.querySelector("[data-loading-dot-core]");
    if (dot === null || core === null) throw new Error("no dot (or no dot core) in the held view");
    const describe = (element) =>
      element.getAnimations().map((animation) => {
        const timing = animation.effect?.getTiming() ?? {};
        return {
          animationName: animation.animationName ?? "(not a CSSAnimation)",
          playState: animation.playState,
          currentTime: animation.currentTime,
          iterations: timing.iterations,
          duration: timing.duration,
          delay: timing.delay,
          fill: timing.fill,
        };
      });
    const style = getComputedStyle(core);
    return {
      // The landing lives on the dot, the breath on its core: both lists are
      // reported, because "one animation" on the visible element is exactly how
      // a dropped breath animation would look.
      dotAnimations: describe(dot),
      coreAnimations: describe(core),
      computedAnimationName: style.animationName,
      computedAnimationDuration: style.animationDuration,
      computedAnimationDelay: style.animationDelay,
      computedAnimationIterationCount: style.animationIterationCount,
      opacity: style.opacity,
    };
  });
}

/** Sample all three dots' computed opacity every frame, in real time. */
async function realTimeTrace(ms) {
  const trace = await page.evaluate(async (windowMs) => {
    const dots = [...document.querySelectorAll("[data-loading-dot-core]")];
    if (dots.length === 0) throw new Error("no dots to sample");
    const start = performance.now();
    const out = [];
    await new Promise((resolve) => {
      const tick = () => {
        const t = performance.now() - start;
        out.push({
          t: Number(t.toFixed(1)),
          o: dots.map((dot) => Number(Number(getComputedStyle(dot).opacity).toFixed(3))),
        });
        if (t >= windowMs) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return out;
  }, ms);
  return trace;
}

/** What a human sees in a trace row, in words. */
function readRow(frame) {
  const [a, b, c] = frame.o;
  const lowest = Math.min(...frame.o);
  const label =
    lowest > 0.95 ? "all landed" : lowest > 0.85 ? "a dot barely dipping" : lowest > 0.65 ? "a dot dipping" : "a dot deep in the trough";
  return `${label} (${a}/${b}/${c})`;
}

/** The trace distilled: how many visible swings, and when. */
function traceSummary(trace) {
  const lows = [];
  let inDip = [false, false, false];
  for (const frame of trace) {
    for (let index = 0; index < 3; index += 1) {
      const value = frame.o[index];
      if (!inDip[index] && value < 0.95) {
        inDip[index] = true;
        lows.push({ dot: index, startMs: frame.t, minOpacity: value });
      } else if (inDip[index]) {
        const last = lows.at(-1);
        if (last && last.dot === index) last.minOpacity = Math.min(last.minOpacity, value);
        if (value >= 0.995) inDip[index] = false;
      }
    }
  }
  return { dips: lows, frames: trace.length };
}

try {
  const holdQuery = `sidebarDelay=${HOLD_SIDEBAR_MS}`;

  // ---- 1. dwell, measured ----
  const client = await dwellBattery("client profile (instant sidebar + RPCs: the warm load)", CLIENT);
  let modeled = null;
  if (REPEATS > 0) {
    modeled = await dwellBattery("modeled profile (sidebarDelay=200, rpcLatency=8, metaScanMs=1.5)", MODELED);
  }

  // ---- 2. animation state, live ----
  await page.goto(`${base}?${holdQuery}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-loading-dot]", { timeout: 60_000 });
  const early = await animationState(60);
  const mid = await animationState(700);
  console.log("\n  dot 1, live, 60ms into the view:");
  console.log(`    dot getAnimations(): ${early.dotAnimations.length}`);
  for (const animation of early.dotAnimations) console.log(`      ${JSON.stringify(animation)}`);
  console.log(`    core getAnimations(): ${early.coreAnimations.length}`);
  for (const animation of early.coreAnimations) console.log(`      ${JSON.stringify(animation)}`);
  console.log(`    computed animation-name: ${early.computedAnimationName}`);
  console.log(`    computed animation-duration: ${early.computedAnimationDuration}`);
  console.log(`    computed animation-delay: ${early.computedAnimationDelay}`);
  console.log(`    computed animation-iteration-count: ${early.computedAnimationIterationCount}`);
  console.log(`    computed opacity: ${early.opacity}`);
  console.log("\n  same dot, live, 760ms into the view:");
  for (const animation of mid.dotAnimations) console.log(`      dot  ${JSON.stringify(animation)}`);
  for (const animation of mid.coreAnimations) console.log(`      core ${JSON.stringify(animation)}`);
  console.log(`    computed core opacity: ${mid.opacity}`);

  // ---- 3. real-time opacity over a held view ----
  // Re-navigate so the trace starts at the view's own zero.
  await page.goto(`${base}?${holdQuery}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-loading-dot]", { timeout: 60_000 });
  const trace = await realTimeTrace(SAMPLE_MS);
  console.log(`\n  real-time opacity, nothing paused, ${trace.length} frames over ${SAMPLE_MS}ms:`);
  for (const frame of trace) {
    // One row per ~100ms so the transcript stays readable; the swings are
    // slower than that, and every dip is still visible in the summary.
    if (Math.round(frame.t / 100) !== Math.round((frame.t - 16) / 100)) {
      console.log(`    ${String(Math.round(frame.t)).padStart(4)}ms  ${readRow(frame)}`);
    }
  }
  const summary = traceSummary(trace);
  console.log(`    dips seen: ${summary.dips.length}`);
  for (const dip of summary.dips) {
    console.log(`      dot ${dip.dot + 1} starts dipping at ${Math.round(dip.startMs)}ms, floor ${dip.minOpacity.toFixed(2)}`);
  }

  console.log("\n  --- summary ---");
  console.log(`  client dwell median: ${client.median.toFixed(1)}ms`);
  if (modeled !== null) console.log(`  modeled dwell median: ${modeled.median.toFixed(1)}ms`);
  console.log(
    `  live animations: dot ${early.dotAnimations.length} (${early.dotAnimations.map((a) => `${a.animationName}:${a.playState}`).join(", ")}), core ${early.coreAnimations.length} (${early.coreAnimations.map((a) => `${a.animationName}:${a.playState}`).join(", ")})`,
  );
  console.log(`  real-time dips in ${SAMPLE_MS}ms: ${summary.dips.length}`);
} finally {
  await browser.close();
  child.kill();
}
