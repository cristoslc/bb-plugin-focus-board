// Headless repro for the per-lane header menu (ruling dl-20261105T165850-324f).
// Frames the ruling's three surfaces against the REAL app mounted by the
// screenshot harness:
//   1. the lane header with the retired hand-order badge gone (an ordered
//      lane reports its state on data-column-ordered and carries no badge),
//   2. the menu a header click opens (sort row, remove entry, sweep entry),
//   3. the sweep pill's eligibility-plus-count law: a zero-eligible sweepable
//      lane shows no pill; the Done lane (9-13 days aged) shows count 2.
// Writes frames to docs/screenshots/repro-lane-header-menu/ plus a JSON with
// the DOM readings the frames claim.
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts --port
// 5231 --strictPort`, then `node scripts/screenshot/repro-lane-header-menu.mjs`.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const DESKTOP = { width: 1280, height: 800 };
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5231/";
const OUT = new URL("../../docs/screenshots/repro-lane-header-menu/", import.meta.url)
  .pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: DESKTOP,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
});
page.on("response", (response) => {
  if (response.status() === 404) errors.push(`[404] ${response.url()}`);
});
await mkdir(OUT, { recursive: true });

await page.goto(
  `${BASE}?groupBy=status&ranks=${encodeURIComponent(
    JSON.stringify({ "status:unread": ["thr_review_pr"] }),
  )}`,
  { waitUntil: "domcontentloaded", timeout: 60_000 },
);
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 800));

// Frame 1: the ranked lane's header — badge gone (its aria-label was the
// old marker), the ordered state itself still on the section, and the
// caret riding the lane's name (the toolbar's dropdown idiom).
const headerRead = await page.evaluate(() => {
  const section = document.querySelector('section[data-column-id="unread"]');
  const header = section?.querySelector(":scope > header");
  const trigger = header?.querySelector("button[data-lane-menu-trigger]");
  const badge = document.querySelector('[aria-label="Ordered by you, not by recency"]');
  return {
    ordered: section?.getAttribute("data-column-ordered"),
    triggerLabel: trigger?.getAttribute("aria-label") ?? null,
    triggerInName: trigger?.closest("h3") !== null,
    triggerExpanded: trigger?.getAttribute("aria-expanded") ?? null,
    oldBadgeGone: badge === null,
  };
});

await page.screenshot({ path: `${OUT}lane-header-badge-gone.png` });

// Frame 2: the menu the name+caret target opens.
await page.click('section[data-column-id="unread"] header button[data-lane-menu-trigger]');
await page.waitForSelector('[role="menu"][aria-label="Lane actions"]', { timeout: 5_000 });
const menuRead = await page.evaluate(() => {
  const menu = document.querySelector('[role="menu"][aria-label="Lane actions"]');
  return {
    open: menu !== null,
    sortState: menu?.querySelector("[data-lane-sort-state]")?.getAttribute("data-lane-sort-state") ?? null,
    sortText: menu?.querySelector("[data-lane-sort-state]")?.textContent?.trim() ?? null,
    directionChecked:
      menu?.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent?.trim() ?? null,
    removeEntry: [...(menu?.querySelectorAll("button") ?? [])].some(
      (button) => button.textContent?.trim() === "Remove custom order",
    ),
    sweepEntry: [...(menu?.querySelectorAll("button") ?? [])].some(
      (button) => button.textContent?.trim() === "Sweep this lane…",
    ),
  };
});
await page.screenshot({ path: `${OUT}lane-menu-open.png` });
// Close the menu (the backdrop click) so the count frame shows the headers.
await page.mouse.click(640, 500);
await page.waitForSelector('[role="menu"][aria-label="Lane actions"]', {
  hidden: true,
  timeout: 5_000,
});

// Frame 3: the sweep pill's eligibility law, from the same board.
const pillRead = await page.evaluate(() => {
  const pillOf = (columnId) => {
    const header = document.querySelector(
      `section[data-column-id="${columnId}"] > header`,
    );
    const pill = header?.querySelector("[data-sweep-button]");
    return pill === null || pill === undefined
      ? null
      : pill.textContent?.trim() ?? "";
  };
  return {
    // A manual arm with nothing eligible: the broom rests.
    unread: pillOf("unread"),
    // The Done arm with two aged-out members: the count.
    done: pillOf("done"),
  };
});

// The Done lane sits offscreen right at 1280px; pan the board's far end so
// the count frame shows both halves of the law in one view (a zero-eligible
// sweepable lane carries no pill; the Done lane's broom carries its count).
await page.evaluate(() => {
  const scroller = document.querySelector("[data-columns-board]");
  if (scroller !== null) scroller.scrollLeft = scroller.scrollWidth;
});
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}sweep-pill-eligibility.png` });

const record = {
  ruling: "dl-20261105T165850-324f",
  url: BASE,
  header: headerRead,
  menu: menuRead,
  pills: pillRead,
  consoleErrors: errors,
};
await writeFile(`${OUT}evidence.json`, `${JSON.stringify(record, null, 2)}\n`);

await browser.close();
console.log(JSON.stringify(record, null, 2));
