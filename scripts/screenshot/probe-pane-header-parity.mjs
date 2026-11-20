// Runtime measurements + frames for the thread-pane header parity work
// ("make the FB side panel header better-resemble the native split panel
// header", 2026-11-20). Drives the LIVE bb app in a throwaway profile and
// reads, per header —
//
//   - the native pane (bb's own thread page rendered as a split pane), and
//   - Focus Board's in-board thread pane (components/thread-pane.tsx)
//
// the header row's box (height, padding, border, background) and every
// row child's box, computed styles, aria-label and icon (two levels of
// walk: the header's children AND the chrome row's children), at desktop
// width, at narrowed widths, and at phone (compact) width, each in both
// themes. Screenshots land beside the JSON so the PR can put native and
// Focus Board side by side.
//
// Read-only apart from navigation. Run per tree with LABEL=before /
// LABEL=after; artifacts land in docs/screenshots/pane-header-parity/<label>/.
//
// Usage: node scripts/screenshot/probe-pane-header-parity.mjs
// Honors BB_APP, CHROME_PATH, THREAD_ID (a board card's thread), PROJECT_ID,
// OUT_DIR (defaults from LABEL), and SERVE_BUNDLE — a candidate build's
// directory: the probe sniffs the installed host's
// `plugin-app-assets/<hash>/app.{js,css}` for Focus Board and answers those
// two requests from <SERVE_BUNDLE>/app.{js,css} (the restyled utilities are
// compiled into the candidate CSS; the served one must move with the JS).
// Everything else — the host, the plugin install — is untouched.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const LABEL = process.env.LABEL ?? "run";
const THREAD_ID = process.env.THREAD_ID ?? "";
const PROJECT_ID = process.env.PROJECT_ID ?? "proj_p4562js7v2";
const BOARD = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = process.env.OUT_DIR ?? `docs/screenshots/pane-header-parity/${LABEL}`;
/** Candidate build dir; when set the probe swaps the served plugin JS+CSS. */
const SERVE_BUNDLE = process.env.SERVE_BUNDLE ?? null;
/** A string only the board's own bundle carries: the panel's root attribute. */
const BUNDLE_MARKER = "data-focus-board-panel";

