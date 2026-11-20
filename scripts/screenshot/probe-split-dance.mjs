// The split dance: can a one-pane window end with BOTH the board and a thread
// on screen?
//
// The operator's ruling (dec_a4lrjn0gqqmk, "Navigate, then bring the board
// back") asks a card click in a one-pane window to open the thread and then
// bring the board back beside it. Step 1 is measured elsewhere; step 2 is the
// unknown, because nothing in the SDK navigates a panel INTO a split and the
// host's route reconciliation replaces the focused pane.
//
// This probe records, at every step: the host's raw split layout (the
// `bb.splitLayout` atom), the plugin-facing view of it (null below two panes,
// the same rule `useSidebarSplitLayout` applies), the route, whether the board
// is mounted, and the rendered panes with their content.
//
// The three orders the commission names, plus what the host's own affordances
// add:
//
//   A. Navigate, then restore. Board alone -> the host's opener for a thread
//      with split:true -> the board's panel route.
//   B. Restore, then navigate. Thread in the only pane -> the board's panel
//      route -> the host's opener for the thread again with split:true.
//   C. Two opens. Thread in the only pane -> the host's opener for a
//      DIFFERENT thread with split:true.
//
// Every "host's opener" call is the same function the SDK's
// `experimental_useSidebarThreadActions().open(id, {split:true})` calls
// (plugin-frontend `open` -> `openThreadInSplit`), reached here through bb's
// own sidebar row menu ("Open in split"), which runs
// `navigate.toThread(id, {split:true})` -> the same function.
//
// Usage: node scripts/screenshot/probe-split-dance.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, THREAD_A, THREAD_B, VIEWPORT.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-split-dance";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: Number(process.env.WIDTH ?? 1600), height: 1200 };

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The host's split layout, the plugin-facing view of it, the route, the board
 *  marker, and the rendered panes. Pure read: never writes. */
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
  const flatten = (node, out) => {
    if (node === null || node === undefined) return out;
    if (node.type === 'pane') { out.push(node); return out; }
    for (const child of node.children ?? []) flatten(child, out);
    return out;
  };
  const panes = layout === null ? [] : flatten(layout.root, []);
  const board = document.querySelector('[data-focus-board-panel]');
  const describe = (content) => {
    if (content === null || content === undefined) return { kind: null };
    if (content.kind === 'thread') return { kind: 'thread', threadId: content.threadId };
    if (content.kind === 'plugin-panel') return { kind: 'plugin-panel', pluginId: content.pluginId, panelPath: content.panelPath, subPath: content.subPath };
    return { kind: content.kind };
  };
  return {
    route: location.pathname + location.search + location.hash,
    rawAtom: raw === null ? null : 'layout',
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      focused: layout.focusedPaneId === pane.paneId,
      ...describe(pane.content),
      holdsBoard: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        return el !== null && board !== null && el.contains(board);
      })(),
    })),
    /** What useSidebarSplitLayout() answers: null unless two or more panes. */
    hookLayout: panes.length > 1 ? 'layout' : null,
    boardMounted: board !== null,
    inBoardPane: (() => {
      const aside = document.querySelector('aside[aria-label^="Thread:"]');
      return aside === null ? null : aside.getAttribute('aria-label');
    })(),
    renderedPanes: [...document.querySelectorAll('[data-split-pane-id]')].map((el) => el.getAttribute('data-split-pane-id')),
    compactViewport: window.matchMedia('(max-width: 767px)').matches,
    /** Board cards, so a step can prove the board is not only mounted but showing cards. */
    cardCount: document.querySelectorAll('[data-thread-card]').length,
    threadViewVisible: (() => {
      const el = document.querySelector('textarea, [contenteditable="true"]');
      return el !== null;
    })(),
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`, "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: VIEWPORT,
});

const evidence = { app: APP, viewport: VIEWPORT, phases: {}, notes: [] };
let context = null;
let page = null;
const errors = [];

async function boot(label) {
  if (context !== null) await context.close();
  errors.length = 0;
  context = await browser.createBrowserContext();
  page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  // When the atom materializes is itself a fact: sample it during boot.
  const samples = [];
  for (const ms of [0, 100, 300, 600, 1000, 2000, 4000]) {
    await sleep(ms === 0 ? 0 : ms - (samples.at(-1)?.at ?? 0));
    const state = await page.evaluate(READ_STATE);
    samples.push({ at: ms, paneCount: state.paneCount, rawAtom: state.rawAtom, route: state.route });
  }
  evidence.phases[label] = { bootSamples: samples, steps: [] };
  return samples;
}

async function step(label, name, extra = {}) {
  const state = await page.evaluate(READ_STATE);
  const row = { name, ...state, ...extra };
  evidence.phases[label].steps.push(row);
  console.log(`=== ${label} / ${name} ===`);
  console.log(
    JSON.stringify(
      {
        route: row.route,
        rawAtom: row.rawAtom,
        paneCount: row.paneCount,
        hookLayout: row.hookLayout,
        focusedPaneId: row.focusedPaneId,
        panes: row.panes.map((p) => `${p.paneId}:${p.kind}${p.threadId ? `:${p.threadId}` : ""}${p.panelPath ? `:${p.panelPath}/${p.subPath}` : ""}${p.focused ? ":F" : ""}`),
        boardMounted: row.boardMounted,
        cardCount: row.cardCount,
        inBoardPane: row.inBoardPane,
        ...extra,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: `${OUT_DIR}/${label}-${row.panes.length}p-${name.replace(/[^a-z0-9]+/gi, "-")}.png` });
  return row;
}

/** The sidebar's thread rows, in DOM order. */
async function sidebarRows() {
  return page.evaluate(() => {
    return [...document.querySelectorAll('a[href*="/threads/"]')]
      .filter((a) => a.getBoundingClientRect().x < 320 && a.getBoundingClientRect().width > 0)
      .map((a) => {
        const match = /\/threads\/(thr_[A-Za-z0-9_-]+)/.exec(a.getAttribute("href") || "");
        const r = a.getBoundingClientRect();
        return {
          threadId: match === null ? null : match[1],
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
        };
      })
      .filter((row) => row.threadId !== null);
  });
}

/** The sidebar's Focus Board nav item, so the board's panel route can be
 *  reached the way a user reaches it. */
async function boardNavPoint() {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll('a[href], button')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.x < 320 && r.width > 0 && /focus board/i.test((el.getAttribute("aria-label") || el.textContent || "") + "");
    });
    const el = candidates[0];
    if (el === undefined) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
}

/** A plain click on a sidebar thread row: the host's plain navigation. */
async function clickRow(threadId) {
  const rows = await sidebarRows();
  const row = rows.find((candidate) => candidate.threadId === threadId) ?? rows[0];
  await page.mouse.click(row.x, row.y);
  await sleep(1500);
  return row.threadId;
}

/** The host's own "Open in split": right-click the row, click the menu entry.
 *  `toThread(id, {split:true})` in the host's sidebar row menu. */
async function openInSplit(threadId) {
  const rows = await sidebarRows();
  const row = rows.find((candidate) => candidate.threadId === threadId);
  if (row === undefined) throw new Error(`no sidebar row for ${threadId}`);
  await page.mouse.click(row.x, row.y, { button: "right" });
  await sleep(900);
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: (el.textContent || "").trim().slice(0, 60), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), visible: r.width > 0 };
    }),
  );
  const entry = items.find((item) => item.visible && /open in split|split/i.test(item.label));
  if (entry === undefined) {
    await page.keyboard.press("Escape");
    await sleep(300);
    return { opened: false, menu: items };
  }
  await page.mouse.click(entry.x, entry.y);
  await sleep(2500);
  return { opened: true, label: entry.label, menu: items };
}

async function clickBoardNav() {
  const point = await boardNavPoint();
  if (point === null) return false;
  await page.mouse.click(point.x, point.y);
  await sleep(2000);
  return true;
}

/** Navigate to the board's panel route straight in the address bar, the exact
 *  URL shape `toPluginPanel("board", {subPath})` produces. */
async function gotoPanelRoute(subPath = "") {
  const suffix = subPath === "" ? "" : `/${subPath}`;
  const url = new URL(`/plugins/focus-board/board${suffix}`, APP).toString();
  // A history push into the SPA does not re-render; a load does, and it is the
  // same route the router resolves. Reload-based so the step is unambiguous.
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(3000);
}

// ---------------------------------------------------------------------------
// A. Navigate, then restore.
// ---------------------------------------------------------------------------
await boot("A");
const rowsA = await sidebarRows();
const threadA = process.env.THREAD_A ?? rowsA[0].threadId;
const threadB = process.env.THREAD_B ?? rowsA[1].threadId;
evidence.threads = { A: threadA, B: threadB };

await step("A", "1-board-alone");
// Step 1: the opener for the thread with split:true.
await clickRow(threadA);
await step("A", "2-thread-after-plain-open", { via: "sidebar row click (plain navigation)" });
// The opener's split branch, from the thread-in-only-pane state this time.
const openA = await openInSplit(threadA);
await step("A", "3-thread-after-open-in-split", { openInSplit: openA });
// Step 2 of the ruling: the board's panel route, with the thread's subPath.
await gotoPanelRoute(`t/${threadA}`);
await step("A", "4-board-route-with-subpath", { via: "panel route load, subPath t/<thread>" });

// ---------------------------------------------------------------------------
// B. Restore, then navigate.
// ---------------------------------------------------------------------------
await boot("B");
// Get the thread into the only pane first.
await clickRow(threadA);
await step("B", "1-thread-in-only-pane");
// Restore the board first.
await clickBoardNav();
await step("B", "2-board-route", { via: "sidebar nav item (plain route change)" });
// Then ask the opener for the thread again, with split.
const openB = await openInSplit(threadA);
await step("B", "3-open-in-split-after-board", { openInSplit: openB });
// And the plain row click, for the record: does a route change now split?
await clickRow(threadA);
await step("B", "4-plain-row-click-after-board");

// ---------------------------------------------------------------------------
// C. Two opens: a DIFFERENT thread from the thread-in-only-pane state.
// ---------------------------------------------------------------------------
await boot("C");
await clickRow(threadA);
await step("C", "1-thread-in-only-pane");
const openC = await openInSplit(threadB);
await step("C", "2-other-thread-open-in-split", { openInSplit: openC, thread: threadB });

evidence.errors = errors;
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log("=== boot samples ===");
for (const [label, phase] of Object.entries(evidence.phases)) {
  console.log(label, JSON.stringify(phase.bootSamples));
}
console.log("=== errors ===", errors);

await browser.close();
process.exit(0);
