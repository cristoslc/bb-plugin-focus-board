// Live probe for the 2026-11-23 report: "/" stopped focusing the board's
// search field "with another pane open", while the board's pane was the active
// one. The rule that arms both board shortcuts
// (lib/shortcut-ownership.ts) proves the board holds host focus by walking
// from the board's panel root to the nearest `[data-split-pane-id]` container
// and comparing that id with the focused pane the split layout reports. That
// walk rests on a host contract last observed on 0.49.0 by
// scripts/screenshot/probe-native-split-pane.mjs; this probe re-checks it on
// the host this report came from.
//
// What it records, per step: the viewport, the persisted split layout
// (localStorage `bb.splitLayout`, the same tree `useSidebarSplitLayout()`
// folds into panes), every `[data-split-pane-id]` container with whether it
// holds the board, the board panel's ancestor chain, document.activeElement,
// and, after each keypress, whether the toolbar search field took focus and
// whether a composer opened.
//
// Sequence:
//   1. board alone, press "/" (baseline: the shortcut's own contract)
//   2. board alone, press the New Thread key "c" (the sibling shortcut)
//   3. open a thread beside the board in bb's native pane (sidebar row menu
//      "Open in split", the same host path the board's card click calls)
//   4. click the board's own empty space so bb focuses the board's pane, read
//      the DOM, press "/", then press "c"
//   5. press a card, then click the board again, press "/" (the operator's
//      "board focused by a card press" shape)
//
// Reads only apart from navigation and one keyboard gesture set; the split
// layout persists to the probe's own throwaway Chrome profile, never the
// operator's.
//
// Usage: node scripts/screenshot/probe-board-shortcut-focus.mjs
// Honors BB_APP, CHROME_PATH, THREAD_ID, OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP =
  process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-board-shortcut-focus";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything the ownership rule reads, plus what the operator would see. */
const READ = `(() => {
  const board = document.querySelector('[data-focus-board-panel]');
  const search = document.querySelector('input[aria-label="Search threads"]');
  const panes = [...document.querySelectorAll('[data-split-pane-id]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.getAttribute('data-split-pane-id'),
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      tag: el.tagName.toLowerCase(),
      className: (el.className || '').toString().slice(0, 60),
      hasBoard: board !== null && el.contains(board),
    };
  });
  const describe = (el) => {
    if (el === null) return null;
    const attrs = {};
    for (const a of el.attributes) {
      if (a.name === 'class') continue;
      if (a.name === 'style') continue;
      attrs[a.name] = (a.value || '').slice(0, 60);
    }
    return {
      tag: el.tagName.toLowerCase(),
      className: (el.className || '').toString().slice(0, 60),
      attrs,
    };
  };
  const ancestors = [];
  for (let el = board; el !== null && ancestors.length < 8; el = el.parentElement) {
    ancestors.push(describe(el));
  }
  let activeChain = [];
  for (let el = document.activeElement; el !== null && activeChain.length < 6; el = el.parentElement) {
    activeChain.push({
      tag: el.tagName.toLowerCase(),
      className: (el.className || '').toString().slice(0, 50),
      attrs: el === document.activeElement ? describe(el)?.attrs ?? {} : {},
    });
  }
  const paneOfBoard = board === null ? null
    : board.closest('[data-split-pane-id]')?.getAttribute('data-split-pane-id') ?? null;
  return {
    url: location.href,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    splitLayout: localStorage.getItem('bb.splitLayout'),
    compact: window.innerWidth < 1024,
    boardVisible: board !== null,
    paneOfBoard,
    panes,
    boardAncestors: ancestors,
    activeElement: document.activeElement === null ? null : {
      tag: document.activeElement.tagName.toLowerCase(),
      id: document.activeElement.id || null,
      ariaLabel: document.activeElement.getAttribute('aria-label'),
      isSearchField: document.activeElement === search,
    },
    activeChain,
    searchFieldPresent: search !== null,
    searchFieldFocused: document.activeElement === search,
    composerOpen: document.querySelector('[role="dialog"]') !== null,
  };
})()`;

/** Click the board's own empty space (a lane background far from cards). */
const BOARD_EMPTY_POINT = `(() => {
  const board = document.querySelector('[data-focus-board-panel]');
  if (board === null) return null;
  const r = board.getBoundingClientRect();
  // Bottom-right of the board: past the lanes' last cards on a wide board.
  return { x: Math.round(r.right - 24), y: Math.round(r.bottom - 120) };
})()`;

/** Record what the browser finally does with each keydown: the target as the
 *  board's rule sees it, and whether anyone claimed the key. The window bubble
 *  listener runs after every document listener, so `defaultPrevented` here is
 *  the final verdict (the host's own claim included). */
const INSTALL_KEY_TRACE = `(() => {
  window.__probeKeys = [];
  const describe = (el) => {
    if (el === null || el === undefined) return null;
    const attrs = {};
    for (const a of el.attributes || []) {
      if (a.name === 'class' || a.name === 'style') continue;
      attrs[a.name] = (a.value || '').slice(0, 40);
    }
    return { tag: el.tagName.toLowerCase(), attrs };
  };
  window.addEventListener('keydown', (event) => {
    window.__probeKeys.push({
      key: event.key,
      defaultPrevented: event.defaultPrevented,
      target: describe(event.target),
      activeElement: describe(document.activeElement),
    });
  });
  return true;
})()`;

