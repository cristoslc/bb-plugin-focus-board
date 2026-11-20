// Does the board keep the card the operator clicked in view when the click
// opens a native thread pane beside it?
//
// The operator's report, 2026-11-20: "keeping the focused card in view (by
// scrolling) isn't fully working in conjunction with the pane split".
//
// The shape this probe stages: the board is panned so the card sits near its
// right edge (a real gesture — the operator scrolled to reach that lane), the
// card is clicked, and the host inserts a thread pane beside the board. The
// pane halves the board's width, so the card that was visible at the right
// edge can fall outside the new visible range. The board is expected to bring
// it back.
//
// It records one sample per animation frame across the gesture: the board
// container's width and scroll offset, the lane list's offset, the card's
// rect, whether it is inside the board's visible range, how many panes exist,
// and the split layout. It writes before/after shots plus evidence.json, and
// exits non-zero while the card is left outside the board's visible range.
//
// Usage: node scripts/screenshot/probe-pane-split-recenter.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, CARD, VIEWPORT, SERVE_BUNDLE.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT = process.env.OUT_DIR ?? "docs/screenshots/probe-pane-split-recenter";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SERVE_BUNDLE = process.env.SERVE_BUNDLE ?? null;
const [width, height] = (process.env.VIEWPORT ?? "1600x1200").split("x").map(Number);

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${width},${height}`, "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width, height },
});

/** A marker only the board's own bundle carries, used to identify it. */
const BUNDLE_MARKER = "data-focus-board-panel";

async function findBoardBundle() {
  const sniff = await browser.newPage();
  await sniff.setCacheEnabled(false);
  const bodies = [];
  sniff.on("response", (response) => {
    const url = response.url();
    if (!/\/plugin-app-assets\/[a-f0-9]+\/app\.js$/.test(url)) return;
    bodies.push(
      response.text().then((body) => ({ url, hasBoard: body.includes(BUNDLE_MARKER) })),
    );
  });
  await sniff.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1500);
  const found = (await Promise.all(bodies)).find((entry) => entry.hasBoard) ?? null;
  await sniff.close();
  return found;
}

const bundle = SERVE_BUNDLE === null ? null : await findBoardBundle();
if (SERVE_BUNDLE !== null) {
  if (bundle === null || bundle.url === null) {
    console.error("Could not identify the board's app.js among the served plugin assets.");
    await browser.close();
    process.exit(1);
  }
  console.log(`serving ${SERVE_BUNDLE} for ${bundle.url}`);
}

const page = await browser.newPage();
if (SERVE_BUNDLE !== null && bundle !== null && bundle.url !== null) {
  const swapped = `${readFileSync(SERVE_BUNDLE, "utf8")}\n;window.__fbServedBundle = "swapped";\n`;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url() !== bundle.url) {
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
page.on("console", (message) => {
  const text = message.text();
  if (/\[focus-board\]/.test(text)) console.log(`console[${message.type()}]: ${text}`);
});
await page.setCacheEnabled(false);
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("[data-focus-board-panel]", { timeout: 30000 });
await page.waitForSelector("[data-columns-board]", { timeout: 30000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30000 });
await sleep(2000);

/** Pick a card that needs a positive horizontal pan to reach, and pan the
 *  board so the card sits just inside the right edge. Returns the click
 *  target and the chosen card. */
const staged = await page.evaluate((wanted) => {
  const board = document.querySelector("[data-columns-board]");
  if (board === null) return { problem: "no board" };
  board.scrollLeft = 0;
  const cards = [...document.querySelectorAll("[data-thread-card]")]
    .map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        card,
        id: card.getAttribute("data-thread-card"),
        left: rect.left + board.scrollLeft,
        right: rect.right + board.scrollLeft,
        top: rect.top,
        height: rect.height,
      };
    })
    .filter((entry) => entry.id !== null && entry.height > 0);
  if (cards.length === 0) return { problem: "no cards" };
  const preferred = wanted === null ? null : cards.find((entry) => entry.id === wanted);
  // The far-right quarter of the content: a lane the operator had to pan to.
  const contentRight = Math.max(...cards.map((entry) => entry.right));
  const target =
    preferred ??
    cards
      .filter((entry) => entry.right > contentRight - 320 && entry.top < window.innerHeight - 120)
      .sort((a, b) => b.right - a.right)[0] ??
    cards[cards.length - 1];
  // Put the card 24px inside the right edge: the state a scrolled board is in
  // when the operator reaches for a lane at the far end of the row.
  const boardWidth = board.getBoundingClientRect().width;
  board.scrollLeft = Math.max(0, Math.round(target.right - boardWidth + 24));
  // Mark the exact element: a done or family thread can paint a second card
  // for the same id in another lane, and the projection is not the one the
  // pointer is over.
  target.card.setAttribute("data-probe-target", "");
  const rect = target.card.getBoundingClientRect();
  const lane = target.card.closest("section[data-column-id]");
  return {
    card: target.id,
    lane: lane === null ? null : lane.getAttribute("data-column-id"),
    contentRight: Math.round(contentRight),
    boardWidth: Math.round(boardWidth),
    scrollLeft: Math.round(board.scrollLeft),
    targetRect: {
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    },
  };
}, process.env.CARD ?? null);
if (staged.problem !== undefined) {
  console.error(`Cannot stage the gesture: ${staged.problem}`);
  await browser.close();
  process.exit(1);
}
console.log(`staged: ${JSON.stringify(staged)}`);
await sleep(300);

const START_SAMPLER = (cardId, laneId) => {
  const samples = [];
  let stop = false;
  // Identity markers: a re-mount replaces these nodes, and an expando set on
  // the old node cannot follow the new one.
  const panel = document.querySelector("[data-focus-board-panel]");
  if (panel !== null) panel.__probePanel = 1;
  const boardNode = document.querySelector("[data-columns-board]");
  if (boardNode !== null) boardNode.__probeBoard = 1;
  globalThis.__splitSamples = samples;
  globalThis.__stopSplitSampler = () => {
    stop = true;
  };
  const findCard = () => {
    const marked = document.querySelector("[data-probe-target]");
    if (marked !== null) return marked;
    const all = [
      ...document.querySelectorAll(`[data-thread-card="${CSS.escape(cardId)}"]`),
    ].filter((entry) => entry.closest("[data-transport-ghost]") === null);
    const inLane = all.find(
      (entry) => entry.closest("section[data-column-id]")?.getAttribute("data-column-id") === laneId,
    );
    return inLane ?? all[0] ?? null;
  };
  const read = (label) => {
    const board = document.querySelector("[data-columns-board]");
    const anchor = findCard();
    const lane = anchor?.closest("section[data-column-id]") ?? null;
    const list = anchor?.closest("[data-card-list]") ?? null;
    const b = board?.getBoundingClientRect() ?? null;
    const c = anchor?.getBoundingClientRect() ?? null;
    const panes = [...document.querySelectorAll("[data-split-pane-id]")];
    const boardPane = board === null ? null : board.closest("[data-split-pane-id]");
    return {
      label,
      t: Math.round(performance.now()),
      lane: lane?.getAttribute("data-column-id") ?? null,
      paneCount: panes.length,
      boardPaneId: boardPane?.getAttribute("data-split-pane-id") ?? null,
      inBoardPaneDom: board !== null && document.contains(board),
      boardWidth: b ? Math.round(b.width) : null,
      boardLeft: b ? Math.round(b.left) : null,
      boardRight: b ? Math.round(b.right) : null,
      boardX: board ? Math.round(board.scrollLeft) : null,
      boardY: board ? Math.round(board.scrollTop) : null,
      listX: list ? Math.round(list.scrollLeft) : null,
      listY: list ? Math.round(list.scrollTop) : null,
      cardLeft: c ? Math.round(c.left) : null,
      cardRight: c ? Math.round(c.right) : null,
      inView: b && c ? c.left >= b.left - 1 && c.right <= b.right + 1 : null,
      splitLayoutPresent: localStorage.getItem("bb.splitLayout") !== null,
      panelSameNode: board?.closest("[data-focus-board-panel]")?.__probePanel === 1,
      boardSameNode: board?.__probeBoard === 1,
      ghost: anchor ? anchor.closest("[data-transport-ghost]") !== null : null,
    };
  };
  samples.push(read("pre-click"));
  const tick = () => {
    if (stop) return;
    samples.push(read("frame"));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

await page.evaluate(START_SAMPLER, staged.card, staged.lane);

// The click target: the card's own link, at its centre, in its own coordinates
// now that the pan settled.
const target = await page.evaluate(() => {
  const card = document.querySelector("[data-probe-target]");
  const link = card === null ? null : card.matches("a[href]") ? card : card.querySelector("a[href]");
  if (link === null) return null;
  const rect = link.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
});
if (target === null) {
  console.error("The staged card has no clickable link.");
  await browser.close();
  process.exit(1);
}

await page.screenshot({ path: `${OUT}/before.png` });
await page.mouse.click(target.x, target.y);
await sleep(500);
await page.screenshot({ path: `${OUT}/after-500ms.png` });
await sleep(3000);
await page.screenshot({ path: `${OUT}/after.png` });

const samples = await page.evaluate(() => {
  globalThis.__stopSplitSampler();
  return globalThis.__splitSamples;
});

const first = samples[0];
const last = samples[samples.length - 1];
const paneArrivals = samples.findIndex((s) => s.paneCount === 2);
const evidence = {
  checkedAt: new Date().toISOString(),
  app: APP,
  bundle: SERVE_BUNDLE === null ? { servedByHost: "installed" } : { replacedWith: SERVE_BUNDLE },
  viewport: { width, height },
  staged,
  firstFrame: first,
  firstPaneFrame: paneArrivals === -1 ? null : samples[paneArrivals],
  lastFrame: last,
  frames: samples.length,
  sawPane: samples.some((s) => s.paneCount === 2),
  // The host re-creates the panel on the split: the board's own node (and its
  // panel root) is replaced, which is the reason the width observer never sees
  // the resize (it is created after this new board paints).
  sawRemount: samples.some((s) => s.panelSameNode === false),
  transitions: samples.filter((s, index) => {
    if (index === 0) return true;
    const previous = samples[index - 1];
    return (
      s.paneCount !== previous.paneCount ||
      s.boardX !== previous.boardX ||
      s.boardWidth !== previous.boardWidth ||
      s.inView !== previous.inView ||
      s.inBoardPaneDom !== previous.inBoardPaneDom
    );
  }),
  verdict: {
    cardInViewAtEnd: last.inView,
    paneOpened: samples.some((s) => s.paneCount === 2),
  },
};
writeFileSync(`${OUT}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`frames: ${samples.length}`);
console.log(`card ${staged.card}: in view before=${String(first.inView)} after=${String(last.inView)}`);
console.log(`pane opened: ${String(evidence.verdict.paneOpened)}; remount seen: ${String(evidence.sawRemount)}`);
console.log(`evidence: ${OUT}/evidence.json`);

await browser.close();
process.exit(evidence.verdict.cardInViewAtEnd === true ? 0 : 1);
