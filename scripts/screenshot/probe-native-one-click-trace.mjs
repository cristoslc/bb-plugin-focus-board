// Instrumented second pass on the 2026-11-17 one-pane regression: one card
// click, sampled every 100ms, so the pane record, the pane count and the route
// are read as they change rather than after everything settled. A DOM marker
// on the board tells whether the board's element survived the click or the
// host remounted the plugin panel subtree (which would drop the click's
// in-flight state).
//
// Usage: node scripts/screenshot/probe-native-one-click-trace.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-native-one-click";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SAMPLE = `(function () {
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
  const board = document.querySelector('[data-focus-board-panel]');
  let record = null;
  try { record = localStorage.getItem('focus-board:boardNativeThreadPane'); } catch {}
  return {
    t: Math.round(performance.now()),
    route: location.pathname,
    paneCount: panes.length,
    focused: layout === null ? null : layout.focusedPaneId,
    threads: panes.filter((p) => p.content && p.content.kind === 'thread').map((p) => p.content.threadId + '@' + p.paneId),
    boardMounted: board !== null,
    markerSurvived: board !== null && board.getAttribute('data-probe-marker') === window.__probeMarker,
    record,
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(5000);

const marker = `m${Date.now()}`;
await page.evaluate((value) => {
  window.__probeMarker = value;
  const board = document.querySelector('[data-focus-board-panel]');
  if (board !== null) board.setAttribute('data-probe-marker', value);
}, marker);

async function sample(label) {
  const s = await page.evaluate(SAMPLE);
  s.label = label;
  return s;
}

async function cardPoint(index) {
  return page.evaluate((i) => {
    const cards = [...document.querySelectorAll('[data-thread-card]')]
      .filter((el) => el.parentElement?.closest('[data-thread-card]') === null);
    const card = cards[i];
    if (card === undefined) return null;
    const anchor = card.querySelector('a');
    if (anchor === null) return null;
    anchor.scrollIntoView({ block: 'center', inline: 'center' });
    const r = anchor.getBoundingClientRect();
    return { threadId: card.getAttribute('data-thread-card'), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, index);
}

const trace = [];
async function clickAndTrace(index, label, { double = false } = {}) {
  const point = await cardPoint(index);
  if (point === null) throw new Error(`no card ${index}`);
  await sleep(400);
  const before = await sample(`${label}:before`);
  trace.push({ ...before, thread: point.threadId });
  if (double) {
    await page.mouse.click(point.x, point.y, { clickCount: 2, delay: 60 });
  } else {
    await page.mouse.click(point.x, point.y);
  }
  for (let i = 0; i < 30; i += 1) {
    await sleep(100);
    trace.push({ ...(await sample(`${label}:+${(i + 1) * 100}ms`)), thread: point.threadId });
  }
  await page.screenshot({ path: `${OUT_DIR}/trace-${label}.png` });
  return point;
}

console.log("=== click 1 (fresh) ===");
const first = await clickAndTrace(0, "1-first");
console.log(JSON.stringify(trace.filter((s) => s.label.startsWith("1-first")), null, 2));

const base = trace.length;
console.log("=== click 2 (a different card) ===");
const second = await clickAndTrace(1, "2-second");
console.log(JSON.stringify(trace.slice(base), null, 2));

const base2 = trace.length;
console.log("=== click 3 (a third card, with a record now) ===");
await clickAndTrace(2, "3-replace");
console.log(JSON.stringify(trace.slice(base2), null, 2));

const base3 = trace.length;
console.log("=== double click on a fourth card ===");
await clickAndTrace(3, "4-double", { double: true });
console.log(JSON.stringify(trace.slice(base3), null, 2));

writeFileSync(
  `${OUT_DIR}/trace.json`,
  JSON.stringify({ first, second, trace, errors }, null, 2),
);
console.log("=== errors ===", errors);
await browser.close();
process.exit(0);
