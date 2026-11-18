// What focus actually is when a card click runs.
//
// The shipped click path assumes bb's pane focus follows the pointer into the
// board, so a card click starts with the BOARD focused and has to focus the
// board's thread pane before it can replace it. That assumption decides how
// much machinery the click needs (lib/native-pane-ownership.ts). This probe
// measures it in a fresh browser profile:
//
//   1. two panes (board + a thread pane opened from bb's own sidebar), the
//      pointer parked over the board,
//   2. the layout at pointerdown, at the click event (before the board's own
//      handler), and every 50ms after it,
//   3. a second click on a different card, for the pane count and pane ids.
//
// Reads only, apart from navigation. The split layout lives in this browser
// profile's localStorage, never the operator's app profile.
//
// Usage: node scripts/screenshot/probe-card-click-focus-trace.mjs
// Honors BB_APP, CHROME_PATH, THREAD_A, OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-card-click-focus";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The host's split layout, its rendered panes, and the board's box. One
 *  body, spliced into two places: a plain evaluate call, and a capture-phase
 *  listener that must read the layout inside the click's own event. */
const LAYOUT_BODY = `
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
    atom: layout === null ? null : 'layout',
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId:
        pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      focused: layout.focusedPaneId === pane.paneId,
      holdsBoard: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        return el !== null && board !== null && el.contains(board);
      })(),
      domFocused:
        document.querySelector('[data-split-pane-id="' + pane.paneId + '"]')
          ?.getAttribute('data-focused') ?? null,
    })),
    boardMounted: board !== null,
    boardBox: (() => {
      if (board === null) return null;
      const r = board.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    route: location.pathname,
    inBoardPane: (() => {
      const aside = document.querySelector('aside[aria-label^="Thread:"]');
      return aside === null ? null : aside.getAttribute('aria-label');
    })(),
  };
`;

const READ_LAYOUT = `(function () {${LAYOUT_BODY}})()`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(6000);

async function read(label) {
  const state = await page.evaluate(READ_LAYOUT);
  state.label = label;
  return state;
}

// ---------------------------------------------------------------------------
// 1. Two panes: the board plus a thread pane opened from bb's own sidebar.
// ---------------------------------------------------------------------------
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

async function findRow(threadId) {
  let row = null;
  for (let i = 0; i < 80 && row === null; i += 1) {
    row = await page.evaluate(
      (id, scrollerExpr) => {
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
      },
      threadId,
      SIDEBAR_SCROLLER,
    );
    if (row === null) await sleep(250);
  }
  if (row === null) throw new Error(`sidebar row not found for ${threadId}`);
  return row;
}

async function openInSplit(threadId) {
  const row = await findRow(threadId);
  await sleep(400);
  await page.mouse.move(row.x, row.y);
  await sleep(400);
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
  const split = items.find((item) => item.visible && /open in split/i.test(item.label));
  if (split === undefined) throw new Error("no Open-in-split entry in the sidebar row menu");
  await page.mouse.click(split.x, split.y);
  await sleep(3000);
}

const sidebarThreads = await page.evaluate(() =>
  [
    ...new Set(
      [...document.querySelectorAll('a[href*="/threads/"]')]
        .map((anchor) => {
          const match = /\/threads\/(thr_[A-Za-z0-9]+)/.exec(
            anchor.getAttribute("href") || "",
          );
          return match === null ? null : match[1];
        })
        .filter((id) => id !== null),
    ),
  ],
);
const opener = process.env.THREAD_A ?? sidebarThreads[0];
if (opener === undefined) throw new Error("no thread in the sidebar to open in split");
await openInSplit(opener);
const twoPanes = await read("two-panes:after-sidebar-split");

// ---------------------------------------------------------------------------
// 2. The click trace: focus at pointerdown, at the click, and after it.
// ---------------------------------------------------------------------------
await page.evaluate((layoutBody) => {
  const read = new Function(layoutBody);
  // eslint-disable-next-line no-new-func
  window.__clickSamples = [];
  const capture = (phase) => (event) => {
    const target = event.target instanceof Element ? event.target : null;
    window.__clickSamples.push({
      phase,
      t: Math.round(performance.now()),
      state: read(),
      targetThreadCard:
        target === null
          ? null
          : target.closest("[data-thread-card]")?.getAttribute("data-thread-card") ?? null,
      activeElement:
        document.activeElement === null
          ? null
          : document.activeElement.tagName +
            (document.activeElement.getAttribute?.("data-split-pane-id") ?? ""),
    });
  };
  for (const phase of ["pointerdown", "mousedown", "pointerup", "click"]) {
    document.addEventListener(phase, capture(phase), true);
  }
}, LAYOUT_BODY);

