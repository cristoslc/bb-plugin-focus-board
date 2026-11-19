// Headless repro for the phone report "opening a card from unread moves it to
// its idle lane but does not recenter the view on it, so it seems to
// disappear".
//
// The shape: a read-and-unread thread sits in the Unread lane, the operator
// taps it, the host marks it read a beat later, and the card relocates to its
// idle bucket. On a phone the pane covers the board, so the operator sees the
// relocation only when the sheet closes: the card must be where the board is
// looking.
//
// This driver records the frame-by-frame trace the report needs: the board's
// and the lane list's scroll offsets, the lane the card sits in, and whether
// the card is inside the board's visible range, sampled once per animation
// frame across the click and the read write. It writes before/after shots and
// evidence.json, and exits non-zero while the card is left out of view (the
// pre-fix state), zero once the board settles on it.
//
// Usage: start the harness (`npx vite --config scripts/screenshot/vite.config.ts`),
// then `node scripts/screenshot/repro-unread-open-recenter.mjs`. Honors
// CHROME_PATH, HARNESS_URL, OUT_DIR, and VIEWPORT ("390x844" | "1280x800").
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-unread-open-recenter/", import.meta.url).pathname;
const [width, height] = (process.env.VIEWPORT ?? "390x844").split("x").map(Number);
const PHONE = width < 768;
const CARD = process.env.CARD ?? "thr_rpc_auth";
// The host's read write lands after its round trip, never in the click's own
// commit: the report's "a beat later".
const READ_WRITE_DELAY_MS = Number(process.env.READ_WRITE_DELAY_MS ?? 120);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width, height, deviceScaleFactor: PHONE ? 2 : 1, isMobile: PHONE, hasTouch: PHONE },
  args: ["--hide-scrollbars"],
});