const READ_KEYS = `(() => (window.__probeKeys || []).splice(0))()`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
const consoleLines = [];
page.on("console", (message) => {
  const text = message.text();
  if (text.includes("[focus-board:")) consoleLines.push(text);
});
const steps = {};
const shots = [];
const shot = async (name) => {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
  shots.push(`${name}.png`);
};

try {
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("[data-focus-board-panel]", { timeout: 30000 });
  await sleep(2500);
  await page.evaluate(INSTALL_KEY_TRACE);

  const read = () => page.evaluate(READ);
  const keys = () => page.evaluate(READ_KEYS);
  const press = async (key) => {
    await page.keyboard.press(key);
    await sleep(450);
    return { state: await read(), keys: await keys() };
  };
  const clickBoardEmpty = async () => {
    const point = await page.evaluate(BOARD_EMPTY_POINT);
    if (point === null) return false;
    await page.mouse.click(point.x, point.y);
    await sleep(500);
    return true;
  };
  const firstCard = () =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll("[data-focus-board-panel] [data-thread-card]")];
      const visible = cards.find((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 40 && r.height > 40 && r.top > 60 && r.bottom < window.innerHeight;
      });
      if (visible === undefined) return null;
      const r = visible.getBoundingClientRect();
      // The card's own header area: a press here is the operator's "open this
      // thread" gesture, not a control inside the card.
      return {
        threadId: visible.getAttribute("data-thread-card"),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + Math.min(24, r.height / 2)),
      };
    });

  // 1. Baseline: the board alone, its pane the only pane.
  await clickBoardEmpty();
  steps.baselineBefore = await read();
  await shot("01-board-alone");
  steps.baselineSlash = await press("/");
  await shot("02-board-alone-slash");
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(200);
  steps.baselineNewThreadKey = await press("c");
  await shot("03-board-alone-new-thread-key");
  await page.keyboard.press("Escape");
  await sleep(600);

  // 2. A thread beside the board, opened the way the host itself opens one.
  const row = await page.evaluate(() => {
    const anchor = [...document.querySelectorAll('a[href*="/threads/"]')].find(
      (a) => a.getBoundingClientRect().x < 320 && a.getBoundingClientRect().width > 0,
    );
    if (anchor === undefined) return null;
    anchor.scrollIntoView({ block: "center" });
    const r = anchor.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      href: anchor.getAttribute("href"),
    };
  });
  steps.sidebarRow = row;
  if (row === null) throw new Error("no sidebar thread row found");
  await page.mouse.move(row.x, row.y);
  await sleep(500);
  await page.mouse.click(row.x, row.y, { button: "right" });
  await sleep(900);
  const splitItem = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.textContent || "").trim().slice(0, 60),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          visible: r.width > 0,
        };
      })
      .find((m) => m.visible && /open in split/i.test(m.label)),
  );
  steps.splitItem = splitItem ?? null;
  if (splitItem === undefined || splitItem === null) {
    throw new Error("no Open-in-split entry in the sidebar row menu");
  }
  await page.mouse.click(splitItem.x, splitItem.y);
  await sleep(4000);
  steps.afterSplit = await read();
  await shot("04-after-split");

  // 3. The operator's shape: click the board's own surface so bb focuses the
  //    board's pane, then press "/".
  await clickBoardEmpty();
  steps.boardClickedBefore = await read();
  await shot("05-board-clicked");
  steps.boardClickedSlash = await press("/");
  await shot("06-board-clicked-slash");
  steps.boardClickedNewThreadKey = await press("c");
  await shot("07-board-clicked-new-thread-key");
  await page.keyboard.press("Escape");
  await sleep(600);
  const afterComposer = await read();
  steps.afterComposerClose = afterComposer;

  // 4. Focus the board by pressing a card, then press "/" the way an operator
  //    does after looking something up.
  const card = await firstCard();
  steps.cardPoint = card;
  if (card !== null) {
    await page.mouse.click(card.x, card.y);
    await sleep(2500);
  }
  steps.afterCardPress = await read();
  await shot("08-after-card-press");
  await clickBoardEmpty();
  steps.boardClickedAgain = await read();
  steps.boardClickedAgainSlash = await press("/");
  await shot("09-board-clicked-again-slash");

  // 5. The counter-case: the OTHER pane holds focus. "/" must stay inert, so
  //    the fix cannot become a key stolen from the pane being typed in.
  const otherPane = await page.evaluate(() => {
    const panes = [...document.querySelectorAll("[data-split-pane-id]")];
    const board = document.querySelector("[data-focus-board-panel]");
    const foreign = panes.find((el) => board !== null && !el.contains(board));
    if (foreign === undefined) return null;
    const r = foreign.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  steps.foreignPanePoint = otherPane;
  if (otherPane !== null) {
    await page.mouse.click(otherPane.x, otherPane.y);
    await sleep(600);
    steps.foreignPaneBefore = await read();
    steps.foreignPaneSlash = await press("/");
    await shot("10-foreign-pane-slash");
  }

  writeFileSync(
    `${OUT_DIR}/evidence.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        app: APP,
        userAgent: await page.evaluate(() => navigator.userAgent),
        steps,
        shots,
        consoleLines,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ steps, consoleLines }, null, 2));
} finally {
  await browser.close();
}
