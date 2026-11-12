/**
 * Headless repro/evidence probe for issue #391: a relocation that EMPTIES its
 * old lane used to take the transporter dissolve's out-ghost with it — the
 * lane leaves the render (the board's "columns exist only while they hold
 * cards" rule, `components/grouping`), so the departing card popped instead of
 * finishing its dissolve.
 *
 * The probe drives the shape the issue names as a data move: the last card of
 * the Idle · Earlier lane relocates to Pinned. Two passes, because a
 * screenshot blocks the page for a few hundred milliseconds:
 *
 *   frames    three stills through the dissolve window — `pre` (the lane still
 *             holds its last card), `mid` (inside the wipe-out), `collapse`
 *             (the slot closing), `post` (the lane closed).
 *   timeline  a fresh page sampled every ~20ms: the lane's section, its held
 *             frame, its ghost, and the ghost's phase — the whole dissolve
 *             window on record, no capture gaps.
 *
 * Run twice, once per tree state, and compare:
 *   npx vite --config scripts/screenshot/vite.config.ts &
 *   LABEL=before node scripts/screenshot/repro-out-ghost.mjs   # pre-fix tree
 *   LABEL=after  node scripts/screenshot/repro-out-ghost.mjs   # fixed tree
 *
 * Evidence lands in docs/screenshots/repro-out-ghost/ as
 * `evidence-<label>.json` plus `<label>-{pre,mid,collapse,post}.png`.
 *
 * The read the two runs must show:
 *   before  the timeline holds NO ghost sample at all and the lane is gone at
 *           ~0ms: the wipe never got a frame (the pop).
 *   after   the ghost is sampled across the whole dissolve (wiping-out then
 *           collapsing, ~600ms), inside a lane wearing `data-column-closing`,
 *           and lane and ghost leave together at the phase plan's remove tick.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const LABEL = process.env.LABEL ?? "after";
const OUT = new URL("../../docs/screenshots/repro-out-ghost/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// The emptied lane and the card that leaves it last. thr_icon_lazy is moved
// out first (a pre-roll whose own dissolve finishes before the sampled push),
// so the sampled relocation is the lane's LAST card — the issue's shape.
const LANE = "idle-earlier";
const LEAVING = "thr_env_edge";
const PREROLL = "thr_icon_lazy";
// The dissolve's own clocks (components/card-transport): the wipe-out, then
// the slot collapse, then the ghost's removal.
const WIPE_OUT_MS = 400;
const COLLAPSE_MS = 200;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  // Wide enough that every lane of the fixture is on screen: the held frame
  // sits where the emptied lane sat (after Idle · Today), and a frame that
  // cropped it out would show the fix as nothing at all.
  defaultViewport: { width: 2560, height: 1100, deviceScaleFactor: 1 },
  args: ["--hide-scrollbars"],
});

const problems = [];

/** A board page past the load-echo guard, with the lane's last card in place. */
async function openBoard() {
  const page = await browser.newPage();
  // The transporter DISSOLVE is the effect issue #391 names: the shipped
  // transport default is the zoom, and the dissolve is selected through the
  // same stored preference the operator's Appearance tab writes ("teleport" is
  // the dissolve's stored name; components/preferences).
  await page.evaluateOnNewDocument(() => {
    window.localStorage.setItem("focus-board:cardTransport", "teleport");
  });
  page.on("pageerror", (error) => problems.push(String(error)));
  page.on("console", (message) => {
    // The harness has no favicon; the browser's own 404 for it is noise every
    // probe on this harness sees, so it is not a page problem.
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      problems.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (response.url().endsWith("/favicon.ico")) return;
    problems.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(BASE, { waitUntil: "networkidle0" });
  // The board, then past the load-echo mount guard (700ms from the first lane
  // map): within that window the board deliberately lands relocations in place
  // with no play at all (issue #373), and this probe is about a later move.
  await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
  await sleep(1600);

  const before = await readLane(page);
  if (!before.lane) throw new Error(`the ${LANE} lane is not on the board — nothing to empty`);
  if (before.laneCards !== 2) {
    throw new Error(`the ${LANE} lane holds ${before.laneCards} cards, expected the fixture's 2`);
  }
  // The pre-roll: the lane's FIRST card leaves, so the sampled move is its last.
  await push(page, PREROLL);
  await sleep(1200);
  const afterPreRoll = await readLane(page);
  if (afterPreRoll.laneCards !== 1) {
    throw new Error(
      `the pre-roll left ${afterPreRoll.laneCards} cards in ${LANE}, expected 1 (is the mount guard still withholding plays?)`,
    );
  }
  return { page, before, afterPreRoll };
}

function readLane(page) {
  return page.evaluate(
    ({ lane }) => {
      const section = document.querySelector(`[data-column-id="${lane}"]`);
      const ghost = section?.querySelector("[data-transport-ghost]") ?? null;
      const cards = [...(section?.querySelectorAll("[data-thread-card]") ?? [])].filter(
        (card) => card.closest("[data-transport-ghost]") === null,
      );
      return {
        lane: section !== null,
        laneClosing: section?.getAttribute("data-column-closing") ?? null,
        laneCards: cards.length,
        ghost: ghost !== null,
        ghostPhase: ghost?.getAttribute("data-transport-out") ?? null,
        ghostOpacity: ghost !== null ? getComputedStyle(ghost).opacity : null,
      };
    },
    { lane: LANE },
  );
}

function push(page, threadId) {
  return page.evaluate(
    ({ threadId }) =>
      window.__uat.pushThreadUpdate(threadId, {
        isPinned: true,
        pinnedAt: 1,
        pinSortKey: 0,
      }),
    { threadId },
  );
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}${LABEL}-${name}.png`, timeout: 30_000 });
}

// ── Pass 1: the stills ────────────────────────────────────────────────────
const frames = await openBoard();
await shoot(frames.page, "pre");
const pushStarted = Date.now();
await push(frames.page, LEAVING);
const at = async (ms) => {
  const wait = ms - (Date.now() - pushStarted);
  if (wait > 0) await sleep(wait);
};
await at(WIPE_OUT_MS / 2);
await shoot(frames.page, "mid");
await at(WIPE_OUT_MS + COLLAPSE_MS / 2);
await shoot(frames.page, "collapse");
await at(WIPE_OUT_MS + COLLAPSE_MS + 250);
await shoot(frames.page, "post");
await frames.page.close();

// ── Pass 2: the timeline (no screenshots, so no capture gaps) ─────────────
const timeline = await openBoard();
const samples = [];
const started = Date.now();
const pushPromise = push(timeline.page, LEAVING);
while (Date.now() - started < 1000) {
  const t = Date.now() - started;
  samples.push({ t, ...(await readLane(timeline.page)) });
  await sleep(20);
}
await pushPromise;
await timeline.page.close();

const ghostSamples = samples.filter((sample) => sample.ghost);
const heldSamples = samples.filter((sample) => sample.laneClosing !== null);
const laneGone = samples.find((sample) => !sample.lane);
const firstGhost = ghostSamples[0];
const lastGhost = ghostSamples.at(-1);
const evidence = {
  issue: 391,
  label: LABEL,
  query: BASE,
  lane: LANE,
  leavingCard: LEAVING,
  preRollCard: PREROLL,
  clocksMs: { wipeOut: WIPE_OUT_MS, collapse: COLLAPSE_MS, remove: WIPE_OUT_MS + COLLAPSE_MS },
  readings: { before: timeline.before, afterPreRoll: timeline.afterPreRoll },
  verdict: {
    // The pop reads as "the wipe never got a frame": no ghost sample at all,
    // the lane gone in the first breath.
    ghostSamples: ghostSamples.length,
    ghostAppearedAtMs: firstGhost?.t ?? null,
    ghostLeftAtMs: lastGhost?.t ?? null,
    ghostMs: firstGhost !== undefined && lastGhost !== undefined ? lastGhost.t - firstGhost.t : 0,
    ghostPhases: [...new Set(ghostSamples.map((sample) => sample.ghostPhase).filter(Boolean))],
    ghostLowestOpacity: Math.min(...ghostSamples.map((sample) => Number(sample.ghostOpacity))),
    heldFrameSamples: heldSamples.length,
    laneLeftAtMs: laneGone?.t ?? null,
    poppedWithLane: ghostSamples.length === 0,
  },
  samples,
  pageProblems: problems,
};
writeFileSync(`${OUT}evidence-${LABEL}.json`, JSON.stringify(evidence, null, 1));

const v = evidence.verdict;
console.log(`[${LABEL}] ${LANE} emptied by ${LEAVING}`);
console.log(
  `  ghost frames: ${v.ghostSamples} (${v.ghostAppearedAtMs}ms -> ${v.ghostLeftAtMs}ms, ${v.ghostMs}ms)`,
);
console.log(`  phases: ${v.ghostPhases.join(" -> ") || "none"}; lane left ${v.laneLeftAtMs}ms`);
console.log(`  held frame samples: ${v.heldFrameSamples}; popped with the lane: ${v.poppedWithLane}`);
if (problems.length > 0) {
  console.log(`  page problems:\n   ${problems.join("\n   ")}`);
  process.exitCode = 1;
}

// The expected read per tree: before = the pop (not one ghost frame),
// after = the hold (the dissolve's phases played inside a held frame, and
// the lane outlived the wipe it used to die with).
const expected = LABEL === "before";
const heldLongEnough =
  v.ghostMs >= WIPE_OUT_MS + COLLAPSE_MS - 80 && v.heldFrameSamples > 0 && v.laneLeftAtMs !== null;
if (v.poppedWithLane !== expected || (!expected && !heldLongEnough)) {
  console.log(
    `FAIL: label "${LABEL}" expected poppedWithLane=${expected}${expected ? "" : " with a full-window hold"}, read poppedWithLane=${v.poppedWithLane}, ghostMs=${v.ghostMs}, held=${v.heldFrameSamples}`,
  );
  process.exitCode = 1;
}

await browser.close();
