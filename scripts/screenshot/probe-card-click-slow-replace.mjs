// Does a card click ever open BOTH the native pane and the board's own pane?
//
// The operator's report (2026-11-24, with a screenshot): "clicking a card BOTH
// took over the (correct) existing pane AND also launched the in-fb-pane side
// panel. EXPECTED: existing pane takeover, NO in-fb-pane panel". Two thread
// surfaces for one click.
//
// The click's replacement has two halves that run on different clocks:
//
//   - the landing navigation is issued from the board's layout effect once the
//     host has focused the board's pane, and the host applies it on its own
//     commit;
//   - `REPLACE_CONFIRM_MS` (400ms) is a net for a host that never answers: when
//     it fires and the replacement intent is still live, it opens the board's
//     own pane and drops the record.
//
// On a small, warm window the host lands inside the click's own flush and the
// net never fires. The operator's window is not small (308 threads on the
// board). This probe slows the renderer deliberately (CDP
// `Emulation.setCPUThrottlingRate`, `CPU_RATES`) and samples the window after
// one replacement click: a sample where the native pane holds the clicked
// thread AND the board's own in-panel pane is mounted is the reported state.
//
// Phases are one per CPU rate, each in its own browser context (its own split
// layout, its own storage), so nothing touches the operator's window. The click
// trace (`nativeOpenDebug`) is turned on for the run and put back afterwards;
// the trace says which branches ran, the samples say which surfaces were on
// screen.
//
// Usage: node scripts/screenshot/probe-card-click-slow-replace.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, CPU_RATES (comma separated, default
// "10,20"), SERVE_BUNDLE (a built app.js to serve over the installed one).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-card-click-slow-replace";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PLUGIN_ID = "focus-board";
const SERVE_BUNDLE = process.env.SERVE_BUNDLE ?? null;
const BUNDLE_MARKER = "data-focus-board-panel";
const CPU_RATES = (process.env.CPU_RATES ?? "10,20")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readPluginSetting(key) {
  try {
    const out = execFileSync("bb", ["plugin", "config", PLUGIN_ID], { encoding: "utf8" });
    const line = out.split("\n").find((candidate) => candidate.startsWith(`${key} = `));
    if (line === undefined) return null;
    const raw = line.slice(`${key} = `.length);
    return raw === "true" ? true : raw === "false" ? false : raw;
  } catch {
    return null;
  }
}

function writePluginSetting(key, value) {
  execFileSync("bb", ["plugin", "config", PLUGIN_ID, "set", key, String(value)], {
    encoding: "utf8",
  });
}

/** One sample of the window: the host's layout, the board's own pane, the
 *  route, and the record. `bothSurfaces` is the reported state. */
