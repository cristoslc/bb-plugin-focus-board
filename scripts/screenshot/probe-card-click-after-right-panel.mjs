// Does an action in the native thread pane (one that opens bb's right panel)
// change where the next card click lands?
//
// The report (operator, 2026-11-21, unconfirmed trigger): "sometimes when the
// native thread pane is open, clicking on a card then opens the legacy focus
// board thread pane instead of swapping the native one. This _may_ be
// occurring after an action is taken in the native pane that causes the right
// sidebar to open in bb."
//
// The click's own decision trace is the evidence (`nativeOpenDebug`, server.ts):
// one `[focus-board:native-open]` line per click naming the branch it took, the
// host's layout and the board's record. This probe turns that on for the run
// (it reads the value first, sets it, and puts the operator's value back), then
// drives the board's OWN cards against the live host in a throwaway browser
// profile, and after each click reads:
//
//   - the branch the click took (the trace line),
//   - the host's split layout (`bb.splitLayout`), read out of the profile,
//   - the board's own record (`focus-board:boardNativeThreadPane`),
//   - which surface the thread landed in: bb's native pane, or the board's own
//     in-panel pane (the `aside[aria-label^="Thread:"]` the report calls the
//     legacy pane).
//
// Phases, all from a fresh browser context (its own split layout, so nothing
// leaks between them, and nothing touches the operator's window):
//
//   A  baseline: click a card, click another. The shipped rule: the first
//      click asks the host for the split and adopts the pane it gets; the
//      second replaces that pane's thread.
//   B  the same, with bb's right panel opened in the native pane between the
//      two clicks (the pane header's own "Show right panel" control).
//   C  the pane rethreaded from inside it (a sidebar row), then a card click.
//   D  the right panel open, then the same rethread.
//   E  the stale state, then bb's own "Open in split" for a third thread: what
//      a fresh host split does there.
//   F  the pane navigated to a NON-THREAD route (the rail's Decisions entry),
//      then a card click. The operator's 2026-11-23 report names this shape
//      ("mostly when I navigate the native pane to a different location (like
//      Decisions)"): the layout reports that pane with `threadId: null`, which
//      is the one shape A-E never produced.
//   G  F repeated with a DIFFERENT page each cycle: a page route lands in the
//      pane that already holds it, or replaces the focused pane, so a new page
//      each time costs the window a pane. Measures what the fresh split leaves
//      behind.
//
// Usage: node scripts/screenshot/probe-card-click-after-right-panel.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR. Reads only apart from navigation and the
// two debug-setting writes described above.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-card-click-after-right-panel";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PLUGIN_ID = "focus-board";
/** A built `app.js` to serve in place of the installed one, so the probe can
 *  measure a candidate without touching the operator's install (the same trick
 *  probe-board-remount-on-split.mjs uses). Everything else — the host, its
 *  split renderer, the plugin's install — stays untouched. */
const SERVE_BUNDLE = process.env.SERVE_BUNDLE ?? null;
/** A string only the board's own bundle carries: the panel's root attribute. */
const BUNDLE_MARKER = "data-focus-board-panel";

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read a plugin setting through the bb CLI, or null when it cannot be read. */
function readPluginSetting(key) {
  try {
    const out = execFileSync("bb", ["plugin", "config", PLUGIN_ID], { encoding: "utf8" });
    const line = out.split("\n").find((candidate) => candidate.startsWith(`${key} = `));
    if (line === undefined) return null;
    const raw = line.slice(`${key} = `.length);
    return raw === "true" ? true : raw === "false" ? false : raw;
  } catch {
    return null;
  }
}

function writePluginSetting(key, value) {
  execFileSync("bb", ["plugin", "config", PLUGIN_ID, "set", key, String(value)], {
    encoding: "utf8",
  });
}

const EDGE = `${PLUGIN_ID}:boardNativeThreadPane`;

