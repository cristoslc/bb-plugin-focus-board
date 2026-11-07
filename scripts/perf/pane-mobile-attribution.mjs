/**
 * The thread pane's open/close attribution probe: measures the pane's
 * tap-to-present and tap-to-gone latency at a phone viewport with REAL touch
 * gestures, frame-by-frame, so the mobile sluggishness attribution
 * (docs/perf/pane-mobile-attribution-2026-11-06.md) reads measured numbers
 * rather than guesses. Observes only — the app's behavior is untouched.
 *
 * Per cell (viewport × board scale):
 *   - open: a real CDP touch tap on a visible card's anchor; tap→pane-present
 *     (latency), then the window to the settle end (long tasks, commits,
 *     dropped frames, the per-frame gap list) — the tap mark opens the
 *     window and a "tail-end" mark closes it after the settle sleep, so the
 *     tail's churn is in the same numbers
 *   - close: a real touch tap on the pane's close control ("Back to board" on
 *     a compact viewport, the X otherwise); tap→gone and the same tail
 *   - per-cycle raw samples + the open pane's sheet geometry (which shape
 *     the pane took and whether it covered the board)
 *   - ThreadCard render counts per cycle when the instrument is serving (the
 *     prod probe harness aliases an instrumented card; dev harness reports null)
 *
 * The two surfaces the attribution compares:
 *   dev harness (vite dev, React development build):
 *     npx vite --config scripts/screenshot/vite.config.ts
 *     HARNESS_URL=http://localhost:5173/ node scripts/perf/pane-mobile-attribution.mjs
 *   prod probe harness (React production, unminified names):
 *     npx vite build --config scripts/screenshot/vite.probe.config.ts
 *     npx vite preview --config scripts/screenshot/vite.probe.config.ts
 *     HARNESS_URL=http://localhost:5174/ node scripts/perf/pane-mobile-attribution.mjs
 *
 * Env: CHROME_PATH, HARNESS_URL, OUT_DIR (default docs/perf/), ATTR_SCALES
 * (comma list of `scale=` fixture sizes, default "500" — with 0 meaning the
 * base fixture only), ATTR_VIEWPORTS ("phone,desktop" default), ATTR_CYCLES
 * (default 5), ATTR_CPU (default 4), ATTR_PROFILE=1 (a CPU profile of the
 * first open and first close per cell, kept as profile-<cell>-{open,close}.json).
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const START_PORT = Number(process.env.HARNESS_PORT ?? "5493");
const OUT = process.env.OUT_DIR ?? "docs/perf";
const CYCLES = Math.max(1, Number(process.env.ATTR_CYCLES ?? "5"));
const SCALES = (process.env.ATTR_SCALES ?? "500")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);
if (SCALES.length === 0) {
  throw new Error("ATTR_SCALES resolved empty — set ATTR_SCALES=0,300,500 or similar");
}
const VIEWPORTS = (process.env.ATTR_VIEWPORTS ?? "phone,desktop")
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v === "phone" || v === "desktop");
const SETTLE_MS = Number(process.env.ATTR_SETTLE_MS ?? "300");
const PROFILE = process.env.ATTR_PROFILE === "1";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const PANE_SEL = 'aside[aria-label^="Thread:"]';
// The compact header keeps the X too, but the phone gesture closes via the
// back chevron; either control runs the same onClose.
const CLOSE_SEL = '[aria-label="Back to board"], [aria-label="Close thread pane"]';

// ── The in-page instrument ────────────────────────────────────────────────
// The probe-mobile-perf family: a React commit counter (the DevTools hook,
// installed before any app code), a long-task observer, a frame sampler, an
// appear/disappear watcher whose timestamp is taken in-page (driver-side
// polling adds real latency to the number being measured at phone widths),
// and mark/window summaries over all three streams.
function installInstrument() {
  const w = window;
  w.__panePerf = { commits: [], longTasks: [], frames: [], marks: [] };
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = hook.renderers.size + 1;
      hook.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot() {
      w.__panePerf.commits.push(performance.now());
    },
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__panePerf.longTasks.push({ t: entry.startTime, d: entry.duration });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask is Chrome-only; the probe runs on Chrome */
  }
  const tick = (ts) => {
    w.__panePerf.frames.push(ts);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  w.__panePerf.watchSelector = (sel, want) => {
    w.__panePerf.watchedAt = null;
    const matches = () => (document.querySelector(sel) !== null) === (want === "present");
    if (matches()) {
      w.__panePerf.watchedAt = performance.now();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (matches()) {
          observer.disconnect();
          w.__panePerf.watchedAt = performance.now();
          resolve(true);
        }
      });
      observer.observe(document, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, 15_000);
    });
  };
  w.__panePerf.mark = (name) => {
    w.__panePerf.marks.push({ name, t: performance.now() });
    return w.__panePerf.marks.length - 1;
  };
  /** The window summary between two mark indexes, carrying the frame-gap
   *  list (the frame-by-frame view: every gap, so a hole reads as a hole). */
  w.__panePerf.window = (fromIndex, toIndex) => {
    const marks = w.__panePerf.marks;
    const a = marks[fromIndex];
    const b = marks[toIndex];
    if (!a || !b) return null;
    const [t0, t1] = [a.t, b.t];
    const longTasks = w.__panePerf.longTasks.filter((e) => e.t >= t0 && e.t <= t1);
    const frames = w.__panePerf.frames.filter((f) => f >= t0 && f <= t1);
    const gaps = [];
    for (let i = 1; i < frames.length; i += 1) gaps.push(Math.round(frames[i] - frames[i - 1]));
    const commits = w.__panePerf.commits.filter((c) => c >= t0 && c <= t1).length;
    let dropped = 0;
    for (const gap of gaps) {
      if (gap > 33) dropped += 1;
    }
    const span = t1 - t0;
    return {
      wallMs: Math.round(span),
      commits,
      longTaskCount: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((sum, e) => sum + e.d, 0)),
      longestTaskMs: Math.round(longTasks.reduce((max, e) => Math.max(max, e.d), 0)),
      frames: frames.length,
      dropped,
      fps: span > 0 ? Math.round((frames.length / span) * 1000) : null,
      frameGaps: gaps,
    };
  };
}