async function cardPoint(index) {
  return page.evaluate((i) => {
    const cards = [...document.querySelectorAll("[data-thread-card]")].filter(
      (el) => el.parentElement?.closest("[data-thread-card]") === null,
    );
    const card = cards[i];
    if (card === undefined) return null;
    const anchor = card.querySelector("a");
    if (anchor === null) return null;
    anchor.scrollIntoView({ block: "center", inline: "center" });
    const r = anchor.getBoundingClientRect();
    return {
      threadId: card.getAttribute("data-thread-card"),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  }, index);
}

const trace = [];
async function clickAndTrace(index, label) {
  const point = await cardPoint(index);
  if (point === null) throw new Error(`no card ${index}`);
  await sleep(400);
  // Park the pointer over the board's card, then read the layout BEFORE the
  // press: this is the state the operator is looking at.
  await page.mouse.move(point.x, point.y);
  await sleep(400);
  await page.evaluate(() => { window.__clickSamples = []; });
  const before = await read(`${label}:before-pointerdown`);
  trace.push({ ...before, thread: point.threadId, phase: "before-pointerdown" });
  await page.mouse.down();
  const atDown = await page.evaluate(() => window.__clickSamples.slice());
  await page.mouse.up();
  const atUp = await page.evaluate(() => window.__clickSamples.slice());
  trace.push({ ...atDown.at(-1).state, thread: point.threadId, phase: "pointerdown:in-handler" });
  trace.push({ ...atUp.at(-1).state, thread: point.threadId, phase: "click:in-handler" });
  for (let i = 0; i < 40; i += 1) {
    await sleep(50);
    const s = await read(`${label}:+${(i + 1) * 50}ms`);
    trace.push({ ...s, thread: point.threadId, phase: `+${(i + 1) * 50}ms` });
  }
  await page.screenshot({ path: `${OUT_DIR}/trace-${label}.png` });
  return { point, samples: atDown.concat(atUp) };
}

const firstStart = trace.length;
const first = await clickAndTrace(0, "click-1");
const firstRows = trace.slice(firstStart);
// The shipped click on a board with no record opens the board's own in-panel
// pane, which covers the cards; Escape closes it so the second click lands on
// a card and not on the pane.
await page.keyboard.press("Escape");
await sleep(600);
const secondStart = trace.length;
const second = await clickAndTrace(1, "click-2");
const secondRows = trace.slice(secondStart);

writeFileSync(
  `${OUT_DIR}/evidence.json`,
  JSON.stringify(
    {
      app: APP,
      sidebarThreads,
      opener,
      twoPanes,
      trace,
      clickSamples: { first: first.samples, second: second.samples },
      errors,
    },
    null,
    2,
  ),
);

const phase = (suffix) => trace.filter((row) => row.phase === suffix);
const summarize = (row) => ({
  phase: row.phase,
  paneCount: row.paneCount,
  focusedPaneId: row.focusedPaneId,
  panes: row.panes.map((pane) => `${pane.paneId}:${pane.threadId ?? "board"}:${pane.focused ? "F" : "-"}`),
  route: row.route,
  inBoardPane: row.inBoardPane,
});

console.log("=== two panes ===");
console.log(JSON.stringify(summarize({ ...twoPanes, phase: "two-panes" }), null, 2));

for (const [label, samples] of [["click-1", first.samples], ["click-2", second.samples]]) {
  console.log(`=== ${label}: in-handler samples ===`);
  console.log(JSON.stringify(samples.map((s) => ({
    phase: s.phase,
    focusedPaneId: s.state.focusedPaneId,
    panes: s.state.panes.map((pane) => `${pane.paneId}:${pane.threadId ?? "board"}:${pane.focused ? "F" : "-"}`),
    target: s.targetThreadCard,
    activeElement: s.activeElement,
  })), null, 2));
}

console.log("=== click-1 timeline ===");
console.log(JSON.stringify(firstRows.filter((r) => ["before-pointerdown", "pointerdown:in-handler", "click:in-handler", "+50ms", "+200ms", "+500ms", "+1000ms", "+2000ms"].includes(r.phase)).map(summarize), null, 2));
console.log("=== click-2 timeline ===");
console.log(JSON.stringify(secondRows.filter((r) => ["before-pointerdown", "pointerdown:in-handler", "click:in-handler", "+50ms", "+200ms", "+500ms", "+1000ms", "+2000ms"].includes(r.phase)).map(summarize), null, 2));
console.log("=== errors ===", errors);

await browser.close();
process.exit(0);
