/**
 * The settle-attribution probe: boots the REAL app in the screenshot harness
 * (mock SDK, no bb account, no network) at one or more board scales and, once
 * the board's first card has painted, names WHICH React commits and DOM
 * mutations produce the load bench's `settleTail` — the post-paint window in
 * which the board "looks loaded but keeps repainting" (Rank 2 of the perf
 * memo, docs/plans/perf-strategy-2026-11-05.md).
 *
 * Attribution WITHOUT behavior change: the load driver measures the untouched
 * app; the probe only observes. Two in-page instruments, installed before any
 * document script so React is not yet evaluated:
 *
 * 1. The React commit census, through the DevTools hook contract
 *    (`__REACT_DEVTOOLS_GLOBAL_HOOK__` installed at document start; the dev
 *    build injects into it and calls `onCommitFiberRoot` per commit). Each
 *    commit records which components (function/class fibers) actually RAN
 *    their render — dev builds stamp every rendered fiber's
 *    `actualStartTime` and reset it (-1.1) whenever the fiber is rebased, so
 *    "actualStartTime inside the last commit's window" is exact — plus the
 *    App fiber's subtree render wall.
 * 2. The labeled mutation census: one MutationObserver over document.body
 *    records every childList and characterData change with its timestamp and
 *    the nearest stable board marker (`card:thr_bulk_12`, `chip`,
 *    `toolbar`, …), mirroring the load bench's settle clock (childList only)
 *    while ALSO keeping text records — React text replacements ride
 *    characterData, which the bench's childList-only clock cannot see.
 *    Attribute writes (the pulse gate's parking, the dot periods) are counted
 *    but kept out of both clocks, matching the bench.
 *
 * Every mutation burst is then assigned to its commit, every commit after the
 * settle fence is grouped into a driver (the rpc resolution whose end mark
 * sits in its render window, or `no-rpc-effect`), and the per-driver table
 * lands in the report: when it fires, how much wall it consumes, what it
 * renders, which DOM it touches, and whether anything VISIBLE changed or the
 * churn is re-render-only / internal bookkeeping.
 *
 * The probe never changes the app, the harness, or the server: an attribution
 * run and a bench run on the same tree measure the same behavior.
 *
 * Usage:
 *   node scripts/perf/settle-attribution.mjs
 *   node scripts/perf/settle-attribution.mjs --scales 300 --repeats 2
 *
 * Env: CHROME_PATH, HARNESS_PORT (default 5483), OUT_DIR (docs/perf/),
 * ATTR_SCALES (default "100,300,500"), ATTR_REPEATS (3), ATTR_WARMUP (1),
 * ATTR_QUIET_MS (700 — the no-mutation window that ends a run's read).
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";
import {
  assignBurstsToCommits,
  burstsFromMutationRecords,
  driversFromTimeline,
  rpcRunsFromMarks,
  settleFence,
} from "./settle-attribution-lib.mjs";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5483");
const OUT_DIR = process.env.OUT_DIR ?? "docs/perf";
const scalesFlagIndex = process.argv.indexOf("--scales");
const SCALES = ((scalesFlagIndex >= 0
  ? process.argv[scalesFlagIndex + 1]
  : (process.env.ATTR_SCALES ?? "100,300,500"))
  .split(",")
  .map((scale) => Number(scale.trim()))
  .filter((scale) => Number.isFinite(scale) && scale > 0));
if (SCALES.length === 0) {
  throw new Error(
    "the scale list resolved empty — pass --scales 100,300,500 (an empty battery measures nothing and must not run)",
  );
}
const REPEATS = Math.max(1, Number(process.env.ATTR_REPEATS ?? "3"));
const WARMUPS = Math.max(0, Number(process.env.ATTR_WARMUP ?? "1"));
const QUIET_MS = Math.max(200, Number(process.env.ATTR_QUIET_MS ?? "700"));

/** The load bench's settle fence uses these ten mount calls (load-bench.mjs's
 *  REQUIRED_MOUNT_RPCS); copied, not imported, so the probe never runs the
 *  bench's budgets or writes its report shape. */
