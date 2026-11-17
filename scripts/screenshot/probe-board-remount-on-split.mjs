// Does the board's app re-mount when bb's window splits or unsplits?
//
// The operator's report: "when the window splits/unsplits, focus board reloads
// every time." This probe measures it against a real bb (the installed build's
// own web renderer, driven in a browser this script opens), not the jsdom
// harness, because the question is what the HOST does to the panel's React
// subtree and no unit test can see that.
//
// It counts, per transition:
//   - mounts: distinct `[data-focus-board-panel]` DOM nodes, i.e. how many
//     times the board's app root was created. A React re-render reuses the
//     node; a re-mount does not.
//   - the loading view's appear/disappear pairs (`[data-loading-view]`), which
//     is the flash the operator sees.
//   - bb's RPC requests that arrive while the transition is in flight (the
//     refetch cost), counted by wrapping fetch and XMLHttpRequest before any
//     app code runs.
//   - the pane container's identity and `data-split-pane-id` on either side.
//   - the board scroller's and each lane list's scroll offsets, so a scroll
//     reset is visible rather than inferred.
//
// Drive: bb's own "Open in split" on a sidebar row (split), then the pane
// chrome's "Close pane" button (unsplit). Nothing else is touched; the split
// layout lands in the probe browser's own profile, never the operator's app.
//
// Usage: node scripts/screenshot/probe-board-remount-on-split.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, FRAMES_DIR (keep the raw gif frames),
// GIF_WIDTH, and SERVE_BUNDLE.
//
// SERVE_BUNDLE=<path to a built app.js> measures a candidate build against the
// installed host without touching the operator's plugin install: the probe
// sniffs which `plugin-app-assets/<hash>/app.js` is Focus Board's (the one
// whose body carries the board's own root attribute) and answers that one
// request from the given file. Everything else — the host, its split renderer,
// the plugin's enabled state and source path — is untouched.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { assembleGif, makeFramesDir, removeDir } from "./lib/recorder.mjs";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-board-remount-on-split";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SERVE_BUNDLE = process.env.SERVE_BUNDLE ?? null;
/** A string only the board's own bundle carries: the panel's root attribute. */
const BUNDLE_MARKER = "data-focus-board-panel";

mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Installed before any app code: the counters the transitions are read from. */
const INSTRUMENT = `(() => {
  const probe = {
    startedAt: performance.now(),
    mounts: [],
    loading: [],
    requests: [],
  };
  window.__fbProbe = probe;
  let panel = null;
  let loadingVisible = false;

  const paneOf = (el) => {
    const pane = el === null ? null : el.closest('[data-split-pane-id]');
    return pane === null ? null : {
      id: pane.getAttribute('data-split-pane-id'),
      sameNode: probe.lastPane === pane,
    };
  };
  probe.lastPane = null;

  const scan = () => {
    const board = document.querySelector('[data-focus-board-panel]');
    if (board !== null && board !== panel) {
      panel = board;
      const pane = paneOf(board);
      probe.mounts.push({
        at: Math.round(performance.now()),
        paneId: pane === null ? null : pane.id,
        paneIsNewNode: probe.lastPane !== null && (pane === null || !pane.sameNode),
        url: location.href,
      });
      const paneEl = board.closest('[data-split-pane-id]');
      if (paneEl !== null) probe.lastPane = paneEl;
    }
    const loading = document.querySelector('[data-loading-view]');
    const visible = loading !== null && loading.isConnected;
    if (visible !== loadingVisible) {
      loadingVisible = visible;
      probe.loading.push({ at: Math.round(performance.now()), visible });
    }
  };

  const observer = new MutationObserver(scan);
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
  };
  if (document.documentElement === null) {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  const record = (url, method) => {
    probe.requests.push({ at: Math.round(performance.now()), url, method });
  };
  // Route changes, so the evidence can say whether OUR app navigated during
  // the transition (a subPath or route change would re-key the panel itself).
  probe.urls = [{ at: 0, url: location.href }];
  const noteUrl = () => {
    const last = probe.urls[probe.urls.length - 1];
    if (last !== undefined && last.url !== location.href) {
      probe.urls.push({ at: Math.round(performance.now()), url: location.href });
    }
  };
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function () {
      const result = original.apply(this, arguments);
      noteUrl();
      return result;
    };
  }
  window.addEventListener("popstate", noteUrl);
  const absolute = (url) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return String(url);
    }
  };
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string'
      ? input
      : input instanceof Request ? input.url : String(input);
    record(absolute(url), (init && init.method) || (input instanceof Request ? input.method : 'GET'));
    return nativeFetch.apply(this, arguments);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    record(absolute(url), method);
    return open.apply(this, arguments);
  };
  probe.scan = scan;
})();`;

