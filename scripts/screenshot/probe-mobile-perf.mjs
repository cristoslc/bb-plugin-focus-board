// Headless performance probe for the Focus Board at phone width (issue: mobile
// performance). Loads the real app through the screenshot harness, then
// measures, per board and per interaction:
//
//   - load timeline: DCL, load, FCP, LCP, DOM interactive, time until the
//     board's first card paints, total blocking time (long tasks over 50ms)
//   - interaction windows: wall time, React commit count, long tasks
//     (count + summed ms), animation frames and dropped frames
//   - the thread pane's open and close, each repeated PROBE_PANE_CYCLES times
//     and reported as a median: click-to-pane-appear, click-to-first-paint,
//     and the long-task/commit/dropped-frame load of the same span
//   - scroll: the same, while a busy lane is scrolled with real touch/wheel
//   - optional Chrome trace per phase for the style/layout/paint breakdown
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   node scripts/screenshot/probe-mobile-perf.mjs          # terminal 2
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_TRACE=1 (emit
// docs/screenshots/probe-mobile-perf/trace-<phase>.json plus a rolled-up
// breakdown), PROBE_PANE_PROFILE=1 (a CPU profile of the pane's open and
// close), PROBE_PANE_CYCLES (default 5, 0 skips the pane section),
// PROBE_SETTLE_MS (default 500, the tail after the pane appears or goes),
// PROBE_VIEWPORT=desktop (1440x900, the non-mobile control), PROBE_BOARDS
// (comma-separated board names, for one board's worth of attribution work),
// PROBE_PANEL_WIDTH=<px> (pin the plugin panel's own width, the squeezed-panel
// case whose pane covers the board as a panel-scoped sheet rather than a
// window-wide one), and PROBE_CPU=<n> (CDP Emulation.setCPUThrottlingRate — a
// mid-range phone sits several times slower than the dev machine's M3 Pro, so
// the default runs at 4x). The 390x844 viewport is the release harness's phone
// size. Each board's entry also carries `paneSheet`: the open pane's box, the
// board's box, whether the pane covers it, and how many cards wear the
// spotlight's focus marker, which is how a run says what the recede would
// have cost.
//
// Attribution switches, for pricing one mechanism rather than the whole pane:
// PROBE_EXTRA_CSS=<file> attaches a candidate stylesheet after load,
// PROBE_DROP_SPOTLIGHT=focus|all strips the card spotlight's focus arm (or the
// whole rule) from the injected <style>, and PROBE_DEBUG=1 forwards the page's
// console to this one. A stylesheet override cannot replace
// PROBE_DROP_SPOTLIGHT: the declarations stop applying while the :has() rules
// keep invalidating every card, which is the cost under test.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-mobile-perf/", import.meta.url).pathname;
const TRACE = process.env.PROBE_TRACE === "1";
// Per-pane-phase CPU profile (open and close). Separate from TRACE because the
// trace is the expensive part and the profile answers "which function".
const PANE_PROFILE = process.env.PROBE_PANE_PROFILE === "1";
const CPU = Number(process.env.PROBE_CPU ?? "4");

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
// The pane cycles run at the same width as the rest of the board. Desktop is
// the control: whatever cost survives there is inherent to the pane, and only
// the difference is mobile-specific.
const DESKTOP_VIEWPORT = process.env.PROBE_VIEWPORT === "desktop";
const VIEWPORT = DESKTOP_VIEWPORT ? DESKTOP : PHONE;
// Open/close repetitions, so the reported number is a median rather than one
// sample. 5 keeps a full run under a couple of minutes at 4x throttle.
const PANE_CYCLES = Number(process.env.PROBE_PANE_CYCLES ?? "5");
// Tail window after the pane has appeared (open) or gone (close): long tasks,
// commits and dropped frames are counted over the whole open+tail span so two
// runs at different speeds are compared over the same amount of work.
const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS ?? "500");
// PROBE_PANEL_WIDTH pins the plugin panel's own width, the way a squeezed bb
// panel narrows on a wide window. It is how the panel-scoped sheet (the pane's
// `absolute inset-0` path below PANE_SHEET_MAX_PANEL_WIDTH) gets priced: on a
// desktop viewport the compact media query never fires, so without this switch
// that sheet cannot be reached at all.
const PANEL_WIDTH = process.env.PROBE_PANEL_WIDTH ? Number(process.env.PROBE_PANEL_WIDTH) : null;
const PANE_SEL = 'aside[aria-label^="Thread:"]';
const PANE_CLOSE_SEL = '[aria-label="Close thread pane"]';

