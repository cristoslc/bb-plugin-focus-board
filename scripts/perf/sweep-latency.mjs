/**
 * The sweep-latency probe: arm the Idle · A while ago lane's broom, confirm
 * it, and price every phase of the gesture — queue → rpc sent → rpc settled
 * → card landed → lane clear — on a board the size a long-lived workspace
 * reaches.
 *
 * Why a probe and not the bench: `scripts/screenshot/bench-board.mjs` prices
 * ONE card's done toggle. The sweep prices N cards in sequence, and the
 * question it answers is WHERE the wall time goes, not just how much there
 * is. The probe changes nothing in the app or the server: it observes the
 * shipped gesture through three in-page instruments installed before any
 * document script runs —
 *
 * 1. The React commit census (the DevTools hook contract the dev build
 *    injects into): one record per commit, with the root fiber's subtree
 *    render wall and the components that ran (both dev-build only; a
 *    production build reports the commit count and zeroes the wall, which is
 *    why the per-commit detail is read on the dev profile).
 * 2. A lane clock: samples of the swept lane's and the Done lane's card sets,
 *    one per mutation batch, so each swept card's ARRIVAL in Done (its state
 *    applied and painted) and its GHOST's departure from the old lane (the
 *    dissolve finished) are timestamped separately. The two are ~320ms apart
 *    by design: the transport ghost holds the old slot through the animation.
 * 3. The long-task observer, for the main-thread blocking the render wall
 *    alone does not name.
 *
 * The rpc side comes from the harness's own `__perfMarks` timeline
 * (`fb-rpc-start:<method>` / `fb-rpc-end:<method>`), so the probe and the load
 * bench read the same clock, and from `__uat.simRpcLog`, which counts the
 * refetch passes the coalescer did or did not collapse.
 *
 * The board is held QUIET before the gesture: card count stable and no
 * mutation for a second (after a 3s floor). Without that gate a 1,700-card
 * board is still mounting when the click lands, and the mount's own work is
 * misread as the gesture's.
 *
 * Knobs, all stated with their numbers in the report:
 * - `--latency <ms>`: the modeled per-RPC bridge round trip (`?rpcLatency=`).
 *   The recorded runs use 15ms: this machine's focus-board handler mean over
 *   549,363 calls is 12.0ms (`bb plugin list`), plus the IPC hop.
 * - `--scale <n>`: live threads appended to the fixture (`?scale=`).
 * - `--done <n>`: live threads already marked Done (`?done=`, the fixture
 *   added for this probe). It is the knob that matters: the Done column is
 *   rebuilt by every board assembly, and a long-lived workspace holds
 *   hundreds to thousands of them (the operator's board: 1,363).
 * - `--metascan <ms>`: the modeled per-thread metadata scan the list handlers
 *   pay (`?metaScanMs=`, default 1.5).
 * - `--single`: price ONE card's done toggle instead of the lane sweep.
 *
 * Usage:
 *   npm run build                             # the harness loads dist/app.css
 *   npm run perf:sweep                        # dev harness, this tree
 *   npx vite build --config scripts/screenshot/vite.probe.config.ts
 *   npx vite preview --config scripts/screenshot/vite.probe.config.ts &
 *   HARNESS_URL=http://localhost:5174/ npm run perf:sweep   # production build
 *
 * The production build is the profile a claim about the shipped plugin needs
 * (the screenshot README's warning: the dev harness serves React development,
 * which overstates cost and can rank bottlenecks wrongly).
 *
 * Env: CHROME_PATH (system Chrome), HARNESS_PORT (default 5488),
 * HARNESS_URL (measure an already-running harness instead), OUT_DIR
 * (default docs/perf/), SWEEP_LANE (default idle-awhile).
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5488");
const OUT_DIR = process.env.OUT_DIR ?? "docs/perf";
/** The lane the operator's complaint names. */
const LANE_ID = process.env.SWEEP_LANE ?? "idle-awhile";

