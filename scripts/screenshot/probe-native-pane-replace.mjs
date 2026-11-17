// Runtime probe for the board's one-pane rule (2026-11-17): card clicks must
// replace the pane the board opened, not stack a new pane per click.
//
// The plugin's own click cannot be driven from outside the plugin, so the
// probe drives the HOST mechanism the rule is built on, on the installed bb
// (0.49.0), from bb's own UI:
//
//   before — bb's opener per click. Two "Open in split" clicks from the
//            sidebar are exactly what a board card click used to do
//            (`actions.open(threadId, { split: true })`), and they leave one
//            pane per click beside the board.
//   after  — the two navigations the board's replacement performs
//            (lib/native-pane-ownership.ts): with the BOARD pane focused,
//            open the thread the board's pane already shows (bb's route
//            reconciliation focuses that pane and changes nothing else), then
//            open the second thread (it is in no pane, so the focused pane
//            takes it). Two panes before and after, and the board never
//            leaves the layout.
//
// Reads only, apart from navigation itself: no renames, no archive, no
// writes. The split layout lives in the probe browser's own profile
// (localStorage bb.splitLayout), never the operator's app profile.
//
// Usage: node scripts/screenshot/probe-native-pane-replace.mjs
// Honors BB_APP, CHROME_PATH, THREAD_A, THREAD_B (two threads visible in the
// sidebar; discovered from the sidebar when unset), OUT_DIR. Evidence (JSON +
// screenshots) lands in OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-native-pane-replace";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

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

/** The host's own layout record plus the panes as rendered. */
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
  return {
    url: location.pathname,
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId: pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      holdsBoard: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        return el !== null && el.contains(board);
      })(),
    })),
    boardVisible: board !== null,
    boardBox: (() => {
      if (board === null) return null;
      const r = board.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
/** Repointed per phase: each phase boots in its own context, with no storage
 *  and no persisted split layout (bb rehydrates its panes from more than
 *  localStorage, so clearing the key in place is not enough). */
let page = null;
let context = null;

async function startPhase() {
  if (context !== null) await context.close();
  context = await browser.createBrowserContext();
  page = await context.newPage();
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(5000);
}

async function read(label) {
  const state = await page.evaluate(READ_STATE);
  console.log(`=== ${label} ===`);
  console.log(JSON.stringify(state, null, 2));
  await page.screenshot({ path: `${OUT_DIR}/${label}.png` });
  return state;
}

/** Find a sidebar row for `threadId`, scrolling the sidebar until it mounts. */
async function findRow(threadId) {
  let row = null;
  for (let i = 0; i < 80 && row === null; i += 1) {
    row = await page.evaluate((id, scrollerExpr) => {
      const anchor = [...document.querySelectorAll('a[href*="/threads/"]')].find(
        (candidate) =>
          (candidate.getAttribute("href") || "").includes(id) &&
          candidate.getBoundingClientRect().x < 320,
      );
      if (anchor === undefined || anchor === null) {
        const scroller = eval(scrollerExpr);
        if (scroller !== null && scroller !== undefined) scroller.scrollTop += 300;
        return null;
      }
      anchor.scrollIntoView({ block: "center" });
      const r = anchor.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, threadId, SIDEBAR_SCROLLER);
    if (row === null) await sleep(250);
  }
  if (row === null) throw new Error(`sidebar row not found for ${threadId}`);
  return row;
}

/** The first two distinct thread ids the sidebar lists. */
async function discoverThreads() {
  const ids = await page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll('a[href*="/threads/"]')]
          .map((anchor) => {
            const href = anchor.getAttribute("href") || "";
            const match = /\/threads\/(thr_[A-Za-z0-9]+)/.exec(href);
            return match === null ? null : match[1];
          })
          .filter((id) => id !== null),
      ),
    ],
  );
  return ids;
}

/** Open a thread in bb's own split, the opener a card click used to call. */
async function openInSplit(threadId) {
  const row = await findRow(threadId);
  await sleep(400);
  await page.mouse.move(row.x, row.y);
  await sleep(400);
  await page.mouse.click(row.x, row.y, { button: "right" });
  await sleep(800);
  const items = await page.evaluate(() =>
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
  const split = items.find((item) => item.visible && /open in split/i.test(item.label));
  if (split === undefined) throw new Error("no Open-in-split entry in the sidebar row menu");
  await page.mouse.click(split.x, split.y);
  await sleep(2500);
}

/** Plain row click: bb's route navigation, what the replacement's two steps use. */
async function openPlain(threadId) {
  const row = await findRow(threadId);
  await sleep(300);
  await page.mouse.click(row.x, row.y);
  await sleep(2500);
}

/**
 * Focus the board's own pane the way the replacement's first navigation does:
 * navigate to the route the pane holds. bb's reconciliation focuses the pane
 * that already shows the route's content and changes nothing else — the board
 * arrives in its own pane, on screen, with the layout untouched.
 */
async function focusBoardPane(boardPaneId) {
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3500);
  const focused = await page.evaluate(() => {
    const raw = localStorage.getItem("bb.splitLayout");
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    const layout = parsed && parsed.layout ? parsed.layout : parsed;
    return layout === null ? null : layout.focusedPaneId;
  });
  if (focused !== boardPaneId) {
    throw new Error(`route focus landed on ${focused}, not the board's ${boardPaneId}`);
  }
  return "board route";
}