/** Reads the panel, the panes and every scroll offset that carries view state. */
const READ = `(() => {
  const board = document.querySelector('[data-focus-board-panel]');
  const pane = board === null ? null : board.closest('[data-split-pane-id]');
  const scroller = document.querySelector('[data-columns-board]');
  const laneScroll = {};
  for (const list of document.querySelectorAll('[data-column-id]')) {
    const id = list.getAttribute('data-column-id');
    const box = list.querySelector('[data-card-list]');
    if (id !== null && box !== null) {
      laneScroll[id] = { x: Math.round(box.scrollLeft), y: Math.round(box.scrollTop) };
    }
  }
  const probe = window.__fbProbe;
  return {
    url: location.href,
    boardInDocument: board !== null,
    boardPaneId: pane === null ? null : pane.getAttribute('data-split-pane-id'),
    paneContainers: [...document.querySelectorAll('[data-split-pane-id]')].map((el) => ({
      id: el.getAttribute('data-split-pane-id'),
      focused: el.getAttribute('data-focused'),
      hasBoard: el.contains(document.querySelector('[data-focus-board-panel]')),
      box: (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      })(),
    })),
    boardBox: board === null ? null : (() => {
      const r = board.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    })(),
    cards: document.querySelectorAll('[data-thread-card]').length,
    scroll: scroller === null ? null : {
      x: Math.round(scroller.scrollLeft),
      y: Math.round(scroller.scrollTop),
      laneDirection: scroller.getAttribute('data-lane-direction'),
    },
    laneScroll,
    counters: {
      mounts: probe.mounts.length,
      loadingTransitions: probe.loading.length,
      requests: probe.requests.length,
    },
    splitLayout: localStorage.getItem('bb.splitLayout'),
  };
})();`;

/** Every counter since a phase started, plus what the app asked for. */
const SINCE = (mark) => `((mark) => {
  const probe = window.__fbProbe;
  const after = (list) => list.filter((entry) => entry.at >= mark);
  const requests = after(probe.requests);
  const rpc = requests.filter((r) => r.url.includes('/api/'));
  const byPath = {};
  for (const r of rpc) {
    const key = r.url.replace(location.origin, '').split('?')[0];
    byPath[key] = (byPath[key] ?? 0) + 1;
  }
  return {
    mounts: after(probe.mounts),
    loading: after(probe.loading),
    rpcCount: rpc.length,
    rpcByPath: byPath,
    urls: after(probe.urls),
  };
})(${mark})`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});

/** Which served app.js is the board's, sniffed by content, or null. */
async function findBoardBundle() {
  const sniff = await browser.newPage();
  await sniff.setCacheEnabled(false);
  const assets = new Set();
  const bodies = [];
  sniff.on("response", (response) => {
    const url = response.url();
    if (!/\/plugin-app-assets\/[a-f0-9]+\/app\.js$/.test(url)) return;
    assets.add(url);
    bodies.push(
      response.text().then((body) => ({ url, hasBoard: body.includes(BUNDLE_MARKER) })),
    );
  });
  await sniff.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const found = (await Promise.all(bodies)).find((entry) => entry.hasBoard) ?? null;
  await sniff.close();
  return { url: found === null ? null : found.url, sniffed: assets.size };
}

const bundle = SERVE_BUNDLE === null ? null : await findBoardBundle();
if (SERVE_BUNDLE !== null) {
  if (bundle === null || bundle.url === null) {
    console.error("Could not identify the board's app.js among the served plugin assets.");
    await browser.close();
    process.exit(1);
  }
  console.log(`serving ${SERVE_BUNDLE} for ${bundle.url}`);
}

