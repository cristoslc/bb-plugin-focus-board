// Headless measurement: how much of a horizontal lane row's width the lane's
// left header strip takes, and where the first card actually starts.
//
// The operator's report (2026-11-19, phone): "in horizontal mode on phone, too
// much negative space at left." In a horizontal lane the header is a left
// strip (`w-40 shrink-0`), 160px of a 390px viewport, and the card list starts
// after it. This probe measures that, at the phone baseline and at desktop, so
// the fix is picked from numbers instead of taste.
//
// Run: npx vite --config scripts/screenshot/vite.config.ts --port 5173
// then: node scripts/screenshot/repro-horizontal-lane-header-left-gap.mjs
//
// SHOT_PREFIX=before when run against the pre-fix tree, the default `after`
// otherwise; the pair is the evidence under
// docs/screenshots/repro-horizontal-lane-header-left-gap/.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/repro-horizontal-lane-header-left-gap/", import.meta.url)
  .pathname;
mkdirSync(OUT, { recursive: true });

const PREFIX = process.env.SHOT_PREFIX ?? "after";

// The phone baseline every mobile UAT suite uses, plus a desktop viewport so
// the same measurement can prove the desktop read did not move.
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 900, deviceScaleFactor: 1 };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const readings = {};
for (const [label, viewport] of [
  ["phone", PHONE],
  ["desktop", DESKTOP],
]) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.goto(`${BASE}?groupBy=status&laneDirection=horizontal`, {
    waitUntil: "networkidle0",
  });
  await page.waitForSelector("[data-columns-board]");
  // Let the mount-time fit and the fonts settle, so this is the steady state.
  await new Promise((resolve) => setTimeout(resolve, 600));

  readings[label] = await page.evaluate(() => {
    const round = (n) => Math.round(n);
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: round(r.left),
        y: round(r.top),
        width: round(r.width),
        height: round(r.height),
        right: round(r.right),
      };
    };
    const board = document.querySelector("[data-columns-board]");
    const boardStyle = board === null ? null : getComputedStyle(board);
    const lanes = [...document.querySelectorAll("section[data-column-id]")].map((section) => {
      const header = section.querySelector("header");
      const list = section.querySelector("[data-card-list]");
      const cards = [...section.querySelectorAll("[data-card-list] [data-thread-card]")];
      const first = cards[0] ?? null;
      const rowBox = box(section);
      const headerBox = box(header);
      const listBox = box(list);
      const cardBox = box(first);
      const headerStyle = header === null ? null : getComputedStyle(header);
      const listStyle = list === null ? null : getComputedStyle(list);
      const label = section.querySelector("h3");
      const labelBox = box(label);
      return {
        lane: section.getAttribute("data-column-id"),
        cards: cards.length,
        row: rowBox,
        // The strip between the screen edge and the first card.
        header: headerBox,
        headerPadding: headerStyle === null ? null : headerStyle.padding,
        label: labelBox,
        labelText: label === null ? null : (label.textContent ?? "").trim(),
        // The card's own flow list, and the width share it gets of its row.
        cardList: listBox,
        cardListOverflowX: listStyle === null ? null : listStyle.overflowX,
        cardListPad: listStyle === null ? null : listStyle.padding,
        listShareOfRow:
          listBox === null || rowBox === null || rowBox.width === 0
            ? null
            : Number((listBox.width / rowBox.width).toFixed(3)),
        headerShareOfRow:
          headerBox === null || rowBox === null || rowBox.width === 0
            ? null
            : Number((headerBox.width / rowBox.width).toFixed(3)),
        // Where the operator's eye lands: the first card's left edge.
        firstCard: cardBox,
        firstCardInsetFromRowLeft:
          cardBox === null || rowBox === null ? null : cardBox.x - rowBox.x,
        firstCardInsetFromViewportLeft: cardBox === null ? null : cardBox.x,
        firstCardVisibleWidth:
          cardBox === null ? null : Math.max(0, Math.min(cardBox.right, window.innerWidth) - cardBox.x),
        // The strip's own affordances, so the fix can prove they survived.
        trigger: box(section.querySelector("[data-lane-menu-trigger]")),
        hideLane: box(section.querySelector("[data-hide-lane]")),
        caret: box(section.querySelector("h3 svg")),
        count: (() => {
          // The bare count span: the header's second child span.
          const spans = header === null ? [] : [...header.children].filter((c) => c.tagName === "SPAN");
          const bare = spans.find((s) => s.querySelector("h3") === null) ?? null;
          return bare === null ? null : { text: (bare.textContent ?? "").trim(), box: box(bare) };
        })(),
      };
    });

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      board: {
        box: box(board),
        padding: boardStyle === null ? null : boardStyle.padding,
      },
      lanes,
    };
  });

  await page.screenshot({ path: `${OUT}${PREFIX}-horizontal-${label}.png` });
  // A frame of one lane alone, so the strip and the first card read at a
  // glance in the PR's before/after pair.
  const framed = await page.evaluate(() => {
    const section = document.querySelector('section[data-column-id="unread"]');
    if (section === null) return null;
    const r = section.getBoundingClientRect();
    return {
      x: 0,
      y: Math.max(0, Math.round(r.top - 28)),
      width: window.innerWidth,
      height: Math.min(Math.round(r.height + 56), window.innerHeight),
    };
  });
  if (framed !== null) {
    await page.screenshot({ path: `${OUT}${PREFIX}-unread-lane-${label}.png`, clip: framed });
  }
  await page.close();
}

writeFileSync(`${OUT}readings-${PREFIX}.json`, `${JSON.stringify(readings, null, 2)}\n`);
console.log(JSON.stringify(readings, null, 2));
await browser.close();
