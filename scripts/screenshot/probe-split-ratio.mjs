// Where a card click's split ratio comes from, on the installed host.
//
// The operator's ask: "the focus board split for thread pane should be more
// like 2:1, not 1:1." This probe measures, in a throwaway browser profile
// against the LIVE bb app (never the operator's window):
//
//   1. the `bb.splitLayout` atom before the split (absent: one pane),
//   2. the sizes the host writes at INSERT time, per pane as a fraction of
//      the split area and as a rendered width,
//   3. what the operator's own drag writes (board grown to ~2/3) and whether
//      a reload keeps it,
//   4. what the NEXT split uses after the thread pane closes, which is the
//      question the ask turns on: a one-time drag persists only while the
//      two panes stay open, or it becomes the default from then on.
//
// Read-only apart from the gestures a user makes: a card click, a divider
// drag, a pane close, and reloads. Artifacts land in
// docs/screenshots/probe-split-ratio/.
//
// Usage: node scripts/screenshot/probe-split-ratio.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, THREAD_INDEX, VIEWPORT.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-split-ratio";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: Number(process.env.WIDTH ?? 1600), height: 1200 };
const THREAD_INDEX = Number(process.env.THREAD_INDEX ?? 0);

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The persisted atom, every pane's share of the split area, and the rendered
 *  widths. Pure read: never writes. */
const READ_STATE = `(function () {
  let raw = null;
  try { raw = localStorage.getItem('bb.splitLayout'); } catch {}
  let layout = null;
  if (raw !== null && raw !== '') {
    try {
      const parsed = JSON.parse(raw);
      layout = parsed && parsed.layout ? parsed.layout : parsed;
    } catch {}
  }
  // Every leaf pane with its effective fraction: the product of the split
  // sizes along the path from the root.
  const leaves = [];
  const walk = (node, share, path) => {
    if (node === null || node === undefined) return;
    if (node.type === 'pane') {
      leaves.push({ paneId: node.paneId, share: share, path: path, content: node.content && node.content.kind });
      return;
    }
    const sizes = node.sizes ?? [];
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    (node.children ?? []).forEach((child, i) => {
      const s = (sizes[i] ?? 1 / (node.children.length)) / total;
      walk(child, share * s, path.concat(i));
    });
  };
  if (layout !== null) walk(layout.root, 1, []);
  const widths = {};
  for (const el of document.querySelectorAll('[data-split-pane-id]')) {
    const r = el.getBoundingClientRect();
    widths[el.getAttribute('data-split-pane-id')] = Math.round(r.width);
  }
  const board = document.querySelector('[data-focus-board-panel]');
  return {
    route: location.pathname,
    raw: raw,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    leaves: leaves.map((leaf) => ({ ...leaf, width: widths[leaf.paneId] ?? null })),
    renderedWidths: widths,
    boardMounted: board !== null,
    cardCount: document.querySelectorAll('[data-thread-card]').length,
    compactViewport: window.matchMedia('(max-width: 767px)').matches,
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`, "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: VIEWPORT,
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

const evidence = { app: APP, viewport: VIEWPORT, steps: [], errors };

async function record(name, extra = {}) {
  const state = await page.evaluate(READ_STATE);
  const row = { name, ...state, ...extra };
  evidence.steps.push(row);
  console.log(
    `=== ${name} ===`,
    JSON.stringify({
      route: row.route,
      focused: row.focusedPaneId,
      panes: row.leaves.map((l) => `${l.paneId}:${l.content}:${l.share.toFixed(4)}:${l.width}px`),
      cardCount: row.cardCount,
      ...extra,
    }),
  );
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  return row;
}

/** A board card's centre, in the pane that holds the board. */
async function cardPoint() {
  return page.evaluate((index) => {
    const cards = [...document.querySelectorAll("[data-thread-card]")];
    const el = cards[index] ?? cards[0];
    if (el === undefined) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: Math.round(r.x + Math.min(r.width / 2, 120)), y: Math.round(r.y + r.height / 2), count: cards.length };
  }, THREAD_INDEX);
}

/** Drag bb's split gutter between the two panes by dx px (positive moves the
 *  gutter right, so the left pane grows). */