const REQUIRED_MOUNT_RPCS = [
  "done_list",
  "pin_parks_list",
  "sweep_config_get",
  "link_list",
  "error_acks_list",
  "snooze_list",
  "rank_list",
  "groups_list",
  "family_state_list",
  "pulse_rates",
];

/**
 * Phase 1 (document start, BEFORE React is ever imported — deferred module
 * scripts run before DOMContentLoaded): the DevTools hook. React's module
 * init injects into whatever hook is present then, so this cannot wait for
 * the body the way the benchmark's own fence watchers do.
 */
function installSettleHook() {
  const w = window;
  let commitSeq = 0;
  const commits = [];
  w.__settleCommits = commits;
  w.__settleInstrumentErrors = [];
  const noteInstrumentError = (where, error) => {
    if (w.__settleInstrumentErrors.length < 50) {
      w.__settleInstrumentErrors.push(`${where}: ${String(error && error.message ? error.message : error)}`);
    }
  };
  function censusWalk(record, renderWindowStart) {
    try {
      const byName = new Map();
      let rendered = 0;
      let mounted = 0;
      let hostFibers = 0;
      let appRenderMs = 0;
      let topName = null;
      const stack = [record.root.current];
      while (stack.length > 0) {
        const fiber = stack.pop();
        for (let child = fiber.child; child !== null; child = child.sibling) stack.push(child);
        const tag = fiber.tag;
        if (tag === 5 || tag === 6 || tag === 26 || tag === 27) { hostFibers += 1; continue; }
        if (tag !== 0 && tag !== 1 && tag !== 11 && tag !== 14 && tag !== 15) continue;
        const start = fiber.actualStartTime;
        if (!(start > renderWindowStart && start < record.t + 0.25)) continue;
        rendered += 1;
        if (fiber.alternate === null) mounted += 1;
        const type = fiber.type;
        // SimpleMemoComponent/MemoComponent types are memo objects wrapping
        // the real component; unwrap them so the census names the component.
        const innerType = (tag === 14 || tag === 15) && type && typeof type === "object" ? type.type : type;
        const name =
          innerType === null || innerType === undefined ? "null"
          : typeof innerType === "function"
            ? (innerType.displayName ?? innerType.name ?? "anon")
            : (innerType.displayName ?? innerType.name ?? "anon-wrapper");
        byName.set(name, (byName.get(name) ?? 0) + 1);
        // The first rendered function fiber popped from the DFS is the
        // component tree's root (the App), whose actualDuration prices the
        // whole render pass (subtree-inclusive in dev builds).
        if (topName === null) {
          topName = name;
          appRenderMs = Math.round((fiber.actualDuration ?? 0) * 100) / 100;
        }
      }
      record.fns = rendered;
      record.mounted = mounted;
      record.hostFibers = hostFibers;
      record.appRenderMs = appRenderMs;
      record.topName = topName;
      record.names = [...byName.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([name, count]) => `${name}×${count}`);
    } catch (error) {
      noteInstrumentError("censusWalk", error);
      record.fns = 0;
      record.names = [];
    }
  }
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(internals) {
      this.renderers.set(1, internals ?? null);
      return 1;
    },
    onCommitFiberRoot(rendererId, root, priority, didError) {
      const record = {
        idx: commitSeq++,
        t: performance.now(),
        priority,
        didError: didError === true,
        // The previous record was pushed synchronously at its own hook, so
        // its timestamp is the render window's left edge even when back-to-
        // back commits land before their microtask walks run.
        prevT: commits.length > 0 ? commits[commits.length - 1].t : null,
        fns: null,
        mounted: null,
        hostFibers: null,
        appRenderMs: 0,
        topName: null,
        names: null,
        root: root ?? null,
      };
      commits.push(record);
      // The walk runs in a microtask: reading the fiber tree must not extend
      // the commit itself. Walks queue FIFO.
      Promise.resolve().then(() => {
        censusWalk(record, record.prevT === null ? 0 : record.prevT);
      });
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };
}

/**
 * Phase 2 (DOM start — the benchmark's own fence-watcher conditions): the
 * labeled mutation clocks, the fence marks, and the long-task observer. Same
 * document.body-waits-for-parse shape as the load bench's instrument.
 */
