// Can a plugin focus a split pane that shows no thread?
//
// The card click's replace rule is "focus the pane, then navigate into it",
// because bb lands a navigation in the FOCUSED pane. For a pane showing another
// thread there is a lever the click already uses (`open(thatThread, { split:
// true })` focuses the pane holding it). For a pane showing NO thread — a page
// route like Decisions — there is no thread to open, and nothing in this repo
// knows how to focus such a pane. This probe measures the two candidates,
// ranked:
//
//   1. A host command surface. The host's keybinding vocabulary names
//      `pane.focus.1`…`pane.focus.8`, `pane.focus.next`, `.previous`, and the
//      four arrow moves. A command a PLUGIN can invoke would focus the pane.
//      Measured here as a fact about the installed SDK typings
//      (`@get-bb/plugin-sdk`: no command-invocation export exists), and the
//      runtime half — whether the host runs a pane focus from anything the
//      plugin can reach — is what phases 1–3 measure.
//   2. A synthetic press on the pane container. bb focuses a pane in that
//      element's own pointer handler: `onPointerDown` → `onFocusPane(paneId)`
//      on the workspace route's pane chrome, which also marks the pane
//      `data-focused="true"`. A dispatched `pointerdown` may run the same
//      handler a real press does.
//
// Every phase runs in its own browser context against the live host: no storage
// and no split layout shared with the operator's window. The probe reads only,
// apart from navigation, a real press to put the board's pane back in focus,
// and the synthetic dispatches themselves.
//
// Usage: node scripts/screenshot/probe-pane-focus-lever.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-pane-focus-lever";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The whole state, read off the host's own rendered truth. `data-focused` is
 *  the DOM's own claim about the same fact the layout's `focusedPaneId` holds,
 *  so the two can be compared. */
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
  return {
    route: location.pathname,
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId:
        pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      focused: layout !== null && layout.focusedPaneId === pane.paneId,
      domFocused: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        return el === null ? null : el.getAttribute('data-focused');
      })(),
      holdsBoard: (() => {
        const el = document.querySelector('[data-split-pane-id="' + pane.paneId + '"]');
        return el !== null && board !== null && el.contains(board);
      })(),
    })),
    boardMounted: board !== null,
    boardCards: document.querySelectorAll('[data-thread-card]').length,
    inBoardPane: aside === null ? null : aside.getAttribute('aria-label'),
    record: localStorage.getItem('focus-board:boardNativeThreadPane'),
  };
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});

const evidence = { app: APP, phases: {}, navigations: [], errors: [] };
let context = null;
let page = null;
let currentPhase = null;

async function startPhase() {
  if (context !== null) await context.close();
  context = await browser.createBrowserContext();
  page = await context.newPage();
  await page.setCacheEnabled(false);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      evidence.navigations.push({ phase: currentPhase, url: frame.url() });
    }
  });
  page.on("pageerror", (error) => evidence.errors.push(String(error).slice(0, 300)));
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(6000);
}

async function read(label) {
  const state = await page.evaluate(READ_STATE);
  state.label = label;
  await page.screenshot({ path: `${OUT_DIR}/${currentPhase}-${label}.png` });
  return state;
}

/** The Nth board card's click point, scrolled into view and hit-tested at read
 *  time (a point computed before a scroll lands nowhere). */