// ── The in-page instrument ────────────────────────────────────────────────
// Installed before any app code runs (evaluateOnNewDocument): a React commit
// counter riding the devtools hook React looks for at boot, a long-task
// observer, a frame sampler, and a small recorder API the driver calls.
function installInstrument() {
  const w = window;
  w.__perf = {
    commits: [],
    longTasks: [],
    frames: [],
    events: [],
    readyAt: null,
    boardPaintAt: null,
  };

  // React commit counter. React (both the dev build the harness bundles and a
  // production build) calls onCommitFiberRoot on the global devtools hook when
  // it is present at module init, so installing a stub before the bundle runs
  // is enough to observe every commit.
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = hook.renderers.size + 1;
      hook.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id, _root, _priority) {
      w.__perf.commits.push(performance.now());
    },
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__perf.longTasks.push({ t: entry.startTime, d: entry.duration });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask is Chrome-only; the probe runs on Chrome */
  }

  // LCP needs its own buffered observer; getEntriesByType misses it when the
  // entry lands before the first paint read.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.lcp = Math.round(entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* LCP is Chrome-only */
  }

  // Frame sampler: one rAF loop for the whole session. The driver reads the
  // timestamp list between marks to compute frames and dropped frames.
  const tick = (ts) => {
    w.__perf.frames.push(ts);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Board-paint moment: the first `[data-thread-card]` in the DOM. Recorded
  // once from a MutationObserver so "time to interactive board" is measured
  // rather than guessed. Observes `document` (documentElement does not exist
  // yet at document creation, which made this silently record nothing).
  try {
    const mo = new MutationObserver(() => {
      if (w.__perf.boardPaintAt === null && document.querySelector("[data-thread-card]") !== null) {
        w.__perf.boardPaintAt = performance.now();
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  } catch {
    /* document always exists */
  }

  /** Mark a labeled instant. */
  w.__perf.mark = (name) => {
    w.__perf.events.push({ name, t: performance.now() });
    return w.__perf.events.length - 1;
  };
  /** Every card's own anchor, in document order. A card wrapper can precede
   *  its anchor, and a card also owns chip anchors (tracker links), so each
   *  card resolves to its FIRST anchor instead of trusting any anchor under
   *  it — the same rule the UAT runner's card click uses. */
  w.__perf.cardAnchors = (sel) => {
    const anchors = [];
    for (const host of document.querySelectorAll(`${sel} [data-thread-card]`)) {
      const anchor = host.matches("a[href]") ? host : host.querySelector("a[href]");
      if (anchor !== null && !anchors.includes(anchor)) anchors.push(anchor);
    }
    return anchors;
  };
  /** Resolve when `sel` appears ("present") or disappears ("absent"), with
   *  the in-page timestamp. Polling from the driver would add up to two frames
   *  of its own latency to every sample, which is most of the number being
   *  measured at phone widths. */
  w.__perf.watchSelector = (sel, want) => {
    w.__perf.watchedAt = null;
    const done = () => {
      const present = document.querySelector(sel) !== null;
      if (present !== (want === "present")) return false;
      w.__perf.watchedAt = performance.now();
      return true;
    };
    if (done()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (done()) {
          observer.disconnect();
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
  /** Summarize the window between two marks. */
  w.__perf.window = (fromIndex, toIndex) => {
    const a = w.__perf.events[fromIndex];
    const b = w.__perf.events[toIndex];
    if (!a || !b) return null;
    const [t0, t1] = [a.t, b.t];
    const longTasks = w.__perf.longTasks.filter((e) => e.t >= t0 && e.t <= t1);
    const frames = w.__perf.frames.filter((f) => f >= t0 && f <= t1);
    const commits = w.__perf.commits.filter((c) => c >= t0 && c <= t1).length;
    let dropped = 0;
    for (let i = 1; i < frames.length; i += 1) {
      if (frames[i] - frames[i - 1] > 33) dropped += 1;
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
    };
  };
}

// ── Load metrics ──────────────────────────────────────────────────────────
async function loadMetrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((p) => p.name === "first-contentful-paint");
    const perf = window.__perf;
    // Total blocking time: every long task's excess over 50ms, summed.
    const tbt = perf.longTasks.reduce((sum, e) => sum + Math.max(0, e.d - 50), 0);
    return {
      domInteractive: Math.round(nav?.domInteractive ?? 0),
      domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
      load: Math.round(nav?.loadEventEnd ?? 0),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: perf.lcp ?? null,
      boardPaintAt: perf.boardPaintAt === null ? null : Math.round(perf.boardPaintAt),
      totalBlockingTime: Math.round(tbt),
      longTaskCount: perf.longTasks.length,
      commitCount: perf.commits.length,
      nodeCount: document.querySelectorAll("*").length,
      cardCount: document.querySelectorAll("[data-thread-card]").length,
      laneCount: document.querySelectorAll("[data-column-id], section[data-lane-id]").length,
      // The style engine's own view of the sheet: how many CSS rules the
      // spotlight's :has() chain makes Chromium re-evaluate each frame is not
      // exposed, but the rule count and selector complexity are.
      styleSheets: document.styleSheets.length,
    };
  });
}

// ── V8 CPU profile attribution ────────────────────────────────────────────
// The strongest evidence for "every state change re-renders the board": a CDP
// CPU profile names each function and its self time. The harness serves the
// UNMINIFIED vite dev bundle, so names survive as written in the source.
async function cpuProfile(page, label, action) {
  const session = await page.createCDPSession();
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  await action();
  const { profile } = await session.send("Profiler.stop");
  await session.detach();
  await writeFile(`${OUT}profile-${label}.json`, JSON.stringify(profile));
  return { label, ...rankProfile(profile) };
}

function rankProfile(profile) {
  const total = profile.nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
  // Group by function + line, and keep only the renderer's own work (idle and
  // program buckets carry no attribution).
  const byFn = new Map();
  for (const n of profile.nodes) {
    const hits = n.hitCount ?? 0;
    if (hits === 0) continue;
    const fn = n.callFrame.functionName || "(anonymous)";
    if (fn === "(idle)" || fn === "(program)" || fn === "(root)") continue;
    const file = (n.callFrame.url || "").split("/").slice(-1)[0].split("?")[0];
    const line = n.callFrame.lineNumber + 1;
    const key = `${file}:${line}:${fn}`;
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
        selfPctTotal: total > 0 ? Math.round((hits / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 30);
  // Per-module roll-up: the plugin's own files vs React vs the rest.
  const byFile = new Map();
  for (const [key, hits] of byFn) {
    const file = key.split(":")[0];
    byFile.set(file, (byFile.get(file) ?? 0) + hits);
  }
  const files = [...byFile.entries()]
    .map(([file, hits]) => ({
      file,
      selfSamples: hits,
      selfPctActive: totalActive > 0 ? Math.round((hits / totalActive) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 15);
  return { totalSamples: total, activeSamples: totalActive, sampleIntervalUs: 100, top, files };
}


// Chrome's own trace categories: the rolled-up per-category main-thread time
// is the hard evidence for where an interaction's milliseconds go.
async function traceBreakdown(page, label, action) {
  await page.tracing.start({
    path: `${OUT}trace-${label}.json`,
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"],
  });
  await action();
  await page.tracing.stop();
  return summarizeTrace(`${OUT}trace-${label}.json`);
}

async function summarizeTrace(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const events = raw.traceEvents ?? raw;
  const totals = new Map();
  // Main-thread-ish categories on the renderer: the top-level ones that carry
  // time. Summing duration per name over the whole trace is enough for a
  // ranked breakdown.
  const interesting = new Set([
    "UpdateLayoutTree",
    "Layout",
    "Paint",
    "PrePaint",
    "ParseHTML",
    "EvaluateScript",
    "FunctionCall",
    "TimerFire",
    "EventDispatch",
    "HitTest",
    "Commit",
    "CompositeLayers",
    "RecalculateStyles",
    "RunTask",
  ]);
  for (const e of events) {
    if (typeof e.dur !== "number") continue;
    if (!interesting.has(e.name)) continue;
    const stat = totals.get(e.name) ?? { name: e.name, us: 0, count: 0 };
    stat.us += e.dur;
    stat.count += 1;
    totals.set(e.name, stat);
  }
  const ranked = [...totals.values()].sort((a, b) => b.us - a.us).map((s) => ({
    name: s.name,
    ms: Math.round(s.us / 1000),
    count: s.count,
  }));
  return ranked;
}

// ── The driver ────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--enable-precise-memory-info"],
});

await mkdir(OUT, { recursive: true });
const results = { machine: null, boards: [] };

results.machine = {
  chrome: await browser.version(),
  viewport: VIEWPORT,
  viewportMode: DESKTOP_VIEWPORT ? "desktop" : "phone",
  cpuThrottleRate: CPU,
  paneCycles: PANE_CYCLES,
  base: BASE,
  userAgent: await (async () => {
    const p = await browser.newPage();
    const ua = await p.evaluate(() => navigator.userAgent);
    await p.close();
    return ua;
  })(),
};

/** Open the harness at the probe viewport with the instrument installed. */
async function openBoard(query) {
  const page = await browser.newPage();
  if (process.env.PROBE_DEBUG === "1") {
    page.on("console", (m) => console.error("PAGE:", m.type(), m.text()));
  }
  await page.evaluateOnNewDocument(installInstrument);
  if (PANEL_WIDTH !== null) {
    // A stylesheet, not inline styles: the pane remounts the panel, which
    // wipes inline overrides. Registered before any app code so the squeeze is
    // in place for the board's first layout; a squeeze applied after load
    // would leave the first open measuring a wide panel.
    await page.evaluateOnNewDocument((width) => {
      const inject = () => {
        const tag = document.createElement("style");
        tag.id = "probe-panel-width";
        tag.textContent = `[data-bb-plugin="focus-board"] { width: ${width}px !important; min-width: ${width}px !important; max-width: ${width}px !important; }`;
        document.head.append(tag);
      };
      if (document.head === null) {
        document.addEventListener("DOMContentLoaded", inject, { once: true });
        return;
      }
      inject();
    }, PANEL_WIDTH);
  }
  await page.setViewport({
    ...VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: !DESKTOP_VIEWPORT,
    hasTouch: !DESKTOP_VIEWPORT,
  });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 60_000 });
  // PROBE_EXTRA_CSS=<file> attaches a candidate stylesheet after load, for
  // attribution runs: the difference against the baseline is that one rule.
  if (process.env.PROBE_EXTRA_CSS) {
    await page.addStyleTag({ content: readFile(process.env.PROBE_EXTRA_CSS, "utf8") });
  }
  // PROBE_DROP_SPOTLIGHT removes card-spotlight rules: "all" deletes the
  // injected <style>, "focus" keeps only the pointer arm. An override
  // stylesheet cannot stand in for this: the declarations stop applying but
  // the :has() rules still invalidate every card, which is the cost under
  // test.
  const dropSpotlight = process.env.PROBE_DROP_SPOTLIGHT;
  if (dropSpotlight !== undefined) {
    await page.evaluate((mode) => {
      const style = document.getElementById("focus-board-card-spotlight");
      if (style === null) return;
      if (mode === "all" || style.textContent === null) {
        style.remove();
        return;
      }
      const focusArm = style.textContent.indexOf("/* The focus arm:");
      if (focusArm > 0) style.textContent = style.textContent.slice(0, focusArm);
    }, dropSpotlight);
  }
  await new Promise((r) => setTimeout(r, 800));
  return page;
}

/** Run a windowed interaction and summarize it. */
async function windowed(page, label, action) {
  const { from, to } = await page.evaluate(() => ({
    from: window.__perf.mark(`start:${Math.random()}`),
    to: null,
  }));
  void to;
  await action();
  return page.evaluate((from) => {
    const to = window.__perf.mark(`end:${Math.random()}`);
    const summary = window.__perf.window(from, to);
    return { label: window.__perf.events[from].name, ...summary };
  }, from);
}

/** Open the thread pane once, timed from the card's own click to the pane
 *  appearing. The click is dispatched on the card anchor itself rather than at
 *  a computed point: a card's geometric centre can land on its done checkbox
 *  or a chip, and a chip click opens the tracker instead of the pane. The
 *  cost being measured is the pane's mount and paint, not pointer hit-testing.
 *  `appearMs` is the felt latency; the window summary covers the whole span, so
 *  long tasks, commits and dropped frames count the same work in both
 *  directions. */
async function paneOpenOnce(page, boardSel, cardIndex) {
  const target = await page.evaluate(
    (sel, index) => {
      const anchors = window.__perf.cardAnchors(sel);
      if (anchors.length === 0) return null;
      const el = anchors[index % anchors.length];
      el.scrollIntoView({ block: "center", inline: "center" });
      return { title: el.getAttribute("href") };
    },
    boardSel,
    cardIndex,
  );
  if (target === null) {
    console.error("paneOpenOnce: no card anchor", boardSel);
    return null;
  }
  // Settle the scroll before the timed window opens, so the board's own
  // scroll cost is not attributed to the pane.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const from = await page.evaluate(
    (sel, index, paneSel) => {
      const anchors = window.__perf.cardAnchors(sel);
      const el = anchors[index % anchors.length];
      // The card-render counter rides the probe-only ThreadCard wrapper, so it
      // says whether opening the pane re-rendered the board.
      globalThis.__cardRenders = 0;
      const mark = window.__perf.mark("pane-open");
      window.__perf.paneReady = window.__perf.watchSelector(paneSel, "present");
      el.click();
      return mark;
    },
    boardSel,
    cardIndex,
    PANE_SEL,
  );
  const appeared = await page.evaluate(() => window.__perf.paneReady);
  if (appeared !== true) {
    console.error("pane did not open", target.title, await page.evaluate(() => location.hash));
    throw new Error(`pane did not open for ${target.title}`);
  }
  const appearMs = await page.evaluate(
    (mark) => Math.round(window.__perf.watchedAt - window.__perf.events[mark].t),
    from,
  );
  // Two frames is the pane's first painted commit.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const paintedMs = await page.evaluate(
    (mark) => Math.round(performance.now() - window.__perf.events[mark].t),
    from,
  );
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const summary = await page.evaluate((mark) => {
    const to = window.__perf.mark("pane-open-end");
    return { ...window.__perf.window(mark, to), cardRenders: globalThis.__cardRenders ?? null };
  }, from);
  return { direction: "open", appearMs, paintedMs, ...summary };
}

/** Close the pane once, timed from the close control's own click to the pane
 *  leaving the DOM. The close control is clicked as an element too: the
 *  compact header's is a 36px button whose centre is its glyph. */
async function paneCloseOnce(page) {
  const from = await page.evaluate(
    (sel, paneSel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      globalThis.__cardRenders = 0;
      const mark = window.__perf.mark("pane-close");
      window.__perf.paneReady = window.__perf.watchSelector(paneSel, "absent");
      el.click();
      return mark;
    },
    PANE_CLOSE_SEL,
    PANE_SEL,
  );
  if (from === null) {
    console.error("paneCloseOnce: no close button");
    return null;
  }
  await page.evaluate(() => window.__perf.paneReady);
  const goneMs = await page.evaluate(
    (mark) => Math.round(window.__perf.watchedAt - window.__perf.events[mark].t),
    from,
  );
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const summary = await page.evaluate((mark) => {
    const to = window.__perf.mark("pane-close-end");
    return { ...window.__perf.window(mark, to), cardRenders: globalThis.__cardRenders ?? null };
  }, from);
  return { direction: "close", appearMs: goneMs, paintedMs: goneMs, ...summary };
}

/** Which box the open pane occupies, and whether that box covers the board.
 *  The geometric half of "could an operator see a recede behind this pane at
 *  all": a `coversBoard` true with an opaque background means every card the
 *  spotlight dims is hidden while the pane is up. */
async function paneSheetCoverage(page, boardSel) {
  return page.evaluate(
    (paneSel, boardSel) => {
      const pane = document.querySelector(paneSel);
      const board = document.querySelector(boardSel);
      if (pane === null || board === null) return null;
      const p = pane.getBoundingClientRect();
      const b = board.getBoundingClientRect();
      const style = getComputedStyle(pane);
      return {
        // The placement tokens decide which of the pane's three shapes this is:
        // the compact window sheet, the panel-scoped sheet, or side by side.
        panePlacement: pane.className.match(/\b(fixed|absolute|relative)\b/)?.[0] ?? null,
        pane: { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) },
        board: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
        paneBackground: style.backgroundColor,
        paneOpacity: style.opacity,
        coversBoard:
          p.x <= b.x &&
          p.y <= b.y &&
          p.x + p.width >= b.x + b.width &&
          p.y + p.height >= b.y + b.height,
        // The marker the focus recede arms on: 1 while the pane holds a card,
        // which is the board-wide restyle under test.
        focusSolidCards: document.querySelectorAll("[data-focus-solid]").length,
        // The pointer arm's own condition. A click leaves the pointer over the
        // card it hit, so a latched `:hover` can arm the recede through the
        // other arm and mask what the focus marker contributed.
        hoveredCards: document.querySelectorAll("div[data-thread-card]:hover").length,
      };
    },
    PANE_SEL,
    boardSel,
  );
}

/** Median and spread of one direction's cycles. */function summarizeCycles(samples) {
  if (samples.length === 0) return null;
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid];
  };
  const appears = samples.map((s) => s.appearMs);
  return {
    samples: samples.length,
    appearMs: median(appears),
    appearMinMs: Math.min(...appears),
    appearMaxMs: Math.max(...appears),
    paintedMs: median(samples.map((s) => s.paintedMs)),
    wallMs: median(samples.map((s) => s.wallMs)),
    commits: median(samples.map((s) => s.commits)),
    cardRenders: median(samples.filter((s) => s.cardRenders !== null).map((s) => s.cardRenders)),
    longTaskCount: median(samples.map((s) => s.longTaskCount)),
    longTaskMs: median(samples.map((s) => s.longTaskMs)),
    longestTaskMs: median(samples.map((s) => s.longestTaskMs)),
    dropped: median(samples.map((s) => s.dropped)),
  };
}