function installSettleInstrument() {
  if (document.body === null) {
    document.addEventListener("DOMContentLoaded", () => installSettleInstrument());
    return;
  }
  const w = window;
  const pushMark = (label) => {
    (w.__perfMarks ?? (w.__perfMarks = [])).push({ label, t: performance.now() });
  };

  // ── The labeled mutation clocks ─────────────────────────────────────────
  // childList adds/removes bump the bench-parity settle clock
  // (`__perfLastMutation`, the same key and kind-scope the load bench keeps);
  // characterData text swaps are recorded but kept OUT of it; attribute
  // writes are counted only. The record cap keeps the census bounded.
  const MUTATION_CAP = 30_000;
  const mutations = [];
  w.__settleMutations = mutations;
  const LABEL_ATTRS = [
    "data-thread-card", "data-ticket-chip-mark", "data-child-dot",
    "data-child-chip-rows", "data-child-thread-dots", "data-child-thread-section",
    "data-collapsed-group-card", "data-group-box", "data-column-id", "data-lane-id",
    "data-board-toolbar", "data-pane-chat-body", "data-parent-lane-board",
    "data-focus-board-config-section", "data-sweep-row",
  ];
  function labelMutationWhere(node) {
    for (let n = node, i = 0; n !== null && n !== document.body && i < 24; n = n.parentNode, i += 1) {
      if (n.getAttribute !== undefined) {
        for (const attr of LABEL_ATTRS) {
          const value = n.getAttribute(attr);
          if (value !== null && value !== "") {
            return attr.replace(/^data-/, "").slice(0, 14) + ":" + String(value).slice(0, 12);
          }
        }
      }
    }
    const parent = node === null ? null : node.parentNode;
    return parent === null || parent === document.body
      ? "root-direct"
      : "body-sub:" + String(node.nodeName ?? "?").toLowerCase();
  }
  let attrMutations = 0;
  let dropped = 0;
  let allKindsLast = 0;
  /** A removed/added node's short shape: tag + class names (the ghost-slot
   *  and chip questions answer from this, not from guesses). */
  function nodeShape(node) {
    if (node === null || typeof node.nodeType !== "number") return String(node ?? "null");
    if (node.nodeType === 3) return "text:" + String(node.nodeValue ?? "").trim().slice(0, 24);
    const classes = typeof node.getAttribute === "function" ? String(node.getAttribute("class") ?? "").slice(0, 48) : "";
    let marker = "";
    if (typeof node.getAttribute === "function") {
      // The transport ghosts carry their own phase markers; a removed or
      // inserted ghost names its play's phase directly.
      marker = node.getAttribute("data-transport-ghost") !== null
        ? `ghost:${node.getAttribute("data-transport-out") ?? "?"}`
        : (node.getAttribute("data-thread-card") ??
          node.getAttribute("data-column-id") ??
          node.getAttribute("data-group-box") ??
          node.getAttribute("data-board-toolbar") ??
          "");
    }
    return node.nodeName.toLowerCase() + (marker ? `@${String(marker).slice(0, 10)}` : "") + (classes ? ` .${classes.replace(/\s+/g, ".").slice(0, 40)}` : "");
  }
  const mutationClock = new MutationObserver((changeRecords) => {
    const t = performance.now();
    let childSeen = false;
    let textSeen = false;
    for (const record of changeRecords) {
      if (record.type === "attributes") {
        attrMutations += 1;
        continue;
      }
      if (record.type === "characterData") textSeen = true;
      else childSeen = true;
      if (mutations.length >= MUTATION_CAP) {
        dropped += 1;
        continue;
      }
      mutations.push({
        t,
        kind: record.type === "characterData" ? "text" : record.addedNodes.length > 0 ? "add" : "remove",
        where: labelMutationWhere(record.target),
        what:
          record.type === "characterData"
            ? null
            : nodeShape((record.addedNodes.length > 0 ? record.addedNodes : record.removedNodes)[0]),
      });
    }
    // The bench's clock counts childList only — parity is the point.
    if (childSeen && t > (w.__perfLastMutation ?? 0)) w.__perfLastMutation = t;
    if (childSeen || textSeen) allKindsLast = Math.max(allKindsLast, t);
    w.__settleAllLastMutation = allKindsLast;
    w.__settleAttrMutations = attrMutations;
    w.__settleDropped = dropped;
  });
  mutationClock.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });

  // ── The transport ghost watcher ─────────────────────────────────────────
  // Ghost slot <li data-transport-ghost>s change phase by attribute
  // (data-transport-out), which the childList clocks never see; attribute
  // records for ghost targets name the play's card id and its phase at every
  // change, so the ghost lifecycle's own clock (arm → collapse → remove) is
  // readable directly instead of inferred.
  const ghostEvents = [];
  w.__settleGhostEvents = ghostEvents;
  const ghostClock = new MutationObserver((changeRecords) => {
    for (const record of changeRecords) {
      const target = record.target;
      if (target.getAttribute?.("data-transport-ghost") === null || target.getAttribute?.("data-transport-ghost") === undefined) continue;
      if (ghostEvents.length >= 200) continue;
      ghostEvents.push({
        t: performance.now(),
        kind: record.type,
        attr: record.attributeName,
        phase: target.getAttribute("data-transport-out"),
        arrival: target.getAttribute("data-transport-arrival"),
        card: target.getAttribute("data-thread-card"),
      });
    }
    w.__settleGhostEvents = ghostEvents;
  });
  ghostClock.observe(document.body, { attributes: true, attributeFilter: ["data-transport-out", "data-transport-arrival", "data-transport-ghost"], subtree: true, childList: false });

  // ── The timer log ───────────────────────────────────────────────────────
  // Every window.setTimeout/Interval call's schedule time, delay, and the
  // caller's stack (top frames). Read-only wrapping: arguments pass through
  // unchanged. The attribution correlates a tail burst with the timers whose
  // schedule-time + delay lands in it, and the stack NAMES the driver line
  // (a board.tsx transport timer, a wallpaper remeasure, the polls' own).
  const timerLog = [];
  w.__settleTimerLog = timerLog;
  const logTimer = (fn, delay) => {
    if (timerLog.length < 400 && typeof fn === "function") {
      const stack = String(new Error().stack ?? "").split("\n").slice(2, 5).map((line) => line.trim().replace(/^at /, "")).join(" ⏎ ");
      timerLog.push({ t: performance.now(), delay: delay === undefined || delay === null ? 0 : Number(delay) || 0, stack });
    }
  };
  const origSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = function (fn, delay, ...args) {
    logTimer(fn, delay);
    return origSetTimeout(fn, delay, ...args);
  };
  const origSetInterval = w.setInterval.bind(w);
  w.setInterval = function (fn, delay, ...args) {
    logTimer(fn, delay);
    return origSetInterval(fn, delay, ...args);
  };

  // ── Fence marks (same watchers as the load bench's own instrument) ──────
  const root = document.querySelector('[data-bb-plugin="focus-board"]');
  if (root === null) throw new Error("settle instrument: the plugin mount point is missing");
  if (root.childElementCount > 0) pushMark("fb:first-commit");
  else {
    const rootObserver = new MutationObserver(() => {
      if (root.childElementCount > 0) {
        rootObserver.disconnect();
        pushMark("fb:first-commit");
      }
    });
    rootObserver.observe(root, { childList: true });
  }
  if (document.querySelector("[data-thread-card]") !== null) pushMark("fb-first-card");
  else {
    const cardObserver = new MutationObserver(() => {
      if (document.querySelector("[data-thread-card]") !== null) {
        cardObserver.disconnect();
        pushMark("fb-first-card");
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
 * One settled load: navigate, wait for the fences (sidebar-ready + first
 * card), drain the fan-in, then wait until the childList clock has been
 * quiet for QUIET_MS — the settle tail is over — and pull the raw timeline.
 * The extraction itself never mutates the DOM it is reading.
 */
async function measureSettledLoad(page, base, query) {
  await page.goto(`${base}?scale=${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const marks = window.__perfMarks ?? [];
      const ready = marks.some((mark) => mark.label === "fb-sidebar-ready");
      const card = document.querySelector("[data-thread-card]") !== null;
      return ready && card;
    },
    { timeout: 60_000, polling: "raf" },
  );
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
        if (!starts.has(method) || !ends.has(method)) return false;
      }
      return true;
    },
    { timeout: 60_000, polling: "raf" },
  );
  await page.waitForFunction(
    (quiet) => performance.now() - (window.__perfLastMutation ?? 0) > quiet,
    { timeout: 30_000, polling: "raf" },
    QUIET_MS,
  );
  return page.evaluate(() => {
    const raw = (window.__perfMarks ?? []).map((mark) => ({ ...mark }));
    const paintEntries = performance.getEntriesByType("paint");
    const fcp = paintEntries.find((entry) => entry.name === "first-contentful-paint");
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    const lastLcp = lcpEntries[lcpEntries.length - 1];
    const tbt = (window.__perfLongTasks ?? []).reduce(
      (sum, duration) => sum + Math.max(0, duration - 50),
      0,
    );
    return {
      now: performance.now(),
      marks: raw,
      firstCardAt: raw.find((mark) => mark.label === "fb-first-card")?.t ?? null,
      firstCommitAt: raw.find((mark) => mark.label === "fb:first-commit")?.t ?? null,
      lastChildMutationAt: window.__perfLastMutation ?? null,
      lastAllKindsMutationAt: window.__settleAllLastMutation ?? null,
      attrMutations: window.__settleAttrMutations ?? 0,
      droppedMutations: window.__settleDropped ?? 0,
      instrumentErrors: window.__settleInstrumentErrors ?? [],
      ghostEvents: window.__settleGhostEvents ?? [],
      timerLog: window.__settleTimerLog ?? [],
      commits: (window.__settleCommits ?? []).map(({ root: _root, ...rest }) => rest),
      mutations: window.__settleMutations ?? [],
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      lcpMs: lastLcp ? Math.round(lastLcp.startTime) : null,
      tbtMs: Math.round(tbt),
      cardCount: document.querySelectorAll("[data-thread-card]").length,
      surfaces: {
        chipMarks: document.querySelectorAll("[data-ticket-chip-mark]").length,
        dotPulse: document.querySelectorAll("[data-dot-pulse]").length,
        parked: document.querySelectorAll("[data-pulse-parked]").length,
        attentionPulse: document.querySelectorAll("[data-attention-pulse]").length,
        transportGhosts: document.querySelectorAll("[data-transport-ghost]").length,
        whatsNewPulse: document.querySelectorAll("[aria-label=\"What's new\"]").length,
      },
    };
  });
}

/** The completeness gate an attribution run must pass before it counts. */
function assertRunComplete(raw, expectedLabel) {
  const labels = new Set(raw.marks.map((mark) => mark.label));
  for (const required of ["fb-sidebar-ready", "fb-first-card"]) {
    if (!labels.has(required)) {
      throw new Error(`${expectedLabel}: the timeline is incomplete — ${required} never fired`);
    }
  }
  if (raw.firstCardAt === null) {
    throw new Error(`${expectedLabel}: no board card was ever painted into the DOM`);
  }
  if (raw.commits.length === 0 || !raw.commits.some((commit) => commit.fns !== null)) {
    throw new Error(
      `${expectedLabel}: the commit census never ran — React did not inject into the probe's DevTools hook; refusing to attribute`,
    );
  }
  if (raw.instrumentErrors.length > 0) {
    throw new Error(
      `${expectedLabel}: the probe's own instrument hit ${raw.instrumentErrors.length} error(s): ${raw.instrumentErrors[0]}`,
    );
  }
}

/** The timers whose due time lands in the tail window, with caller stacks. */
function dueTimersFor(raw, bursts, fence, settleEnd) {
  const windowStart = bursts
    .filter((burst) => burst.t1 > fence)
    .reduce((min, burst) => Math.min(min, burst.t0), fence);
  const windowEnd = (settleEnd ?? fence) + 60;
  return raw.timerLog
    .map((timer) => ({ ...timer, dueT: timer.t + timer.delay }))
    .filter((timer) => timer.dueT > windowStart - 10 && timer.dueT <= windowEnd)
    .sort((a, b) => a.dueT - b.dueT);
}

/** Human shape for one attribution run. */
function attributionReport(raw, settled, attribution) {
  const { fence, settleTailBenchMs, settleTailFullMs, tailCommits, tailChildMutations, tailTextMutations } = settled;
  const { drivers, orphans, beforeFence } = attribution;
  const lines = [];
  lines.push(
    `    fence @${Math.round(fence)}ms = max(first card ${Math.round(raw.firstCardAt ?? 0)}, last mount rpc end)`,
  );
  lines.push(
    `    settleTail (bench clock, childList): ${settleTailBenchMs === null ? "null" : Math.round(settleTailBenchMs) + "ms"}  ` +
      `full (incl characterData): ${settleTailFullMs === null ? "null" : Math.round(settleTailFullMs) + "ms"}  ` +
      `attr mutations (unclocked): ${raw.attrMutations}`,
  );
  lines.push(
    `    tail mutations: child ${tailChildMutations}, text ${tailTextMutations} ` +
      `(before fence: child ${beforeFence.childMutations}, text ${beforeFence.textMutations}; ` +
      `orphan (non-React): ${orphans.childMutations} child in ${orphans.bursts} bursts)`,
  );
  lines.push(
    `    tail commits: ${tailCommits.length} ` +
      `(render pass wall via App fiber: ${tailCommits.length > 0 ? Math.max(...tailCommits.map((c) => c.appRenderMs ?? 0)) : 0}ms max)`,
  );
  for (const driver of drivers) {
    const where = driver.where.slice(0, 4).map((entry) => `${entry.name}×${entry.count}`).join(", ");
    const what = driver.what.slice(0, 3).map((entry) => `${entry.name}×${entry.count}`).join(" | ");
    const rendered = driver.renderedByName.slice(0, 5).map((entry) => `${entry.name}×${entry.count}`).join(", ");
    lines.push(
      `      ${driver.key.padEnd(28)} commits ${String(driver.commits.length).padStart(2)}  ` +
        `wall +${Math.round((driver.firstMutationT ?? fence) - fence)}..+${Math.round((driver.lastMutationT ?? fence) - fence)}ms  ` +
        `child×${driver.childMutations} text×${driver.textMutations}`,
    );
    if (where.length > 0) lines.push(`        where: ${where}`);
    if (what.length > 0) lines.push(`        nodes: ${what}`);
    if (rendered.length > 0) lines.push(`        rendered: ${rendered}`);
  }
  return lines.join("\n");
}

async function main() {
  const startedAt = new Date();
  const { child, base } = await startHarness(PORT);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: ["--hide-scrollbars"],
  });

  /** Per run: the fence, both settle-tail views, and the driver table. */
  const runAttribution = (raw) => {
    const rpcRuns = rpcRunsFromMarks(raw.marks);
    const fence = settleFence(raw.firstCardAt, rpcRuns, REQUIRED_MOUNT_RPCS);
    if (typeof fence !== "number") {
      throw new Error("attribution: no settle fence (no first card, no mount rpc end) — refusing");
    }
    const bursts = burstsFromMutationRecords(raw.mutations);
    const burstCommits = assignBurstsToCommits(bursts, raw.commits);
    const { drivers, orphans, beforeFence } = driversFromTimeline({
      commits: raw.commits,
      bursts,
      burstCommits,
      rpcRuns,
      fence,
    });
    const settled = {
      fence,
      settleTailBenchMs: raw.lastChildMutationAt === null ? null : raw.lastChildMutationAt - fence,
      settleTailFullMs: raw.lastAllKindsMutationAt === null ? null : raw.lastAllKindsMutationAt - fence,
      tailChildMutations: 0,
      tailTextMutations: 0,
      tailCommits: raw.commits.filter((commit) => commit.t > fence),
    };
    for (const driver of drivers) {
      settled.tailChildMutations += driver.childMutations;
      settled.tailTextMutations += driver.textMutations;
    }
    settled.tailChildMutations += orphans.childMutations;
    settled.tailTextMutations += orphans.textMutations;
    return { bursts, burstCommits, attribution: { drivers, orphans, beforeFence }, settled };
  };

  const cells = {};
  try {
    for (const scale of SCALES) {
      const cellKey = `client@${scale}`;
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument(installSettleHook);
      await page.evaluateOnNewDocument(installSettleInstrument);
      await page.evaluateOnNewDocument((required) => {
        window.__requiredMountRpcs = required;
      }, REQUIRED_MOUNT_RPCS);
      const runs = [];
      const cardCounts = new Set();
      for (let iteration = 0; iteration < WARMUPS + REPEATS; iteration += 1) {
        const raw = await measureSettledLoad(page, base, scale);
        const expectedLabel = `${cellKey} ${iteration < WARMUPS ? "warmup" : `run ${iteration - WARMUPS + 1}/${REPEATS}`}`;
        assertRunComplete(raw, expectedLabel);
        cardCounts.add(raw.cardCount);
        if (iteration < WARMUPS) continue;
        const { bursts, burstCommits, attribution, settled } = runAttribution(raw);
        console.log(`\n== ${expectedLabel} (cards ${raw.cardCount}) ==`);
        console.log(attributionReport(raw, settled, attribution));
        for (const ghost of raw.ghostEvents) {
          console.log(
            `      ghost ${ghost.card ?? "?"} ${ghost.attr}=${ghost.phase ?? "gone"} arrival=${ghost.arrival ?? "-"} @+${Math.round(ghost.t - settled.fence)}ms (${ghost.kind})`,
          );
        }
        const dueTimers = dueTimersFor(raw, bursts, settled.fence, raw.lastChildMutationAt ?? settled.fence);
        for (const timer of dueTimers) {
          console.log(`      timer due @+${Math.round(timer.dueT - settled.fence)}ms (sched +${Math.round(timer.t - settled.fence)}ms +${Math.round(timer.delay)}ms): ${timer.stack}`);
        }
        runs.push({
          raw: {
            marks: raw.marks,
            firstCardAt: raw.firstCardAt,
            firstCommitAt: raw.firstCommitAt,
            lastChildMutationAt: raw.lastChildMutationAt,
            lastAllKindsMutationAt: raw.lastAllKindsMutationAt,
            attrMutations: raw.attrMutations,
            droppedMutations: raw.droppedMutations,
            fcpMs: raw.fcpMs,
            lcpMs: raw.lcpMs,
            tbtMs: raw.tbtMs,
            cardCount: raw.cardCount,
            surfaces: raw.surfaces,
            ghostEvents: raw.ghostEvents,
            timerLog: raw.timerLog,
            commits: raw.commits,
            mutations: raw.mutations,
          },
          bursts,
          drivers: attribution.drivers,
          orphans: attribution.orphans,
          beforeFence: attribution.beforeFence,
          settled: {
            fence: settled.fence,
            settleTailBenchMs: settled.settleTailBenchMs,
            settleTailFullMs: settled.settleTailFullMs,
            tailChildMutations: settled.tailChildMutations,
            tailTextMutations: settled.tailTextMutations,
            tailCommits: settled.tailCommits,
          },
        });
      }
      if (cardCounts.size !== 1) {
        throw new Error(
          `${cellKey}: card count is not deterministic (${[...cardCounts].join(", ")}) — refusing to record`,
        );
      }
      cells[cellKey] = { profile: "client", scale, cardCount: [...cardCounts][0], runs };
      await page.close();
    }
  } finally {
    await browser.close();
    child.kill();
  }

  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  await mkdir(OUT_DIR, { recursive: true });
  const jsonPath = `${OUT_DIR}/settle-attribution-${stamp}.json`;
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: startedAt.toISOString(),
        scales: SCALES,
        repeats: REPEATS,
        warmups: WARMUPS,
        quietMs: QUIET_MS,
        requiredMountRpcs: REQUIRED_MOUNT_RPCS,
        cells,
      },
      null,
      2,
    ),
  );
  console.log(`\nreport: ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
