// Live check for the board's single-key shortcuts in the screenshot harness:
// the configurable New Thread key (default "C") and "/" must belong to the
// surface the keystroke happens in.
//
// This is the real app mounted in real Chrome with real key events
// (Input.dispatchKeyEvent through puppeteer, the sequence a keyboard
// produces), so it catches what jsdom cannot: whether the guard survives the
// browser's own event target and whether a swallowed key actually kept the
// letter out of the editor.
//
// Five cases:
//   1. typing "c" into a rich-text editor that belongs to another pane opens
//      no composer, and the letter lands in the editor (the operator's bug:
//      bb's composers are contenteditable, and a document-level listener
//      heard every one of them);
//   2. typing "c" into a textarea in that pane opens no composer;
//   3. pressing "c" with nothing focused on the board still opens the
//      composer (the feature);
//   4. with a split open and the board's pane focused, clicking inside the
//      board and pressing "/" focuses the search field, and pressing "c"
//      opens the composer. This is the 2026-11-23 report's shape, and it needs
//      a real browser: bb focuses its pane container on pointerdown, so the
//      keystroke's target is the container AROUND the plugin panel, which
//      jsdom never reproduces because its synthetic clicks move no focus. The
//      harness models that container (`?nativeSplit=1` chrome in
//      scripts/screenshot/mock-sdk.tsx, shaped from
//      scripts/screenshot/probe-board-shortcut-focus.mjs on the installed
//      0.50.1 build);
//   5. clicking the OTHER pane and pressing "/" leaves the search field alone,
//      so the widening that fixes case 4 cannot steal the key from the pane
//      being typed in.
//
// The pane-FOCUS half of the arming (the shortcut fires only while the board's
// own pane is the focused pane in bb's split layout) is pinned in jsdom
// (tests/new-thread-shortcut.test.tsx, tests/search-focus-slash.test.tsx,
// tests/shortcut-ownership.test.ts, tests/app-native-split-awareness.test.tsx)
// and the host facts it relies on were read live by
// scripts/screenshot/probe-board-shortcut-focus.mjs (the board's panel sits in
// a `[data-split-pane-id]` container that bb focuses on pointerdown) and
// scripts/screenshot/probe-board-mount-lifetime.mjs (the panel leaves the
// document when the route leaves it).
//
// Usage: node scripts/screenshot/probe-shortcut-typing.mjs
// Honors CHROME_PATH and PORT. Exit code is 0 only when every case holds.
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PORT ?? 38924);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A pane beside the board: a rich-text editor and a textarea, both outside
 *  the board's own panel root, exactly where bb's thread chat sits. */
const PLANT_FOREIGN_PANE = `(() => {
  const pane = document.createElement('div');
  pane.id = 'probe-foreign-pane';
  pane.style.cssText =
    'position:fixed;left:24px;top:24px;z-index:99999;background:#fff;color:#000;padding:8px;border:1px solid #000';
  const editor = document.createElement('div');
  editor.id = 'probe-editor';
  editor.setAttribute('contenteditable', 'true');
  editor.style.cssText = 'min-width:160px;min-height:24px';
  const box = document.createElement('textarea');
  box.id = 'probe-textarea';
  pane.append(editor, box);
  document.body.appendChild(pane);
  return { inPanel: pane.closest('[data-focus-board-panel]') !== null };
})()`;

const READ = `(() => {
  const editor = document.getElementById('probe-editor');
  const box = document.getElementById('probe-textarea');
  const dialog = document.querySelector('[role="dialog"]');
  return {
    editorText: editor === null ? null : editor.textContent,
    textareaValue: box === null ? null : box.value,
    dialogOpen: dialog !== null,
    dialogLabel: dialog === null ? null : (dialog.textContent || '').trim().slice(0, 40),
    activeElement: document.activeElement === null
      ? null
      : document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''),
  };
})()`;

const CLEAN_UP = `(() => {
  document.getElementById('probe-foreign-pane')?.remove();
  return true;
})()`;