/** The whole state, read off the host's own rendered truth. */
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
  const aside = document.querySelector('aside[aria-label^="Thread:"]');
  const toggle = [...document.querySelectorAll('button')].find(
    (el) => /right panel/i.test(el.getAttribute('aria-label') ?? ''),
  );
  return {
    route: location.pathname,
    candidateBundle: window.__fbServedBundle ?? null,
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId:
        pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      focused: layout !== null && layout.focusedPaneId === pane.paneId,
      holdsBoard: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        return el !== null && board !== null && el.contains(board);
      })(),
      rect: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    })),
    renderedPaneCount: document.querySelectorAll('[data-split-pane-id]').length,
    boardMounted: board !== null,
    boardCards: document.querySelectorAll('[data-thread-card]').length,
    inBoardPane: aside === null ? null : aside.getAttribute('aria-label'),
    record: localStorage.getItem('${EDGE}'),
    rightPanelToggle:
      toggle === undefined
        ? null
        : {
            label: toggle.getAttribute('aria-label'),
            expanded: toggle.getAttribute('aria-expanded'),
          },
    // bb's right panel, as rendered inside the focused pane (bb's resizable
    // panel group carries data-split-resize-grid-root).
    rightPanel: (() => {
      const group = document.querySelector('[data-split-resize-grid-root]');
      if (group === null) return null;
      const panels = [...group.children].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width) };
      });
      return { panels };
    })(),
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});

const evidence = { app: APP, phases: {}, trace: [], console: [], navigations: [], errors: [] };

/** Which served app.js is the board's, sniffed by content, or null. */
async function findBoardBundle() {
  const sniff = await browser.createBrowserContext();
  const sniffPage = await sniff.newPage();
  await sniffPage.setCacheEnabled(false);
  const bodies = [];
  sniffPage.on("response", (response) => {
    const url = response.url();
    if (!/\/plugin-app-assets\/[a-f0-9]+\/app\.js$/.test(url)) return;
    bodies.push(response.text().then((body) => ({ url, hasBoard: body.includes(BUNDLE_MARKER) })));
  });
  await sniffPage.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1500);
  const found = (await Promise.all(bodies)).find((entry) => entry.hasBoard) ?? null;
  await sniff.close();
  return found === null ? null : found.url;
}

const candidateBundleUrl = SERVE_BUNDLE === null ? null : await findBoardBundle();
if (SERVE_BUNDLE !== null) {
  if (candidateBundleUrl === null) {
    console.error("Could not identify the board's app.js among the served plugin assets.");
    await browser.close();
    process.exit(1);
  }
  console.log(`serving ${SERVE_BUNDLE} for ${candidateBundleUrl}`);
  evidence.servedBundle = SERVE_BUNDLE;
}
let context = null;
let page = null;

async function startPhase() {
  if (context !== null) await context.close();
  context = await browser.createBrowserContext();
  page = await context.newPage();
  await page.setCacheEnabled(false);
  if (candidateBundleUrl !== null && SERVE_BUNDLE !== null) {
    const swapped = `${readFileSync(SERVE_BUNDLE, "utf8")}\n;window.__fbServedBundle = "swapped";\n`;
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url() !== candidateBundleUrl) {
        void request.continue();
        return;
      }
      void request.respond({
        status: 200,
        contentType: "application/javascript; charset=utf-8",
        body: swapped,
      });
    });
  }
  page.on("console", async (message) => {
    const text = message.text();
    if (!text.includes("[focus-board:native-open]")) {
      if (currentPhase === "C" || currentPhase === "D") {
        evidence.console.push({ phase: currentPhase, type: message.type(), text: text.slice(0, 400) });
      }
      return;
    }
    const payloads = [];
    for (const arg of message.args()) {
      try {
        payloads.push(await arg.jsonValue());
      } catch {
        payloads.push(message.text());
      }
    }
    evidence.trace.push({ phase: currentPhase, payloads });
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      evidence.navigations.push({ phase: currentPhase, url: frame.url() });
    }
  });
  page.on("pageerror", (error) => evidence.errors.push(String(error).slice(0, 300)));
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(6000);
}

let currentPhase = null;

async function read(label) {
  const state = await page.evaluate(READ_STATE);
  state.label = label;
  await page.screenshot({ path: `${OUT_DIR}/${currentPhase}-${label}.png` });
  return state;
}