const page = await browser.newPage();
if (SERVE_BUNDLE !== null && bundle !== null && bundle.url !== null) {
  // A marker appended to the served body, so the evidence can prove the page
  // really ran the candidate build instead of a cached original.
  const swapped = `${readFileSync(SERVE_BUNDLE, "utf8")}\n;window.__fbServedBundle = "swapped";window.__fbModuleEvals = (window.__fbModuleEvals ?? 0) + 1;\n`;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url() !== bundle.url) {
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
page.on("console", (message) => {
  const text = message.text();
  if (/\[fb-|\[focus-board\]/.test(text)) {
    console.log(`console[${message.type()}]: ${text}`);
  }
});
await page.setCacheEnabled(false);
await page.evaluateOnNewDocument(INSTRUMENT);
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("[data-focus-board-panel]", { timeout: 30000 });
await sleep(3000);

const framesDir = process.env.FRAMES_DIR ?? (await makeFramesDir("remount-probe"));
let frame = 0;
/** One screenshot per call, numbered for the gif assembler. */
const shoot = async () => {
  frame += 1;
  const name = `frame-${String(frame).padStart(4, "0")}`;
  await page.screenshot({ path: path.join(framesDir, `${name}.png`) });
};
/** Screenshots in a burst, so a fast transition survives in the gif. */
const burst = async (count, gapMs) => {
  for (let i = 0; i < count; i += 1) {
    await shoot();
    await sleep(gapMs);
  }
};

const served = await page.evaluate(() => window.__fbServedBundle ?? null);
const evals = () => page.evaluate(() => window.__fbModuleEvals ?? 0);
console.log(`module evaluations at first paint: ${await evals()}`);
console.log(`served bundle marker: ${String(served)}`);
const initial = await page.evaluate(READ);
await shoot();
console.log("=== initial ===");
console.log(JSON.stringify(initial, null, 2));

// Put the board in a non-default scroll state, so a reset is measurable: pan
// the board along its own axis and scroll the first lane list that overflows.
const scrolled = await page.evaluate(() => {
  const scroller = document.querySelector('[data-columns-board]');
  if (scroller === null) return { applied: null };
  const horizontal = scroller.getAttribute('data-lane-direction') !== "horizontal";
  if (horizontal) scroller.scrollLeft = 260;
  else scroller.scrollTop = 200;
  let laneSet = null;
  for (const list of document.querySelectorAll('[data-column-id]')) {
    const box = list.querySelector('[data-card-list]');
    if (box === null) continue;
    if (box.scrollHeight > box.clientHeight + 40) {
      box.scrollTop = 120;
      laneSet = { id: list.getAttribute('data-column-id'), y: box.scrollTop };
      break;
    }
  }
  return {
    applied: {
      board: { x: scroller.scrollLeft, y: scroller.scrollTop },
      lane: laneSet,
    },
  };
});
await sleep(300);
const scrolledRead = await page.evaluate(READ);
console.log("=== after the operator-style pan ===");
console.log(JSON.stringify(scrolled, null, 2));

// The sidebar row whose context menu carries bb's own "Open in split".
const row = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="/threads/"]')].find(
    (x) => x.getBoundingClientRect().x < 320 && x.getBoundingClientRect().height > 0,
  );
  if (a === undefined) return null;
  a.scrollIntoView({ block: "center" });
  const r = a.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), href: a.getAttribute("href") };
});
if (row === null) {
  console.error("No sidebar thread row found; cannot split.");
  await browser.close();
  process.exit(1);
}
await page.mouse.move(row.x, row.y);
await sleep(400);
await page.mouse.click(row.x, row.y, { button: "right" });
await sleep(800);
const menu = await page.evaluate(() =>
  [...document.querySelectorAll('[role="menuitem"]')]
    .filter((el) => el.getBoundingClientRect().width > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        label: (el.textContent ?? "").trim().slice(0, 40),
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + r.height / 2),
      };
    }),
);
const splitItem = menu.find((m) => /open in split/i.test(m.label));
if (splitItem === undefined) {
  console.error("No 'Open in split' entry; the row menu was:", JSON.stringify(menu));
  await browser.close();
  process.exit(1);
}