mkdirSync(OUT_DIR, { recursive: true });
if (!THREAD_ID) {
  console.error("Set THREAD_ID to a thread visible both in the sidebar and on the board.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Generic measured shape of elements: box, styles, identity. */
const MEASURE_EL = `(function (el) {
  const b = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const icon = el.querySelector('[data-icon]');
  return {
    tag: el.tagName,
    aria: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    text: (el.textContent || '').trim().slice(0, 48),
    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 220),
    box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
    fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color,
    bg: s.backgroundColor, radius: s.borderRadius, padding: s.padding,
    gap: s.gap, display: s.display,
    overflow: s.overflow + '/' + s.textOverflow, whiteSpace: s.whiteSpace,
    minWidth: s.minWidth, flex: s.flex,
    icon: icon === null ? null : icon.getAttribute('data-icon'),
  };
})`;

/** The Focus Board pane's header: <aside><header>… one flat row. */
const FB_HEADER = `(function () {
  const root = document.querySelector('aside[role="complementary"] > header');
  if (root === null) return null;
  const R = root.getBoundingClientRect();
  const c = getComputedStyle(root);
  const row = root.firstElementChild;
  const children = row === null ? [] : [...row.children].map(${MEASURE_EL});
  // One level deeper for the title's own text span (the button carries the
  // button font, the span carries the title's typography).
  const titleBtn = root.querySelector('[title="Rename thread"]');
  const titleSpan = titleBtn === null ? null : titleBtn.querySelector('span');
  return {
    box: { x: Math.round(R.x), y: Math.round(R.y), w: Math.round(R.width), h: Math.round(R.height) },
    height: Math.round(R.height),
    padding: c.padding, bg: c.backgroundColor,
    borderBottom: c.borderBottomWidth + '|' + c.borderBottomStyle + '|' + c.borderBottomColor,
    gap: c.gap, display: c.display, overflow: c.overflow,
    chromeRowVar: c.getPropertyValue('--bb-app-chrome-row-height'),
    rowBox: row === null ? null : ${MEASURE_EL}(row).box,
    children,
    buttons: [...root.querySelectorAll('button')].map(${MEASURE_EL}),
    titleSpan: titleSpan === null ? null : ${MEASURE_EL}(titleSpan),
    titleEditor: root.querySelector('input[aria-label="Thread title"]') !== null,
  };
})()`;

/** The native pane's header: <header> > one chrome row div; walk it too. */
const NATIVE_HEADER = `(function () {
  const pane = [...document.querySelectorAll('[data-split-pane-id]')].find((p) =>
    !p.contains(document.querySelector('[data-focus-board-panel]')));
  if (pane === undefined) return { missing: 'pane' };
  const header = pane.querySelector('header');
  if (header === null) return { missing: 'header' };
  const row = header.querySelector('[class*="chrome-row-height"]') ?? header.firstElementChild;
  const rows = (row ?? header) === header ? [] : [...row.children].map((el) => {
    const m = ${MEASURE_EL}(el);
    // The row children wrap the actual text (the title among them); one
    // span level down is where the typography lives, and the phone row
    // keeps its ellipsis inside the title wrapper's own children.
    const span = el.querySelector('span');
    if (span !== null) m.span = ${MEASURE_EL}(span);
    m.kids = [...el.children].slice(0, 8).map((k) => {
      const kb = k.getBoundingClientRect();
      return {
        tag: k.tagName, aria: k.getAttribute('aria-label'),
        icon: k.querySelector('[data-icon]')?.getAttribute('data-icon') ?? null,
        box: { x: Math.round(kb.x), w: Math.round(kb.width), h: Math.round(kb.height) },
      };
    });
    return m;
  });
  return {
    paneW: Math.round(pane.getBoundingClientRect().width),
    header: ${MEASURE_EL}(header),
    row: ${MEASURE_EL}(row ?? header),
    chromeRowVar: getComputedStyle(header).getPropertyValue('--bb-app-chrome-row-height'),
    rowChildren: rows,
    buttons: [...header.querySelectorAll('button')].map(${MEASURE_EL}),
  };
})()`;

const BODY_BG = `getComputedStyle(document.body).backgroundColor`;

/** Open THREAD_ID in a native split pane via the sidebar row's menu. */
async function openInSplit(page) {
  let row = null;
  for (let i = 0; i < 90 && row === null; i += 1) {
    row = await page.evaluate((id, scrollerExpr) => {
      const a = [...document.querySelectorAll('a[href*="/threads/"]')].find((x) =>
        (x.getAttribute("href") || "").includes(id) &&
        x.getBoundingClientRect().x < 320,
      );
      if (a === undefined || a === null) {
        // eslint-disable-next-line no-eval
        const scroller = eval(scrollerExpr);
        if (scroller !== null && scroller !== undefined) scroller.scrollTop += 300;
        return null;
      }
      a.scrollIntoView({ block: "center" });
      const r = a.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, THREAD_ID, SIDEBAR_SCROLLER);
    if (row === null) await sleep(300);
  }
  if (row === null) throw new Error(`sidebar row not found: ${THREAD_ID}`);
  await sleep(400);
  await page.mouse.move(row.x, row.y);
  await sleep(400);
  await page.mouse.click(row.x, row.y, { button: "right" });
  await sleep(800);
  const item = await page.evaluate(() => {
    return [...document.querySelectorAll('[role="menuitem"]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: (el.textContent || "").trim(),
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          visible: r.width > 0,
        };
      })
      .find((m) => /open in split/i.test(m.label) && m.visible) ?? null;
  });
  if (item === null) throw new Error("no Open-in-split entry in the sidebar row menu");
  await page.mouse.click(item.x, item.y);
  await sleep(3500);
}

const splitOpen = (page) =>
  page.evaluate(() => ({
    count: [...document.querySelectorAll('[data-split-pane-id]')].length,
    url: location.href,
  }));

const setTheme = (page, theme) =>
  page.evaluate((t) => {
    window.localStorage.setItem("bb.theme", t);
    window.localStorage.setItem("bb.splitLayout.dimInactiveSplits", "false");
    window.__fbThemeSet = t;
  }, theme);

/** Open the Focus Board thread pane inside the plugin panel (card click). */
async function openFocusPane(page) {
  const opened = await page
    .evaluate(() => document.querySelector('aside[role="complementary"][aria-label^="Thread:"]') !== null)
    .catch(() => false);
  if (opened === true) return true;
  const box = await page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-card="${id}"]`);
    if (card === null) return null;
    card.scrollIntoView({ block: "center" });
    const r = card.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 40) };
  }, THREAD_ID);
  if (box === null) return false;
  await sleep(500);
  await page.mouse.click(box.x, box.y);
  await sleep(2200);
  return page.evaluate(
    () => document.querySelector('aside[role="complementary"][aria-label^="Thread:"]') !== null,
  );
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}.png` });
}