/** The Nth board card's click point, scrolled into view and hit-tested at
 *  read time: a point computed before another card's scroll is a stale point,
 *  and a click on one lands nowhere. */
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
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      threadId: card.getAttribute("data-thread-card"),
      x,
      y,
      hitInCard: hit !== null && card.contains(hit),
    };
  }, index);
}

async function clickCard(index) {
  const point = await cardPoint(index);
  if (point === null) throw new Error(`no card ${index}`);
  await page.mouse.move(point.x, point.y);
  await sleep(350);
  await page.mouse.click(point.x, point.y);
  await sleep(2500);
  return point;
}

/** The click's own timeline: what the window shows every 100ms after the
 *  press, so a surface that opens and closes again is still visible. */
async function clickCardSampled(index, label) {
  const point = await cardPoint(index);
  if (point === null) throw new Error(`no card ${index}`);
  await page.mouse.move(point.x, point.y);
  await sleep(350);
  await page.mouse.click(point.x, point.y);
  const samples = [];
  for (let i = 0; i < 25; i += 1) {
    await sleep(100);
    const state = await page.evaluate(READ_STATE);
    samples.push({
      at: (i + 1) * 100,
      route: state.route,
      paneCount: state.paneCount,
      focusedPaneId: state.focusedPaneId,
      panes: state.panes.map(
        (pane) => `${pane.paneId}:${pane.threadId ?? pane.kind}${pane.focused ? ":F" : ""}`,
      ),
      inBoardPane: state.inBoardPane,
      record: state.record,
    });
  }
  return { point, label, samples };
}

/** bb's own "Show right panel" control in the focused thread pane. */
async function openRightPanel() {
  const point = await page.evaluate(() => {
    const toggle = [...document.querySelectorAll("button")].find(
      (el) =>
        /right panel/i.test(el.getAttribute("aria-label") ?? "") &&
        el.getBoundingClientRect().width > 0,
    );
    if (toggle === undefined) return null;
    const r = toggle.getBoundingClientRect();
    return {
      label: toggle.getAttribute("aria-label"),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  });
  if (point === null) return null;
  await page.mouse.click(point.x, point.y);
  await sleep(1500);
  return point;
}

/** bb's own sidebar row for a thread, clicked plainly: the app route becomes
 *  that thread, and bb's reconciliation lands it in the FOCUSED pane — which is
 *  the native thread pane right after a card click. That is a pane rethread,
 *  the other way a pane stops matching the board's record. */
async function plainSidebarClick(threadId) {
  const point = await page.evaluate((id) => {
    const anchor = [...document.querySelectorAll('a[href*="/threads/"]')].find(
      (candidate) =>
        (candidate.getAttribute("href") ?? "").includes(id) &&
        candidate.getBoundingClientRect().x < 320,
    );
    if (anchor === undefined) return null;
    anchor.scrollIntoView({ block: "center" });
    const r = anchor.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, threadId);
  if (point === null) return null;
  await page.mouse.click(point.x, point.y);
  await sleep(2500);
  return point;
}

/** bb's own "Open in split" on a sidebar row: the same host placement the
 *  board's click asks for (`openThreadInSplit`), driven from bb's UI so the
 *  probe can see what that ask does in a given layout. Right-click opens no
 *  split entry for a thread that is already in a pane. */
async function openInSplit(threadId) {
  const row = await page.evaluate((id) => {
    const anchor = [...document.querySelectorAll('a[href*="/threads/"]')].find(
      (candidate) =>
        (candidate.getAttribute("href") ?? "").includes(id) &&
        candidate.getBoundingClientRect().x < 320,
    );
    if (anchor === undefined) return null;
    anchor.scrollIntoView({ block: "center" });
    const r = anchor.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, threadId);
  if (row === null) return null;
  await page.mouse.move(row.x, row.y);
  await sleep(300);
  await page.mouse.click(row.x, row.y, { button: "right" });
  await sleep(900);
  const item = await page.evaluate(() => {
    const entries = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.textContent ?? "").trim().slice(0, 60),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          visible: r.width > 0,
        };
      })
      .filter((entry) => entry.visible && /open in split/i.test(entry.label));
    return entries[0] ?? null;
  });
  if (item === null) return null;
  await page.mouse.click(item.x, item.y);
  await sleep(2500);
  return item;
}