// --- split -----------------------------------------------------------------
const splitMark = await page.evaluate(() => Math.round(performance.now()));
await page.mouse.click(splitItem.x, splitItem.y);
await burst(16, 90);
await sleep(2500);
const afterSplit = await page.evaluate(READ);
console.log(`module evaluations after split: ${await evals()}`);
const splitCounters = await page.evaluate(SINCE(splitMark));
await shoot();
console.log("=== after split ===");
console.log(JSON.stringify({ afterSplit, splitCounters }, null, 2));

// --- unsplit ---------------------------------------------------------------
const closeButton = await page.evaluate(() => {
  const board = document.querySelector('[data-focus-board-panel]');
  const buttons = [...document.querySelectorAll('button[aria-label="Close pane"]')];
  const target = buttons.find(
    (b) => board === null || !b.closest('[data-split-pane-id]')?.contains(board),
  );
  if (target === undefined) return null;
  const r = target.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (closeButton === null) {
  console.error("No 'Close pane' button beside the board; cannot unsplit.");
  await browser.close();
  process.exit(1);
}
const unsplitMark = await page.evaluate(() => Math.round(performance.now()));
await page.mouse.click(closeButton.x, closeButton.y);
await burst(16, 90);
await sleep(2500);
const afterUnsplit = await page.evaluate(READ);
const unsplitCounters = await page.evaluate(SINCE(unsplitMark));
await shoot();
console.log("=== after unsplit ===");
console.log(JSON.stringify({ afterUnsplit, unsplitCounters }, null, 2));

const verdict = {
  bundle: SERVE_BUNDLE === null
    ? { servedByHost: "installed" }
    : { replacedWith: SERVE_BUNDLE, assetUrl: bundle === null ? null : bundle.url, markerSeen: served },
  mountsOnSplit: splitCounters.mounts.length,
  mountsOnUnsplit: unsplitCounters.mounts.length,
  loadingFlashesOnSplit: splitCounters.loading.filter((e) => e.visible).length,
  loadingFlashesOnUnsplit: unsplitCounters.loading.filter((e) => e.visible).length,
  boardNodeReplacedOnSplit: initial.boardInDocument && splitCounters.mounts.length > 0,
  boardNodeReplacedOnUnsplit: unsplitCounters.mounts.length > 0,
  rpcOnSplit: splitCounters.rpcCount,
  rpcOnUnsplit: unsplitCounters.rpcCount,
  boardScrollBefore: scrolledRead.scroll,
  boardScrollAfterSplit: afterSplit.scroll,
  boardScrollAfterUnsplit: afterUnsplit.scroll,
  laneScrollBefore: scrolledRead.laneScroll,
  laneScrollAfterSplit: afterSplit.laneScroll,
  laneScrollAfterUnsplit: afterUnsplit.laneScroll,
  boardPaneIdBefore: initial.boardPaneId,
  boardPaneIdAfterSplit: afterSplit.boardPaneId,
  boardPaneIdAfterUnsplit: afterUnsplit.boardPaneId,
  cardCountStable:
    initial.cards > 0 && afterSplit.cards === initial.cards && afterUnsplit.cards === initial.cards,
  // The operator-visible question: did the transition flash the loading view
  // and throw the view state away?
  invisible:
    splitCounters.loading.filter((entry) => entry.visible).length === 0 &&
    unsplitCounters.loading.filter((entry) => entry.visible).length === 0 &&
    afterSplit.scroll !== null &&
    scrolledRead.scroll !== null &&
    afterSplit.scroll.x === scrolledRead.scroll.x,
};

writeFileSync(
  `${OUT_DIR}/evidence.json`,
  `${JSON.stringify(
    { checkedAt: new Date().toISOString(), app: APP, row, initial, scrolledRead, afterSplit, splitCounters, afterUnsplit, unsplitCounters, verdict },
    null,
    2,
  )}\n`,
);

const gifPath = path.join(OUT_DIR, "split-unsplit.gif");
await assembleGif({
  dir: framesDir,
  outPath: gifPath,
  fps: 11,
  width: Number(process.env.GIF_WIDTH ?? 900),
});
if (process.env.FRAMES_DIR === undefined) await removeDir(framesDir);

console.log("=== verdict ===");
console.log(JSON.stringify(verdict, null, 2));
console.log(`gif: ${gifPath}`);
await browser.close();
process.exit(verdict.invisible ? 0 : 1);
