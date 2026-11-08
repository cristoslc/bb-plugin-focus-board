// One-shot capture and gate for the View menu's ungrouped option label (the
// option used to read "None", which said nothing about the board it picked).
// Loads the board seeded to that grouping (?groupBy=none), records what the
// View menu offers and what the View chip reads, opens the menu for a frame,
// then closes it for the resulting one-lane board frame at 1920x1080.
// Run the vite harness first:
//   npm run build && npx vite --config scripts/screenshot/vite.config.ts
// then: node scripts/screenshot/repro-view-menu-label.mjs
// EXPECT_LABEL names the label the run gates on (default "No grouping");
// EXPECT_LABEL=none records evidence only, for a pre-change frame set
// captured through OUT_DIR like the other repros.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir =
  process.env.OUT_DIR ??
  path.join(here, "..", "..", "docs", "screenshots", "repro-view-menu-label");
await fs.mkdir(outDir, { recursive: true });
const base = process.env.HARNESS_URL ?? "http://localhost:5173/";
const expectLabel = process.env.EXPECT_LABEL ?? "No grouping";

const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-first-run", "--disable-search-engine-choice-screen"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
await page.goto(`${base}?groupBy=none`, { waitUntil: "networkidle2" });
await page.waitForSelector("[data-thread-card]", { timeout: 15000 });
// The ungrouped view is a card GRID since issue #416: no lane section to wait
// for, the grid element is the surface.
await page.waitForSelector("[data-card-grid]", { timeout: 15000 });

const evidence = {};

// 1. The View chip's own text: the selected grouping's name, no colon label.
evidence.chipText = await page.$eval('button[aria-label="View"]', (el) =>
  el.textContent.trim(),
);

// 2. The board the option picks: the card grid, no lanes, at a wide viewport.
evidence.board = await page.evaluate(() => {
  const grid = document.querySelector("[data-card-grid]");
  const board = document.querySelector("[data-card-grid-board]");
  return {
    laneIds: [...document.querySelectorAll("[data-column-id]")].map((lane) =>
      lane.getAttribute("data-column-id"),
    ),
    gridCards: document.querySelectorAll("li[data-grid-card]").length,
    cardCount: document.querySelectorAll("[data-thread-card]").length,
    boardWidth: board?.getBoundingClientRect().width ?? null,
    gridTracks:
      grid === null
        ? null
        : getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
  };
});
await page.screenshot({ path: path.join(outDir, "board.png") });

// 3. The View menu open: every grouping row the menu offers, and which one
// paints selected.
await page.click('button[aria-label="View"]');
await page.waitForSelector('[role="listbox"][aria-label="View"]', {
  timeout: 5000,
});
evidence.menu = await page.evaluate(() => {
  const list = document.querySelector('[role="listbox"][aria-label="View"]');
  const rows = [...list.querySelectorAll('[role="option"]')];
  return {
    labels: rows.map((row) => row.textContent.trim()),
    selected: rows
      .filter((row) => row.getAttribute("aria-selected") === "true")
      .map((row) => row.textContent.trim()),
  };
});
await page.screenshot({ path: path.join(outDir, "menu.png") });

await fs.writeFile(
  path.join(outDir, "evidence.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
await browser.close();

if (expectLabel !== "none") {
  const problems = [];
  if (!evidence.menu.labels.includes(expectLabel)) {
    problems.push(`the View menu does not offer "${expectLabel}"`);
  }
  if (evidence.menu.labels.includes("None")) {
    problems.push('the View menu still offers "None"');
  }
  if (!evidence.menu.selected.includes(expectLabel)) {
    problems.push(
      `the selected row reads "${evidence.menu.selected.join(", ")}", not "${expectLabel}"`,
    );
  }
  if (!evidence.chipText.includes(expectLabel)) {
    problems.push(`the View chip reads "${evidence.chipText}"`);
  }
  // Since issue #416 the ungrouped view is a card grid: no lane container of
  // any kind, and a grid that wraps at this width.
  if (evidence.board.laneIds.length > 0) {
    problems.push(`the grid grew lane containers ${evidence.board.laneIds.join(", ")}`);
  }
  if (evidence.board.gridCards === 0) {
    problems.push("the grid rendered no cards");
  }
  if (evidence.board.gridTracks === null || evidence.board.gridTracks < 2) {
    problems.push(`the grid laid out ${evidence.board.gridTracks} column(s)`);
  }
  if (problems.length > 0) {
    console.error(`FAIL: ${problems.join("; ")}`);
    process.exit(1);
  }
  console.log(`PASS: the View menu and chip read "${expectLabel}"`);
}
