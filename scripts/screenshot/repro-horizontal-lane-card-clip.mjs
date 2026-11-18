// Headless repro: a family card in a HORIZONTAL lane is clipped by its lane,
// so its child rows below the cut cannot be reached at all.
//
// The operator's report (2026-11-18, phone screenshot): on the rows read a
// family card shows its rows until the lane's bottom edge and the rest are
// gone. There is no inner scroll and, when the family is under the fold
// budget, no "Show all" handle either, so the withheld children are
// unreachable. The screenshot is 900x2000 at ~2.4x, so the window is the
// repo's 390x844 phone baseline.
//
// Run: npx vite --config scripts/screenshot/vite.config.ts --port 5173
// then: node scripts/screenshot/repro-horizontal-lane-card-clip.mjs
//
// The probe measures the clip rather than asserting it as a pass: it prints
// the card, its card list, and its lane row (rects and computed overflow), the
// fold handle's position, and how many child rows fall outside the visible
// box. Evidence lands in docs/screenshots/repro-horizontal-lane-card-clip/.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/repro-horizontal-lane-card-clip/", import.meta.url)
  .pathname;
mkdirSync(OUT, { recursive: true });

// Which side of the fix these frames are: `SHOT_PREFIX=before` when the probe
// is run against the pre-fix tree, the default `after` otherwise. The pair is
// the evidence the report needs (docs/screenshots/repro-horizontal-lane-card-clip).
const PREFIX = process.env.SHOT_PREFIX ?? "after";

// The phone baseline every mobile UAT suite uses. hasTouch/isMobile make the
// coarse-pointer utilities apply, which is the surface the report names.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// A family past the fold budget (seven children), so the handle is due, plus
// a two-child family under it, which is the report's own case.
const CARD_IDS = ["thr_sweep_parent", "thr_proj_family"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport(PHONE);
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

const readings = {};
for (const query of ["?groupBy=status&laneDirection=horizontal", "?groupBy=status"]) {
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0" });
  await page.waitForSelector("[data-columns-board]");
  // Let the mount-time fit and the fonts settle so the measurement is the
  // steady state, not the first paint.
  await new Promise((resolve) => setTimeout(resolve, 600));

  readings[query] = await page.evaluate((ids) => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const describe = (el) => {
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        rect: rect(el),
        height: style.height,
        minHeight: style.minHeight,
        maxHeight: style.maxHeight,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        flex: style.flex,
        className: el.getAttribute("class") ?? null,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      };
    };
    return ids.map((id) => {
      const card = document.querySelector(`[data-thread-card="${id}"]`);
      if (!card) return { id, found: false };
      const list = card.closest("[data-card-list]");
      const lane = card.closest("section, [data-lane]") ?? list?.parentElement ?? null;
      const listBox = list?.getBoundingClientRect() ?? null;
      // A row node: the nested rows list's items at both tiers.
      const rows = [...card.querySelectorAll("[data-nested-rows] > ul > li")];
      const handle = card.querySelector("[data-show-all-rows]");
      const rowsOutOfView =
        listBox === null
          ? null
          : rows.filter((row) => row.getBoundingClientRect().bottom > listBox.bottom + 0.5)
              .length;
      return {
        id,
        found: true,
        card: describe(card),
        cardList: describe(list),
        lane: describe(lane),
        rows: rows.length,
        rowsOutOfView,
        handle: describe(handle),
        handleOutOfView:
          handle === null || listBox === null
            ? null
            : handle.getBoundingClientRect().bottom > listBox.bottom + 0.5,
        // The deepest point the card's own content reaches, against the
        // box that clips it.
        contentBottom:
          rows.length === 0
            ? null
            : Math.round(
                Math.max(
                  ...rows.map((row) => row.getBoundingClientRect().bottom),
                  handle?.getBoundingClientRect().bottom ?? 0,
                ),
              ),
      };
    });
  }, CARD_IDS);

  const shotName =
    query.includes("laneDirection=horizontal") ? "horizontal-lanes" : "vertical-lanes";
  await page.screenshot({ path: `${OUT}${PREFIX}-${shotName}-phone.png` });

  // Frame the folded family: scroll the board to its lane and the lane's list
  // back to its flow start, then capture the viewport and the card list's own
  // box (the box that clips it) so the cut line is visible as a picture, not
  // only as a number.
  const framed = await page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-card="${id}"]`);
    if (card === null) return null;
    const list = card.closest("[data-card-list]");
    const board = card.closest("[data-columns-board]");
    const lane = list?.parentElement ?? null;
    if (list === null || board === null) return null;
    board.scrollTop = Math.max(0, board.scrollTop + lane.getBoundingClientRect().top - 60);
    list.scrollLeft += card.getBoundingClientRect().left - list.getBoundingClientRect().left - 8;
    const r = list.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, CARD_IDS[0]);
  if (framed !== null) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await page.screenshot({ path: `${OUT}${PREFIX}-${shotName}-clipped.png` });
    // The clip region is the card list, the element the measurement names.
    await page.screenshot({
      path: `${OUT}${PREFIX}-${shotName}-clipped-list.png`,
      clip: framed,
    });
  }
}

writeFileSync(`${OUT}readings-${PREFIX}.json`, `${JSON.stringify(readings, null, 2)}\n`);
console.log(JSON.stringify(readings, null, 2));
await browser.close();
