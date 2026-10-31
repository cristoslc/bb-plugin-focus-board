// Headless probe: WHO owns a finger's pan, per origin and per axis (the
// interaction contract of issue #330).
//
// The report: "sliding a finger in the header scrolls the page. Sliding a
// finger in a lane scrolls the lane horizontally even though there's nothing
// to the right of the cards." The rule: a slide scrolls the nearest scroller
// that actually has overflow in the gesture's direction, chaining lane → board
// → nothing, and a scroller with no overflow in the axis must not consume it.
//
// So the question is not "did something move" but "which element moved, and
// which element could have". This probe reads the live scroll geometry before
// and after a real CDP touch pan (page.touchscreen against a hasTouch
// viewport), from five origins in both lane layouts:
//
//   card      a top-level card's body
//   lane-gap  the lane's empty space below its last card
//   lane-head the lane's own header strip (lane label + count)
//   toolbar   the board toolbar above the board (the operator's "header")
//   board     the board's own padding, outside every lane
//
// The reading includes every scroller's computed overflow and its overflow
// extent (scrollWidth − clientWidth), so a lane list that is an accidental
// cross-axis scroller shows up as `overflowX: auto` with `maxX: 0`.
//
// Run: npx vite --config scripts/screenshot/vite.config.ts --port 5173
// then: node scripts/screenshot/probe-board-pan-routing.mjs
// Evidence lands in docs/screenshots/probe-board-pan-routing/evidence.json.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/probe-board-pan-routing/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

/** A real finger pan, `px` along one axis. */
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

const SHELL = () => {
  // The page-scroll fixture: a shell around the plugin root with one viewport
  // of overflow, the shape a host pane has. Without it "the page scrolled"
  // cannot be observed at all (the harness page is exactly one screen tall).
  let shell = document.getElementById("uat-scroll-shell");
  if (shell === null) {
    shell = document.createElement("div");
    shell.id = "uat-scroll-shell";
    shell.style.cssText = "height:100%;overflow:auto;";
    const root = document.getElementById("root");
    root.replaceWith(shell);
    shell.append(root);
    const spacer = document.createElement("div");
    spacer.id = "uat-page-overflow";
    spacer.style.cssText = "height:100vh;";
    shell.append(spacer);
  }
  return true;
};

/** The scroll geometry of everything that could own a pan. */
const geometry = () => {
  const read = (el) => {
    if (el === null) return null;
    const cs = getComputedStyle(el);
    return {
      scrollLeft: Math.round(el.scrollLeft),
      scrollTop: Math.round(el.scrollTop),
      maxX: Math.round(el.scrollWidth - el.clientWidth),
      maxY: Math.round(el.scrollHeight - el.clientHeight),
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      touchAction: cs.touchAction,
    };
  };
  const list = document.querySelector("[data-card-list]");
  const shell = document.getElementById("uat-scroll-shell");
  return {
    board: read(document.querySelector("[data-columns-board]")),
    lane: read(list),
    page: read(shell),
    window: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
  };
};

/** A viewport point for each origin, the way an operator's finger finds it. */
const origins = () => {
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  const rect = (el) => el.getBoundingClientRect();
  const mid = (b) => ({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) });
  const card = document.querySelector("[data-card-list] [data-thread-card]");
  const list = document.querySelector("[data-card-list]");
  const laneHead = document.querySelector("section[data-column-id] > header");
  const toolbar = document.querySelector("[data-board-toolbar]");
  const board = document.querySelector("[data-columns-board]");
  const listBox = list === null ? null : rect(list);
  const cardBox = card === null ? null : rect(card);
  const laneBox = laneHead === null ? null : rect(laneHead);
  const toolbarBox = toolbar === null ? null : rect(toolbar);
  const boardBox = board === null ? null : rect(board);
  return {
    card: cardBox === null ? null : { x: Math.round(cardBox.left + cardBox.width / 2), y: Math.round(cardBox.top + Math.min(cardBox.height / 2, 16)) },
    "lane-gap": listBox === null ? null : horizontal
      ? { x: Math.round(Math.min(listBox.right - 6, (cardBox?.right ?? listBox.left) + 24)), y: Math.round(listBox.top + listBox.height / 2) }
      : { x: Math.round(mid(listBox).x), y: Math.round(Math.min(listBox.bottom - 6, (cardBox?.bottom ?? listBox.top) + 24)) },
    "lane-head": laneBox === null ? null : mid(laneBox),
    toolbar: toolbarBox === null ? null : mid(toolbarBox),
    board: boardBox === null ? null : { x: Math.round(boardBox.left + 8), y: Math.round(boardBox.bottom - 8) },
  };
};

const results = [];

for (const layout of [
  { name: "vertical", query: "?groupBy=status" },
  { name: "horizontal", query: "?groupBy=status&laneDirection=horizontal" },
]) {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
  for (const axis of ["x", "y"]) {
    for (const origin of ["card", "lane-gap", "lane-head", "toolbar", "board"]) {
      await page.goto(`${BASE}${layout.query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
      await sleep(900);
      await page.evaluate(SHELL);
      const points = await page.evaluate(origins);
      const point = points[origin];
      if (point === null) {
        results.push({ layout: layout.name, axis, origin, skipped: "origin not resolvable" });
        continue;
      }
      const under = await page.evaluate(
        (p) => document.elementFromPoint(p.x, p.y)?.tagName.toLowerCase() ?? null,
        point,
      );
      const before = await page.evaluate(geometry);
      await pan(page, { ...point, axis, px: axis === "x" ? -200 : -200 });
      const after = await page.evaluate(geometry);
      const delta = (scroller) => ({
        x: after[scroller] === null ? null : after[scroller].scrollLeft - before[scroller].scrollLeft,
        y: after[scroller] === null ? null : after[scroller].scrollTop - before[scroller].scrollTop,
      });
      results.push({
        layout: layout.name,
        axis,
        origin,
        point,
        under,
        before,
        delta: { board: delta("board"), lane: delta("lane"), page: delta("page") },
      });
    }
  }
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}evidence.json`, `${JSON.stringify(results, null, 2)}\n`);

const fmt = (v) => String(v).padStart(4);
for (const r of results) {
  if (r.skipped) {
    console.log(`${r.layout}/${r.axis} ${r.origin}: skipped (${r.skipped})`);
    continue;
  }
  console.log(
    `${r.layout.padEnd(10)} ${r.axis} ${r.origin.padEnd(10)} under=${String(r.under).padEnd(8)} ` +
      `board=${fmt(r.delta.board.x)}/${fmt(r.delta.board.y)} lane=${fmt(r.delta.lane.x)}/${fmt(r.delta.lane.y)} page=${fmt(r.delta.page.x)}/${fmt(r.delta.page.y)}  ` +
      `geom board=${r.before.board.overflowX}/${r.before.board.maxX},${r.before.board.overflowY}/${r.before.board.maxY} ` +
      `lane=${r.before.lane.overflowX}/${r.before.lane.maxX},${r.before.lane.overflowY}/${r.before.lane.maxY}`,
  );
}