const READ_STATE = `(function () {
  let layout = null;
  try {
    const raw = localStorage.getItem('bb.splitLayout');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      layout = parsed && parsed.layout ? parsed.layout : parsed;
    }
  } catch {}
  const flatten = (node, out) => {
    if (node === null || node === undefined) return out;
    if (node.type === 'pane') { out.push(node); return out; }
    for (const child of node.children ?? []) flatten(child, out);
    return out;
  };
  const panes = layout === null ? [] : flatten(layout.root, []);
  const aside = document.querySelector('aside[aria-label^="Thread:"]');
  return {
    at: Math.round(performance.now()),
    route: location.pathname,
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      threadId:
        pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      focused: layout !== null && layout.focusedPaneId === pane.paneId,
    })),
    boardMounted: document.querySelector('[data-focus-board-panel]') !== null,
    boardCards: document.querySelectorAll('[data-thread-card]').length,
    inBoardPane: aside === null ? null : aside.getAttribute('aria-label'),
    record: localStorage.getItem('focus-board:boardNativeThreadPane'),
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});

const evidence = {
  app: APP,
  cpuRates: CPU_RATES,
  phases: {},
  trace: [],
  errors: [],
};

/** Which served app.js is the board's, sniffed by content, or null. */
async function findBoardBundle() {
  const sniff = await browser.createBrowserContext();
  const sniffPage = await sniff.newPage();
  await sniffPage.setCacheEnabled(false);
  const bodies = [];
  sniffPage.on("response", (response) => {
    const url = response.url();
    if (!/\/plugin-app-assets\/[a-f0-9]+\/app\.js$/.test(url)) return;
    bodies.push(response.text().then((body) => ({ url, hasBoard: body.includes(BUNDLE_MARKER) })));
  });
  await sniffPage.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1500);
  const found = (await Promise.all(bodies)).find((entry) => entry.hasBoard) ?? null;
  await sniff.close();
  return found === null ? null : found.url;
}

const candidateBundleUrl = SERVE_BUNDLE === null ? null : await findBoardBundle();
if (SERVE_BUNDLE !== null) {
  if (candidateBundleUrl === null) {
    console.error("Could not identify the board's app.js among the served plugin assets.");
    await browser.close();
    process.exit(1);
  }
  console.log(`serving ${SERVE_BUNDLE} for ${candidateBundleUrl}`);
  evidence.servedBundle = SERVE_BUNDLE;
}

let currentPhase = null;
let context = null;
let page = null;

async function startPhase(rate) {
  if (context !== null) await context.close();
  context = await browser.createBrowserContext();
  page = await context.newPage();
  await page.setCacheEnabled(false);
  const client = await page.createCDPSession();
  if (candidateBundleUrl !== null && SERVE_BUNDLE !== null) {
    const swapped = `${readFileSync(SERVE_BUNDLE, "utf8")}\n;window.__fbServedBundle = "swapped";\n`;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url() !== candidateBundleUrl) {
        void request.continue();
        return;
      }
      void request.respond({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: swapped,
      });
    });
  }
  page.on("console", async (message) => {
    const text = message.text();
    if (!text.includes("[focus-board:native-open]")) return;
    const payloads = [];
    for (const arg of message.args()) {
      try {
        payloads.push(await arg.jsonValue());
      } catch {
        payloads.push(message.text());
      }
    }
    evidence.trace.push({ phase: currentPhase, rate, payloads });
  });
  page.on("pageerror", (error) => evidence.errors.push(String(error).slice(0, 300)));
  // Load unthrottled (a throttled first paint of a board this size never
  // settles inside a sensible timeout), then slow the renderer the way the
  // operator's larger estate does. Everything the click does from here on runs
  // against the throttled commit budget.
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(6000);
  await client.send("Emulation.setCPUThrottlingRate", { rate });
  await sleep(2500);
}

async function read(label) {
  const state = await page.evaluate(READ_STATE);
  state.label = label;
  return state;
}

/** The Nth board card's click point, scrolled into view and hit-tested. */
async function cardPoint(index) {
  return page.evaluate((i) => {
    const cards = [...document.querySelectorAll("[data-thread-card]")].filter(
      (el) => el.parentElement?.closest("[data-thread-card]") === null,
    );
    const card = cards[i];
    if (card === undefined) return null;
    const anchor = card.querySelector("a");
    if (anchor === null) return null;
    anchor.scrollIntoView({ block: "center", inline: "center" });
    const r = anchor.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    return { threadId: card.getAttribute("data-thread-card"), x, y };
  }, index);
}

async function clickCard(index, settleMs) {
  const point = await cardPoint(index);
  if (point === null) throw new Error(`no card ${index}`);
  await page.mouse.move(point.x, point.y);
  await sleep(400);
  await page.mouse.click(point.x, point.y);
  await sleep(settleMs);
  return point;
}

/** Sample the window for `ms` at `step` intervals, keeping every sample. */
async function sample(label, { ms, step }) {
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < ms) {
    samples.push(await read(label));
    await sleep(step);
  }
  return samples;
}

/** The reported state inside a sample list: a native pane holds the clicked
 *  thread while the board's own in-panel pane is mounted. */
function bothSurfaces(samples, threadId) {
  return samples.find(
    (sample) =>
      sample.inBoardPane !== null &&
      sample.panes.some((pane) => pane.threadId === threadId && pane.paneId !== "pane-1"),
  );
}

for (const rate of CPU_RATES) {
  currentPhase = `rate-${rate}`;
  await startPhase(rate);
  const phase = (evidence.phases[currentPhase] = { rate });
  phase.board = await read("1-board");
  // The first click opens a native pane and adopts it.
  phase.firstCard = await clickCard(0, 4000);
  phase.firstClick = await read("2-first-click");
  // The second click is the replacement the report is about: the pane already
  // holds a thread, the card click replaces it.
  const secondPoint = await cardPoint(1);
  phase.secondCard = secondPoint;
  await page.mouse.move(secondPoint.x, secondPoint.y);
  await sleep(400);
  await page.mouse.click(secondPoint.x, secondPoint.y);
  // The window's own timeline: 3s at 100ms covers the 400ms net with room for
  // the host's commit on a throttled renderer.
  phase.samples = await sample("3-replacement", { ms: 3000, step: 100 });
  const both = bothSurfaces(phase.samples, secondPoint.threadId);
  phase.clickedThread = secondPoint.threadId;
  phase.bothSurfaces = both === undefined ? null : both;
  phase.inBoardPaneSamples = phase.samples.filter((sample) => sample.inBoardPane !== null).length;
  phase.paneThreadSamples = phase.samples.filter((sample) =>
    sample.panes.some((pane) => pane.threadId === secondPoint.threadId && pane.paneId !== "pane-1"),
  ).length;
  await page.screenshot({ path: `${OUT_DIR}/${currentPhase}-4-after.png` });
  phase.final = await read("4-final");
}

if (context !== null) await context.close();

writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));

const summarize = (state) =>
  state === undefined
    ? null
    : {
        route: state.route,
        paneCount: state.paneCount,
        focusedPaneId: state.focusedPaneId,
        panes: state.panes.map(
          (pane) => `${pane.paneId}:${pane.threadId ?? "page"}${pane.focused ? ":F" : ""}`,
        ),
        inBoardPane: state.inBoardPane,
        record: state.record,
      };

for (const [name, phase] of Object.entries(evidence.phases)) {
  console.log(`=== ${name} (cpu throttle ${phase.rate}x) ===`);
  console.log(
    JSON.stringify(
      {
        board: summarize(phase.board),
        firstClick: summarize(phase.firstClick),
        secondCard: phase.secondCard,
        clickedThread: phase.clickedThread,
        samplesWithInPanelPane: phase.inBoardPaneSamples,
        samplesWithNativePaneOnClickedThread: phase.paneThreadSamples,
        bothSurfaces: phase.bothSurfaces === null ? null : summarize(phase.bothSurfaces),
        final: summarize(phase.final),
      },
      null,
      2,
    ),
  );
}
console.log("=== trace ===");
console.log(JSON.stringify(evidence.trace.map((entry) => entry.payloads), null, 2));
console.log("=== errors ===", evidence.errors);

await browser.close();
process.exit(0);
