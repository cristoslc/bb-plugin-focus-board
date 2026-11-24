// Which lane headers carry a sweep pill on the LIVE board, and which lanes
// still offer the lane menu's manual sweep.
//
// The operator's report: "the sweep + count buttons for items beyond the age
// threshold are missing from these columns", on a crop showing
// `Idle · Earlier ⌄ 221` and `Done ⌄ 12` with an empty slot to the right of
// each count. Two candidate explanations are ruled apart here, on the live
// data rather than a fixture:
//
//   1. the sweep props never reach the Board (a wiring regression: NO lane
//      shows a pill), or
//   2. the pill is wired and the lane simply proposes nothing, which the
//      2026-10-03 arming decision makes correct for every manual-only arm
//      (`idle-earlier`, `idle-today`, `idle-recent`) and for any preselecting
//      arm whose eligible set is empty.
//
// It also opens each lane's own menu and reads whether "Sweep this lane…" is
// offered, which is the manual path the pill rule points at. A missing menu
// entry is a bug regardless of the pill rule.
//
// Read-only: it opens its own browser context (no shared storage, no split
// layout) and never clicks a card or a sweep control.
//
// Usage: node scripts/screenshot/probe-sweep-pills.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR, VIEWPORT.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/probe-sweep-pills";
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const VIEWPORT = { width: Number(process.env.WIDTH ?? 1800), height: 1200 };

mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every rendered lane's header facts: id, label, count, pill, cancel. */
const READ_LANES = `(function () {
  const lanes = [];
  for (const section of document.querySelectorAll("[data-column-id]")) {
    const header = section.querySelector("header");
    const labelEl = header === null ? null : header.querySelector("h3 span");
    // The count is the header's own last bare span, a sibling of the
    // name+caret <span> and of the sweep slot that follows it.
    const countEl =
      header === null
        ? null
        : [...header.children].find(
            (el) => el.tagName === "SPAN" && el.querySelector("h3") === null && (el.textContent || "").trim() !== "",
          ) ?? null;
    const pill = section.querySelector("[data-sweep-button]");
    lanes.push({
      id: section.getAttribute("data-column-id"),
      closing: section.hasAttribute("data-column-closing"),
      label: labelEl === null ? null : (labelEl.textContent || "").trim(),
      count: countEl === null ? null : (countEl.textContent || "").trim(),
      pill: pill === null ? null : {
        label: pill.getAttribute("aria-label"),
        text: (pill.textContent || "").trim(),
      },
      cancel: section.querySelector("[data-sweep-cancel]") !== null,
      cards: section.querySelectorAll("[data-thread-card]").length,
    });
  }
  return {
    route: location.pathname,
    laneDirection: document.querySelector("[data-lane-direction]")?.getAttribute("data-lane-direction") ?? null,
    lanes,
  };
})();`;

/** Open one lane's menu by its trigger and read the entry labels it offers. */
const openLaneMenu = (columnId) => `(function () {
  const section = document.querySelector('[data-column-id="' + ${JSON.stringify(columnId)} + '"]');
  if (section === null) return { opened: false };
  const trigger = section.querySelector("[data-lane-menu-trigger]");
  if (trigger === null) return { opened: false };
  trigger.click();
  return { opened: true };
})()`;

const READ_MENU = `(function () {
  const menu = document.querySelector('[role="menu"]');
  if (menu === null) return { open: false, entries: [] };
  const entries = [...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')]
    .map((el) => (el.textContent || "").trim());
  return { open: true, entries };
})()`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`, "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: VIEWPORT,
});
const context = await browser.createBrowserContext();
const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 300));
});
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));

const evidence = { app: APP, viewport: VIEWPORT, errors, lanes: [], menus: [] };

await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });

/** Wait for a settled board before reading it. The board's cards stream in
 *  from the host's sidebar store: a first paint can hold a partial list
 *  (a run once settled at 60 cards over six lanes with no Done lane, the
 *  remainder arriving later), and a lane census is only evidence when it
 *  holds. Two identical reads 300ms apart were not enough; this waits for
 *  four, 700ms apart. */
const census = (state) =>
  state.lanes.map((lane) => `${lane.id}:${lane.count}:${lane.cards}`).join("|");
const SETTLE_SAMPLES = 4;
const SETTLE_MS = 700;
await sleep(5000);
let read = await page.evaluate(READ_LANES);
let stable = 0;
for (let attempt = 0; attempt < 40 && stable < SETTLE_SAMPLES; attempt += 1) {
  await sleep(SETTLE_MS);
  const next = await page.evaluate(READ_LANES);
  stable = census(next) === census(read) && next.lanes.length > 0 ? stable + 1 : 0;
  read = next;
}
if (stable < SETTLE_SAMPLES) {
  throw new Error(`board never settled at ${stable}/${SETTLE_SAMPLES}: ${census(read)}`);
}

evidence.laneDirection = read.laneDirection;
evidence.lanes = read.lanes;
await page.screenshot({ path: `${OUT_DIR}/01-lanes.png` });
console.log("=== lanes ===");
for (const lane of read.lanes) {
  console.log(
    JSON.stringify({
      id: lane.id,
      label: lane.label,
      count: lane.count,
      cards: lane.cards,
      pill: lane.pill === null ? "(none)" : lane.pill.label,
    }),
  );
}

for (const lane of read.lanes) {
  if (lane.id === null) continue;
  await page.evaluate(openLaneMenu(lane.id));
  await sleep(400);
  const menu = await page.evaluate(READ_MENU);
  evidence.menus.push({ columnId: lane.id, ...menu });
  console.log("=== menu ===", JSON.stringify({ columnId: lane.id, sweep: menu.entries.some((e) => /sweep/i.test(e)), entries: menu.entries }));
  await page.keyboard.press("Escape");
  await sleep(300);
}

evidence.errors = errors;
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log("=== errors ===", errors);
await browser.close();
process.exit(0);