/** Press inside the board's pane, away from any card: the host focuses the
 *  pane on press, which is the state a card click starts in. */
async function focusBoardPane() {
  const point = await page.evaluate(() => {
    const board = document.querySelector("[data-focus-board-panel]");
    if (board === null) return null;
    const r = board.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 20) };
  });
  if (point === null) return null;
  await page.mouse.click(point.x, point.y);
  await sleep(900);
  return point;
}

/** bb's rail entry for a PAGE, clicked plainly: the app route becomes that
 *  page and bb's reconciliation lands it in the pane that already holds it,
 *  or else in the FOCUSED pane. A page is not a thread, so the pane the
 *  operator navigated this way survives with no thread at all — the state
 *  phase F measures. Labels are the rail button's own (`Decisions, 39 pending
 *  decisions`), matched by prefix because the count changes. */
async function navigateFocusedPaneToPage(label) {
  const point = await page.evaluate((wanted) => {
    const button = [...document.querySelectorAll("button")].find(
      (el) =>
        (el.getAttribute("aria-label") ?? "").startsWith(wanted) &&
        el.getBoundingClientRect().width > 0,
    );
    if (button === undefined) return null;
    const r = button.getBoundingClientRect();
    return {
      label: button.getAttribute("aria-label"),
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  }, label);
  if (point === null) return null;
  await page.mouse.click(point.x, point.y);
  await sleep(2500);
  return point;
}

/** A card whose thread no pane holds: the click has to ask the host for
 *  placement, which is the only ask that can cost a pane. Picking by index
 *  would re-click a thread that is already in a pane once the board narrows,
 *  and the ask would then only focus it. */
async function clickFreeCard() {
  const point = await page.evaluate(() => {
    let layout = null;
    try {
      const raw = localStorage.getItem("bb.splitLayout");
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        layout = parsed && parsed.layout ? parsed.layout : parsed;
      }
    } catch {}
    const panes = [];
    const flatten = (node) => {
      if (node === null || node === undefined) return;
      if (node.type === "pane") {
        panes.push(node);
        return;
      }
      for (const child of node.children ?? []) flatten(child);
    };
    flatten(layout === null ? null : layout.root);
    const taken = new Set(
      panes
        .filter((pane) => pane.content && pane.content.kind === "thread")
        .map((pane) => pane.content.threadId),
    );
    const cards = [...document.querySelectorAll("[data-thread-card]")].filter(
      (el) => el.parentElement?.closest("[data-thread-card]") === null,
    );
    const card = cards.find((el) => !taken.has(el.getAttribute("data-thread-card")));
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
  });
  if (point === null) return null;
  await page.mouse.move(point.x, point.y);
  await sleep(350);
  await page.mouse.click(point.x, point.y);
  await sleep(2200);
  return point;
}

// ---------------------------------------------------------------------------
// A. Baseline: two clicks, no right panel.
// ---------------------------------------------------------------------------
currentPhase = "A";
await startPhase();
evidence.phases.A = {};
evidence.phases.A.board = await read("1-board");
evidence.phases.A.firstCard = await clickCard(0);
evidence.phases.A.firstClick = await read("2-first-click");
evidence.phases.A.secondCard = await clickCard(1);
evidence.phases.A.secondClick = await read("3-second-click");

// ---------------------------------------------------------------------------
// B. The right panel opened in the native pane between the two clicks.
// ---------------------------------------------------------------------------
currentPhase = "B";
await startPhase();
evidence.phases.B = {};
evidence.phases.B.board = await read("1-board");
evidence.phases.B.firstCard = await clickCard(0);
evidence.phases.B.firstClick = await read("2-first-click");
evidence.phases.B.panelToggle = await openRightPanel();
evidence.phases.B.panelOpen = await read("3-right-panel-open");
evidence.phases.B.secondCard = await clickCard(1);
evidence.phases.B.secondClick = await read("4-second-click");

