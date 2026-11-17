// Runtime probe for the native-pane move's two host-side risks
// (docs/plans/2026-11-17-native-thread-pane.md; the ruled slice 2 of
// dec_nhnljjo8rgbz): does an ALREADY-OPEN thread focus its pane instead of
// opening a duplicate, and does the pane cap (bb's 8-pane ceiling) leave the
// board stranded when it falls back?
//
// Everything here drives bb's own surface, not the plugin's: the sidebar
// row's native context menu → "Open in split" runs the same placement
// engine a board card click reaches through
// `experimental_useSidebarThreadActions().open(threadId, { split: true })`
// (apps/app/src/lib/plugin-sidebar-hooks.ts, the split branch's
// openThreadInSplit), so the probe measures the code path the click switch
// hands the host.
//
// The cap scenario is the dangerous one: bb's placement rule replaces the
// FOCUSED pane once the layout is at the ceiling, so the probe deliberately
// focuses the BOARD pane at the ceiling and opens one more thread — exactly
// the state a user reaches by clicking a card after filling the layout.
//
// Reads only. The split layout persists to the probe browser's own
// throwaway profile (localStorage bb.splitLayout), never the operator's app.
//
// Usage: node scripts/screenshot/probe-native-split-cap.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, CAP (default 8).
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-native-split-pane";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CAP = Number(process.env.CAP ?? 8);

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const panes = [...document.querySelectorAll('[data-split-pane-id]')].map((el) => {
    const r = el.getBoundingClientRect();
    const boardInside = el.contains(board);
    return {
      id: el.getAttribute('data-split-pane-id'),
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      hasBoard: boardInside,
      // The native thread page names itself in its own header/title.
      title: (el.querySelector('h1,h2')?.textContent || '').trim().slice(0, 70),
      threadHref: (() => {
        const a = [...el.querySelectorAll('a[href*="/threads/"]')]
          .map((x) => x.getAttribute('href') || '')
          .find((h) => h.indexOf('/threads/') > 0);
        return a ?? null;
      })(),
    };
  });
  let layout = null;
  try { layout = JSON.parse(localStorage.getItem('bb.splitLayout') || 'null'); } catch (e) { layout = null; }
  const boardPaneIds = layout === null ? [] : (() => {
    const out = [];
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return;
      if (node.type === 'pane') {
        if (node.content && node.content.kind === 'plugin-panel' && node.content.panelPath === 'board') {
          out.push(node.paneId);
        }
        return;
      }
      for (const child of node.children || []) walk(child);
    };
    walk(layout.layout?.root ?? null);
    return out;
  })();
  return {
    url: location.href,
    boardVisible: board !== null,
    paneCount: panes.length,
    panes,
    boardPaneIds,
    focusedPaneId: layout?.layout?.focusedPaneId ?? null,
    layoutPaneCount: (function count(node) {
      if (node === null || typeof node !== 'object') return 0;
      if (node.type === 'pane') return 1;
      return (node.children || []).reduce((n, c) => n + count(c), 0);
    })(layout?.layout?.root ?? null),
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
await sleep(4000);

const stateA = await page.evaluate(READ_STATE);
console.log("=== A: board route ===");
console.log(JSON.stringify({ paneCount: stateA.paneCount, boardVisible: stateA.boardVisible, boardPaneIds: stateA.boardPaneIds }, null, 2));

/** Every sidebar thread id currently linked anywhere in the sidebar. */
async function knownThreadIds() {
  return page.evaluate(() =>
    [...new Set(
      [...document.querySelectorAll('a[href*="/threads/"]')]
        .map((a) => (a.getAttribute("href") || "").match(/threads\/([A-Za-z0-9_]+)/)?.[1])
        .filter(Boolean),
    )],
  );
}

/** Scroll the sidebar until THREAD_ID's row mounts; returns its center. */
async function sidebarRow(threadId) {
  for (let i = 0; i < 80; i += 1) {
    const row = await page.evaluate((id, scrollerExpr) => {
      const a = [...document.querySelectorAll('a[href*="/threads/"]')].find(
        (x) => (x.getAttribute("href") || "").includes(id) && x.getBoundingClientRect().x < 320,
      );
      if (a === undefined || a === null) {
        // eslint-disable-next-line no-eval
        const scroller = eval(scrollerExpr);
        if (scroller !== null && scroller !== undefined) scroller.scrollTop += 300;
        return null;
      }
      a.scrollIntoView({ block: "center" });
      const r = a.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, threadId, SIDEBAR_SCROLLER);
    if (row !== null) return row;
    await sleep(200);
  }
  return null;
}

/** Open one thread through bb's own sidebar context menu → "Open in split". */
async function openInSplit(threadId) {
  const row = await sidebarRow(threadId);
  if (row === null) return { threadId, opened: false, reason: "sidebar row not found" };
  await sleep(500);
  await page.mouse.move(row.x, row.y);
  await sleep(500);
  await page.mouse.click(row.x, row.y, { button: "right" });
  await sleep(900);
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
  const item = items.find((m) => m.visible && /open in split/i.test(m.label));
  if (item === undefined) {
    await page.keyboard.press("Escape");
    return { threadId, opened: false, reason: "no Open-in-split entry (menu already split?)" };
  }
  await page.mouse.click(item.x, item.y);
  await sleep(3500);
  return { threadId, opened: true };
}

/** Focus one pane by clicking its own top-left chrome corner. */
async function focusPane(paneId) {
  const box = await page.evaluate((id) => {
    const el = document.querySelector(`[data-split-pane-id="${id}"]`);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + 8), y: Math.round(r.y + 8) };
  }, paneId);
  if (box === null) return false;
  await page.mouse.click(box.x, box.y);
  await sleep(800);
  return true;
}

