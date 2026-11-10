/**
 * Scratch probe: does the board's first card paint wait for the mount fan-in
 * in BOTH lane directions? Issue: "in horizontal view, the board is painting
 * before settling". Observes only; changes no behavior.
 *
 * For each direction it loads the harness at one scale with the staged knobs
 * (`?metaScanMs=`, `?rpcLatency=`, `?sidebarDelay=`), records a per-frame
 * census (frame time, card count, the board's lane→card signature), and
 * reports:
 *
 * - `firstCardFrame`: the first frame in which a card existed;
 * - `mountEndsBeforeFirstCard`: how many of the nine mount list calls had
 *   already pushed their end mark when that frame ran (9 = fully settled
 *   before the paint, <9 = the board painted early);
 * - `signatureChangedAfterPaint`: whether the lane→card map moved after the
 *   first card, i.e. the board reshuffled once it already looked loaded.
 *
 * Usage: node scripts/perf/repro-lane-direction-hold.mjs
 * Env: CHROME_PATH, HARNESS_PORT (default 5491), SCALE (300),
 *      KNOB_META_SCAN_MS (8), KNOB_RPC_LATENCY_MS (6), KNOB_SIDEBAR_DELAY_MS (120),
 *      DIRECTIONS ("vertical,horizontal"), OUT_DIR (docs/perf).
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5491");
const SCALE = Number(process.env.SCALE ?? "300");
const META_SCAN_MS = Number(process.env.KNOB_META_SCAN_MS ?? "8");
const RPC_LATENCY_MS = Number(process.env.KNOB_RPC_LATENCY_MS ?? "6");
const SIDEBAR_DELAY_MS = Number(process.env.KNOB_SIDEBAR_DELAY_MS ?? "120");
const DIRECTIONS = (process.env.DIRECTIONS ?? "vertical,horizontal").split(",").map((d) => d.trim());
/** Raw query string appended to every case (`groupBy=group&demo=1`), so one
 *  probe run can reproduce a shape the base knobs do not reach. */
const EXTRA = process.env.EXTRA ?? "";
const OUT_DIR = process.env.OUT_DIR ?? "docs/perf";

/** The mount calls that carry the gate's nine lists: since issue #424 the six
 *  per-thread walks arrive in ONE aggregate read, so "did the board wait for
 *  the metadata" is measured on these four calls, and an aggregate that has
 *  not landed is the same failure the old six-call fan-in could produce. */
const MOUNT_LISTS = [
  "board_state_get",
  "rank_list",
  "sweep_config_get",
  "family_state_list",
];

