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
  // The real-time sampler, armed here so its `t=0` is the row's FIRST PAINTED
  // FRAME. Starting it from the driver instead (after waitForSelector) put the
  // window a frame or more late, which made a fully-landed dot read 0.63 at
  // "7ms" and quietly flattered the schedule.
  window.__trace = null;
  const startSampling = () => {
    if (window.__trace !== null) return;
    const layers = [...document.querySelectorAll("[data-loading-dot]")].map((dot) => ({
      dot,
      core: dot.querySelector("[data-loading-dot-core]"),
    }));
    if (layers.length !== 3 || layers.some((layer) => layer.core === null)) return;
    const out = [];
    window.__trace = out;
    const read = (element) =>
      element.isConnected ? Number(Number(getComputedStyle(element).opacity).toFixed(3)) : 0;
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      out.push({
        t: Number(t.toFixed(1)),
        o: layers.map((layer) => Number((read(layer.dot) * read(layer.core)).toFixed(3))),
      });
      if (t < 3000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  // Observe the DOCUMENT node, not `document.documentElement`: this script runs
  // before the parser has created the root element, and `observe(null)` throws
  // inside an injected script, which leaves an instrument that silently stamps
  // nothing (the exact trap that made the first version of this probe report
  // three nulls against a page with 40 cards in it).
  new MutationObserver(() => {
    note();
    startSampling();
  }).observe(document, { childList: true, subtree: true });
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

/** Wait for the in-page sampler (armed at document start) and return its first
 *  `ms` of frames. Nothing is paused and nothing is repositioned: these are the
 *  compositor's own frames, in the order they painted. */
async function realTimeTrace(ms) {
  await page.waitForFunction(
    (want) => Array.isArray(window.__trace) && window.__trace.length > 8 && window.__trace.at(-1).t >= want,
    { timeout: 60_000, polling: 50 },
    Math.min(ms, 1000),
  );
  return page.evaluate((windowMs) => window.__trace.filter((frame) => frame.t <= windowMs), ms);
}

/** What a human sees in a trace row, in words. */
function readRow(frame) {
  const [a, b, c] = frame.o;
  const lowest = Math.min(...frame.o);
  const label =
    lowest > 0.95 ? "all landed" : lowest > 0.85 ? "a dot barely dipping" : lowest > 0.65 ? "a dot dipping" : "a dot deep in the trough";
  return `${label} (${a}/${b}/${c})`;
}

/** The trace distilled into what a person would actually register: per dot, the
 *  moment its composite first dips below 0.9 (the descent is visible), the
 *  moment it bottoms out, and how long it stays dim. A "dip count" is the wrong
 *  unit here: the breaths overlap, so a dot spends most of the first half
 *  second somewhere between 0.45 and 1. */
function traceSummary(trace) {
  return [0, 1, 2].map((index) => {
    const values = trace.map((frame) => ({ t: frame.t, v: frame.o[index] ?? 0 }));
    // Ignore the frames before this dot has painted at all (composite 0 from
    // the landing's own start), or "the trough" is the blank first frame.
    const visibleAt = values.findIndex((sample) => sample.v >= 0.3);
    const after = visibleAt < 0 ? [] : values.slice(visibleAt);
    if (after.length === 0) return { dot: index + 1, descentMs: null, troughMs: null, troughValue: null, landedAgainMs: null };
    // The FIRST local peak and the dip that follows it: the dot arrives, then
    // breathes. A global minimum would find the blank frame, and a global
    // maximum would find the landed frame a second later.
    let phase = "rising";
    let peak = after[0];
    let descent = null;
    let trough = null;
    for (const sample of after) {
      if (phase === "rising") {
        if (sample.v > peak.v) peak = sample;
        else if (sample.v < peak.v - 0.05) {
          phase = "falling";
          descent = sample;
          trough = sample;
        }
        continue;
      }
      if (phase === "falling") {
        if (sample.v < trough.v) trough = sample;
        else if (sample.v > trough.v + 0.05) break;
      }
    }
    const back =
      trough === null ? null : (values.find((sample) => sample.t > trough.t && sample.v >= 0.95) ?? null);
    return {
      dot: index + 1,
      descentMs: descent === null ? null : descent.t,
      troughMs: trough === null ? null : trough.t,
      troughValue: trough === null ? null : trough.v,
      landedAgainMs: back === null ? null : back.t,
    };
  });
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
  console.log(
    `\n  real-time opacity, nothing paused, ${trace.length} frames over ${SAMPLE_MS}ms ` +
      `(composite = the dot's landing opacity x its core's breath opacity, i.e. what the eye gets):`,
  );
  // The first 400ms frame by frame: this is the window the gate actually keeps
  // the view up for, so it gets every painted frame rather than a sample.
  console.log("    first 400ms, every frame:");
  for (const frame of trace.filter((sample) => sample.t <= 400)) {
    console.log(`    ${String(Math.round(frame.t)).padStart(4)}ms  ${readRow(frame)}`);
  }
  console.log("    after that, one row per 100ms:");
  for (const frame of trace.filter((sample) => sample.t > 400)) {
    if (Math.round(frame.t / 100) !== Math.round((frame.t - 16) / 100)) {
      console.log(`    ${String(Math.round(frame.t)).padStart(4)}ms  ${readRow(frame)}`);
    }
  }
  const summary = traceSummary(trace);
  console.log("    per dot (composite): descent starts / bottoms out / landed again");
  for (const profile of summary) {
    console.log(
      `      dot ${profile.dot}: ${profile.descentMs === null ? "no descent" : `${Math.round(profile.descentMs)}ms`}` +
        ` / ${profile.troughMs === null ? "-" : `${Math.round(profile.troughMs)}ms at ${profile.troughValue.toFixed(2)}`}` +
        ` / ${profile.landedAgainMs === null ? "not within the window" : `${Math.round(profile.landedAgainMs)}ms`}`,
    );
  }

  console.log("\n  --- summary ---");
  console.log(`  client dwell median: ${client.median.toFixed(1)}ms`);
  if (modeled !== null) console.log(`  modeled dwell median: ${modeled.median.toFixed(1)}ms`);
  console.log(
    `  live animations: dot ${early.dotAnimations.length} (${early.dotAnimations.map((a) => `${a.animationName}:${a.playState}`).join(", ")}), core ${early.coreAnimations.length} (${early.coreAnimations.map((a) => `${a.animationName}:${a.playState}`).join(", ")})`,
  );
  console.log(
    `  real-time: first descent ${Math.round(Math.min(...summary.map((p) => p.descentMs ?? Infinity)))}ms, ` +
      `last trough ${Math.round(Math.max(...summary.map((p) => p.troughMs ?? 0)))}ms`,
  );
} finally {
  await browser.close();
  child.kill();
}