// ---------------------------------------------------------------------------
// C. The native pane rethreaded from inside it (bb's own sidebar row), then a
//    card click. Not the operator's guess; the other way a pane stops matching
//    the board's record.
// ---------------------------------------------------------------------------
currentPhase = "C";
await startPhase();
evidence.phases.C = {};
evidence.phases.C.board = await read("1-board");
evidence.phases.C.firstCard = await clickCard(0);
evidence.phases.C.firstClick = await read("2-first-click");
const rethreadThread = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
    (anchor) => anchor.getBoundingClientRect().x < 320,
  );
  const match = rows[1] === undefined ? null : /\/threads\/(thr_[A-Za-z0-9]+)/.exec(rows[1].getAttribute("href") ?? "");
  return match === null ? null : match[1];
});
if (rethreadThread !== null) {
  evidence.phases.C.rethreaded = await plainSidebarClick(rethreadThread);
  evidence.phases.C.rethreadedState = await read("3-rethreaded");
}
evidence.phases.C.sampledClick = await clickCardSampled(2, "card-click-after-rethread");
evidence.phases.C.cardClickAfterRethread = await read("4-card-click-after-rethread");

// ---------------------------------------------------------------------------
// D. Both: the right panel opened in the native pane, then the pane rethreaded,
//    then a card click.
// ---------------------------------------------------------------------------
currentPhase = "D";
await startPhase();
evidence.phases.D = {};
evidence.phases.D.board = await read("1-board");
evidence.phases.D.firstCard = await clickCard(0);
evidence.phases.D.firstClick = await read("2-first-click");
evidence.phases.D.panelToggle = await openRightPanel();
evidence.phases.D.panelOpen = await read("3-right-panel-open");
if (rethreadThread !== null) {
  evidence.phases.D.rethreaded = await plainSidebarClick(rethreadThread);
  evidence.phases.D.rethreadedState = await read("4-rethreaded");
}
evidence.phases.D.sampledClick = await clickCardSampled(2, "card-click-after-rethread");
evidence.phases.D.cardClickAfterRethread = await read("5-card-click-after-rethread");

// ---------------------------------------------------------------------------
// E. What a fresh host split does from the stale state: the premise the repair
//    rests on. With the pane rethreaded and the board focused (where every card
//    click starts), bb's own split placement for a third thread must add a pane
//    BESIDE the board, not take the board's slot.
// ---------------------------------------------------------------------------
currentPhase = "E";
await startPhase();
evidence.phases.E = {};
evidence.phases.E.board = await read("1-board");
evidence.phases.E.firstCard = await clickCard(0);
evidence.phases.E.firstClick = await read("2-first-click");
const rethreadThreadE = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
    (anchor) => anchor.getBoundingClientRect().x < 320,
  );
  const match = rows[1] === undefined ? null : /\/threads\/(thr_[A-Za-z0-9]+)/.exec(rows[1].getAttribute("href") ?? "");
  return match === null ? null : match[1];
});
if (rethreadThreadE !== null) {
  evidence.phases.E.rethreaded = await plainSidebarClick(rethreadThreadE);
  evidence.phases.E.rethreadedState = await read("3-rethreaded");
}
evidence.phases.E.boardFocused = await focusBoardPane();
evidence.phases.E.boardFocusedState = await read("4-board-focused");
const freshThread = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
    (anchor) => anchor.getBoundingClientRect().x < 320,
  );
  const match = rows[2] === undefined ? null : /\/threads\/(thr_[A-Za-z0-9]+)/.exec(rows[2].getAttribute("href") ?? "");
  return match === null ? null : match[1];
});
if (freshThread !== null) {
  evidence.phases.E.freshThread = freshThread;
  evidence.phases.E.splitEntry = await openInSplit(freshThread);
  evidence.phases.E.afterSplit = await read("5-after-host-split");
}

