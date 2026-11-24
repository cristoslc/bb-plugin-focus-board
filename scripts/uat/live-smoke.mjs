/**
 * The live smoke gate: six checks against the INSTALLED bb host, in a browser
 * context of its own.
 *
 * ## Why this gate exists
 *
 * The UAT suites and the screenshot harness prove the board's decisions
 * against a simulated host built from the SDK's documented surface. The
 * simulator cannot see bb's real thread page, the real opener's placement
 * rule, route reconciliation across panes, or a transformed ancestor. Every
 * pane defect of the last week lived in exactly that gap: the macOS popover
 * opening off screen (components/menu-popover.tsx's own history), the stale
 * record fallback of #510, and the split ratio being a host constant rather
 * than the board's choice. None of them was reachable from the harness.
 *
 * The operator's ruling (2026-11-24, decision `dec_b4wiwx3of87q`, option "add
 * a live smoke gate"; corpus entry `dl-20261124T051010-a016`) answers that
 * with a small fixed live set: four to six checks against the installed host
 * in a throwaway profile, recorded under `docs/uat/live-*.md`, run before a
 * cut whose changelog touches the pane or the click path. This file is that
 * set. It is deliberately six checks and two to three minutes, not a suite
 * replay: it is the last thing between a green build and the operator's own
 * window.
 *
 * ## The six, each one thing the operator would notice
 *
 * 1. A one-pane card click splits: two panes, the board still mounted, the
 *    clicked thread in the new pane.
 * 2. A second click replaces: that thread in the board's pane, no third pane.
 * 3. A click after the board's pane was navigated away: the ruling in force
 *    for an unresolvable pane record (see NAVIGATED_PANE_RULING).
 * 4. The board's in-panel pane header matches bb's native row: the Focus
 *    Board mark plus caret and no checkbox, at the same 48px row, in the same
 *    order.
 * 5. `/` focuses the search field with a second pane open, and the New Thread
 *    letter opens the composer.
 * 6. On bb's own thread page, the Focus Board menu opens ON SCREEN: its box
 *    inside the viewport, not merely present in the DOM.
 *
 * ## What it may not do
 *
 * - No silent skips. A missing host, an unloaded plugin, a check that cannot
 *   run: all of them exit non-zero with a sentence naming what was expected.
 *   A green run that proved nothing is the failure this gate exists to stop.
 * - Its own browser context every time (`browser.createBrowserContext`), never
 *   the operator's window, profile, or storage. Nothing here reads or writes a
 *   plugin setting; the panes and the board's pane record live only in that
 *   context's storage, which dies with the run.
 * - It drives a real bb, so it says what it touched. Opening a thread marks it
 *   read on the host, so the run prefers threads the host already marks read
 *   and lists every thread it opened in the report, with the read state it saw
 *   at the run's start.
 *
 * ## Running it
 *
 *   npm run live-smoke              # the gate, always, against the default host
 *   BB_APP=http://127.0.0.1:PORT/plugins/focus-board/board npm run live-smoke
 *   node scripts/uat/live-smoke.mjs --release
 *
 * `--release` is the release path's mode: it reads the `[Unreleased]` group,
 * prints the scope decision (scripts/uat/live-smoke-scope.ts), and drives the
 * host only when the cut touches the pane or the click path. Every other
 * invocation runs the checks; there is no third state and no override.
 *
 * Honors BB_APP, CHROME_PATH, OUT_DIR (a frames dir; defaults to
 * docs/screenshots/live-smoke/<run>/) and LIVE_SMOKE_REPORT. The report lands
 * at docs/uat/live-smoke.md, in the UAT reports' own shape.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { formatScopeDecision, paneClickScope } from "./live-smoke-scope.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BOARD_URL = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const BOARD_BASE = BOARD_URL.replace(/\/+$/, "");
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
/** The run's own stamp (`20261124T051010`): the frames dir and the evidence. */
const RUN = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "");
const FRAMES = process.env.OUT_DIR ?? `${ROOT}docs/screenshots/live-smoke/${RUN}`;
const REPORT = process.env.LIVE_SMOKE_REPORT ?? `${ROOT}docs/uat/live-smoke.md`;
const RELEASE_MODE = process.argv.includes("--release");
const PLUGIN_ID = "focus-board";
/** The board's record of the pane it opened (lib/native-pane-ownership.ts). */
const RECORD_KEY = `${PLUGIN_ID}:boardNativeThreadPane`;
/** The board's own panel root: bb sets it, and so does the board's bundle. */
const PANEL_ATTR = "data-focus-board-panel";
/** A pane container's attribute: the pane id the split layout reports. */
const PANE_ATTR = "data-split-pane-id";

/**
 * The pane ruling this gate asserts after the board's pane was navigated away,
 * and where it comes from.
 *
 * As built (bb 0.50.1 + the dev tree at 1.8.3-dev) `app.tsx`'s
 * `openThreadForInteraction` treats a `{paneId, threadId}` record that no
 * longer resolves as "the operator put something else in that pane": it
 * re-plans from the host's rendered truth and asks the opener for the CLICKED
 * thread, which bb places in a FRESH pane beside the board
 * (lib/native-fresh-pane.ts carries the rule and its live trace). So today's
 * outcome for check 3 is a third pane.
 *
 * The always-replace rule that changes this is in flight in
 * `bb/enforce-board-ownership-of-pane-id-thr_mdtar7xjwz`. When it merges, flip
 * this constant to "replace": check 3 then asserts the flat two-pane count and
 * the clicked thread in the board's own pane. Asserting exactly one of the two
 * is the point — a gate that accepted either would pass through the change
 * without noticing it.
 */