// ── CPU profile ranking (the named-function attribution) ─────────────────
// Same ranker as probe-mobile-perf: self time by file:line:fn, grouped by
// file. The prod probe harness builds unminified, so the names survive.
function rankProfile(profile) {
  const total = profile.nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
  const byFn = new Map();
  for (const n of profile.nodes) {
    const hits = n.hitCount ?? 0;
    if (hits === 0) continue;
    const fn = n.callFrame.functionName || "(anonymous)";
    if (fn === "(idle)" || fn === "(program)" || fn === "(root)") continue;
    const file = (n.callFrame.url || "").split("/").slice(-1)[0].split("?")[0];
    const key = `${file}:${n.callFrame.lineNumber + 1}:${fn}`;
    byFn.set(key, (byFn.get(key) ?? 0) + hits);
  }
  const totalActive = [...byFn.values()].reduce((a, b) => a + b, 0);
  const top = [...byFn.entries()]
    .map(([key, hits]) => {
      const [file, line, ...rest] = key.split(":");
      return {
        file,
        line: Number(line),
        fn: rest.join(":"),
        selfSamples: hits,
        selfPctActive: totalActive > 0 ? Math.round((hits / totalActive) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 25);
  const byFile = new Map();
  for (const [key, hits] of byFn) {
    const file = key.split(":")[0];
    byFile.set(file, (byFile.get(file) ?? 0) + hits);
  }
  const files = [...byFile.entries()]
    .map(([file, hits]) => ({ file, selfSamples: hits, selfPctActive: totalActive > 0 ? Math.round((hits / totalActive) * 1000) / 10 : 0 }))
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 10);
  return { totalSamples: total, activeSamples: totalActive, top, files };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function summarizeCycles(samples) {
  if (samples.length === 0) return null;
  const keys = [
    "latencyMs",
    "wallMs",
    "commits",
    "longTaskCount",
    "longTaskMs",
    "longestTaskMs",
    "dropped",
    "cardRenders",
  ];
  const out = { samples: samples.length };
  for (const key of keys) out[key] = median(samples.map((s) => s[key]));
  const allGaps = samples.flatMap((s) => s.worstFrameGaps);
  allGaps.sort((a, b) => b - a);
  out.worstFrameGaps = allGaps.slice(0, 5);
  return out;
}

/** One CPU-profiled phase: start, run the whole phase (arm already done;
 *  `action` covers tap → watcher → two frames → tail), stop, keep the raw
 *  profile next to the report, and return { sample, profile }. */
async function profiled(page, rawPath, action) {
  const cdp = await page.createCDPSession();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
  const sample = await action();
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.detach();
  await writeFile(rawPath, JSON.stringify(profile));
  return { sample, profile: rankProfile(profile) };
}

async function runCell(browser, base, viewportName, scale) {
  const viewport = viewportName === "phone" ? PHONE : DESKTOP;
  const isPhone = viewportName === "phone";
  const query = `?demo=1${scale > 0 ? `&scale=${scale}` : ""}`;
  const page = await browser.newPage();
  await page.setViewport({
    ...viewport,
    deviceScaleFactor: 2,
    isMobile: isPhone,
    hasTouch: isPhone,
  });
  const cdpSession = await page.createCDPSession();
  await cdpSession.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.ATTR_CPU ?? "4") });
  await page.evaluateOnNewDocument(installInstrument);
  const t0 = Date.now();
  await page.goto(`${base}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 120_000 });
  const loadMs = Date.now() - t0;
  // The mount fan-in drains before the first gesture: the pane's own cost
  // must not carry the load's echo tail.
  await new Promise((r) => setTimeout(r, 1_000));
  const boardSel = (await page.$("[data-columns-board]")) !== null ? "[data-columns-board]" : "[data-parent-board]";
  const cardCount = await page.evaluate(() => document.querySelectorAll("[data-thread-card]").length);

  const opens = [];
  const closes = [];
  let sheetShape = null;
  let profileOpen = null;
  let profileClose = null;
  const stamp = `${viewportName}-${scale}`;

  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    // ── open ──
    // Aim at a card anchor's geometric centre (the same visible-anchor rule
    // probe-mobile-tap uses); the index cycles through the anchor list, so
    // repeated cycles open different cards. A tap aimed off the anchor is
    // not detected here (the pane opening is the proof); probe-mobile-tap
    // carries the wrong-object census for the tap-aim question.
    const visibleAnchors = await page.evaluate(
      (sel) => {
        const anchors = [];
        for (const host of document.querySelectorAll(`${sel} [data-thread-card]`)) {
          const anchor = host.matches("a[href]") ? host : host.querySelector("a[href]");
          if (anchor === null) continue;
          const r = anchor.getBoundingClientRect();
          if (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 40) {
            anchors.push({
              x: Math.round(r.left + r.width / 2),
              y: Math.round(r.top + r.height / 2),
              href: anchor.getAttribute("href"),
            });
          }
        }
        return anchors;
      },
      boardSel,
    );
    if (visibleAnchors.length === 0) throw new Error(`${stamp}: no visible card anchor to tap`);
    const aim = visibleAnchors[cycle % visibleAnchors.length];

    // Arm the marks and the appear watcher, and zero the card-render counter
    // (it exists only on the prod probe harness's instrumented card alias).
    // A profiled first cycle keeps the profiler running until the phase
    // settles (tap → pane present → two frames → the settle tail), so the
    // commit work after the tap's dispatch is in the profile too.
    await page.evaluate((sel) => {
      window.__panePerf.marks = [];
      if (typeof globalThis.__cardRenders === "number") globalThis.__cardRenders = 0;
      window.__panePerf.mark("tap");
      window.__panePerf.done = window.__panePerf.watchSelector(sel, "present");
    }, PANE_SEL);
    const openPhase = async () => {
      await page.touchscreen.tap(aim.x, aim.y);
      const appeared = await page.evaluate(() => window.__panePerf.done);
      if (appeared !== true) {
        throw new Error(`${stamp}: the pane never opened (wanted ${aim.href ?? "?"})`);
      }
      const latency = await page.evaluate(
        () => Math.round(window.__panePerf.watchedAt - window.__panePerf.marks[0].t),
      );
      // Two frames: the present commit, then its paint. The settle tail runs
      // afterwards; its end mark closes the window so the tail's churn lands
      // in the same summary.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const sample = await page.evaluate(() => {
        window.__panePerf.mark("tail-end");
        return window.__panePerf.window(0, window.__panePerf.marks.length - 1);
      });
      const gaps = sample.frameGaps.filter((gap) => gap > 33).slice(0, 5);
      return {
        latencyMs: latency,
        ...sample,
        worstFrameGaps: [...gaps].sort((a, b) => b - a),
        cardRenders: await page.evaluate(() =>
          typeof globalThis.__cardRenders === "number" ? globalThis.__cardRenders : null,
        ),
      };
    };
    if (PROFILE && cycle === 0) {
      const { sample, profile } = await profiled(page, `${OUT}/profile-${stamp}-open.json`, openPhase);
      opens.push(sample);
      profileOpen = profile;
    } else {
      opens.push(await openPhase());
    }
    if (cycle === 0) {
      sheetShape = await page.evaluate(
        (paneSel, selBoard) => {
          const pane = document.querySelector(paneSel);
          const board = document.querySelector(selBoard);
          if (pane === null || board === null) return null;
          const p = pane.getBoundingClientRect();
          const b = board.getBoundingClientRect();
          return {
            placement: pane.className.match(/\b(fixed|absolute|relative)\b/)?.[0] ?? null,
            pane: { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) },
            coversBoard:
              p.x <= b.x &&
              p.y <= b.y &&
              p.x + p.width >= b.x + b.width &&
              p.y + p.height >= b.y + b.height,
            cardRendersInstrumented: typeof globalThis.__cardRenders === "number",
          };
        },
        PANE_SEL,
        boardSel,
      );
    }
    await new Promise((r) => setTimeout(r, 150));

    // ── close ──
    const closeAim = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, CLOSE_SEL);
    if (closeAim === null) throw new Error(`${stamp}: no close control`);
    await page.evaluate((sel) => {
      window.__panePerf.marks = [];
      if (typeof globalThis.__cardRenders === "number") globalThis.__cardRenders = 0;
      window.__panePerf.mark("tap");
      window.__panePerf.done = window.__panePerf.watchSelector(sel, "absent");
    }, PANE_SEL);
    const closePhase = async () => {
      await page.touchscreen.tap(closeAim.x, closeAim.y);
      const gone = await page.evaluate(() => window.__panePerf.done);
      if (gone !== true) throw new Error(`${stamp}: the pane never closed`);
      const latency = await page.evaluate(
        () => Math.round(window.__panePerf.watchedAt - window.__panePerf.marks[0].t),
      );
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const sample = await page.evaluate(() => {
        window.__panePerf.mark("tail-end");
        return window.__panePerf.window(0, window.__panePerf.marks.length - 1);
      });
      const gaps = sample.frameGaps.filter((gap) => gap > 33).slice(0, 5);
      return {
        latencyMs: latency,
        ...sample,
        worstFrameGaps: [...gaps].sort((a, b) => b - a),
        cardRenders: await page.evaluate(() =>
          typeof globalThis.__cardRenders === "number" ? globalThis.__cardRenders : null,
        ),
      };
    };
    if (PROFILE && cycle === 0) {
      const { sample, profile } = await profiled(page, `${OUT}/profile-${stamp}-close.json`, closePhase);
      closes.push(sample);
      profileClose = profile;
    } else {
      closes.push(await closePhase());
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  await page.close();
  return {
    viewport: viewportName,
    scale,
    query,
    loadMs,
    cardCount,
    opens: summarizeCycles(opens),
    closes: summarizeCycles(closes),
    sheetShape,
    profileOpen,
    profileClose,
  };
}

// The cycle index used to cycle the anchor list is the loop's own `cycle`
// counter, passed in from the driver; nothing here runs in the page.

async function main() {
  const startedAt = new Date();
  const external = process.env.HARNESS_URL;
  const { child, base } = external
    ? { child: null, base: external }
    : await startHarness(START_PORT);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--hide-scrollbars"],
  });
  await mkdir(OUT, { recursive: true });
  const cells = [];
  try {
    for (const viewportName of VIEWPORTS) {
      for (const scale of SCALES) {
        const cell = await runCell(browser, base, viewportName, scale);
        cells.push(cell);
        const open = cell.opens;
        const close = cell.closes;
        console.log(
          `\n== ${viewportName} scale=${scale} (${cell.query}, ${cell.cardCount} cards) ==` +
            `\n  open : tap→present ${open.latencyMs}ms; window ${open.wallMs}ms, ${open.longTaskCount} long tasks (${open.longTaskMs}ms), dropped ${open.dropped}, worst-gaps ${JSON.stringify(open.worstFrameGaps)}` +
            `\n  close: tap→gone    ${close.latencyMs}ms; window ${close.wallMs}ms, ${close.longTaskCount} long tasks (${close.longTaskMs}ms), dropped ${close.dropped}, worst-gaps ${JSON.stringify(close.worstFrameGaps)}` +
            (open.cardRenders !== null
              ? `\n  card renders per open/close: ${open.cardRenders} / ${close.cardRenders}`
              : ""),
        );
      }
    }
  } finally {
    await browser.close();
    if (child !== null) child.kill();
  }
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const path = `${OUT}/pane-mobile-attribution-${stamp}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        generatedAt: startedAt.toISOString(),
        cycles: CYCLES,
        settleMs: SETTLE_MS,
        cpuThrottle: Number(process.env.ATTR_CPU ?? "4"),
        cells,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport: ${path}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