async function dragGutter(dx) {
  const g = await page.evaluate(() => {
    const els = [...document.querySelectorAll("[data-split-pane-id]")];
    if (els.length < 2) return null;
    const a = els[0].getBoundingClientRect();
    const b = els[1].getBoundingClientRect();
    return { x: (a.right + b.left) / 2, y: a.y + a.height / 2 };
  });
  if (g === null) return null;
  await page.mouse.move(g.x, g.y);
  await sleep(150);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(g.x + (dx * i) / 8, g.y);
    await sleep(60);
  }
  await page.mouse.up();
  await sleep(900);
  return page.evaluate(READ_STATE);
}

/** The focused pane's own close control, as the host draws it. */
const CLOSE_CANDIDATES = `(function () {
  const panes = [...document.querySelectorAll('[data-split-pane-id]')];
  const pane = panes[panes.length - 1];
  if (pane === undefined) return { found: false, buttons: [] };
  const buttons = [...pane.querySelectorAll('button,[role="button"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      label: (el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim()).slice(0, 60),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      visible: r.width > 0 && r.height > 0,
    };
  });
  return { found: true, buttons };
})()`;

async function closeThreadPane() {
  const probe = await page.evaluate(CLOSE_CANDIDATES);
  const entry = (probe.buttons ?? []).find(
    (b) => b.visible && /close|remove pane|hide pane/i.test(b.label),
  );
  if (entry === undefined) return { closed: false, candidates: probe.buttons };
  await page.mouse.click(entry.x, entry.y);
  await sleep(1800);
  return { closed: true, label: entry.label, candidates: probe.buttons };
}

// ---------------------------------------------------------------------------
// Step 1: the board alone. A fresh profile: no persisted layout at all.
// ---------------------------------------------------------------------------
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(4500);
await record("01-board-alone");

// ---------------------------------------------------------------------------
// Step 2: the card click, the split the ask is about.
// ---------------------------------------------------------------------------
const point = await cardPoint();
if (point === null) throw new Error("no board card to click");
const insert = await record("02-before-click");
await page.mouse.click(point.x, point.y);
await sleep(2500);
const afterSplit = await record("03-after-card-click");

// ---------------------------------------------------------------------------
// Step 3: the operator's drag, board to ~2/3 of the split area.
// ---------------------------------------------------------------------------
const total = Object.values(afterSplit.renderedWidths).reduce((a, b) => a + b, 0);
const boardNow = afterSplit.renderedWidths["pane-1"] ?? 0;
const target = Math.round(total * (2 / 3));
const dragged = await dragGutter(target - boardNow);
const afterDrag = await record("04-after-drag-2-to-1", { dragged: dragged?.leaves ?? null });

// ---------------------------------------------------------------------------
// Step 4: reload. Does the operator's ratio survive a boot?
// ---------------------------------------------------------------------------
await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
await sleep(5000);
const afterReload = await record("05-after-reload");

// ---------------------------------------------------------------------------
// Step 5: close the thread pane, then click a card again. What does the NEXT
// split insert?
// ---------------------------------------------------------------------------
const closed = await closeThreadPane();
await sleep(500);
const afterClose = await record("06-after-close-thread-pane", { close: closed });

const pointAgain = await cardPoint();
if (pointAgain !== null) {
  await page.mouse.click(pointAgain.x, pointAgain.y);
  await sleep(2500);
  await record("07-next-click-after-close");
}
evidence.summary = {
  insertShares: afterSplit.leaves.map((l) => ({ paneId: l.paneId, share: Number(l.share.toFixed(4)), width: l.width })),
  draggedShares: afterDrag.leaves.map((l) => ({ paneId: l.paneId, share: Number(l.share.toFixed(4)), width: l.width })),
  reloadShares: afterReload.leaves.map((l) => ({ paneId: l.paneId, share: Number(l.share.toFixed(4)), width: l.width })),
  closeOutcome: closed,
  afterCloseRaw: afterClose.raw,
  nextInsertShares: evidence.steps.at(-1).leaves.map((l) => ({ paneId: l.paneId, share: Number(l.share.toFixed(4)), width: l.width })),
};
evidence.errors = errors;
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log("=== summary ===", JSON.stringify(evidence.summary, null, 2));
console.log("=== errors ===", errors);
await browser.close();
process.exit(0);