const NAVIGATED_PANE_RULING = "fresh-pane";

/** What to do when check 3's pane count says the ruling changed. */
const RULING_HINT =
  "if the always-replace work merged (bb/enforce-board-ownership-of-pane-id-thr_mdtar7xjwz), flip NAVIGATED_PANE_RULING in scripts/uat/live-smoke.mjs to \"replace\" and rerun";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Scope (--release only)
// ---------------------------------------------------------------------------
if (RELEASE_MODE) {
  const markdown = readFileSync(`${ROOT}CHANGELOG.md`, "utf8");
  const decision = paneClickScope(markdown);
  for (const line of formatScopeDecision(decision)) console.log(line);
  if (!decision.inScope) process.exit(0);
}

// ---------------------------------------------------------------------------
// Report machinery
// ---------------------------------------------------------------------------
/** One check: its title, its assertions, and the error that stopped it. */
const checks = [];
let currentCheck = null;
const mutations = [];
const evidence = {
  run: RUN,
  app: BOARD_URL,
  hostVersion: null,
  pluginVersion: null,
  ruling: NAVIGATED_PANE_RULING,
  cards: [],
  threads: [],
  steps: [],
  errors: [],
};

function startCheck(title) {
  currentCheck = { title, results: [], error: null };
  checks.push(currentCheck);
}

/** One assertion inside the check in progress. */
function ok(name, condition, detail = "") {
  currentCheck.results.push({ name, ok: Boolean(condition), detail });
  return Boolean(condition);
}

/** Run one check, recording a throw as that check's failure and nothing else. */
async function step(title, body) {
  startCheck(title);
  const started = Date.now();
  try {
    await body();
  } catch (error) {
    const message = String(error?.message ?? error);
    currentCheck.error = message;
    currentCheck.results.push({ name: "the check ran to completion", ok: false, detail: message });
    evidence.errors.push({ check: title, error: message });
  }
  currentCheck.ms = Date.now() - started;
}

const checkPassed = (check) =>
  check.error === null && check.results.length > 0 && check.results.every((result) => result.ok);

// ---------------------------------------------------------------------------
// Host facts (read from the CLI, never from the page)
// ---------------------------------------------------------------------------
function hostVersion() {
  try {
    return execFileSync("bb", ["--version"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function pluginVersion() {
  try {
    const out = execFileSync("bb", ["plugin", "list"], { encoding: "utf8" });
    const match = /^focus-board@(\S+)/m.exec(out);
    return match === null ? null : match[1];
  } catch {
    return null;
  }
}

/**
 * Every thread row, for the read states the report has to state. A failure
 * here is not fatal to the checks — it only costs the report its read-state
 * column, and the report says so instead of pretending the threads were read.
 */
function threadRows() {
  try {
    const rows = JSON.parse(execFileSync("bb", ["thread", "list", "--json"], { encoding: "utf8" }));
    if (!Array.isArray(rows)) return { rows: null, error: "bb thread list --json returned no array" };
    return { rows, error: null };
  } catch (error) {
    return { rows: null, error: String(error?.message ?? error) };
  }
}

/** A thread the run opened: already read at the start, or not. */
function readStateOf(rows, threadId) {
  if (rows === null) return "unknown";
  const row = rows.find((candidate) => candidate.id === threadId);
  if (row === undefined) return "unknown";
  const readAt = row.lastReadAt ?? null;
  const updatedAt = row.updatedAt ?? null;
  if (readAt === null) return "unread";
  if (updatedAt === null) return "read";
  return readAt >= updatedAt ? "read" : "unread";
}

// ---------------------------------------------------------------------------
// Page-side reads
// ---------------------------------------------------------------------------
/** The whole window state, read off the host's own persisted layout. */
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
  const board = document.querySelector('[${PANEL_ATTR}]');
  const aside = document.querySelector('aside[role="complementary"][aria-label^="Thread:"]');
  const dialog = document.querySelector('[role="dialog"]');
  return {
    url: location.href,
    route: location.pathname,
    paneCount: panes.length,
    renderedPaneCount: document.querySelectorAll('[${PANE_ATTR}]').length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId:
        pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      focused: layout !== null && layout.focusedPaneId === pane.paneId,
      holdsBoard: (() => {
        const el = document.querySelector('[${PANE_ATTR}="' + pane.paneId + '"]');
        return el !== null && board !== null && el.contains(board);
      })(),
    })),
    boardMounted: board !== null,
    boardCards: document.querySelectorAll('[data-thread-card]').length,
    inBoardPane: aside === null ? null : aside.getAttribute('aria-label'),
    record: localStorage.getItem('${RECORD_KEY}'),
    searchField: document.querySelector('input[aria-label="Search threads"]') !== null,
    searchFieldFocused:
      document.querySelector('input[aria-label="Search threads"]') === document.activeElement,
    composerOpen: dialog !== null,
    composerBox: (() => {
      if (dialog === null) return null;
      const r = dialog.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    dialogText: dialog === null ? null : (dialog.textContent ?? '').trim().slice(0, 80),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
})()`;

const readState = (page) => page.evaluate(READ_STATE);

/** The one-line window shape every failure message carries. */
function describe(state) {
  const panes = state.panes
    .map(
      (pane) =>
        `${pane.paneId}:${pane.kind}${pane.threadId === null ? "" : `(${pane.threadId})`}` +
        `${pane.holdsBoard ? "[board]" : ""}${pane.focused ? "[focused]" : ""}`,
    )
    .join(", ");
  return `${state.paneCount} pane(s) [${panes}] at ${state.route}`;
}

/** Poll the window until `predicate` holds, or fail naming what was awaited. */
async function waitForState(page, predicate, ms, what) {
  const started = Date.now();
  let last = await readState(page);
  while (Date.now() - started < ms) {
    if (predicate(last)) return last;
    await sleep(150);
    last = await readState(page);
  }
  throw new Error(`waited ${ms}ms for ${what}; the window held ${describe(last)}`);
}

const recordPaneId = (state) => {
  if (state.record === null) return null;
  try {
    const parsed = JSON.parse(state.record);
    return typeof parsed?.paneId === "string" ? parsed.paneId : null;
  } catch {
    return null;
  }
};

/** The board's own pane (the one holding the panel), or null. */
const boardPane = (state) => state.panes.find((pane) => pane.holdsBoard) ?? null;

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------
/**
 * Click a board card by thread id. The point is recomputed, scrolled into
 * view, and hit-tested at click time: a point measured before another card's
 * scroll lands nowhere.
 */
async function clickCard(page, threadId) {
  const point = await page.evaluate((id) => {
    const cards = [...document.querySelectorAll("[data-thread-card]")].filter(
      (el) => el.parentElement?.closest("[data-thread-card]") === null,
    );
    const card = cards.find((el) => el.getAttribute("data-thread-card") === id);
    if (card === undefined) return null;
    const anchor = card.querySelector("a");
    if (anchor === null) return null;
    anchor.scrollIntoView({ block: "center", inline: "center" });
    const r = anchor.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    return { x, y, hitInCard: hit !== null && card.contains(hit) };
  }, threadId);
  if (point === null) {
    throw new Error(`the board shows no card for ${threadId} (the check needs that card)`);
  }
  if (!point.hitInCard) {
    throw new Error(`the click point on ${threadId}'s card is covered by another element`);
  }
  await page.mouse.move(point.x, point.y);
  await sleep(350);
  await page.mouse.click(point.x, point.y);
  return point;
}

