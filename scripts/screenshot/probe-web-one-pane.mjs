// Does a card click in a WEB BROWSER split beside the board, fall back to the
// board's own in-panel pane, or plainly navigate the whole page?
//
// The operator's report (2026-11-24): "split pane not working in web browser,
// but not falling back to in-pane panel either -- just navs whole page".
//
// The probe drives bb's real renderer in Chrome, the same app a browser tab
// loads (`http://127.0.0.1:<port>/plugins/focus-board/board`), with a fresh
// profile per phase. It records, around one card click:
//
// - the click's own branch line (`[focus-board:native-open]`, the plugin's
//   `nativeOpenDebug` setting),
// - the dance's outcome line, when one fires,
// - the host's persisted layout atom, its rendered pane containers, the route,
//   and whether the board is still mounted, sampled over time,
// - whether the page was a real document navigation (the bundle reloaded and
//   module scope died) or a same-document route change, and
// - frames at 400ms and 2000ms.
//
// Usage: BB_APP=http://127.0.0.1:38886/plugins/focus-board/board \
//        node scripts/screenshot/probe-web-one-pane.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR.
//
// The evidence this produced is in `docs/screenshots/probe-web-one-pane/`:
// `before/` served bundle `bd255bbfbd268032` (no split guard) and `after/`
// served `780feef1e2210812` (the guard's own `restore-only` token present), and
// both runs split at 1600 and 1024 and opened the board's own pane at 700. The
// whole-page answer the operator reported did not reproduce on the installed
// host; every phase kept its boot marker, so none was a document navigation.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-web-one-pane";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const PHASES = [
  { label: "wide-1600", width: 1600, height: 1200 },
  { label: "desktop-1024", width: 1024, height: 900 },
  { label: "compact-700", width: 700, height: 900 },
];

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Everything the decision reads, plus the reload marker. */
const READ_STATE = `(function () {
  let layout = null;
  try {
    const raw = localStorage.getItem('bb.splitLayout');
    if (raw !== null && raw !== '') {
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
    bootMarker: window.__webOnePaneProbeBoot ?? null,
    route: location.pathname + location.search + location.hash,
    paneCount: panes.length,
    focusedPaneId: layout === null ? null : layout.focusedPaneId,
    panes: panes.map((pane) => ({
      paneId: pane.paneId,
      kind: pane.content && pane.content.kind,
      threadId: pane.content && pane.content.kind === 'thread' ? pane.content.threadId : null,
      panelPath: pane.content && pane.content.kind === 'plugin-panel' ? pane.content.panelPath : null,
      subPath: pane.content && pane.content.kind === 'plugin-panel' ? pane.content.subPath : null,
      focused: layout.focusedPaneId === pane.paneId,
    })),
    renderedPanes: [...document.querySelectorAll('[data-split-pane-id]')].map((el) => el.getAttribute('data-split-pane-id')),
    boardMounted: board !== null,
    cardCount: document.querySelectorAll('[data-thread-card]').length,
    inBoardPane: aside === null ? null : aside.getAttribute('aria-label'),
    compactViewport: window.matchMedia('(max-width: 767px)').matches,
    threadPage: (function () {
      const match = /\\/threads\\/([^/?#]+)\\/?$/.exec(location.pathname);
      return match === null ? null : match[1];
    })(),
    navType: (performance.getEntriesByType('navigation')[0] || {}).type ?? null,
  };
})();`;

/** The board's cards: the ones a finger would hit. */
const LIST_CARDS = `(function () {
  return [...document.querySelectorAll('[data-thread-card]')]
    .filter((el) => el.parentElement?.closest('[data-thread-card]') === null)
    .map((el) => {
      const anchor = el.querySelector('a');
      if (anchor === null) return null;
      const r = anchor.getBoundingClientRect();
      return {
        threadId: el.getAttribute('data-thread-card'),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
        visible: r.width > 0 && r.height > 0,
      };
    })
    .filter((card) => card !== null && card.visible);
})();`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});