// ---- 1. The already-open thread focuses rather than duplicating ----------
const pool = await knownThreadIds();
const first = pool[0];
const openFirst = await openInSplit(first);
const afterFirst = await page.evaluate(READ_STATE);
const repeatFirst = await openInSplit(first);
const afterRepeat = await page.evaluate(READ_STATE);
await page.screenshot({ path: `${OUT_DIR}/08-repeat-open-focuses.png` });
console.log("=== B: one thread open in split, then reopened ===");
console.log(JSON.stringify({
  first,
  openFirst,
  repeatFirst,
  paneCountAfterFirst: afterFirst.paneCount,
  paneCountAfterRepeat: afterRepeat.paneCount,
  focusedAfterRepeat: afterRepeat.focusedPaneId,
  boardVisible: afterRepeat.boardVisible,
}, null, 2));

// ---- 2. The pane cap: fill to the ceiling, focus the board, open once more
const results = [];
const opened = new Set([first]);
for (const threadId of pool) {
  if (opened.size >= CAP - 1) break;
  if (opened.has(threadId)) continue;
  const attempt = await openInSplit(threadId);
  opened.add(threadId);
  const state = await page.evaluate(READ_STATE);
  results.push({ threadId, attempt, paneCount: state.paneCount, boardVisible: state.boardVisible, boardPaneIds: state.boardPaneIds, focused: state.focusedPaneId });
  if (state.paneCount >= CAP) break;
}
const atCeiling = await page.evaluate(READ_STATE);
await page.screenshot({ path: `${OUT_DIR}/09-at-cap.png` });
console.log("=== C: layout at the ceiling ===");
console.log(JSON.stringify({
  paneCount: atCeiling.paneCount,
  cap: CAP,
  boardVisible: atCeiling.boardVisible,
  boardPaneIds: atCeiling.boardPaneIds,
  focused: atCeiling.focusedPaneId,
  opens: results.map((r) => ({ threadId: r.threadId, opened: r.attempt.opened, paneCount: r.paneCount })),
}, null, 2));

const boardPaneId = atCeiling.boardPaneIds[0];
const focusedBoard = boardPaneId === undefined ? false : await focusPane(boardPaneId);
const afterBoardFocus = await page.evaluate(READ_STATE);
const spare = pool.find((id) => !opened.has(id));
const capOpen = spare === undefined ? { opened: false, reason: "no spare thread id" } : await openInSplit(spare);
const afterCap = await page.evaluate(READ_STATE);
await page.screenshot({ path: `${OUT_DIR}/10-after-cap-open.png` });
console.log("=== D: board focused at the ceiling, one more open ===");
console.log(JSON.stringify({
  spare,
  focusedBoard,
  focusBeforeCap: afterBoardFocus.focusedPaneId,
  capOpen,
  paneCount: afterCap.paneCount,
  boardVisible: afterCap.boardVisible,
  boardPaneIds: afterCap.boardPaneIds,
  focusedAfterCap: afterCap.focusedPaneId,
  panes: afterCap.panes.map((p) => ({ id: p.id, hasBoard: p.hasBoard, title: p.title })),
}, null, 2));

const verdict = {
  // The focus rule: reopening an open thread must not add a pane.
  repeatOpenFocusedRatherThanDuplicated: afterRepeat.paneCount === afterFirst.paneCount,
  // The cap rule: the board plane must still exist after a cap fallback.
  boardSurvivedCapFallback: afterCap.boardVisible && afterCap.boardPaneIds.length === 1,
  boardReplacedByCapFallback: atCeiling.boardVisible && afterCap.boardVisible === false,
  boardPaneIdBefore: boardPaneId ?? null,
  boardPaneIdAfter: afterCap.boardPaneIds[0] ?? null,
};
console.log("=== verdict ===");
console.log(JSON.stringify(verdict, null, 2));
writeFileSync(
  `${OUT_DIR}/evidence-cap.json`,
  JSON.stringify({ stateA, first, openFirst, repeatFirst, afterFirst, afterRepeat, atCeiling, afterBoardFocus, capOpen, afterCap, verdict }, null, 2),
);

await browser.close();
process.exit(verdict.repeatOpenFocusedRatherThanDuplicated && verdict.boardSurvivedCapFallback ? 0 : 1);