/** The split state the board's ownership rule reads, plus what the operator
 *  would see, and where the keyboard actually sits. */
const READ_SPLIT = `(() => {
  const board = document.querySelector('[data-focus-board-panel]');
  const search = document.querySelector('input[aria-label="Search threads"]');
  const panes = [...document.querySelectorAll('[data-split-pane-id]')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      id: el.getAttribute('data-split-pane-id'),
      tabindex: el.getAttribute('tabindex'),
      focused: el.getAttribute('data-focused'),
      w: Math.round(r.width),
      hasBoard: board !== null && el.contains(board),
    };
  });
  let active = document.activeElement;
  return {
    panes,
    boardPaneId:
      board === null
        ? null
        : (board.closest('[data-split-pane-id]')?.getAttribute('data-split-pane-id') ?? null),
    activeElement: active === null ? null : {
      tag: active.tagName.toLowerCase(),
      id: active.id || null,
      splitPaneId: active.getAttribute?.('data-split-pane-id') ?? null,
      ariaLabel: active.getAttribute?.('aria-label') ?? null,
    },
    searchFocused: document.activeElement === search,
    searchValue: search === null ? null : search.value,
    composerOpen: document.querySelector('[role="dialog"]') !== null,
  };
})()`;

/** Points for the board's own empty space and for a card. */
const POINTS = `(() => {
  const board = document.querySelector('[data-focus-board-panel]');
  if (board === null) return null;
  const r = board.getBoundingClientRect();
  const cards = [...board.querySelectorAll('[data-thread-card]')].filter((el) => {
    const c = el.getBoundingClientRect();
    return c.width > 40 && c.height > 40 && c.top > 60 && c.bottom < window.innerHeight;
  });
  const card = cards[0] ?? null;
  return {
    empty: { x: Math.round(r.right - 24), y: Math.round(r.bottom - 120) },
    card: card === null ? null : (() => {
      const c = card.getBoundingClientRect();
      return { x: Math.round(c.x + c.width / 2), y: Math.round(c.y + Math.min(24, c.height / 2)) };
    })(),
    otherPane: (() => {
      const foreign = [...document.querySelectorAll('[data-split-pane-id]')].find(
        (el) => !el.contains(board),
      );
      if (foreign === undefined) return null;
      const f = foreign.getBoundingClientRect();
      return { x: Math.round(f.x + f.width / 2), y: Math.round(f.y + f.height / 2) };
    })(),
  };
})()`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const { child, base } = await startHarness(PORT);
const results = [];
let failures = 0;
try {
  const page = await browser.newPage();
  await page.goto(base, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector("[data-focus-board-panel]", { timeout: 30000 });
  await sleep(1200);

  const planted = await page.evaluate(PLANT_FOREIGN_PANE);
  if (planted.inPanel) throw new Error("the planted pane landed inside the board's panel");

  // 1. A letter typed into another pane's rich-text editor.
  await page.focus("#probe-editor");
  await page.keyboard.press("c");
  await sleep(200);
  results.push({ case: "letter typed into a foreign rich-text editor", state: await page.evaluate(READ) });

  // 2. A letter typed into another pane's textarea.
  await page.focus("#probe-textarea");
  await page.keyboard.press("c");
  await sleep(200);
  results.push({ case: "letter typed into a foreign textarea", state: await page.evaluate(READ) });

  await page.evaluate(CLEAN_UP);

  // 3. The feature: nothing focused, the board is the surface under the keys.
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("c");
  await sleep(400);
  results.push({ case: "letter pressed with nothing focused on the board", state: await page.evaluate(READ) });
  await page.keyboard.press("Escape");
  await sleep(400);

  // 4/5. A split window: the report's shape. `?nativeSplit=1` turns the mock's
  //      split machinery on, and a card click is the gesture that opens the
  //      thread beside the board (the same host call the operator's click
  //      makes).
  await page.goto(`${base}?nativeSplit=1&groupBy=status`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await page.waitForSelector("[data-focus-board-panel]", { timeout: 30000 });
  await sleep(1500);
  let points = await page.evaluate(POINTS);
  if (points === null || points.card === null) throw new Error("no card to split from");
  await page.mouse.click(points.card.x, points.card.y);
  await sleep(2500);
  for (let i = 0; i < 40; i += 1) {
    points = await page.evaluate(POINTS);
    if (points !== null && points.otherPane !== null) break;
    await sleep(250);
  }
  results.push({ case: "split opened by a card click", state: await page.evaluate(READ_SPLIT) });

  // The board's pane focused by a click on its own empty space.
  await page.mouse.click(points.empty.x, points.empty.y);
  await sleep(500);
  results.push({ case: "board clicked with a split open", state: await page.evaluate(READ_SPLIT) });

  await page.keyboard.press("c");
  await sleep(500);
  results.push({ case: "letter in the board's pane with a split open", state: await page.evaluate(READ_SPLIT) });
  await page.keyboard.press("Escape");
  await sleep(500);

  await page.mouse.click(points.empty.x, points.empty.y);
  await sleep(400);
  await page.keyboard.press("/");
  await sleep(500);
  results.push({ case: "slash in the board's pane with a split open", state: await page.evaluate(READ_SPLIT) });

  // 5. The other pane's own keystrokes stay its own.
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(200);
  points = await page.evaluate(POINTS);
  if (points !== null && points.otherPane !== null) {
    await page.mouse.click(points.otherPane.x, points.otherPane.y);
    await sleep(500);
    await page.keyboard.press("/");
    await sleep(500);
    results.push({ case: "slash in the other pane of the split", state: await page.evaluate(READ_SPLIT) });
  }
} finally {
  await browser.close();
  child.kill();
}

const byCase = (name) => results.find((entry) => entry.case === name);
const foreignEditor = byCase("letter typed into a foreign rich-text editor");
const foreignTextarea = byCase("letter typed into a foreign textarea");
const boardKeystroke = byCase("letter pressed with nothing focused on the board");
const splitOpened = byCase("split opened by a card click");
const boardFocused = byCase("board clicked with a split open");
const letterInSplit = byCase("letter in the board's pane with a split open");
const slashInSplit = byCase("slash in the board's pane with a split open");
const slashInOtherPane = byCase("slash in the other pane of the split");
const checks = [
  [
    "the foreign editor kept its letter and no composer opened",
    foreignEditor.state.editorText === "c" && foreignEditor.state.dialogOpen === false,
  ],
  [
    "the foreign textarea kept its letter and no composer opened",
    foreignTextarea.state.textareaValue === "c" && foreignTextarea.state.dialogOpen === false,
  ],
  [
    "the board's own keystroke still opens the composer",
    boardKeystroke.state.dialogOpen === true,
  ],
  [
    "the split names the board's pane container and focuses it on a click",
    splitOpened !== undefined &&
      splitOpened.state.boardPaneId === "pane-1" &&
      splitOpened.state.panes.length === 2 &&
      boardFocused !== undefined &&
      boardFocused.state.activeElement?.splitPaneId === "pane-1",
  ],
  [
    "the New Thread letter opens the composer from the board's pane in a split",
    letterInSplit !== undefined && letterInSplit.state.composerOpen === true,
  ],
  [
    "'/' focuses the search field from the board's pane in a split",
    slashInSplit !== undefined && slashInSplit.state.searchFocused === true,
  ],
  [
    "'/' in the other pane of the split never moves the board's focus",
    slashInOtherPane !== undefined &&
      slashInOtherPane.state.searchFocused === false &&
      slashInOtherPane.state.activeElement?.splitPaneId === "pane-2",
  ],
];
console.log(JSON.stringify({ base, port: PORT, results }, null, 2));
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}
process.exit(failures === 0 ? 0 : 1);