/** Click bb's own sidebar row for a thread: the host lands it in the focused
 *  pane, which is how an operator rethreads a pane without the board. */
async function clickSidebarRow(page, threadId) {
  const point = await page.evaluate((id) => {
    const anchor = [...document.querySelectorAll('a[href*="/threads/"]')].find(
      (candidate) =>
        (candidate.getAttribute("href") ?? "").includes(id) &&
        candidate.getBoundingClientRect().x < 320 &&
        candidate.getBoundingClientRect().width > 0,
    );
    if (anchor === undefined) return null;
    anchor.scrollIntoView({ block: "center" });
    const r = anchor.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, threadId);
  if (point === null) {
    throw new Error(`bb's sidebar shows no visible row for ${threadId} to rethread the pane with`);
  }
  await page.mouse.click(point.x, point.y);
  return point;
}

/**
 * A point inside the board that is not on a card, a link, a control, or a
 * field: the spot an operator clicks to give the board's pane the keyboard.
 */
async function emptyBoardPoint(page) {
  const point = await page.evaluate(() => {
    const board = document.querySelector("[data-focus-board-panel]");
    if (board === null) return null;
    const r = board.getBoundingClientRect();
    const interactive = "[data-thread-card], button, a, input, textarea, [role='button']";
    for (let gy = 0.2; gy <= 0.95; gy += 0.05) {
      for (let gx = 0.03; gx <= 0.97; gx += 0.04) {
        const x = Math.round(r.x + r.width * gx);
        const y = Math.round(r.y + r.height * gy);
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        const el = document.elementFromPoint(x, y);
        if (el === null || !board.contains(el)) continue;
        if (el.closest(interactive) !== null) continue;
        return { x, y };
      }
    }
    return null;
  });
  if (point === null) {
    throw new Error("no empty point inside the board to focus its pane with");
  }
  await page.mouse.click(point.x, point.y);
  await sleep(600);
  return point;
}

/** Both headers, measured the same way: the native split pane's and the
 *  board's own in-panel pane's. */
const MEASURE_HEADERS = `(function () {
  const board = document.querySelector('[${PANEL_ATTR}]');
  const measure = (header, row) => {
    if (header === null || row === null) return null;
    const h = header.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const trigger = header.querySelector('[data-thread-menu-trigger]');
    const triggerBox = trigger === null ? null : trigger.getBoundingClientRect();
    const maximize = header.querySelector(
      '[data-icon="Maximize2"], [aria-label*="Maximize" i], [aria-label*="Full" i]',
    );
    const maximizeBox = maximize === null ? null : maximize.getBoundingClientRect();
    return {
      header: { y: Math.round(h.y), h: Math.round(h.height) },
      row: { y: Math.round(r.y), h: Math.round(r.height) },
      triggers: header.querySelectorAll('[data-thread-menu-trigger]').length,
      trigger:
        trigger === null
          ? null
          : {
              aria: trigger.getAttribute("aria-label"),
              w: Math.round(triggerBox.width),
              h: Math.round(triggerBox.height),
              x: Math.round(triggerBox.x),
              mark: trigger.querySelector('[data-icon="FocusBoard"]') !== null,
              caret: trigger.querySelector('[data-icon="ChevronDown"]') !== null,
              checkbox:
                trigger.querySelector('[role="checkbox"], input[type="checkbox"]') !== null,
            },
      maximizeX: maximizeBox === null ? null : Math.round(maximizeBox.x),
      checkboxes: header.querySelectorAll(
        '[role="checkbox"], input[type="checkbox"]',
      ).length,
    };
  };
  const nativePane = [...document.querySelectorAll('[${PANE_ATTR}]')].find(
    (pane) => board === null || !pane.contains(board),
  );
  const nativeHeader = nativePane === undefined ? null : nativePane.querySelector("header");
  const nativeRow =
    nativeHeader === null
      ? null
      : nativeHeader.querySelector('[class*="chrome-row-height"]') ??
        nativeHeader.firstElementChild;
  const aside = document.querySelector('aside[role="complementary"][aria-label^="Thread:"]');
  const inPanelHeader = aside === null ? null : aside.querySelector("header");
  const inPanelRow = inPanelHeader === null ? null : inPanelHeader.firstElementChild;
  return {
    inPanel: measure(inPanelHeader, inPanelRow),
    native: measure(nativeHeader, nativeRow),
    nativePanePresent: nativePane !== undefined,
  };
})()`;

/** The thread page's Focus Board menu, measured on a context of its own so
 *  bb's own thread page is the whole window. */
async function threadPageMenu(browser, threadUrl, framePath) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (error) =>
    evidence.errors.push({ check: "thread-page", error: String(error).slice(0, 300) }),
  );
  try {
    await page.goto(threadUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector("[data-thread-menu-trigger]", { timeout: 20000 }).catch(() => {});
    const trigger = await page.evaluate(() => {
      const el = document.querySelector("[data-thread-menu-trigger]");
      if (el === null) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return {
        aria: el.getAttribute("aria-label"),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        visible: r.width > 0 && r.height > 0,
      };
    });
    if (trigger === null) return { trigger: null, menu: null };
    await page.mouse.click(trigger.x, trigger.y);
    await page.waitForSelector('[role="menu"]', { timeout: 5000 }).catch(() => {});
    const menu = await page.evaluate(() => {
      const el = document.querySelector('[role="menu"]');
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      const transformed = [];
      for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.transform !== "none") {
          transformed.push({
            tag: node.tagName,
            cls: (node.className || "").toString().slice(0, 60),
            transform: style.transform,
          });
        }
      }
      return {
        label: el.getAttribute("aria-label"),
        box: {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
        },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        rows: [...el.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].map((row) =>
          (row.textContent ?? "").trim(),
        ),
        transformAncestors: transformed,
      };
    });
    if (menu !== null) {
      await page.screenshot({
        path: framePath,
        clip: {
          x: Math.max(0, menu.box.x - 12),
          y: Math.max(0, menu.box.y - 12),
          width: Math.min(menu.box.w + 24, menu.viewport.w),
          height: Math.min(menu.box.h + 24, menu.viewport.h),
        },
      });
    }
    return { trigger, menu };
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
mkdirSync(FRAMES, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${FRAMES}/${name}.png` });

let browser = null;
let context = null;
let page = null;

const CHECK_TITLES = [
  "Preflight: the installed host, its version, and a fresh browser context",
  "A one-pane card click splits",
  "A second card click replaces the pane's thread",
  `A card click after the pane was navigated away keeps the native surface (ruling: ${NAVIGATED_PANE_RULING})`,
  `The board's pane header matches the native row`,
  "Slash focuses search with a second pane open, and the New Thread letter opens the composer",
  "A thread page's Focus Board menu opens on screen",
];

