// Reproduction probe for the 2026-11-17 regression: "thread pane doesn't open
// on first click. Double-clicking switches to home, doesn't open as split."
//
// Unlike probe-native-pane-replace.mjs, this one drives the BOARD's own cards
// on the installed host, so the plugin's click path runs exactly as the
// operator's does. Every step reads the host's split layout, the app's route,
// whether the board is still mounted, and the plugin's own pane record.
//
// Steps (the operator's three):
//   1. fresh state (no record), one click on one card
//   2. a second card, one click
//   3. two clicks on the same card in quick succession
//
// Usage: node scripts/screenshot/probe-native-one-click.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR. Each phase boots its own browser
// context (no storage, no persisted layout). Evidence lands in OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-native-one-click";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const board = document.querySelector('[data-focus-board-panel]');
  let record = null;
  try {
    record = localStorage.getItem('focus-board:boardNativeThreadPane');
  } catch {}
  return {
    route: location.pathname + location.search + location.hash,
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId: pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      panelPath: pane.content && pane.content.kind === 'plugin-panel' ? pane.content.panelPath : null,
      subPath: pane.content && pane.content.kind === 'plugin-panel' ? pane.content.subPath : null,
    })),
    boardMounted: board !== null,
    pluginRecord: record,
  };
})();`;

/** The board's own cards, as clickable anchors, in DOM order. */
const LIST_CARDS = `(function () {
  const cards = [...document.querySelectorAll('[data-thread-card]')]
    .filter((el) => el.parentElement?.closest('[data-thread-card]') === null)
    .map((el) => {
      const anchor = el.querySelector('a');
      if (anchor === null) return null;
      const r = anchor.getBoundingClientRect();
      return {
        threadId: el.getAttribute('data-thread-card'),
        title: (el.querySelector('p')?.textContent ?? '').trim().slice(0, 50),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        visible: r.width > 0 && r.height > 0,
      };
    })
    .filter((card) => card !== null && card.visible);
  return cards;
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
let page = null;
let context = null;
const consoleErrors = [];

async function startPhase() {
  if (context !== null) await context.close();
  consoleErrors.length = 0;
  context = await browser.createBrowserContext();
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 300)));
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);
}

async function read(label) {
  const state = await page.evaluate(READ_STATE);
  state.consoleErrors = [...consoleErrors];
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify(state, null, 2));
  await page.screenshot({ path: `${OUT_DIR}/${label}.png` });
  return state;
}

async function listCards() {
  return page.evaluate(LIST_CARDS);
}

/** Scroll the board so card `index` is on screen, then click its anchor. */
async function clickCard(index, { double = false } = {}) {
  const cards = await listCards();
  const card = cards[index];
  if (card === undefined) throw new Error(`no card at index ${index} (${cards.length} cards)`);
  await page.evaluate((threadId) => {
    const el = document.querySelector(`[data-thread-card="${threadId}"] a`);
    if (el !== null) el.scrollIntoView({ block: "center", inline: "center" });
  }, card.threadId);
  await sleep(500);
  const point = await page.evaluate((threadId) => {
    const el = document.querySelector(`[data-thread-card="${threadId}"] a`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, card.threadId);
  if (point === null) throw new Error(`card ${card.threadId} vanished`);
  if (double) {
    await page.mouse.click(point.x, point.y, { clickCount: 2, delay: 60 });
  } else {
    await page.mouse.click(point.x, point.y);
  }
  await sleep(2500);
  return card;
}

await startPhase();

const evidence = { fresh: {}, recorded: {} };

// 1. Fresh state: no recorded pane, one click on one card.
evidence.fresh.before = await read("fresh-1-board");
const cards = await listCards();
console.log("=== cards ===", cards.slice(0, 4));
evidence.fresh.cards = cards.slice(0, 4);
evidence.fresh.firstClick = await clickCard(0);
evidence.fresh.afterFirstClick = await read("fresh-2-after-first-click");

// 2. A second card, one click.
evidence.fresh.secondClick = await clickCard(1);
evidence.fresh.afterSecondClick = await read("fresh-3-after-second-click");

// 3. Two clicks in quick succession on the same card.
evidence.fresh.doubleClickCard = await clickCard(1, { double: true });
evidence.fresh.afterDoubleClick = await read("fresh-4-after-double-click");

await startPhase();

// The same three steps in a window that already carries a record: click, then
// click again (the record exists now), then a double click.
evidence.recorded.before = await read("recorded-1-board");
await clickCard(0);
evidence.recorded.afterFirstClick = await read("recorded-2-after-first-click");
await clickCard(1);
evidence.recorded.afterSecondClick = await read("recorded-3-after-second-click");
await clickCard(1, { double: true });
evidence.recorded.afterDoubleClick = await read("recorded-4-after-double-click");

const threadPanes = (state) =>
  state.panes.filter((pane) => pane.threadId !== null).map((pane) => pane.threadId);

const verdict = {
  freshFirstClickOpenedAPane: threadPanes(evidence.fresh.afterFirstClick).length === 1,
  freshThreadPanes: threadPanes(evidence.fresh.afterFirstClick),
  freshRouteAfterFirstClick: evidence.fresh.afterFirstClick.route,
  freshBoardMountedAfterFirstClick: evidence.fresh.afterFirstClick.boardMounted,
  secondClickThreadPanes: threadPanes(evidence.fresh.afterSecondClick),
  secondClickPaneCount: evidence.fresh.afterSecondClick.paneCount,
  doubleClickThreadPanes: threadPanes(evidence.fresh.afterDoubleClick),
  doubleClickRoute: evidence.fresh.afterDoubleClick.route,
  doubleClickBoardMounted: evidence.fresh.afterDoubleClick.boardMounted,
  doubleClickPaneCount: evidence.fresh.afterDoubleClick.paneCount,
  recordedFirstClickThreadPanes: threadPanes(evidence.recorded.afterFirstClick),
  recordedSecondClickThreadPanes: threadPanes(evidence.recorded.afterSecondClick),
  recordedDoubleClickThreadPanes: threadPanes(evidence.recorded.afterDoubleClick),
  recordedDoubleClickRoute: evidence.recorded.afterDoubleClick.route,
};
console.log("=== verdict ===");
console.log(JSON.stringify(verdict, null, 2));
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify({ evidence, verdict }, null, 2));

await browser.close();
process.exit(0);