// ---------------------------------------------------------------------------
// F. The native pane navigated to a NON-THREAD route (the rail's Decisions
//    page), then a card click: the shape the operator reported on 2026-11-23
//    ("mostly when I navigate the native pane to a different location (like
//    Decisions)"). The pane survives the navigation with `threadId: null`, so
//    the board's `{paneId, threadId}` record no longer matches it — the same
//    mismatch phase C produces, reached a different way.
// ---------------------------------------------------------------------------
currentPhase = "F";
await startPhase();
evidence.phases.F = {};
evidence.phases.F.board = await read("1-board");
evidence.phases.F.firstCard = await clickCard(0);
evidence.phases.F.firstClick = await read("2-first-click");
evidence.phases.F.pageEntry = await navigateFocusedPaneToPage("Decisions");
evidence.phases.F.navigated = await read("3-decisions-in-the-pane");
// The record is unchanged by the navigation: the board still believes the pane
// holds the thread it put there.
evidence.phases.F.recordAfterNavigation = evidence.phases.F.navigated.record;
evidence.phases.F.sampledClick = await clickCardSampled(1, "card-click-after-decisions");
evidence.phases.F.cardClickAfterDecisions = await read("4-card-click-after-decisions");

// ---------------------------------------------------------------------------
// G. F repeated, a DIFFERENT page each cycle. bb's own navigation rule lands a
//    route in the pane that already holds it and otherwise replaces the
//    focused pane, so a page the window has not shown yet takes a pane of its
//    own. Three cycles is enough to see the direction, and the board narrows
//    as panes accumulate, so the loop stops when no free card is left to click.
// ---------------------------------------------------------------------------
currentPhase = "G";
await startPhase();
evidence.phases.G = {};
evidence.phases.G.board = await read("1-board");
evidence.phases.G.firstCard = await clickCard(0);
evidence.phases.G.firstClick = await read("2-first-click");
evidence.phases.G.cycles = [];
for (const page of ["Automations", "Decisions", "Activity Overview"]) {
  const entry = await navigateFocusedPaneToPage(page);
  if (entry === null) {
    evidence.phases.G.cycles.push({ page, entry: null, note: "no rail entry" });
    continue;
  }
  const navigated = await read(`${evidence.phases.G.cycles.length + 3}-${page.replace(/\W+/g, "-").toLowerCase()}`);
  const clicked = await clickFreeCard();
  if (clicked === null) {
    evidence.phases.G.cycles.push({
      page,
      entry,
      paneCountAfterNavigation: navigated.paneCount,
      card: null,
      note: "the board had no free card left to click",
    });
    break;
  }
  const after = await read(`${evidence.phases.G.cycles.length + 3}-${page.replace(/\W+/g, "-").toLowerCase()}-clicked`);
  evidence.phases.G.cycles.push({
    page,
    entry,
    paneCountAfterNavigation: navigated.paneCount,
    panesAfterNavigation: navigated.panes,
    card: clicked.threadId,
    paneCountAfterClick: after.paneCount,
    panesAfterClick: after.panes,
    record: after.record,
    inBoardPane: after.inBoardPane,
  });
}

writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));

const summarize = (state) => ({
  label: state === undefined ? null : state.label,
  route: state?.route,
  paneCount: state?.paneCount,
  renderedPaneCount: state?.renderedPaneCount,
  focusedPaneId: state?.focusedPaneId,
  panes: (state?.panes ?? []).map(
    (pane) => `${pane.paneId}:${pane.threadId ?? pane.kind}${pane.focused ? ":F" : ""}`,
  ),
  inBoardPane: state?.inBoardPane,
  record: state?.record,
  rightPanelToggle: state?.rightPanelToggle,
  rightPanel: state?.rightPanel,
});

for (const phase of ["A", "B", "C", "D", "E", "F", "G"]) {
  const rows = Object.fromEntries(
    Object.entries(evidence.phases[phase])
      .filter(([, value]) => value?.label !== undefined)
      .map(([key, value]) => [key, summarize(value)]),
  );
  console.log(`=== ${phase} ===`);
  console.log(JSON.stringify(rows, null, 2));
}
console.log("=== G cycles ===");
console.log(JSON.stringify(evidence.phases.G.cycles, null, 2));
console.log("=== trace ===");
console.log(JSON.stringify(evidence.trace, null, 2));
console.log("=== errors ===", evidence.errors);

await browser.close();
process.exit(0);
