// Runtime probe for the 2026-11-17 native-thread-pane feasibility study
// (docs/plans/2026-11-17-native-thread-pane.md): can bb's own native thread
// pane open beside the Focus Board panel, and does the board survive it?
//
// The plugin's own pane (components/thread-pane.tsx) embeds a ThreadChat
// inside the board panel. The native thread pane is bb's real thread page
// rendered in a split-layout pane. bb's own sidebar thread action "Open in
// split" runs the same placement rules a plugin reaches through
// `experimental_useSidebarThreadActions().open(threadId, { split: true })`
// and the installed 0.49.0 build's `useBbNavigate().toThread(id,
// { split: true })` (index-UJHlXnMg.js: the toThread implementation reads
// options.split and runs jQ), so driving the sidebar action from the board
// route measures exactly what a board card click would do under the
// native-pane design.
//
// The sidebar thread list is grouped by project and virtualized, so the
// probe scrolls the sidebar's scroller to find THREAD_ID's row, then
// right-clicks it (bb's native row context menu) and clicks "Open in split".
//
// Reads only, apart from navigation itself: no renames, no archive, no
// writes. The split layout persists to the probe browser's own profile
// (localStorage bb.splitLayout), never the operator's app profile.
//
// Usage: node scripts/screenshot/probe-native-split-pane.mjs
// Honors BB_APP, CHROME_PATH, THREAD_ID (a thread visible in the sidebar),
// OUT_DIR. Evidence (JSON + screenshots) lands in OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const THREAD_ID = process.env.THREAD_ID ?? "";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-native-split-pane";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

if (!THREAD_ID) {
  console.error("Set THREAD_ID to a thread visible in the sidebar.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The sidebar's scrolling container (left of the split area, tall). */
const SIDEBAR_SCROLLER = `(() => {
  return [...document.querySelectorAll('div,section,nav')].find((e) => {
    const r = e.getBoundingClientRect();
    return (
      r.width > 50 && r.x < 300 && r.y < 60 &&
      (e.scrollHeight ?? 0) > e.clientHeight + 50
    );
  });
})()`;

const READ_STATE = `(function () {
  const board = document.querySelector('[data-focus-board-panel]');
  const boardBox = board === null ? null : board.getBoundingClientRect();
  // bb's split panes carry data-split-pane-id (index-UJHlXnMg.js xP).
  const panes = [...document.querySelectorAll('[data-split-pane-id]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.getAttribute('data-split-pane-id'),
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      hasBoard: el.contains(document.querySelector('[data-focus-board-panel]')),
      // The native thread page's own header signature: its actions row.
      threadHeaderActions: el.querySelector('header') !== null,
      sample: (el.className || '').slice(0, 50),
    };
  });
  return {
    url: location.href,
    boardVisible: board !== null,
    boardBox: boardBox === null ? null : {
      x: Math.round(boardBox.x), y: Math.round(boardBox.y),
      w: Math.round(boardBox.width), h: Math.round(boardBox.height),
    },
    panes,
    splitLayout: localStorage.getItem('bb.splitLayout'),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(5000);

const stateA = await page.evaluate(READ_STATE);
await page.screenshot({ path: `${OUT_DIR}/01-board.png` });
console.log("=== state A: board route ===");
console.log(JSON.stringify(stateA, null, 2));

// Scroll the sidebar until THREAD_ID's row mounts, then bring it to center.
let row = null;
for (let i = 0; i < 80 && row === null; i += 1) {
  row = await page.evaluate((id, scrollerExpr) => {
    const a = [...document.querySelectorAll('a[href*="/threads/"]')].find((x) =>
      (x.getAttribute("href") || "").includes(id) &&
      x.getBoundingClientRect().x < 320,
    );
    if (a === undefined || a === null) {
      // eslint-disable-next-line no-eval
      const scroller = eval(scrollerExpr);
      if (scroller !== null && scroller !== undefined) scroller.scrollTop += 300;
      return null;
    }
    a.scrollIntoView({ block: "center" });
    const r = a.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, href: a.getAttribute("href") };
  }, THREAD_ID, SIDEBAR_SCROLLER);
  if (row === null) await sleep(250);
}
if (row === null) {
  console.error("Sidebar row not found for", THREAD_ID);
  await browser.close();
  process.exit(1);
}
console.log("=== sidebar row ===");
console.log(JSON.stringify(row));

await sleep(600);
await page.mouse.move(row.x, row.y);
await sleep(600);
await page.mouse.click(row.x, row.y, { button: "right" });
await sleep(1000);

const menuItems = await page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitem"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      label: (el.textContent || "").trim().slice(0, 60),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      visible: r.width > 0,
    };
  }),
);
console.log("=== sidebar row context menu ===");
console.log(JSON.stringify(menuItems.filter((m) => m.visible), null, 2));
await page.screenshot({ path: `${OUT_DIR}/02-sidebar-context-menu.png` });

const splitItem = menuItems.find((m) => m.visible && /open in split/i.test(m.label));
if (splitItem === undefined) {
  console.error("No Open-in-split entry in the sidebar row menu.");
  await browser.close();
  process.exit(1);
}
await page.mouse.click(splitItem.x, splitItem.y);
await sleep(5000);

const stateB = await page.evaluate(READ_STATE);
await page.screenshot({ path: `${OUT_DIR}/03-after-split.png` });
console.log("=== state B: after Open in split ===");
console.log(JSON.stringify(stateB, null, 2));

// Plain open (no split): click the row itself, the useBbNavigate().toThread
// path the board's maximize action uses today.
await page.mouse.click(row.x, row.y);
await sleep(4000);
const stateC = await page.evaluate(READ_STATE);
await page.screenshot({ path: `${OUT_DIR}/04-after-plain-open.png` });
console.log("=== state C: after plain row open (toThread, no split) ===");
console.log(JSON.stringify(stateC, null, 2));

const verdict = {
  boardVisibleAfterSplit: stateB.boardVisible,
  boardVisibleAfterPlainOpen: stateC.boardVisible,
  paneCountAfterSplit: stateB.panes.length,
  boardAndNativePaneCoexist:
    stateB.boardVisible &&
    stateB.panes.some((p) => p.hasBoard) &&
    stateB.panes.some((p) => !p.hasBoard),
  plainOpenReplacedBoard: stateC.boardVisible === false,
};
console.log("=== verdict ===");
console.log(JSON.stringify(verdict, null, 2));
writeFileSync(
  `${OUT_DIR}/evidence.json`,
  JSON.stringify({ threadId: THREAD_ID, stateA, stateB, stateC, verdict }, null, 2),
);

await browser.close();
process.exit(0);