let cardA = null;
let cardB = null;
let cardD = null;
let rowsRead = null;
let rowsError = null;

try {
  // ---- Preflight ---------------------------------------------------------
  await step(CHECK_TITLES[0], async () => {
    evidence.hostVersion = hostVersion();
    evidence.pluginVersion = pluginVersion();
    ok(
      "the host version is readable (bb --version)",
      evidence.hostVersion !== null,
      evidence.hostVersion === null
        ? "expected `bb` on PATH: the report has to state the host it ran against"
        : `bb ${evidence.hostVersion}`,
    );
    ok(
      "the Focus Board plugin is installed (bb plugin list)",
      evidence.pluginVersion !== null,
      evidence.pluginVersion === null
        ? "expected a plugin list naming focus-board: the gate drives that plugin's board"
        : `focus-board@${evidence.pluginVersion}`,
    );
    ok(
      "Chrome is where CHROME_PATH says",
      existsSync(CHROME),
      existsSync(CHROME) ? CHROME : `expected a browser at ${CHROME} (set CHROME_PATH)`,
    );

    let reachable = false;
    let reachDetail = "";
    try {
      const response = await fetch(BOARD_URL, { redirect: "manual" });
      reachable = response.status >= 200 && response.status < 400;
      reachDetail = `HTTP ${response.status} from ${BOARD_URL}`;
    } catch (error) {
      reachDetail = `no answer from ${BOARD_URL} (${String(error?.message ?? error)}); expected a running bb — set BB_APP if it is not ${BOARD_URL}`;
    }
    ok("the host answers the board's route", reachable, reachDetail);
    if (!reachable) throw new Error(reachDetail);

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
      defaultViewport: { width: 1600, height: 1200 },
    });
    context = await browser.createBrowserContext();
    page = await context.newPage();
    await page.setCacheEnabled(false);
    page.on("pageerror", (error) =>
      evidence.errors.push({ check: "board", error: String(error).slice(0, 300) }),
    );

    let mounted = true;
    try {
      await page.goto(BOARD_URL, { waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector(`[${PANEL_ATTR}]`, { timeout: 25000 });
    } catch {
      mounted = false;
    }
    ok(
      "the board mounts at that route",
      mounted,
      mounted
        ? `the panel root [${PANEL_ATTR}] is on screen`
        : `no [${PANEL_ATTR}] appeared at ${BOARD_URL}: is the focus-board plugin enabled? (bb plugin list)`,
    );
    if (!mounted) throw new Error("the board did not mount");

    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("[data-thread-card]")].filter(
            (el) => el.parentElement?.closest("[data-thread-card]") === null,
          ).length >= 3,
        { timeout: 25000 },
      )
      .catch(() => {});
    const listed = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("[data-thread-card]")].filter(
        (el) => el.parentElement?.closest("[data-thread-card]") === null,
      );
      const dialog = document.querySelector('[role="dialog"]');
      return {
        cards: cards.map((el) => ({
          id: el.getAttribute("data-thread-card"),
          href: el.querySelector("a")?.getAttribute("href") ?? null,
        })),
        dialogText: dialog === null ? null : (dialog.textContent ?? "").trim().slice(0, 120),
      };
    });
    evidence.cards = listed.cards;
    ok(
      "nothing is covering the board",
      listed.dialogText === null,
      listed.dialogText === null
        ? "no dialog over the board"
        : `a dialog is open over the board ("${listed.dialogText}"): answer it once on this install, then rerun`,
    );

    const usable = listed.cards.filter(
      (card) =>
        typeof card.id === "string" &&
        card.id !== "" &&
        typeof card.href === "string" &&
        /\/projects\/[^/]+\/threads\/thr_[A-Za-z0-9]+$/.test(
          new URL(card.href, BOARD_BASE).pathname,
        ),
    );
    ok(
      "the board lists at least three threads to click",
      usable.length >= 3,
      `${usable.length} usable card(s) of ${listed.cards.length}: the checks need three threads and a fourth for the rethread`,
    );
    if (usable.length < 3) throw new Error("the board has too few cards for the six checks");

    const { rows, error } = threadRows();
    rowsRead = rows;
    rowsError = error;
    // The report's honesty: prefer threads the host already marks read, so
    // opening them writes nothing. Ordering only — the checks still need
    // distinct threads, and an unread one is used when that is all there is.
    const readFirst = [
      ...usable.filter((card) => readStateOf(rows, card.id) === "read"),
      ...usable.filter((card) => readStateOf(rows, card.id) !== "read"),
    ];
    [cardA, cardB, cardD] = readFirst;
    evidence.threadUrl = new URL(cardA.href, BOARD_BASE).href;
    evidence.threads = [cardA.id, cardB.id, cardD.id].map((id) => ({
      id,
      readAtStart: readStateOf(rows, id),
    }));
    ok(
      "three distinct threads are picked for the checks",
      new Set([cardA.id, cardB.id, cardD.id]).size === 3,
      evidence.threads.map((thread) => `${thread.id} (${thread.readAtStart})`).join(", "),
    );
  });

  const priorPassed = (index) => checkPassed(checks[index]);

  // ---- Check 1. A one-pane card click splits -----------------------------
  await step(CHECK_TITLES[1], async () => {
    if (!priorPassed(0)) throw new Error("not run: the preflight failed first");
    const before = await readState(page);
    ok("the window starts as one pane", before.paneCount === 1, describe(before));
    ok(
      "no in-panel thread pane is open",
      before.inBoardPane === null,
      `saw "${before.inBoardPane ?? "none"}"`,
    );
    await clickCard(page, cardA.id);
    const after = await waitForState(
      page,
      (state) => state.paneCount === 2,
      10000,
      "the host's split for the clicked thread",
    );
    const opened = after.panes.find((pane) => pane.threadId === cardA.id) ?? null;
    ok("the click leaves two panes", after.paneCount === 2, describe(after));
    ok("the board is still mounted", after.boardMounted, `board mounted: ${after.boardMounted}`);
    ok("the board kept its own pane", boardPane(after) !== null, describe(after));
    ok(
      `the clicked thread (${cardA.id}) is in the new pane`,
      opened !== null && !opened.holdsBoard,
      describe(after),
    );
    ok("the host focused the new pane", opened !== null && opened.focused, describe(after));
    ok(
      "the board's own in-panel pane stayed closed",
      after.inBoardPane === null,
      `saw "${after.inBoardPane ?? "none"}"`,
    );
    mutations.push({
      what: `opened ${cardA.id} in a native pane`,
      readAtStart: readStateOf(rowsRead, cardA.id),
    });
    await shot(page, "01-one-pane-card-click");
    evidence.steps.push({ label: "one-pane-card-click", before, after });
  });

  // ---- Check 2. A second card click replaces -----------------------------
  await step(CHECK_TITLES[2], async () => {
    if (!priorPassed(1)) throw new Error("not run: the check before it failed first");
    const before = await readState(page);
    const owned = recordPaneId(before);
    ok(
      "the board recorded the pane it opened",
      owned !== null,
      `record: ${before.record ?? "none"}`,
    );
    await clickCard(page, cardB.id);
    const after = await waitForState(
      page,
      (state) => state.paneCount === 2 && state.panes.some((pane) => pane.threadId === cardB.id),
      10000,
      `the replacement for ${cardB.id}`,
    );
    const replacedInto = after.panes.find((pane) => pane.paneId === owned) ?? null;
    ok("no third pane appears", after.paneCount === 2, describe(after));
    ok("the board is still mounted", after.boardMounted, `board mounted: ${after.boardMounted}`);
    ok(
      "the clicked thread is in the pane the board opened",
      replacedInto !== null && replacedInto.threadId === cardB.id,
      describe(after),
    );
    ok(
      "the pane the board opened is the one the host focused",
      replacedInto !== null && replacedInto.focused,
      describe(after),
    );
    ok(
      "the board's own in-panel pane stayed closed",
      after.inBoardPane === null,
      `saw "${after.inBoardPane ?? "none"}"`,
    );
    mutations.push({
      what: `replaced the pane's thread with ${cardB.id}`,
      readAtStart: readStateOf(rowsRead, cardB.id),
    });
    await shot(page, "02-second-card-click");
    evidence.steps.push({ label: "second-card-click", before, after });
  });

  // ---- Check 3. A click after the pane was navigated away ----------------
  await step(CHECK_TITLES[3], async () => {
    if (!priorPassed(2)) throw new Error("not run: the check before it failed first");
    const before = await readState(page);
    const owned = recordPaneId(before);
    // A thread bb's sidebar shows, outside the panes and outside the cards
    // this check still has to click. A thread the host already marks read is
    // preferred, so rethreading the pane writes nothing on the host.
    const avoid = [cardA.id, cardB.id, cardD.id];
    const sidebarThreads = await page.evaluate((taken) => {
      const rows = [...document.querySelectorAll('a[href*="/threads/"]')].filter(
        (anchor) =>
          anchor.getBoundingClientRect().x < 320 && anchor.getBoundingClientRect().width > 0,
      );
      const ids = [];
      for (const row of rows) {
        const match = /\/threads\/(thr_[A-Za-z0-9]+)/.exec(row.getAttribute("href") ?? "");
        if (match !== null && !taken.includes(match[1]) && !ids.includes(match[1])) {
          ids.push(match[1]);
        }
      }
      return ids;
    }, avoid);
    const rethreadThread =
      sidebarThreads.find((id) => readStateOf(rowsRead, id) === "read") ?? sidebarThreads[0] ?? null;
    ok(
      "a sidebar row exists to rethread the pane with",
      rethreadThread !== null,
      rethreadThread ?? "expected a visible thread row in bb's sidebar",
    );
    ok(
      "the pane the board opened holds host focus before the rethread",
      before.panes.some((pane) => pane.paneId === owned && pane.focused),
      describe(before),
    );
    if (rethreadThread === null) throw new Error("no sidebar row to rethread the pane with");

    await clickSidebarRow(page, rethreadThread);
    const rethreaded = await waitForState(
      page,
      (state) =>
        state.panes.some((pane) => pane.paneId === owned && pane.threadId === rethreadThread),
      10000,
      `the pane to show ${rethreadThread}`,
    );
    ok(
      "the sidebar row put that thread in the board's pane",
      rethreaded.panes.some((pane) => pane.paneId === owned && pane.threadId === rethreadThread),
      describe(rethreaded),
    );
    ok(
      "the board's record still names the pane it opened (the stale shape)",
      recordPaneId(rethreaded) === owned,
      `record: ${rethreaded.record ?? "none"}`,
    );

    const priorPaneIds = rethreaded.panes.map((pane) => pane.paneId);
    await clickCard(page, cardD.id);
    const after = await waitForState(
      page,
      (state) => state.panes.some((pane) => pane.threadId === cardD.id),
      12000,
      `the click on ${cardD.id} to land`,
    );

    if (NAVIGATED_PANE_RULING === "fresh-pane") {
      ok(
        "the click leaves a pane of its own beside the board",
        after.paneCount === priorPaneIds.length + 1,
        `${describe(after)} (was ${priorPaneIds.join(", ")}). ${RULING_HINT}`,
      );
      const opened = after.panes.find((pane) => pane.threadId === cardD.id) ?? null;
      ok(
        "that pane is one the window did not hold before the click",
        opened !== null && !priorPaneIds.includes(opened.paneId),
        describe(after),
      );
      ok(
        "the operator's own navigation is untouched",
        after.panes.some((pane) => pane.paneId === owned && pane.threadId === rethreadThread),
        describe(after),
      );
    } else {
      ok(
        "the click leaves the pane count flat",
        after.paneCount === priorPaneIds.length,
        `${describe(after)} (was ${priorPaneIds.join(", ")}). ${RULING_HINT}`,
      );
      const boardOwned = after.panes.find((pane) => pane.paneId === owned) ?? null;
      ok(
        "the clicked thread replaced the pane's thread in place",
        boardOwned !== null && boardOwned.threadId === cardD.id,
        describe(after),
      );
    }
    ok("the board is still mounted", after.boardMounted, `board mounted: ${after.boardMounted}`);
    ok(
      "the board's own in-panel pane stayed closed",
      after.inBoardPane === null,
      `saw "${after.inBoardPane ?? "none"}"`,
    );
    mutations.push(
      {
        what: `rethreaded the board's pane to ${rethreadThread} from bb's sidebar`,
        readAtStart: readStateOf(rowsRead, rethreadThread),
      },
      { what: `opened ${cardD.id} after the rethread`, readAtStart: readStateOf(rowsRead, cardD.id) },
    );
    evidence.steps.push({
      label: "click-after-rethread",
      before,
      rethreadThread,
      rethreaded,
      priorPaneIds,
      after,
    });
    await shot(page, "03-click-after-rethread");
  });

  // ---- Check 4. The pane header matches the native row -------------------
  await step(CHECK_TITLES[4], async () => {
    if (!priorPassed(3)) throw new Error("not run: the check before it failed first");
    // The in-panel pane is opened by the board's own pane route (`t/<id>`),
    // not by a click: the shipped open target sends a click to the native
    // pane, and this check must not change a setting to reach the other one.
    const paneUrl = `${BOARD_BASE}/t/${cardA.id}`;
    await page.goto(paneUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await page
      .waitForSelector('aside[role="complementary"][aria-label^="Thread:"]', { timeout: 20000 })
      .catch(() => {});
    const measured = await page.evaluate(MEASURE_HEADERS);
    evidence.steps.push({ label: "header-parity", url: paneUrl, measured });
    ok(
      "the board's own pane opened at its pane route",
      measured.inPanel !== null,
      `expected an aside[aria-label^="Thread:"] at ${paneUrl}`,
    );
    ok(
      "a native split pane is in the window to compare against",
      measured.nativePanePresent && measured.native !== null,
      measured.nativePanePresent
        ? `native header ${JSON.stringify(measured.native?.header ?? null)}`
        : "no [data-split-pane-id] outside the board survived the reload",
    );
    if (measured.inPanel === null || measured.native === null) {
      await shot(page, "04-header-parity");
      throw new Error("the header parity check needs both headers on screen");
    }
    const inPanel = measured.inPanel;
    const native = measured.native;
    ok(
      "the board's pane header is a 48px row",
      Math.abs(inPanel.header.h - 48) <= 1,
      `measured ${inPanel.header.h}px (row ${inPanel.row.h}px)`,
    );
    ok(
      "the native row is the same 48px",
      Math.abs(native.header.h - 48) <= 1,
      `measured ${native.header.h}px (row ${native.row.h}px)`,
    );
    ok(
      "the two rows are the same height",
      Math.abs(inPanel.header.h - native.header.h) <= 1,
      `board ${inPanel.header.h}px vs native ${native.header.h}px`,
    );
    ok(
      "the board's pane header carries exactly one Focus Board control",
      inPanel.triggers === 1,
      `${inPanel.triggers} trigger(s); aria "${inPanel.trigger?.aria ?? "none"}"`,
    );
    ok(
      "the native header carries the same control",
      native.triggers === 1,
      `${native.triggers} trigger(s); aria "${native.trigger?.aria ?? "none"}"`,
    );
    ok(
      "the control carries the Focus Board mark and a caret",
      inPanel.trigger?.mark === true && inPanel.trigger?.caret === true,
      `mark ${inPanel.trigger?.mark}, caret ${inPanel.trigger?.caret}`,
    );
    ok(
      "the control is the native 28px ghost box",
      Math.abs((inPanel.trigger?.w ?? 0) - 28) <= 1 &&
        Math.abs((inPanel.trigger?.h ?? 0) - 28) <= 1,
      `${inPanel.trigger?.w}×${inPanel.trigger?.h}px`,
    );
    ok(
      "no checkbox took the control's place",
      inPanel.trigger?.checkbox === false && inPanel.checkboxes === 0,
      `${inPanel.checkboxes} checkbox(es) in the header; one inside the control: ${inPanel.trigger?.checkbox === true}`,
    );
    ok(
      "the control sits where the native one sits: before the maximize control",
      inPanel.maximizeX === null ||
        (inPanel.trigger !== null && inPanel.trigger.x < inPanel.maximizeX),
      `board ${inPanel.trigger?.x} vs maximize ${inPanel.maximizeX}`,
    );
    ok(
      "the native header orders it the same way",
      native.maximizeX === null ||
        (native.trigger !== null && native.trigger.x < native.maximizeX),
      `native ${native.trigger?.x} vs maximize ${native.maximizeX}`,
    );
    await shot(page, "04-header-parity");
  });

  // ---- Check 5. The keys, with a second pane open ------------------------
  await step(CHECK_TITLES[5], async () => {
    if (!priorPassed(4)) throw new Error("not run: the check before it failed first");
    await page.goto(BOARD_BASE, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector(`[${PANEL_ATTR}]`, { timeout: 25000 });
    const before = await readState(page);
    ok(
      "the window still holds a second pane beside the board",
      before.paneCount >= 2,
      describe(before),
    );
    await emptyBoardPoint(page);
    const focused = await readState(page);
    const board = boardPane(focused);
    ok("clicking the board gives its pane host focus", board !== null && board.focused, describe(focused));
    await page.keyboard.press("/");
    let slash = null;
    try {
      slash = await waitForState(page, (state) => state.searchFieldFocused, 4000, "the search field to take focus");
    } catch (error) {
      const state = await readState(page);
      throw new Error(
        `${error.message}; the search field is ${state.searchField ? "present" : "absent"}`,
      );
    }
    ok(
      "slash focuses the board's search field",
      slash.searchFieldFocused === true,
      `the search field holds focus: ${slash.searchFieldFocused}`,
    );
    await shot(page, "05-slash-search");
    // The New Thread letter is a board shortcut, not a letter typed into the
    // search field: click the board's surface again, the way an operator looks
    // something up and then starts a thread.
    await emptyBoardPoint(page);
    await page.keyboard.press("c");
    let composer = null;
    try {
      composer = await waitForState(page, (state) => state.composerOpen, 4000, "the New Thread composer");
    } catch (error) {
      throw new Error(`${error.message}; the New Thread letter "c" opened no dialog`);
    }
    ok(
      "the New Thread letter opens the composer",
      composer.composerOpen === true,
      `dialog ${composer.composerBox?.w}×${composer.composerBox?.h}px`,
    );
    await shot(page, "06-new-thread-composer");
    await page.keyboard.press("Escape");
    await sleep(400);
    evidence.steps.push({ label: "shortcuts", before, focused, slash, composer });
  });

  // ---- Check 6. A thread page's Focus Board menu opens on screen ---------
  await step(CHECK_TITLES[6], async () => {
    if (!priorPassed(5)) throw new Error("not run: the check before it failed first");
    const threadUrl = evidence.threadUrl;
    const result = await threadPageMenu(browser, threadUrl, `${FRAMES}/07-thread-page-menu.png`);
    evidence.steps.push({ label: "thread-page-menu", threadUrl, ...result });
    ok(
      "bb's thread page carries the Focus Board control",
      result.trigger !== null,
      result.trigger === null
        ? `no [data-thread-menu-trigger] appeared at ${threadUrl} (the thread header slot did not render)`
        : `"${result.trigger.aria}" at ${result.trigger.x},${result.trigger.y}`,
    );
    ok(
      "the control's click opens the menu",
      result.menu !== null,
      result.menu === null
        ? "no [role=menu] appeared after the click"
        : `"${result.menu.label}" with ${result.menu.rows.length} row(s)`,
    );
    if (result.menu === null) throw new Error("the menu did not open");
    const { box, viewport } = result.menu;
    ok(
      "the menu has a real box",
      box.w > 0 && box.h > 0,
      `${box.w}×${box.h}px at ${box.x},${box.y}`,
    );
    ok(
      "the menu is inside the viewport's left and top edges",
      box.x >= 0 && box.y >= 0,
      `menu at ${box.x},${box.y}; viewport ${viewport.w}×${viewport.h}`,
    );
    ok(
      "the menu is inside the viewport's right and bottom edges",
      box.right <= viewport.w && box.bottom <= viewport.h,
      `menu ends at ${box.right},${box.bottom}; viewport ${viewport.w}×${viewport.h}`,
    );
    ok(
      "the menu carries the board's three actions",
      result.menu.rows.length === 3,
      result.menu.rows.join(" / "),
    );
  });
} finally {
  if (browser !== null) await browser.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------
/** Checks a failure blocked: recorded as failures, never as absences. */
const recorded = new Set(checks.map((check) => check.title));
for (const title of CHECK_TITLES) {
  if (recorded.has(title)) continue;
  checks.push({
    title,
    results: [{ name: "the check ran", ok: false, detail: "not run: the run stopped before it" }],
    error: "not run",
  });
}
const failedChecks = checks.filter((check) => !checkPassed(check)).length;
const runFailed = failedChecks > 0;

const stamp = new Date().toISOString();
const lines = ["# UAT report", "", `_Generated ${stamp} by \`npm run live-smoke\`._`, ""];
lines.push("## live-smoke", "");
lines.push(
  `Host: bb ${evidence.hostVersion ?? "unknown"} · Focus Board ${evidence.pluginVersion ?? "unknown"} · \`${BOARD_URL}\``,
  `Frames: \`${FRAMES.replace(ROOT, "")}\``,
  "",
);
lines.push("| Step | Result | Detail |", "| --- | --- | --- |");
for (const check of checks) {
  const detail = check.results
    .map(
      (result) =>
        `${result.ok ? "✓" : "×"} ${result.name}${result.ok || result.detail === "" ? "" : ` (${result.detail})`}`,
    )
    .join("; ");
  lines.push(`| ${check.title} | ${checkPassed(check) ? "pass" : "FAIL"} | ${detail} |`);
}
lines.push("");
lines.push("### What this run touched", "");
lines.push(
  "- A browser context of the run's own (`browser.createBrowserContext`): the split layout and",
  "  the board's pane record live only in that context's storage, and the run discards them.",
  "  Nothing here read or wrote the operator's window, profile, or any plugin setting.",
);
if (rowsError === null) {
  lines.push(
    "- Opening a thread marks it read on the host, so the cards the run used are the first ones",
    "  the host already marked read where it could. The read state it saw is below.",
  );
} else {
  lines.push(
    `- The host's read states could not be read (\`bb thread list --json\` failed: ${rowsError}),`,
    "  so treat every thread below as possibly marked read by this run.",
  );
}
for (const mutation of mutations) {
  lines.push(`- \`${mutation.what}\`: read at the run's start was ${mutation.readAtStart}.`);
}
lines.push(
  "- No file, tag, branch, version, or plugin setting was written. The report and the frames are",
  "  the run's only output.",
);
lines.push("");
lines.push("### Why these six", "");
lines.push(
  "The harness proves the board against a simulated host. It cannot see bb's real thread page,",
  "the real opener, route reconciliation across panes, or a transformed ancestor, and every pane",
  "defect of the last week lived in that gap. These six are the smallest live set that notices it",
  "(operator ruling 2026-11-24, `dec_b4wiwx3of87q`).",
);
lines.push("");
mkdirSync(REPORT.replace(/\/[^/]+$/, ""), { recursive: true });
writeFileSync(REPORT, lines.join("\n"));
writeFileSync(`${FRAMES}/evidence.json`, JSON.stringify(evidence, null, 2));

console.log(`\nlive-smoke: ${runFailed ? `${failedChecks} check(s) FAILED` : "all checks passed"}`);
for (const check of checks) {
  console.log(`  ${checkPassed(check) ? "pass" : "FAIL"}  ${check.title}`);
  if (!checkPassed(check)) {
    for (const result of check.results.filter((entry) => !entry.ok)) {
      console.log(`        × ${result.name}${result.detail === "" ? "" : ` (${result.detail})`}`);
    }
  }
}
console.log(`\nreport: ${REPORT}`);
console.log(`frames: ${FRAMES}`);
process.exitCode = runFailed ? 1 : 0;