async function clickCard(index) {
  const point = await page.evaluate((i) => {
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
  if (point === null) return null;
  await page.mouse.move(point.x, point.y);
  await sleep(350);
  await page.mouse.click(point.x, point.y);
  await sleep(2500);
  return point;
}

/** Press inside the board's pane, away from any card: the host focuses the
 *  pane on press. This is the state every card click starts in, so a focus
 *  measurement starts from it too. */
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

/** bb's rail entry for a PAGE, clicked plainly: the route becomes that page and
 *  bb lands it in the FOCUSED pane, so the board's own pane can be navigated to
 *  a non-thread route — the shape phase 2 needs. */
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

/** bb's own sidebar row for a thread, clicked plainly: the app route becomes
 *  that thread, and the router lands it in the FOCUSED pane. This is the same
 *  navigation the board's own landing (`navigate.toThread`) performs, so it can
 *  stand in for it in a probe that cannot run the plugin's code path. */
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

/** A sidebar thread id in the first N rows, so a phase can name one without
 *  hard-coding. */
async function sidebarThreadId(row) {
  return page.evaluate((index) => {
    const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
      (anchor) => anchor.getBoundingClientRect().x < 320,
    );
    const match =
      rows[index] === undefined
        ? null
        : /\/threads\/(thr_[A-Za-z0-9_-]+)/.exec(rows[index].getAttribute("href") ?? "");
    return match === null ? null : match[1];
  }, row);
}

/** The pane the last state named with no thread AND no board inside it: the
 *  target a page-route phase dispatches at. Both panes report `threadId: null`
 *  once the board's pane is navigated to a page, and the board's own pane is
 *  the one the dispatch must never touch, so "no thread" alone names the wrong
 *  pane. */
function pagePaneId(state) {
  const pane = state.panes.find(
    (candidate) => candidate.threadId === null && !candidate.holdsBoard,
  );
  return pane === undefined ? null : pane.paneId;
}

function threadPaneId(state) {
  const pane = state.panes.find((candidate) => candidate.threadId !== null);
  return pane === undefined ? null : pane.paneId;
}

/**
 * Dispatch a press at the pane container, the way a real pointer press reaches
 * it: at the container element itself, bubbling.
 *
 * `kind` names the event shape so the phases can compare them:
 *   - `pointerdown`: a PointerEvent, bubbles, button 0, pointerId 1.
 *   - `pointerdown-no-bubbles`: the same without `bubbles`, to show whether the
 *     host listens on the element or delegates higher.
 *   - `mousedown`: a MouseEvent, in case the host's handler is `onMouseDown`.
 *   - `pointerdown-on-child`: at a descendant (the pane's own content area),
 *     which is how a real press inside the pane arrives.
 */
async function dispatchPress(paneId, kind) {
  return page.evaluate(
    (id, shape) => {
      const el = document.querySelector('[data-split-pane-id="' + id + '"]');
      if (el === null) return { dispatched: false, reason: "no pane container" };
      const target =
        shape === "pointerdown-on-child"
          ? [...el.querySelectorAll("*")].find(
              (node) => node instanceof HTMLElement && node.offsetWidth > 0 && node.offsetHeight > 0,
            ) ?? el
          : el;
      const init = {
        bubbles: shape !== "pointerdown-no-bubbles",
        cancelable: true,
        button: 0,
        buttons: 1,
        clientX: Math.round(el.getBoundingClientRect().x + 20),
        clientY: Math.round(el.getBoundingClientRect().y + 20),
      };
      const event =
        shape === "mousedown"
          ? new MouseEvent("mousedown", init)
          : new PointerEvent("pointerdown", {
              ...init,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
            });
      target.dispatchEvent(event);
      return {
        dispatched: true,
        kind: shape,
        at: target === el ? "container" : "child",
        targetTag: target.tagName,
        defaultPrevented: event.defaultPrevented,
      };
    },
    paneId,
    kind,
  );
}

/** The pane focus as both sources report it, one line. */
function focusLine(state) {
  return {
    focusedPaneId: state.focusedPaneId,
    domFocused: state.panes.filter((pane) => pane.domFocused === "true").map((pane) => pane.paneId),
    panes: state.panes.map(
      (pane) => `${pane.paneId}:${pane.threadId ?? pane.kind}${pane.focused ? ":F" : ""}`,
    ),
  };
}
/** One focus attempt: dispatch, then read after a short and a long wait so a
 *  focus that lands and is then reverted is visible. */
async function attemptFocus(paneId, kind, label) {
  const dispatch = await dispatchPress(paneId, kind);
  await sleep(400);
  const immediate = await read(`${label}-immediate`);
  await sleep(1200);
  const settled = await read(`${label}-settled`);
  return { dispatch, immediate: focusLine(immediate), settled: focusLine(settled), settledState: settled };
}

// ---------------------------------------------------------------------------
// 1. A pane showing a THREAD, while the board's pane is focused. The control:
//    the click already focuses this shape through `open(thread, { split })`,
//    so a synthetic press that focuses it too proves the lever itself works.
// ---------------------------------------------------------------------------
currentPhase = "1";
await startPhase();
evidence.phases["1"] = {};
evidence.phases["1"].board = await read("1-board");
evidence.phases["1"].card = await clickCard(0);
evidence.phases["1"].afterClick = await read("2-native-pane");
evidence.phases["1"].boardRefocused = await focusBoardPane();
evidence.phases["1"].beforePress = await read("3-board-focused");
{
  const target = threadPaneId(evidence.phases["1"].beforePress);
  evidence.phases["1"].target = target;
  evidence.phases["1"].pointerdown = await attemptFocus(target, "pointerdown", "4-thread-pane");
}

// ---------------------------------------------------------------------------
// 2. A pane showing NO thread (the rail's Decisions page), while the board's
//    pane is focused. This is the shape the ruling needs and the lever the
//    repo does not have: every candidate dispatch shape is tried here.
// ---------------------------------------------------------------------------
currentPhase = "2";
await startPhase();
evidence.phases["2"] = {};
evidence.phases["2"].board = await read("1-board");
evidence.phases["2"].card = await clickCard(0);
evidence.phases["2"].afterClick = await read("2-native-pane");
evidence.phases["2"].pageEntry = await navigateFocusedPaneToPage("Decisions");
evidence.phases["2"].pageInPane = await read("3-decisions-in-the-pane");
evidence.phases["2"].boardRefocused = await focusBoardPane();
const beforePagePress = await read("4-board-focused");
evidence.phases["2"].beforePress = beforePagePress;
const targetPagePane = pagePaneId(beforePagePress);
evidence.phases["2"].target = targetPagePane;
evidence.phases["2"].pointerdown = await attemptFocus(targetPagePane, "pointerdown", "5-page-pane");
// Each further shape restarts from the same state: the board's pane focused and
// the page pane still holding the page.
evidence.phases["2"].reFocused = await focusBoardPane();
evidence.phases["2"].reFocusedState = await read("6-board-focused-again");
evidence.phases["2"].pointerdownNoBubbles = await attemptFocus(
  targetPagePane,
  "pointerdown-no-bubbles",
  "7-page-pane-no-bubbles",
);
evidence.phases["2"].reFocusedAgain = await focusBoardPane();
evidence.phases["2"].mousedown = await attemptFocus(targetPagePane, "mousedown", "8-page-pane-mousedown");
evidence.phases["2"].reFocusedThird = await focusBoardPane();
evidence.phases["2"].pointerdownOnChild = await attemptFocus(
  targetPagePane,
  "pointerdown-on-child",
  "9-page-pane-child",
);

// ---------------------------------------------------------------------------
// 3. The whole rule end to end on the page-route shape: focus the page pane
//    with whichever dispatch phase 2 proved, then navigate a thread into it
//    (a sidebar row: the router's own navigation, which is what the board's
//    landing does). The page pane must be the one replaced, the board's pane
//    untouched, the pane count flat.
// ---------------------------------------------------------------------------
currentPhase = "3";
await startPhase();
evidence.phases["3"] = {};
evidence.phases["3"].board = await read("1-board");
evidence.phases["3"].card = await clickCard(0);
evidence.phases["3"].afterClick = await read("2-native-pane");
evidence.phases["3"].pageEntry = await navigateFocusedPaneToPage("Decisions");
evidence.phases["3"].pageInPane = await read("3-decisions-in-the-pane");
evidence.phases["3"].boardRefocused = await focusBoardPane();
const beforeLanding = await read("4-board-focused");
evidence.phases["3"].beforeLanding = beforeLanding;
const landingTarget = pagePaneId(beforeLanding);
evidence.phases["3"].target = landingTarget;
evidence.phases["3"].focus = await attemptFocus(landingTarget, "pointerdown", "5-page-pane-focused");
const landingThread = await sidebarThreadId(1);
evidence.phases["3"].landingThread = landingThread;
if (landingThread !== null) {
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
      (anchor) => anchor.getBoundingClientRect().x < 320,
    );
    const match =
      rows[1] === undefined ? null : /\/threads\/(thr_[A-Za-z0-9_-]+)/.exec(rows[1].getAttribute("href") ?? "");
    return match === null ? null : match[1];
  });
  evidence.phases["3"].navigation = await plainSidebarClick(clicked ?? landingThread);
}
evidence.phases["3"].afterLanding = await read("6-thread-landed");
evidence.phases["3"].afterLandingFocus = focusLine(evidence.phases["3"].afterLanding);

writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));

const summarize = (state) =>
  state === undefined || state.panes === undefined
    ? state
    : {
        label: state.label,
        route: state.route,
        paneCount: state.paneCount,
        focusedPaneId: state.focusedPaneId,
        domFocused: state.panes
          .filter((pane) => pane.domFocused === "true")
          .map((pane) => pane.paneId),
        panes: state.panes.map(
          (pane) => `${pane.paneId}:${pane.threadId ?? pane.kind}${pane.focused ? ":F" : ""}`,
        ),
        boardPane: state.panes
          .filter((pane) => pane.holdsBoard)
          .map((pane) => pane.paneId),
        inBoardPane: state.inBoardPane,
        record: state.record,
      };

function printPhase(phase) {
  console.log(`=== ${phase} ===`);
  const rows = {};
  for (const [key, value] of Object.entries(evidence.phases[phase])) {
    if (value?.label !== undefined) rows[key] = summarize(value);
    else if (value?.settledState !== undefined) {
      rows[key] = {
        dispatch: value.dispatch,
        immediate: value.immediate,
        settled: value.settled,
      };
    } else rows[key] = value;
  }
  console.log(JSON.stringify(rows, null, 2));
}

for (const phase of ["1", "2", "3"]) printPhase(phase);
console.log("=== errors ===", evidence.errors);

await browser.close();
process.exit(0);
