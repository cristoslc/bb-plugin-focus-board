// Headless probe: does a touch pan of the BOARD scroll it when the finger
// lands on a card? (The operator's report: on a phone the columns drag around
// and the board never scrolls.)
//
// Run: npx vite --config scripts/screenshot/vite.config.ts --port 5173
// then: node scripts/screenshot/probe-board-touch-scroll.mjs
//
// Two lane layouts, three gesture origins each:
//   card   — the finger lands on a top-level card (the report's case)
//   gutter — the finger lands on the lane's empty card-list space below the
//            last card (still inside the lane's own scroller)
//   board  — the finger lands on the board's own padding, outside any lane
// Touch is real: page.touchscreen drives CDP Input.dispatchTouchEvent against
// a `hasTouch`+`isMobile` viewport, so the browser's own gesture recognizer
// and `touch-action` decide the outcome, not the probe.
//
// Evidence lands in docs/screenshots/probe-board-touch-scroll/evidence.json.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/probe-board-touch-scroll/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

/** A horizontal (or vertical) touch pan of `px` from the given origin. */
async function pan(page, { x, y, axis, px, steps = 8 }) {
  const ts = page.touchscreen;
  await ts.touchStart(x, y);
  for (let i = 1; i <= steps; i += 1) {
    const d = (px * i) / steps;
    await ts.touchMove(axis === "x" ? x + d : x, axis === "y" ? y + d : y);
    await sleep(16);
  }
  await ts.touchEnd();
  await sleep(700);
}

/**
 * Installs the event log: which pointers, drags, and selections the gesture
 * produced, and what the scroll offsets did.
 */
const instrument = () => {
  const log = (window.__touchLog = { events: [], scrolls: [] });
  const push = (kind, event) => {
    const target = event.target;
    log.events.push({
      kind,
      target:
        target instanceof Element
          ? `${target.tagName.toLowerCase()}${target.getAttribute("data-thread-card") ? `[card=${target.getAttribute("data-thread-card")}]` : ""}${target.hasAttribute("draggable") ? "[draggable]" : ""}`
          : String(target),
      cancelable: event.cancelable ?? null,
      defaultPrevented: event.defaultPrevented ?? null,
    });
  };
  for (const kind of ["touchstart", "touchmove", "touchend", "pointerdown", "pointermove", "pointerup", "dragstart", "drag", "dragend"]) {
    document.addEventListener(kind, (event) => push(kind, event), { capture: true, passive: true });
  }
  for (const el of document.querySelectorAll("[data-columns-board], [data-card-list]")) {
    el.addEventListener("scroll", () => {
      log.scrolls.push({
        board: el.hasAttribute("data-columns-board") ? Math.round(el.scrollLeft) : null,
        list: el.hasAttribute("data-card-list") ? Math.round(el.scrollLeft) : null,
        top: Math.round(el.scrollTop),
      });
    });
  }
};

/** The board's scroll offsets and the selection state. */
const offsets = () => {
  const board = document.querySelector("[data-columns-board]");
  return {
    boardLeft: Math.round(board.scrollLeft),
    boardTop: Math.round(board.scrollTop),
    boardMaxX: board.scrollWidth - board.clientWidth,
    boardScrollX: getComputedStyle(board).overflowX,
    boardTouchAction: getComputedStyle(board).touchAction,
    selection: String(window.getSelection() ?? "").length,
    dragging: document.querySelector("[dragging], .dragging") !== null,
  };
};

/** A point inside the named element: its center, or a fraction down it. */
const pointIn = (selector, { fy = 0.5, fx = 0.5, dy = 0 } = {}) => {
  const el = document.querySelector(selector);
  if (el === null) return null;
  const box = el.getBoundingClientRect();
  return {
    x: Math.round(box.left + box.width * fx),
    y: Math.round(box.top + box.height * fy + dy),
  };
};

const results = [];

