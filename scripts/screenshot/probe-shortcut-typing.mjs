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
// Three cases:
//   1. typing "c" into a rich-text editor that belongs to another pane opens
//      no composer, and the letter lands in the editor (the operator's bug:
//      bb's composers are contenteditable, and a document-level listener
//      heard every one of them);
//   2. typing "c" into a textarea in that pane opens no composer;
//   3. pressing "c" with nothing focused on the board still opens the
//      composer (the feature).
//
// The pane-FOCUS half of the fix (the letter fires only while the board's own
// pane is the focused pane in bb's split layout) cannot be reproduced here:
// the harness mounts the board as the only pane and its
// `useSidebarSplitLayout` mock returns null statically
// (scripts/screenshot/mock-sdk.tsx), and a null layout is a single pane, which
// the rule treats as the board's own pane. So these cases exercise the armed
// board. That half is pinned in jsdom (tests/new-thread-shortcut.test.tsx,
// tests/search-focus-slash.test.tsx, tests/app-native-split-awareness.test.tsx)
// and the host facts it relies on were read live by
// scripts/screenshot/probe-native-split-pane.mjs (the board's pane container
// carries the pane id the layout reports) and
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
} finally {
  await browser.close();
  child.kill();
}

const [foreignEditor, foreignTextarea, boardKeystroke] = results;
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
];
console.log(JSON.stringify({ base, port: PORT, results }, null, 2));
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
}
process.exit(failures === 0 ? 0 : 1);