await mkdir(OUT, { recursive: true });
const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: PHONE ? 2 : 1, isMobile: PHONE, hasTouch: PHONE });
await page.goto(`${BASE}?groupBy=status`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
await page.waitForSelector(`[data-thread-card="${CARD}"]`, { timeout: 30_000 });
await new Promise((resolve) => setTimeout(resolve, 600));

// The sampler: one sample per animation frame, pushed onto a page-side array.
// It reads the DOM only, so it never perturbs the app it is watching.
const START_SAMPLER = (cardId) => {
  const samples = [];
  let stop = false;
  globalThis.__recenterSamples = samples;
  globalThis.__stopRecenterSampler = () => {
    stop = true;
  };
  const read = (label) => {
    const board = document.querySelector("[data-columns-board]");
    const card = document.querySelector(`[data-thread-card="${CSS.escape(cardId)}"]:not([data-transport-ghost] [data-thread-card])`);
    const anchor = card ?? document.querySelector(`[data-thread-card="${CSS.escape(cardId)}"]`);
    const lane = anchor?.closest("section[data-column-id]") ?? null;
    const list = anchor?.closest("[data-card-list]") ?? null;
    const b = board?.getBoundingClientRect() ?? null;
    const c = anchor?.getBoundingClientRect() ?? null;
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    return {
      label,
      t: Math.round(performance.now()),
      lane: lane?.getAttribute("data-column-id") ?? null,
      paneOpen: pane !== null,
      boardX: board ? Math.round(board.scrollLeft) : null,
      boardY: board ? Math.round(board.scrollTop) : null,
      listX: list ? Math.round(list.scrollLeft) : null,
      listY: list ? Math.round(list.scrollTop) : null,
      cardLeft: c ? Math.round(c.left) : null,
      cardRight: c ? Math.round(c.right) : null,
      inBoardView:
        b && c ? c.left >= b.left - 1 && c.right <= b.right + 1 : null,
      ghost: anchor ? anchor.closest("[data-transport-ghost]") !== null : null,
    };
  };
  samples.push(read("pre-click"));
  const tick = () => {
    if (stop) return;
    samples.push(read("frame"));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

// The operator's starting state: the card is on screen, in Unread. At phone
// width the Unread lane can start beyond the fold, so the board is panned to
// the card first — a click on an offscreen rect would land on nothing and the
// run would "reproduce" a board nobody touched.
const panned = await page.evaluate((card) => {
  const board = document.querySelector("[data-columns-board]");
  const host = document.querySelector(`[data-thread-card="${CSS.escape(card)}"]`);
  if (!board || !host) return null;
  const b = board.getBoundingClientRect();
  const c = host.getBoundingClientRect();
  const delta = c.left < b.left ? -(b.left - c.left) : c.right > b.right ? c.right - b.right : 0;
  board.scrollLeft += delta + (c.left < b.left || c.right > b.right ? 16 : 0);
  return { boardX: Math.round(board.scrollLeft), cardLeft: Math.round(host.getBoundingClientRect().left) };
}, CARD);
if (panned === null) throw new Error(`no board or card ${CARD}`);
await new Promise((resolve) => setTimeout(resolve, 250));

await page.evaluate(START_SAMPLER, CARD);

// The before shot: the board as the operator leaves it, the card in Unread.
await page.screenshot({ path: `${OUT}before-${width}.png` });

// A real tap on the card, the gesture the report describes.
const box = await page.evaluate((card) => {
  const host = document.querySelector(`[data-thread-card="${CSS.escape(card)}"]`);
  const el = host?.matches("a[href]") ? host : host?.querySelector("a[href]");
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}, CARD);
if (box === null) throw new Error(`no card ${CARD} to click`);
await page.mouse.click(box.x, box.y);
await page.evaluate(() => globalThis.__recenterSamples.push({ label: "clicked", t: Math.round(performance.now()) }));

// Fail loud: a click that missed the card would make every reading below
// meaningless, so the pane has to be open before the host's write lands.
await page.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 10_000 });
await page.evaluate(() => globalThis.__recenterSamples.push({ label: "pane-open", t: Math.round(performance.now()) }));

// The host's read write, landing after its own round trip.
await new Promise((resolve) => setTimeout(resolve, READ_WRITE_DELAY_MS));
await page.evaluate(
  (card) => {
    const now = Date.now();
    globalThis.__uat.pushThreadUpdate(card, { isUnread: false, lastReadAt: now });
    globalThis.__recenterSamples.push({ label: "read-write", t: Math.round(performance.now()) });
  },
  CARD,
);

// Settle: long enough for the transport dissolve, the pane's own capture, and
// any refit the board might still run.
await new Promise((resolve) => setTimeout(resolve, 1600));

const samples = await page.evaluate(() => {
  globalThis.__stopRecenterSampler();
  return globalThis.__recenterSamples;
});

// The after shot with the pane closed: what the operator sees when the phone
// sheet lifts — the frame the report is about.
if (PHONE) {
  await page.keyboard.press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const after = await page.evaluate((card) => {
  const board = document.querySelector("[data-columns-board]");
  const host = document.querySelector(`[data-thread-card="${CSS.escape(card)}"]`);
  const lane = host?.closest("section[data-column-id]") ?? null;
  const b = board?.getBoundingClientRect() ?? null;
  const c = host?.getBoundingClientRect() ?? null;
  return {
    lane: lane?.getAttribute("data-column-id") ?? null,
    boardX: board ? Math.round(board.scrollLeft) : null,
    boardY: board ? Math.round(board.scrollTop) : null,
    inBoardView: b && c ? c.left >= b.left - 1 && c.right <= b.right + 1 : null,
  };
}, CARD);
await page.screenshot({ path: `${OUT}after-${width}.png` });

// The trace, compressed to the frames that changed something: the lane the
// card sat in, the board's offset, and the card's place in the board's view.
const lanes = new Map();
const transitions = [];
let lastKey = null;
for (const sample of samples) {
  if (sample.label === "frame") {
    lanes.set(sample.lane, (lanes.get(sample.lane) ?? 0) + 1);
  }
  const key = JSON.stringify([sample.label, sample.lane, sample.boardX, sample.inBoardView]);
  if (key !== lastKey) {
    transitions.push({
      label: sample.label,
      t: sample.t,
      lane: sample.lane,
      boardX: sample.boardX,
      boardY: sample.boardY,
      listX: sample.listX,
      listY: sample.listY,
      cardLeft: sample.cardLeft,
      cardRight: sample.cardRight,
      inBoardView: sample.inBoardView,
      paneOpen: sample.paneOpen,
    });
    lastKey = key;
  }
}

const evidence = {
  viewport: { width, height },
  card: CARD,
  readWriteDelayMs: READ_WRITE_DELAY_MS,
  firstFrame: samples[0],
  lastFrame: samples.filter((sample) => sample.label === "frame").at(-1) ?? null,
  frames: samples.length,
  framesPerLane: Object.fromEntries(lanes),
  transitions,
  afterPaneClose: after,
};
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}evidence-${width}.json`, JSON.stringify(evidence, null, 2));

const ok = after.inBoardView === true;
console.log(
  JSON.stringify(
    {
      out: OUT,
      viewport: `${width}x${height}`,
      laneTrail: transitions.map((entry) => `${entry.label}:${entry.lane ?? "-"}@x${entry.boardX}`),
      afterPaneClose: after,
      verdict: ok ? "PASS: the board settles on the card" : "FAIL: the card is left out of view",
    },
    null,
    2,
  ),
);
await browser.close();
process.exit(ok ? 0 : 1);