/** Clip a header row (±10px vertical) for the side-by-side frames. */
async function clipHeader(page, selEval, name) {
  const box = await page.evaluate((expr) => {
    // eslint-disable-next-line no-eval
    const el = eval(expr);
    if (el === null || el === undefined) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y - 10), width: Math.ceil(r.width), height: Math.ceil(r.height + 20) };
  }, selEval);
  if (box === null) return;
  await page.screenshot({ path: `${OUT_DIR}/${name}.png`, clip: box });
}

const FB_HEADER_SEL = `document.querySelector('aside[role="complementary"] > header')`;
const NATIVE_HEADER_SEL =
  `(function(){ const pane = [...document.querySelectorAll('[data-split-pane-id]')].find((p) => !p.contains(document.querySelector('[data-focus-board-panel]'))); return pane === undefined ? null : pane.querySelector('header'); })()`;

/** The writes that must survive the app's own unload write-back ride here.
 *  Each narrow pass sets its own, effective from the next document start. */
const armPreload = (page, fn) => page.evaluateOnNewDocument(fn);

/** Drag bb's split gutter between the two panes by dx px (positive moves
 *  the gutter right: the board pane grows, the native pane shrinks).
 *  Returns the resulting pane widths. */
async function dragGutter(page, dx) {
  const g = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-split-pane-id]')];
    if (els.length < 2) return null;
    const a = els[0].getBoundingClientRect();
    const b = els[1].getBoundingClientRect();
    return { x: (a.right + b.left) / 2, y: a.y + a.height / 2 };
  });
  if (g === null) return null;
  await page.mouse.move(g.x, g.y);
  await sleep(150);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(g.x + (dx * i) / 8, g.y);
    await sleep(50);
  }
  await page.mouse.up();
  await sleep(900);
  return page.evaluate(() => {
    return [...document.querySelectorAll('[data-split-pane-id]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-split-pane-id"), w: Math.round(r.width) };
    });
  });
}

/** Drag the FB pane's own resize edge (its left border) by dx px:
 *  dragging right shrinks the pane, left grows it. Returns the aside's
 *  width. */
async function dragPaneEdge(page, dx) {
  const e = await page.evaluate(() => {
    const edge = document.querySelector('aside[role="complementary"] [role="separator"]');
    if (edge === null) return null;
    const r = edge.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (e === null) return null;
  await page.mouse.move(e.x, e.y);
  await sleep(150);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) {
    await page.mouse.move(e.x + (dx * i) / 6, e.y);
    await sleep(50);
  }
  await page.mouse.up();
  await sleep(700);
  return page.evaluate(() => {
    const aside = document.querySelector('aside[role="complementary"]');
    if (aside === null) return null;
    const r = aside.getBoundingClientRect();
    return { w: Math.round(r.width), x: Math.round(r.x) };
  });
}

/** Read the split's pane widths. */
const paneWidths = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-split-pane-id]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute("data-split-pane-id"), w: Math.round(r.width) };
    }),
  );