const boards = [
  { name: "columns-demo", query: "?demo=1", kind: "columns" },
  { name: "columns-base", query: "", kind: "columns" },
  { name: "parent-lanes-demo", query: "?groupBy=parent&demo=1", kind: "parent" },
];

// PROBE_BOARDS=columns-demo narrows the run to the named boards (comma
// separated), for a quick attribution pass instead of the full sweep.
if (process.env.PROBE_BOARDS) {
  const wanted = new Set(process.env.PROBE_BOARDS.split(","));
  boards.splice(0, boards.length, ...boards.filter((b) => wanted.has(b.name)));
}

// PROBE_SCALE=N appends that query to every board, so the same probe sweeps a
// board of realistic size (`?scale=300`) instead of the ~50-thread fixture.
const SCALE_Q = process.env.PROBE_SCALE ? `scale=${process.env.PROBE_SCALE}` : "";
if (SCALE_Q) {
  for (const b of boards) b.query = b.query ? `${b.query}&${SCALE_Q}` : `?${SCALE_Q}`;
}

for (const board of boards) {
  const page = await openBoard(board.query);
  const entry = { board: board.name, query: board.query, load: await loadMetrics(page), interactions: [] };
  const boardSel = board.kind === "parent" ? "[data-parent-board]" : "[data-columns-board]";

  // ── Scroll the board horizontally with a real touch pan ──
  const boardBox = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, boardSel);
  entry.boardBox = boardBox;

  const pan = await windowed(page, "pan-board", async () => {
    const ts = page.touchscreen;
    const sy = Math.round(boardBox.y + boardBox.h / 2);
    const sx = Math.round(boardBox.x + boardBox.w * 0.7);
    await ts.touchStart(sx, sy);
    for (let i = 1; i <= 12; i += 1) {
      await ts.touchMove(sx - i * 24, sy);
      await new Promise((r) => setTimeout(r, 16));
    }
    await ts.touchEnd();
    await new Promise((r) => setTimeout(r, 600));
  });
  entry.interactions.push({ ...pan, label: "pan-board-horizontal" });

  // ── Scroll a lane's own list vertically (wheel over the busiest lane) ──
  const laneScroll = await page.evaluate((sel) => {
    const board = document.querySelector(sel);
    const lists = [...board.querySelectorAll("[data-card-list]")];
    const busiest = lists
      .map((l) => ({ l, cards: l.querySelectorAll("[data-thread-card]").length }))
      .sort((a, b) => b.cards - a.cards)[0];
    if (!busiest) return null;
    const r = busiest.l.getBoundingClientRect();
    return {
      cards: busiest.cards,
      scrollHeight: busiest.l.scrollHeight,
      clientHeight: busiest.l.clientHeight,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  }, boardSel);
  entry.laneScroll = laneScroll;
  if (laneScroll !== null) {
    const scroll = await windowed(page, "scroll-lane", async () => {
      await page.mouse.move(laneScroll.x, laneScroll.y);
      for (let i = 0; i < 14; i += 1) {
        await page.mouse.wheel({ deltaY: 120 });
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => setTimeout(r, 400));
    });
    entry.interactions.push({ ...scroll, label: "scroll-busiest-lane-vertical" });
  }

  // ── Hover sweep across cards (the attention capture path) ──
  const hover = await windowed(page, "hover-cards", async () => {
    const points = await page.evaluate((sel) => {
      const cards = [...document.querySelectorAll(`${sel} [data-thread-card]`)].slice(0, 12);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    }, boardSel);
    for (const p of points) {
      await page.mouse.move(p.x, p.y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  entry.interactions.push({ ...hover, label: "hover-12-cards" });

  // ── Open a thread pane (click a card) ──
  const openPane = await windowed(page, "open-pane", async () => {
    const p = await page.evaluate((sel) => {
      const card = document.querySelector(`${sel} [data-thread-card] a`);
      const r = card.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, boardSel);
    await page.mouse.click(p.x, p.y);
    await new Promise((r) => setTimeout(r, 900));
  });
  entry.interactions.push({ ...openPane, label: "open-thread-pane" });

  // ── CPU profile of a hover sweep: names the functions that own the cost ──
  entry.hoverProfile = await cpuProfile(page, "hover-12-cards", async () => {
    const points = await page.evaluate((sel) => {
      const cards = [...document.querySelectorAll(`${sel} [data-thread-card]`)].slice(0, 12);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    }, boardSel);
    for (const p of points) {
      await page.mouse.move(p.x, p.y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });

  // ── Open and close the thread pane, repeated, to a median ──
  // The pane is conditionally mounted, so both directions are a full mount and
  // a full unmount. The interaction above left a pane open; that first close
  // is not measured.
  if (PANE_CYCLES > 0) {
    if ((await page.$(PANE_SEL)) !== null) await paneCloseOnce(page);
    const opens = [];
    const closes = [];
    for (let i = 0; i < PANE_CYCLES; i += 1) {
      const opened = await paneOpenOnce(page, boardSel, i);
      if (opened === null) break;
      opens.push(opened);
      // Read once, from the first open: the pane's box and the board's, so the
      // run itself says which sheet shape it measured and whether any of the
      // board could be seen behind it.
      if (i === 0) entry.paneSheet = await paneSheetCoverage(page, boardSel);
      await new Promise((r) => setTimeout(r, 150));
      const closed = await paneCloseOnce(page);
      if (closed === null) break;
      closes.push(closed);
      await new Promise((r) => setTimeout(r, 150));
    }
    entry.paneCycles = { open: summarizeCycles(opens), close: summarizeCycles(closes) };
    entry.paneCycleSamples = { open: opens, close: closes };
  }

  // ── Attribution: CPU profile and Chrome trace per pane phase ──
  // Off by default (a profile plus two traces per board is a slow run); the
  // one-off attribution pass turns them on.
  if (PANE_PROFILE) {
    if ((await page.$(PANE_SEL)) !== null) await paneCloseOnce(page);
    entry.paneProfiles = {
      open: await cpuProfile(page, `${board.name}-pane-open`, async () => {
        await paneOpenOnce(page, boardSel, 0);
      }),
      close: await cpuProfile(page, `${board.name}-pane-close`, async () => {
        await paneCloseOnce(page);
      }),
    };
  }
  if (TRACE) {
    if ((await page.$(PANE_SEL)) !== null) await paneCloseOnce(page);
    entry.traces = {
      ...(entry.traces ?? {}),
      paneOpen: await traceBreakdown(page, `${board.name}-pane-open`, async () => {
        await paneOpenOnce(page, boardSel, 0);
      }),
      paneClose: await traceBreakdown(page, `${board.name}-pane-close`, async () => {
        await paneCloseOnce(page);
      }),
    };
  }

  if (TRACE) {
    entry.traces = {
      ...(entry.traces ?? {}),
      pan: await traceBreakdown(page, `${board.name}-pan`, async () => {
        await page.evaluate(() => {
          const b = document.querySelector("[data-parent-board], [data-columns-board]");
          b.scrollLeft = 0;
        });
        const ts = page.touchscreen;
        const sy = Math.round(boardBox.y + boardBox.h / 2);
        const sx = Math.round(boardBox.x + boardBox.w * 0.7);
        await ts.touchStart(sx, sy);
        for (let i = 1; i <= 12; i += 1) {
          await ts.touchMove(sx - i * 24, sy);
          await new Promise((r) => setTimeout(r, 16));
        }
        await ts.touchEnd();
        await new Promise((r) => setTimeout(r, 400));
      }),
    };
  }

  results.boards.push(entry);
  await page.close();
}

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