const evidence = { app: APP, phases: {}, notes: [] };
/** Which frontend bundle the board actually executed. The pre-fix bundle has
 *  no `restore-only`, so its absence is the proof the old code ran, and its
 *  presence the proof the new one did. Read from the host's own plugin list
 *  (the bundle hash it serves) rather than guessed from request URLs: 44
 *  plugin bundles load on boot and only one of them is the board. */
async function focusBoardBundle() {
  const list = await fetch(new URL("/api/v1/plugins", APP)).then((r) => r.json());
  const entry = (list.plugins ?? []).find((plugin) => plugin.id === "focus-board");
  const hash = entry?.app?.bundle?.hash;
  if (typeof hash !== "string") return null;
  const url = new URL(`/api/v1/plugin-app-assets/${hash}/app.js`, APP).toString();
  const body = await fetch(url).then((r) => r.text());
  return {
    hash,
    url,
    bytes: body.length,
    carriesSplitGuard: body.includes("restore-only"),
  };
}

const servedBundle = await focusBoardBundle().catch(() => null);

for (const phase of PHASES) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: phase.width, height: phase.height });
  const trace = [];
  const consoleErrors = [];
  const navEvents = [];
  page.on("console", async (message) => {
    const text = message.text();
    if (message.type() === "error") consoleErrors.push(text.slice(0, 300));
    if (!text.includes("[focus-board:native-open]")) return;
    try {
      const args = await Promise.all(message.args().map((arg) => arg.jsonValue()));
      trace.push(args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" "));
    } catch {
      trace.push(text.slice(0, 500));
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 300)));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navEvents.push(frame.url());
  });
  await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4000);
  // A marker that lives in the JS realm: it disappears on a real document
  // navigation, which is what would kill the dance's module state.
  await page.evaluate(() => {
    window.__webOnePaneProbeBoot = Date.now();
  });
  const before = await page.evaluate(READ_STATE);
  const cards = await page.evaluate(LIST_CARDS);
  const card = cards[0] ?? null;
  const record = {
    phase: phase.label,
    viewport: { width: phase.width, height: phase.height },
    before,
    card,
    samples: [],
    trace,
    navEvents,
    consoleErrors,
    outcome: null,
  };

  if (card === null) {
    record.outcome = "no card on the board";
    evidence.phases[phase.label] = record;
    await page.screenshot({ path: `${OUT_DIR}/${phase.label}-no-card.png` });
    await context.close();
    continue;
  }

  await page.mouse.click(card.x, card.y);
  const marks = [0, 50, 150, 300, 600, 1000, 2000, 4000];
  let last = 0;
  for (const at of marks) {
    await sleep(at - last);
    last = at;
    const state = await page.evaluate(READ_STATE);
    record.samples.push({ at, ...state });
    if (at === 300) {
      await page.screenshot({ path: `${OUT_DIR}/${phase.label}-300ms.png` });
    }
    if (at === 2000) {
      await page.screenshot({ path: `${OUT_DIR}/${phase.label}-2000ms.png` });
    }
  }
  await page.screenshot({ path: `${OUT_DIR}/${phase.label}-final.png` });
  const settled = record.samples.at(-1);
  record.outcome =
    settled.renderedPanes.length >= 2
      ? `split (${settled.renderedPanes.length} panes)`
      : settled.boardMounted
        ? settled.inBoardPane
          ? `in-board pane (${settled.inBoardPane})`
          : "board mounted, no thread surface"
        : settled.threadPage === card.threadId
          ? "whole page is the thread"
          : `whole page, route ${settled.route}`;
  evidence.phases[phase.label] = record;
  console.log(
    [
      `=== ${phase.label} ===`,
      `card ${card.threadId}`,
      `outcome: ${record.outcome}`,
      `trace: ${trace.length === 0 ? "(none)" : ""}`,
      ...trace.map((line) => `  ${line}`),
      `navEvents: ${navEvents.length}`,
    ].join("\n"),
  );
  await context.close();
}

writeFileSync(
  `${OUT_DIR}/evidence.json`,
  JSON.stringify({ ...evidence, servedBundle }, null, 2),
);
await browser.close();