for (const layout of [
  { name: "vertical", query: "?groupBy=status", axis: "x", px: -220 },
  { name: "horizontal", query: "?groupBy=status&laneDirection=horizontal", axis: "y", px: -220 },
]) {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

  for (const origin of ["card", "gutter", "board"]) {
    await page.goto(`${BASE}${layout.query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
    await sleep(900);
    await page.evaluate(instrument);

    // The card origin: the first card of the lane whose card list has room
    // below it, so a drag along the flow is not clipped by the viewport.
    const cardPoint = await page.evaluate(() => {
      const card = document.querySelector('[data-card-list] [data-thread-card]');
      if (card === null) return null;
      const box = card.getBoundingClientRect();
      return {
        x: Math.round(box.left + box.width / 2),
        y: Math.round(box.top + Math.min(box.height / 2, 18)),
      };
    });
    // The gutter origin: inside the lane's card list, below its last card.
    const gutterPoint = await page.evaluate(() => {
      const list = document.querySelector("[data-card-list]");
      if (list === null) return null;
      const cards = list.querySelectorAll("[data-thread-card]");
      const last = cards[cards.length - 1];
      const listBox = list.getBoundingClientRect();
      if (last === undefined) return null;
      const lastBox = last.getBoundingClientRect();
      const y = Math.round(Math.min(listBox.bottom - 6, lastBox.bottom + 40));
      return y > lastBox.bottom ? { x: Math.round(listBox.left + listBox.width / 2), y } : null;
    });
    const boardPoint = await page.evaluate(() => {
      const board = document.querySelector("[data-columns-board]");
      const box = board.getBoundingClientRect();
      return { x: Math.round(box.left + 12), y: Math.round(box.bottom - 12) };
    });
    const point = origin === "card" ? cardPoint : origin === "gutter" ? gutterPoint : boardPoint;
    if (point === null) {
      results.push({ layout: layout.name, origin, skipped: "origin not resolvable" });
      continue;
    }

    const before = await page.evaluate(offsets);
    const target = await page.evaluate(
      (p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el === null
          ? null
          : {
              tag: el.tagName.toLowerCase(),
              card: el.closest("[data-thread-card]")?.getAttribute("data-thread-card") ?? null,
              draggable: el.closest("[draggable]") !== null,
              touchAction: getComputedStyle(el).touchAction,
              userSelect: getComputedStyle(el).userSelect,
              webkitUserDrag: getComputedStyle(el).getPropertyValue("-webkit-user-drag"),
            };
      },
      point,
    );
    await pan(page, { ...point, axis: layout.axis, px: layout.px });
    const after = await page.evaluate(offsets);
    const log = await page.evaluate(() => window.__touchLog);
    const eventKinds = [...new Set(log.events.map((e) => e.kind))];
    results.push({
      layout: layout.name,
      origin,
      point,
      target,
      before,
      after,
      scrolled: layout.axis === "x" ? after.boardLeft - before.boardLeft : after.boardTop - before.boardTop,
      eventKinds,
      dragStarted: log.events.some((e) => e.kind === "dragstart"),
      draggedTarget: log.events.find((e) => e.kind === "dragstart")?.target ?? null,
      touchTarget: log.events.find((e) => e.kind === "touchstart")?.target ?? null,
      scrollEvents: log.scrolls.length,
    });
    await page.screenshot({ path: `${OUT}${layout.name}-${origin}.png` });
  }
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}evidence.json`, `${JSON.stringify(results, null, 2)}\n`);

for (const r of results) {
  if (r.skipped) {
    console.log(`${r.layout}/${r.origin}: skipped (${r.skipped})`);
    continue;
  }
  console.log(
    `${r.layout.padEnd(10)} ${r.origin.padEnd(6)}  scroll=${String(r.scrolled).padStart(5)}  ` +
      `touch-action=${String(r.target?.touchAction).padEnd(12)} dragstart=${r.dragStarted ? `YES(${r.draggedTarget})` : "no"}  ` +
      `events=[${r.eventKinds.join(",")}]  selection=${r.after.selection}`,
  );
}
