// Frames and a gate for the ungrouped view's card grid (issue #416): the
// view is a responsive grid of cards, not a one-lane board, and the View
// menu carries the grid's own order (Sort by + Order) in that view.
//
// Run the vite harness first:
//   npm run build && npx vite --config scripts/screenshot/vite.config.ts
// then: node scripts/screenshot/capture-grid-view.mjs
//
// Frames land in docs/screenshots/grid-view/: the default grid (last
// activity, newest first) at desktop size, the same board ordered
// alphabetically and by created date, the View menu open on the grid's two
// choice rows, a 300-card board (the `?scale=` bulk fixture), a phone-width
// grid, and the empty board. `evidence.json` records what the DOM said, so a reviewer can
// check the frames against the numbers.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir =
  process.env.OUT_DIR ?? path.join(here, "..", "..", "docs", "screenshots", "grid-view");
await fs.mkdir(outDir, { recursive: true });
const base = process.env.HARNESS_URL ?? "http://localhost:5173/";
const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-first-run", "--disable-search-engine-choice-screen"],
});
const page = await browser.newPage();
const evidence = {};

/** What the grid says about itself: cards in order, tracks, lane containers. */
async function readGrid() {
  return page.evaluate(() => {
    const grid = document.querySelector("[data-card-grid]");
    if (!(grid instanceof HTMLElement)) return null;
    const idOf = (el) => el.getAttribute("href")?.split("/").pop() ?? "?";
    return {
      cards: [...grid.querySelectorAll(":scope > li[data-grid-card]")].map((li) =>
        idOf(li.querySelector("a[href]")),
      ),
      tracks: getComputedStyle(grid).gridTemplateColumns
        .split(" ")
        .filter((track) => track !== "" && track !== "none").length,
      lanes: document.querySelectorAll("[data-column-id]").length,
      laneHeaders: document.querySelectorAll("[data-lane-menu-trigger]").length,
      cardsFolded: document.querySelectorAll("[data-thread-card]").length,
    };
  });
}

async function openGrid(gotoQuery, viewport) {
  if (viewport !== undefined) await page.setViewport(viewport);
  await page.goto(`${base}${gotoQuery}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-thread-card]", { timeout: 15000 });
  await page.waitForSelector("[data-card-grid]", { timeout: 15000 });
}

// 1. The grid as it opens: last activity, newest first, at desktop size.
await openGrid("?groupBy=none", { width: 1920, height: 1080, deviceScaleFactor: 1 });
evidence.default = await readGrid();
await page.screenshot({ path: path.join(outDir, "grid-desktop.png") });

// 2. The View menu inside the grid: the order rows, and no lane-direction row.
await page.click('button[aria-label="View"]');
await page.waitForSelector('[role="listbox"][aria-label="View"]', { timeout: 5000 });
evidence.menu = await page.evaluate(() => {
  const pairs = [...document.querySelectorAll('[role="radiogroup"]')];
  const shell = document.querySelector('[role="presentation"][aria-label="View"]');
  const box = shell?.getBoundingClientRect() ?? null;
  return {
    pairs: pairs.map((group) => ({
      label: group.getAttribute("aria-label"),
      options: [...group.querySelectorAll('[role="radio"]')].map((radio) => ({
        label: radio.textContent.trim(),
        checked: radio.getAttribute("aria-checked") === "true",
      })),
      insideMenu:
        box !== null &&
        group.getBoundingClientRect().top >= box.top - 0.5 &&
        group.getBoundingClientRect().bottom <= box.bottom + 0.5,
    })),
  };
});
await page.screenshot({ path: path.join(outDir, "grid-menu.png") });

// 3. Alphabetical, ascending: a different order over the same board.
await openGrid("?groupBy=none&gridSort=title:asc");
evidence.alphabetical = await readGrid();
await page.screenshot({ path: path.join(outDir, "grid-alphabetical.png") });

// 4. Created date, newest first: the third key, seeded through the query.
await openGrid("?groupBy=none&gridSort=created:desc");
evidence.created = await readGrid();
await page.screenshot({ path: path.join(outDir, "grid-created.png") });

// 5. Hundreds of cards: the bulk fixture at desktop width.
await openGrid("?groupBy=none&scale=300");
evidence.many = await readGrid();
await page.screenshot({ path: path.join(outDir, "grid-many.png") });

// 6. Phone width: one column, full-width cards.
await openGrid("?groupBy=none", { width: 390, height: 844, deviceScaleFactor: 2 });
evidence.phone = await readGrid();
await page.screenshot({ path: path.join(outDir, "grid-phone.png") });

// 7. Nothing to show: the board's empty state, not an empty grid frame.
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`${base}?groupBy=none&q=zzzznoresults`, { waitUntil: "networkidle2" });
// The empty board replaces the whole grid with the panel's empty state, so
// the toolbar is the mount signal here.
await page.waitForSelector("[data-board-toolbar]", { timeout: 15000 });
evidence.empty = await page.evaluate(() => ({
  grid: document.querySelector("[data-card-grid]") !== null,
  text: document.body.innerText.match(/No threads[^\n]*/)?.[0] ?? null,
}));
await page.screenshot({ path: path.join(outDir, "grid-empty.png") });

await fs.writeFile(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();

const problems = [];
if (evidence.default === null) problems.push("the ungrouped view rendered no card grid");
if (evidence.default.lanes !== 0) {
  problems.push(`the grid carried ${evidence.default.lanes} lane container(s)`);
}
if (evidence.default.laneHeaders !== 0) {
  problems.push(`the grid carried ${evidence.default.laneHeaders} lane header(s)`);
}
if (evidence.default.tracks < 4) {
  problems.push(`the desktop grid laid out only ${evidence.default.tracks} column(s)`);
}
if (evidence.phone.tracks !== 1) {
  problems.push(`the phone grid laid out ${evidence.phone.tracks} column(s), not 1`);
}
const labels = evidence.menu.pairs.map((pair) => pair.label);
if (!labels.includes("Sort by") || !labels.includes("Order")) {
  problems.push(`the View menu offered ${JSON.stringify(labels)}`);
}
if (labels.includes("Lane direction")) {
  problems.push("the View menu still offers Lane direction in the grid");
}
if (evidence.menu.pairs.some((pair) => !pair.insideMenu)) {
  problems.push("a grid choice pair sat outside the open View menu");
}
if (evidence.alphabetical.cards.join(",") === evidence.default.cards.join(",")) {
  problems.push("the alphabetical seed did not change the order");
}
if (evidence.created.cards.join(",") === evidence.default.cards.join(",")) {
  problems.push("the created-date seed did not change the order");
}
if (evidence.empty.text === null) {
  problems.push("the empty board printed no empty-state sentence");
}

if (problems.length > 0) {
  console.error(`FAIL: ${problems.join("; ")}`);
  process.exit(1);
}
console.log("PASS: the grid mounts with no lanes, wraps by width, and the View menu carries its order");