/** Drag the gutter so pane-1 lands on `target` (±8), whatever it measured
 *  before (every reload and drag rewrites the persisted sizes, so each
 *  setup measures and moves the difference instead of a fixed delta). */
async function growGutterTo(page, target) {
  let widths = await paneWidths(page);
  for (let i = 0; i < 3; i += 1) {
    const first = widths[0];
    if (first === undefined) return null;
    const dx = target - first.w;
    if (Math.abs(dx) <= 8) return widths;
    await dragGutter(page, dx);
    widths = await paneWidths(page);
  }
  return widths;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const evidence = { label: LABEL, threadId: THREAD_ID, desktop: {}, phone: {} };

// ---------- Optional candidate-build swap (SERVE_BUNDLE): sniff which
// plugin-app-assets URLs are the board's app.js / app.css and answer them
// from the candidate build, so the measured pane runs the tree's code
// against the real host without touching the install. ----------
let swap = null;
if (SERVE_BUNDLE !== null) {
  const assets = new Set();
  const bodies = [];
  const sniff = await browser.newPage();
  await sniff.setCacheEnabled(false);
  sniff.on("response", (response) => {
    const url = response.url();
    if (!/\/plugin-app-assets\/[a-f0-9]+\/app\.(js|css)$/.test(url)) return;
    assets.add(url);
    bodies.push(
      response.text().then((body) => ({
        url,
        hasBoard: body.includes(BUNDLE_MARKER) || (url.endsWith(".css") && body.includes(".fb-")),
      })),
    );
  });
  await sniff.goto(BOARD, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(1500);
  const all = await Promise.all(bodies);
  await sniff.close();
  const jsUrl = all.find((e) => e.url.endsWith(".js") && e.hasBoard)?.url ?? null;
  const cssUrl = all.find((e) => e.url.endsWith(".css"))?.url ?? null;
  if (jsUrl === null) {
    console.error("Could not identify the board's app.js among the served plugin assets.");
    await browser.close();
    process.exit(1);
  }
  const js = readFileSync(`${SERVE_BUNDLE}/app.js`, "utf8");
  const css = cssUrl === null ? null : readFileSync(`${SERVE_BUNDLE}/app.css`, "utf8");
  swap = { jsUrl, cssUrl, js, css };
  evidence.bundleSwap = { servedBy: SERVE_BUNDLE, jsUrl, cssUrl, marker: "swapped" };
  console.log(`serving ${SERVE_BUNDLE}/app.{js,css} for ${jsUrl}`);
}
/** The page records the swap marker so the evidence proves the candidate ran. */
const armSwapMarker = (pageLike) =>
  pageLike.evaluateOnNewDocument(() => {
    window.__fbServedBundle = "pending";
  });
/** Answer the two plugin asset requests from the candidate build. */
const swapResponder = (request) => {
  if (swap === null) {
    void request.continue();
    return;
  }
  if (request.url() === swap.jsUrl) {
    void request.respond({
      status: 200,
      contentType: "application/javascript; charset=utf-8",
      body: `${swap.js}\n;window.__fbServedBundle = "swapped";`,
    });
    return;
  }
  if (swap.cssUrl !== null && request.url() === swap.cssUrl && swap.css !== null) {
    void request.respond({
      status: 200,
      contentType: "text/css; charset=utf-8",
      body: swap.css,
    });
    return;
  }
  void request.continue();
};
const wireSwap = async (pageLike) => {
  await armSwapMarker(pageLike);
  if (swap !== null) {
    pageLike.setRequestInterception(true).catch(() => {});
    pageLike.on("request", swapResponder);
  }
  await pageLike.setCacheEnabled(false);
};

// ---------- Desktop pass: split, open the FB pane, measure both ----------
// Every pass re-drags the split to its everyday shape AFTER each load:
// board pane 768, FB pane side-by-side, native pane ≈512. The drag is not a
// trust exercise about the stored ratio. It is what makes each pass start
// from the same geometry whether or not the host kept the last one (on bb
// 0.50.1 a dragged ratio does survive a reload — measured 2026-11-20,
// docs/screenshots/probe-split-ratio/evidence.json). A fresh split, by
// contrast, is always halves, and a ≈624px board pane flips the FB pane into
// its narrow-panel sheet. The narrow readings come from live drags measured
// in the same page load.
const page = await browser.newPage();
await wireSwap(page);
await page.goto(BOARD, { waitUntil: "networkidle2", timeout: 30000 });
await sleep(5000);
await openInSplit(page);
evidence.desktop.afterSplitState = await splitOpen(page);

const setupEveryday = async () => {
  if ((await splitOpen(page)).count < 2) {
    await openInSplit(page);
    await sleep(2000);
  }
  // Board pane → 768: the FB pane goes side-by-side, native ≈512.
  const widths = await growGutterTo(page, 768);
  await openFocusPane(page);
  await sleep(1500);
  return widths;
};
await setupEveryday();

for (const theme of ["dark", "light"]) {
  await setTheme(page, theme);
  await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4000);
  const fb = await page.evaluate(FB_HEADER);
  const native = await page.evaluate(NATIVE_HEADER);
  evidence.desktop[theme] = {
    bodyBg: await page.evaluate(BODY_BG),
    served: await page.evaluate(() => window.__fbServedBundle ?? null),
    widths: await setupEveryday(),
    fb,
    native,
  };

  await shot(page, `desktop-both-${theme}`);
  await clipHeader(page, FB_HEADER_SEL, `desktop-fb-${theme}`);
  await clipHeader(page, NATIVE_HEADER_SEL, `desktop-native-${theme}`);
}

// ---------- Desktop-narrow pass (dark): narrow the native pane to ≈320 by
// dragging the gutter right, measure it under width pressure, then shrink
// the FB pane to its 320 minimum with its own edge and measure that. ----------
{
  const nativeNarrow = await growGutterTo(page, 960);  await sleep(800);
  const native = await page.evaluate(NATIVE_HEADER);
  evidence.desktop["narrow-native"] = { widths: nativeNarrow, native };
  await shot(page, "narrow-native-dark");
  await clipHeader(page, NATIVE_HEADER_SEL, "narrow-native-dark");
  const fbNarrow = await dragPaneEdge(page, 160);
  await sleep(800);
  const fb = await page.evaluate(FB_HEADER);
  evidence.desktop["narrow-fb"] = { aside: fbNarrow, fb };
  await clipHeader(page, FB_HEADER_SEL, "narrow-fb-dark");
}
await page.close();

// ---------- Phone pass: compact viewport, same themes ----------
const phone = await browser.newPage();
await wireSwap(phone);
await phone.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
const threadUrl = `${new URL(BOARD).origin}/projects/${PROJECT_ID}/threads/${THREAD_ID}`;
// A real document before localStorage touches (about:blank denies it).
await phone.goto(BOARD, { waitUntil: "networkidle2", timeout: 30000 });

for (const theme of ["dark", "light"]) {
  await setTheme(phone, theme);
  // Native thread page at compact width (bb's plain-navigation fallback).
  await phone.goto(threadUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4500);
  const nativeHeader = await phone.evaluate(NATIVE_HEADER);
  evidence.phone[`native-${theme}`] = { native: nativeHeader, compactSplitAwareness: await phone.evaluate(() => window.matchMedia("(max-width: 767px)").matches) };
  await shot(phone, `phone-native-${theme}`);

  // Focus Board's compact full-screen sheet.
  await phone.goto(BOARD, { waitUntil: "networkidle2", timeout: 30000 });
  await sleep(4500);
  const opened = await openFocusPane(phone);
  await sleep(1200);
  evidence.phone[`fb-${theme}`] = { fb: opened === true ? await phone.evaluate(FB_HEADER) : null, opened };
  await shot(phone, `phone-fb-${theme}`);
}

writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(`evidence + frames in ${OUT_DIR}`);
await browser.close();
process.exit(0);