/** Install before any document script: a per-frame census of the board. */
function installFrameCensus(mountLists) {
  const w = window;
  w.__holdFrames = [];
  w.__holdSignatures = [];
  const signature = () => {
    const lists = [...document.querySelectorAll("[data-card-list]")];
    const parts = lists.map((list) => {
      const lane = list.closest("[data-lane-id]")?.getAttribute("data-lane-id") ?? "?";
      const ids = [...list.querySelectorAll("[data-thread-card]")].map(
        (card) => card.getAttribute("data-thread-card") ?? "?",
      );
      return `${lane}:${ids.join(",")}`;
    });
    return `dir=${document.querySelector("[data-lane-direction]")?.getAttribute("data-lane-direction") ?? "?"}|${parts.join(";")}`;
  };
  const sample = () => {
    const cards = document.querySelectorAll("[data-thread-card]").length;
    const marks = w.__perfMarks ?? [];
    const ended = new Set(
      marks
        .filter((mark) => mark.label.startsWith("fb-rpc-end:"))
        .map((mark) => mark.label.slice("fb-rpc-end:".length)),
    );
    const mountsEnded = mountLists.filter((method) => ended.has(method)).length;
    w.__holdFrames.push({ t: performance.now(), cards, mountsEnded, sig: signature() });
    if (performance.now() < 4000) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

/** Read the recorded frames plus the full mark timeline. */
function readCensus() {
  return {
    frames: window.__holdFrames ?? [],
    marks: (window.__perfMarks ?? []).map((mark) => ({ ...mark })),
  };
}

const summary = (direction, census) => {
  const { frames, marks } = census;
  const firstCardFrame = frames.find((frame) => frame.cards > 0) ?? null;
  const lastFrame = frames[frames.length - 1] ?? null;
  const mountEndAt = (method) => marks.find((mark) => mark.label === `fb-rpc-end:${method}`)?.t ?? null;
  const mountEnds = MOUNT_LISTS.map((method) => ({ method, t: mountEndAt(method) }));
  const missingEnds = mountEnds.filter((entry) => entry.t === null).map((entry) => entry.method);
  const latestMountEnd = Math.max(
    ...mountEnds.filter((entry) => entry.t !== null).map((entry) => entry.t),
  );
  const afterPaint = firstCardFrame === null
    ? []
    : frames.filter((frame) => frame.t >= firstCardFrame.t && frame.sig !== firstCardFrame.sig);
  const firstDivergence = afterPaint[0] ?? null;
  return {
    direction,
    firstCardAt: firstCardFrame === null ? null : Math.round(firstCardFrame.t),
    firstCardCount: firstCardFrame === null ? null : firstCardFrame.cards,
    mountEndsBeforeFirstCard: firstCardFrame === null ? null : firstCardFrame.mountsEnded,
    latestMountEndAt: missingEnds.length > 0 ? null : Math.round(latestMountEnd),
    missingMountEnds: missingEnds,
    lateBy: firstCardFrame === null ? null : Math.round(latestMountEnd - firstCardFrame.t),
    paintedBeforeSettle: firstCardFrame !== null && firstCardFrame.mountsEnded < MOUNT_LISTS.length,
    signatureChangedAfterPaint: firstDivergence !== null,
    firstDivergenceAt: firstDivergence === null ? null : Math.round(firstDivergence.t),
    firstDivergenceCards: firstDivergence === null ? null : firstDivergence.cards,
    finalCards: lastFrame === null ? null : lastFrame.cards,
    finalSignature: lastFrame === null ? null : lastFrame.sig,
    firstPaintedSignature: firstCardFrame === null ? null : firstCardFrame.sig,
    mountEnds,
  };
};

const main = async () => {
  await mkdir(OUT_DIR, { recursive: true });
  const harness = await startHarness(PORT);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: ["--hide-scrollbars"],
  });
  const results = [];
  try {
    for (const direction of DIRECTIONS) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(installFrameCensus, MOUNT_LISTS);
      const query = new URLSearchParams({
        laneDirection: direction,
        scale: String(SCALE),
        metaScanMs: String(META_SCAN_MS),
        rpcLatency: String(RPC_LATENCY_MS),
        sidebarDelay: String(SIDEBAR_DELAY_MS),
      });
      const queryString = `${query.toString()}${EXTRA === "" ? "" : `&${EXTRA}`}`;
      await page.goto(`${harness.base}?${queryString}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForFunction(
        () => (window.__holdFrames ?? []).length > 0 && performance.now() > 4000,
        { timeout: 60_000, polling: "raf" },
      );
      const census = await page.evaluate(readCensus);
      results.push({ ...summary(direction, census), query: queryString });
      await page.close();
    }
  } finally {
    await browser.close();
    harness.child.kill();
  }
  const report = {
    capturedAt: new Date().toISOString(),
    scale: SCALE,
    knobs: { metaScanMs: META_SCAN_MS, rpcLatency: RPC_LATENCY_MS, sidebarDelay: SIDEBAR_DELAY_MS },
    results,
  };
  const outFile = `${OUT_DIR}/lane-direction-hold-${report.capturedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  for (const row of results) {
    console.log(
      [
        row.direction.padEnd(11),
        `firstCard@${row.firstCardAt}ms`,
        `cards=${row.firstCardCount}`,
        `mountEndsBefore=${row.mountEndsBeforeFirstCard}/${MOUNT_LISTS.length}`,
        `latestMountEnd@${row.latestMountEndAt}ms`,
        `paintedBeforeSettle=${row.paintedBeforeSettle}`,
        `reshuffledAfterPaint=${row.signatureChangedAfterPaint}` +
          (row.firstDivergenceAt === null ? "" : `@${row.firstDivergenceAt}ms`),
      ].join("  "),
    );
  }
  console.log(`\nwrote ${outFile}`);
};

await main();