const flag = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  // Read the flag's value ONLY when the flag is present: argv[0] is the node
  // binary, and a default read of it lands as NaN.
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const SCALES = String(flag("scales", process.env.SWEEP_SCALES ?? "60,300"))
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
if (SCALES.length === 0) {
  throw new Error(
    "--scales resolved empty: an empty battery measures nothing and must not run",
  );
}
const REPEATS = Math.max(1, Number(flag("repeats", process.env.SWEEP_REPEATS ?? "3")));
const WARMUPS = Math.max(0, Number(flag("warmup", process.env.SWEEP_WARMUP ?? "1")));
const LATENCY = Number(flag("latency", process.env.SWEEP_LATENCY ?? "15"));
/** Done-lane density: the harness's `?done=` fixture (long-lived workspace). */
const DONE_CARDS = Number(flag("done", process.env.SWEEP_DONE ?? "0"));
/** The modeled per-thread metadata scan the list handlers pay (`?metaScanMs=`). */
const META_SCAN = Number(flag("metascan", process.env.SWEEP_METASCAN ?? "1.5"));
/** Price ONE done toggle instead of the lane sweep: the per-write baseline
 *  the sweep's per-card cost is compared against. */
const SINGLE = process.argv.includes("--single");
const LABEL = String(flag("label", process.env.SWEEP_LABEL ?? ""));

/** Page-side, before any document script: the React commit census. */
function installCommitCensus() {
  const commits = [];
  window.__sweepCommits = commits;
  let seq = 0;
  const censusWalk = (record, renderWindowStart) => {
    let rendered = 0;
    let appRenderMs = 0;
    let topName = null;
    const byName = new Map();
    const stack = [record.root.current];
    while (stack.length > 0) {
      const fiber = stack.pop();
      if (fiber === null || fiber === undefined) continue;
      for (let child = fiber.child; child !== null; child = child.sibling) stack.push(child);
      const tag = fiber.tag;
      if (tag === 5 || tag === 6 || tag === 26 || tag === 27) continue;
      if (tag !== 0 && tag !== 1 && tag !== 11 && tag !== 14 && tag !== 15) continue;
      const start = fiber.actualStartTime;
      if (!(start > renderWindowStart && start < record.t + 0.25)) continue;
      rendered += 1;
      const type = fiber.type;
      const innerType =
        (tag === 14 || tag === 15) && type && typeof type === "object" ? type.type : type;
      const name =
        typeof innerType === "function"
          ? (innerType.displayName ?? innerType.name ?? "anon")
          : "wrapper";
      byName.set(name, (byName.get(name) ?? 0) + 1);
      if (appRenderMs === 0) {
        topName = name;
        // The first rendered fiber in the DFS is the tree root; its
        // actualDuration prices the whole subtree render (dev builds only).
        appRenderMs = Math.round((fiber.actualDuration ?? 0) * 100) / 100;
      }
    }
    record.fns = rendered;
    record.renderMs = appRenderMs;
    record.top = topName;
    record.names = [...byName.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => `${name}×${count}`);
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject(internals) {
      this.renderers.set(1, internals ?? null);
      return 1;
    },
    onCommitFiberRoot(rendererId, root, priority, didError) {
      const record = {
        idx: seq++,
        t: performance.now(),
        prevT: commits.length > 0 ? commits[commits.length - 1].t : 0,
        fns: 0,
        renderMs: 0,
        top: null,
        names: null,
        root,
        didError: didError === true,
      };
      commits.push(record);
      Promise.resolve().then(() => {
        try {
          censusWalk(record, record.prevT);
        } catch {
          record.fns = 0;
        }
      });
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
  };
}

/** Page-side, at DOM start: the lane clock and the long tasks. */
function installLaneClock() {
  const install = () => {
    const sweptLane = window.__sweepLane ?? null;
    const probe = {
      t0: 0,
      sweptLane,
      doneLane: window.__sweepDoneLane ?? "done",
      /** A swept card lands in the Done lane: state applied and painted. */
      landings: [],
      /** A swept card's ghost finally leaves the lane it was swept from. */
      exits: [],
      longTasks: [],
    };
    window.__sweepProbe = probe;
    let seenSwept = new Set();
    let seenDone = new Set();
    const idsOf = (laneId) => {
      const lane = document.querySelector(`[data-column-id="${laneId}"]`);
      return new Set(
        [...(lane?.querySelectorAll("[data-thread-card]") ?? [])].map((card) =>
          card.getAttribute("data-thread-card"),
        ),
      );
    };
    const sample = (t) => {
      if (sweptLane === null) return;
      const swept = idsOf(sweptLane);
      const done = idsOf(probe.doneLane);
      for (const id of seenSwept) {
        if (!swept.has(id)) probe.exits.push({ t, id });
      }
      for (const id of done) {
        if (!seenDone.has(id) && seenSwept.has(id)) probe.landings.push({ t, id });
      }
      seenSwept = swept;
      seenDone = done;
    };
    window.__sweepSample = () => sample(performance.now());
    new MutationObserver(() => {
      // One sample per observer callback: the callback runs as a microtask
      // after React's commit task, so the lanes hold the committed card set.
      sample(performance.now());
    }).observe(document.body, { childList: true, subtree: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTasks.push({ t: entry.startTime, d: Math.round(entry.duration) });
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask unsupported: the report says so by the empty array */
    }
    sample(performance.now());
  };
  if (document.body === null) {
    document.addEventListener("DOMContentLoaded", install);
    return;
  }
  install();
}

/** The lane's own card count, from its column landmark. */
const laneCardCount = () =>
  document.querySelectorAll(`[data-column-id="${LANE_ID}"] [data-thread-card]`).length;

const RUNNING_PILL = `[data-column-id="${LANE_ID}"] [data-sweep-button][aria-label^="Sweeping"]`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ["--hide-scrollbars"],
});