async function resetToBoardOnly() {
  await startPhase();
}

await startPhase();

const discovered = await discoverThreads();
// Four distinct threads: a thread that is already open in a pane loses its
// "Open in split" entry, so each phase gets its own pair.
const BEFORE_A = process.env.THREAD_A ?? discovered[0];
const BEFORE_B = process.env.THREAD_B ?? discovered[1];
const AFTER_A = process.env.THREAD_C ?? discovered[2];
const AFTER_B = process.env.THREAD_D ?? discovered[3];
if (!BEFORE_A || !BEFORE_B || !AFTER_A || !AFTER_B) {
  console.error("Need four threads in the sidebar (or THREAD_A..THREAD_D).");
  await browser.close();
  process.exit(1);
}
console.log("=== threads ===", { BEFORE_A, BEFORE_B, AFTER_A, AFTER_B });

const before = {};
before.board = await read("before-1-board");
await openInSplit(BEFORE_A);
before.firstSplit = await read("before-2-first-card-click");
await openInSplit(BEFORE_B);
before.secondSplit = await read("before-3-second-card-click");

await resetToBoardOnly();

const after = {};
after.board = await read("after-1-board");
// A fresh context opens no panes, so the after pair can be re-discovered.
const afterThreads = await discoverThreads();
const afterA = process.env.THREAD_C ?? afterThreads[0] ?? AFTER_A;
const afterB = process.env.THREAD_D ?? afterThreads[1] ?? AFTER_B;
await openInSplit(afterA);
after.firstSplit = await read("after-2-first-card-click");
const boardPaneId = after.board.panes[0].paneId;
after.focusStep = await focusBoardPane(boardPaneId);
after.boardFocused = await read("after-3-board-pane-focused");
await openPlain(afterA);
after.refocusPane = await read("after-4-focus-pane-by-navigation");
await openPlain(afterB);
after.replaced = await read("after-5-replaced-pane");

const boardPaneSurvives = (state) =>
  state.boardVisible && state.panes.some((pane) => pane.holdsBoard);
const threadPanes = (state) =>
  state.panes.filter((pane) => pane.threadId !== null).map((pane) => pane.threadId);

const verdict = {
  // Today's click: one pane per click beside the board.
  beforePaneCounts: [
    before.board.paneCount,
    before.firstSplit.paneCount,
    before.secondSplit.paneCount,
  ],
  beforeThreadPanes: threadPanes(before.secondSplit),
  // The rule's click: the pane is replaced in place.
  afterFocusMovedOffBoard:
    after.boardFocused.focusedPaneId === boardPaneId,
  afterRefocusKeptBoard: boardPaneSurvives(after.refocusPane),
  afterPaneCounts: [
    after.board.paneCount,
    after.firstSplit.paneCount,
    after.replaced.paneCount,
  ],
  afterThreadPanes: threadPanes(after.replaced),
  afterReplacedThePaneBesideTheBoard:
    after.replaced.paneCount === after.firstSplit.paneCount &&
    threadPanes(after.replaced).length === 1 &&
    threadPanes(after.replaced)[0] === afterB,
  boardStillVisible: boardPaneSurvives(after.replaced),
  // The two-pane states (first split, board focused, pane re-focused by the
  // navigation, replaced) must leave the board exactly where it was: the
  // replacement moves no geometry and never maximises or collapses a pane.
  boardBoxStableAcrossTheReplacement:
    after.firstSplit.boardBox !== null &&
    after.replaced.boardBox !== null &&
    JSON.stringify(after.firstSplit.boardBox) === JSON.stringify(after.replaced.boardBox) &&
    JSON.stringify(after.boardFocused.boardBox) === JSON.stringify(after.firstSplit.boardBox),
  beforeThreads: { a: BEFORE_A, b: BEFORE_B },
  afterThreads: { a: afterA, b: afterB },
};
console.log("=== verdict ===");
console.log(JSON.stringify(verdict, null, 2));

writeFileSync(
  `${OUT_DIR}/evidence.json`,
  JSON.stringify({ before, after, verdict }, null, 2),
);

await browser.close();
process.exit(0);