/**
 * Either start this tree's dev harness, or measure an ALREADY-RUNNING
 * production harness (`HARNESS_URL`, e.g. `npx vite preview --config
 * scripts/screenshot/vite.probe.config.ts`). The dev build serves React
 * development, which the screenshot README warns ranks bottlenecks wrongly;
 * the production build is the profile a claim about the shipped plugin needs.
 */
const HARNESS_URL = process.env.HARNESS_URL ?? "";
const harness = HARNESS_URL === "" ? await startHarness(PORT) : { base: HARNESS_URL, child: null };
const report = {
  label: LABEL,
  latency: LATENCY,
  doneCards: DONE_CARDS,
  metaScanMs: META_SCAN,
  lane: LANE_ID,
  cells: [],
};

try {
  for (const scale of SCALES) {
    for (let iteration = 0; iteration < WARMUPS + REPEATS; iteration += 1) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(installCommitCensus);
      await page.evaluateOnNewDocument(installLaneClock);
      await page.evaluateOnNewDocument((lane) => {
        window.__sweepLane = lane;
      }, LANE_ID);
      const url = `${harness.base}?scale=${scale}&rpcLatency=${LATENCY}&done=${DONE_CARDS}&metaScanMs=${META_SCAN}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForSelector(`[data-column-id="${LANE_ID}"]`, { timeout: 60_000 });
      // Let the board settle: a gesture measured during the mount tail prices
      // the mount, not the gesture. A card count alone is not enough — a
      // 1,700-card board keeps committing while it mounts — so wait for a
      // genuinely QUIET board: the card count stable AND no childList/attribute
      // mutation for QUIET_MS, with a floor and a ceiling.
      await page.evaluate(async (quietMs) => {
        const floor = 3000;
        const ceiling = 30_000;
        const startedAt = performance.now();
        let lastActivity = performance.now();
        const observer = new MutationObserver(() => {
          lastActivity = performance.now();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        let lastCount = -1;
        while (performance.now() - startedAt < ceiling) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const count = document.querySelectorAll("[data-thread-card]").length;
          if (count !== lastCount) {
            lastCount = count;
            lastActivity = performance.now();
          }
          if (
            performance.now() - startedAt >= floor &&
            performance.now() - lastActivity >= quietMs
          ) {
            break;
          }
        }
        observer.disconnect();
      }, 1000);

      if (SINGLE) {
        const measured = await page.evaluate(async (laneId) => {
          const probe = window.__sweepProbe;
          window.__sweepCommits.length = 0;
          probe.landings.length = 0;
          probe.exits.length = 0;
          probe.longTasks.length = 0;
          const markCount = (window.__perfMarks ?? []).length;
          window.__uat?.simRpcLog?.clear?.();
          const lane = document.querySelector(`[data-column-id="${laneId}"]`);
          const card = lane?.querySelector("[data-thread-card]");
          const checkbox = card?.querySelector("[data-done-checkbox]");
          if (checkbox === null || checkbox === undefined) {
            throw new Error("no done checkbox on the lane's first card");
          }
          const cardsBefore = document.querySelectorAll("[data-thread-card]").length;
          const start = performance.now();
          probe.t0 = start;
          checkbox.click(); // arm
          await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
          const armedAt = performance.now();
          checkbox.click(); // confirm
          await new Promise((resolve, reject) => {
            const deadline = performance.now() + 60_000;
            const tick = () => {
              if (probe.landings.length > 0) {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
              } else if (performance.now() > deadline) {
                reject(new Error("the toggle never landed"));
              } else {
                requestAnimationFrame(tick);
              }
            };
            tick();
          });
          const end = performance.now();
          await new Promise((resolve) => setTimeout(resolve, 1200));
          return {
            start,
            appearedAt: armedAt,
            end,
            cardsBefore,
            cardsAfter: document.querySelectorAll("[data-thread-card]").length,
            laneLeft: document.querySelectorAll(`[data-column-id="${laneId}"] [data-thread-card]`).length,
            marks: (window.__perfMarks ?? []).slice(markCount),
            commits: window.__sweepCommits.map((commit) => ({
              idx: commit.idx,
              t: commit.t,
              fns: commit.fns,
              renderMs: commit.renderMs,
              top: commit.top,
            names: commit.names,
            })),
            landings: structuredClone(probe.landings),
            exits: structuredClone(probe.exits),
            longTasks: structuredClone(probe.longTasks),
            rpcLog: window.__uat?.simRpcLog?.calls?.() ?? [],
            notice: null,
          };
        }, LANE_ID);
        await page.close();
        const cell = summarize({
          scale,
          measured,
          armed: { eligible: 1, label: "single toggle" },
          confirmLabel: null,
          iteration,
        });
        report.cells.push(cell);
        if (iteration < WARMUPS) continue;
        console.log(`${measureLine(cell)} | single`);
        continue;
      }

      const armed = await page.evaluate((laneId) => {
        const lane = document.querySelector(`[data-column-id="${laneId}"]`);
        const button = lane?.querySelector("[data-sweep-button]");
        const eligible = Number(
          /(\d+)\s+eligible/.exec(button?.getAttribute("aria-label") ?? "")?.[1] ?? "0",
        );
        button?.click();
        return { eligible, label: button?.getAttribute("aria-label") ?? null };
      }, LANE_ID);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))),
      );
      const confirmLabel = await page.evaluate((laneId) => {
        const button = document.querySelector(
          `[data-column-id="${laneId}"] [data-sweep-button]`,
        );
        return button?.getAttribute("aria-label") ?? null;
      }, LANE_ID);

      const measured = await page.evaluate(async () => {
        const probe = window.__sweepProbe;
        window.__sweepCommits.length = 0;
        probe.landings.length = 0;
        probe.exits.length = 0;
        probe.longTasks.length = 0;
        const markCount = (window.__perfMarks ?? []).length;
        window.__uat?.simRpcLog?.clear?.();
        const button = document.querySelector("[data-sweep-button][aria-pressed='true']");
        if (button === null) throw new Error("no armed sweep button to confirm");
        const cardsBefore = document.querySelectorAll("[data-thread-card]").length;
        const start = performance.now();
        probe.t0 = start;
        button.click();
        const pill = () => document.querySelector("[data-sweep-button][aria-label^='Sweeping']");
        // The run starts on the click; the pill appears on the commit that
        // follows it. Wait for the appearance FIRST: a disappearance check
        // that runs before the first commit measures nothing (it read 32ms
        // over a 435ms run before this guard).
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
        const appearedAt = performance.now();
        await new Promise((resolve, reject) => {
          const deadline = performance.now() + 120_000;
          const tick = () => {
            if (pill() !== null) {
              resolve(undefined);
            } else if (performance.now() > deadline) {
              reject(new Error("the sweep's running pill never appeared"));
            } else {
              requestAnimationFrame(tick);
            }
          };
          tick();
        });
        // Settle: the running pill is gone (setSweepRun(null) in the run's
        // then) AND two animation frames have painted since.
        await new Promise((resolve, reject) => {
          const deadline = performance.now() + 120_000;
          const tick = () => {
            if (pill() === null) {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
            } else if (performance.now() > deadline) {
              reject(new Error("the sweep never finished within 120s"));
            } else {
              requestAnimationFrame(tick);
            }
          };
          tick();
        });
        const end = performance.now();
        // Drain the coalescer's trailing pass, the notice's commit, and the
        // transports' teardown (the ghost tail runs ~320ms past the landing).
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const marks = (window.__perfMarks ?? []).slice(markCount);
        return {
          start,
          appearedAt,
          end,
          cardsBefore,
          cardsAfter: document.querySelectorAll("[data-thread-card]").length,
          laneLeft: document.querySelectorAll("[data-column-id='idle-awhile'] [data-thread-card]").length,
          marks,
          commits: window.__sweepCommits.map((commit) => ({
            idx: commit.idx,
            t: commit.t,
            fns: commit.fns,
            renderMs: commit.renderMs,
            top: commit.top,
            names: commit.names,
          })),
          landings: structuredClone(probe.landings),
          exits: structuredClone(probe.exits),
          longTasks: structuredClone(probe.longTasks),
          rpcLog: window.__uat?.simRpcLog?.calls?.() ?? [],
          notice: document.querySelector("[data-sweep-notice], [role='status']")?.textContent ?? null,
        };
      });
      await page.close();
      const cell = summarize({ scale, measured, armed, confirmLabel, iteration });
      report.cells.push(cell);
      if (iteration < WARMUPS) continue;
      console.log(measureLine(cell));
    }
  }
} finally {
  await browser.close();
  harness.child?.kill();
}

await mkdir(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = `${OUT_DIR}/sweep-latency-${LABEL === "" ? "" : `${LABEL}-`}${stamp}.json`;
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nreport: ${outPath}`);

/** Aggregate one measured run into the phases the report prices. */
function summarize({ scale, measured, armed, confirmLabel, iteration }) {
  const { start, appearedAt, end, marks, commits, landings, exits, longTasks, rpcLog } = measured;
  // done_set runs, paired the load bench's way (first open start, sequential
  // pairs). They may overlap: a batched run has several in flight.
  const openStarts = [];
  const runs = [];
  for (const { label, t } of marks) {
    if (label === "fb-rpc-start:done_set") openStarts.push(t);
    else if (label === "fb-rpc-end:done_set" && openStarts.length > 0) {
      runs.push({ start: openStarts.shift(), end: t });
    }
  }
  const durations = runs.map((run) => run.end - run.start).sort((a, b) => a - b);
  const busy = unionMs(runs);
  const settled = end - start;
  // One landing per card: a swept card renders in BOTH lanes while its
  // transport ghost holds the old slot, so the sampler can see it arrive
  // again after a re-render. The first arrival is the real one.
  const seenLanding = new Set();
  const firstLandings = landings.filter((landing) => {
    if (seenLanding.has(landing.id)) return false;
    seenLanding.add(landing.id);
    return true;
  });
  const lastLandingAt = firstLandings.length > 0 ? firstLandings[firstLandings.length - 1].t : null;
  const lastExitAt = exits.length > 0 ? exits[exits.length - 1].t : null;
  const commitWall = commits.reduce((sum, commit) => sum + (commit.renderMs ?? 0), 0);
  const longSum = longTasks.reduce((sum, task) => sum + task.d, 0);
  const refetch = countMethods(rpcLog, ["done_list", "pin_parks_list", "sweep_config_get", "board_state_get"]);
  // Per-card phases over the landings: the k-th card to reach the Done lane
  // belongs to the k-th done_set on the serial shape. queue = previous landing
  // → rpc sent, rpc = the round trip, after = rpc settled → the card's commit
  // is observed (≤ one mutation-callback hop).
  const cycles = [];
  for (let index = 0; index < firstLandings.length; index += 1) {
    const previous = index === 0 ? start : firstLandings[index - 1].t;
    const run = runs[index] ?? null;
    const landing = firstLandings[index];
    cycles.push({
      id: landing.id,
      queueMs: round(run === null ? landing.t - previous : run.start - previous),
      rpcMs: run === null ? null : round(run.end - run.start),
      afterMs: round(run === null ? null : landing.t - run.end),
      cycleMs: round(landing.t - previous),
    });
  }
  const lastLandingMs = lastLandingAt === null ? null : round(lastLandingAt - start);
  return {
    scale,
    iteration,
    eligible: armed.eligible,
    armedLabel: armed.label,
    confirmLabel,
    /** The run's own wall (pill appears → pill gone): what the gesture costs. */
    settledMs: round(settled),
    pillAppearedMs: round(appearedAt - start),
    /** Last swept card observed in the Done lane. */
    lastLandingMs,
    /** Last ghost gone from the swept lane: the board looks clear. */
    laneClearMs: lastExitAt === null ? null : round(lastExitAt - start),
    landings: firstLandings.length,
    landingEvents: landings.length,
    exits: exits.length,
    cardsBefore: measured.cardsBefore,
    cardsAfter: measured.cardsAfter,
    laneLeft: measured.laneLeft,
    rpcCalls: runs.length,
    rpcBusyMs: round(busy),
    rpcBusyShare: round(busy / settled, 4),
    rpcMeanMs: durations.length === 0 ? null : round(mean(durations)),
    rpcP95Ms: durations.length === 0 ? null : round(p95(durations)),
    rpcMaxMs: durations.length === 0 ? null : round(durations[durations.length - 1]),
    commitCount: commits.length,
    commitWallMs: round(commitWall),
    commitShare: round(commitWall / settled, 4),
    commitMaxMs: commits.reduce((max, commit) => Math.max(max, commit.renderMs ?? 0), 0),
    longTaskCount: longTasks.length,
    longTaskMs: longSum,
    longTaskMaxMs: longTasks.reduce((max, task) => Math.max(max, task.d), 0),
    refetchCalls: refetch,
    runs: runs.slice(0, 400).map((run) => ({
      start: round(run.start - start),
      end: round(run.end - start),
    })),
    landingsMs: firstLandings.slice(0, 400).map((landing) => ({
      id: landing.id,
      at: round(landing.t - start),
    })),
    exitsMs: exits.slice(0, 400).map((exit) => ({
      id: exit.id,
      at: round(exit.t - start),
    })),
    commits: commits.slice(0, 400).map((commit) => ({
      at: round(commit.t - start),
      fns: commit.fns,
      renderMs: commit.renderMs,
      top: commit.top,
      names: commit.names,
    })),
    cycles: cycles.slice(0, 200),
    meanCycleMs: cycles.length === 0 ? null : round(mean(cycles.map((c) => c.cycleMs))),
    p95CycleMs: cycles.length === 0 ? null : round(p95(cycles.map((c) => c.cycleMs).sort((a, b) => a - b))),
    meanQueueMs: cycles.length === 0 ? null : round(mean(cycles.map((c) => c.queueMs))),
    meanRpcMs: cycles.length === 0 ? null : round(mean(cycles.map((c) => c.rpcMs ?? 0))),
    meanAfterMs: cycles.length === 0 ? null : round(mean(cycles.map((c) => c.afterMs ?? 0))),
    notice: measured.notice,
  };
}

function measureLine(cell) {
  return [
    `scale ${cell.scale} run ${cell.iteration}`,
    `lane ${cell.eligible} eligible → ${cell.landings} landed`,
    `run ${cell.settledMs}ms | last card ${cell.lastLandingMs}ms | lane clear ${cell.laneClearMs}ms`,
    `rpc ${cell.rpcCalls}×${cell.rpcMeanMs}ms = ${cell.rpcBusyMs}ms (${Math.round(cell.rpcBusyShare * 100)}%)`,
    `react ${cell.commitCount} commits = ${cell.commitWallMs}ms (${Math.round(cell.commitShare * 100)}%)`,
    `long tasks ${cell.longTaskCount}/${cell.longTaskMs}ms`,
    `refetch ${cell.refetchCalls}`,
    `per card queue ${cell.meanQueueMs} + rpc ${cell.meanRpcMs} + after ${cell.meanAfterMs} = ${cell.meanCycleMs}ms (p95 ${cell.p95CycleMs})`,
  ].join(" | ");
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p95(sortedAscending) {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.ceil(sortedAscending.length * 0.95) - 1);
  return sortedAscending[index];
}

/** Wall covered by a set of possibly-overlapping intervals. */
function unionMs(runs) {
  const sorted = [...runs].sort((a, b) => a.start - b.start);
  let total = 0;
  let openStart = null;
  let openEnd = null;
  for (const run of sorted) {
    if (openStart === null) {
      openStart = run.start;
      openEnd = run.end;
    } else if (run.start <= openEnd) {
      openEnd = Math.max(openEnd, run.end);
    } else {
      total += openEnd - openStart;
      openStart = run.start;
      openEnd = run.end;
    }
  }
  if (openStart !== null) total += openEnd - openStart;
  return total;
}

function countMethods(log, methods) {
  return log.filter((method) => methods.includes(method)).length;
}
