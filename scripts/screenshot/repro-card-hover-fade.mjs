// Headless repro for the hovered-card fade bug: a card under the pointer must
// read MORE prominent, not less. Today the card's hover style swaps its opaque
// surface (`bg-card`) for a translucent one (`hover:bg-accent/50`), so the
// hovered card lets the lane background / wallpaper bleed through — it fades.
// This driver hovers one card and records computed styles before/during hover
// for the hovered card and a sibling card (expect: no sibling change, hovered
// surface gains alpha). Exits 0 with evidence regardless of pass/fail; the
// evidence JSON decides the report. Artifacts land in
// docs/screenshots/repro-card-hover-fade/ (before/after PNGs + evidence.json).
// Run the vite harness first (same as shoot.mjs), then
// `node scripts/screenshot/repro-card-hover-fade.mjs`; honors the same
// `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR` overrides.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2 };
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT =
  process.env.OUT_DIR ??
  new URL("../../docs/screenshots/repro-card-hover-fade/", import.meta.url)
    .pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport(VIEW);
await page.goto(`${BASE}?groupBy=status`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
await sleep(600);

// Pick the first top-level card fully inside the viewport and read its style
// with no pointer anywhere near it.
const cardInfo = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-thread-card]")];
  const visible = cards.find((el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 100 &&
      r.height > 40 &&
      r.top > 0 &&
      r.bottom < window.innerHeight &&
      r.left > 0 &&
      r.right < window.innerWidth
    );
  });
  if (visible === undefined) return null;
  const r = visible.getBoundingClientRect();
  const cs = getComputedStyle(visible);
  return {
    id: visible.getAttribute("data-thread-card"),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    style: {
      backgroundColor: cs.backgroundColor,
      opacity: cs.opacity,
    },
  };
});
if (cardInfo === null) {
  console.error("no visible top-level card found in the viewport");
  process.exit(1);
}

// A sibling card on the same lane for the no-dim observation.
const siblingInfo = await page.evaluate((hoverId) => {
  const card = document.querySelector(`[data-thread-card="${CSS.escape(hoverId)}"]`);
  const list = card?.closest("[data-card-list]");
  if (list === null || list === undefined) return null;
  const sibling = [...list.querySelectorAll("[data-thread-card]")].find(
    (el) => el.getAttribute("data-thread-card") !== hoverId,
  );
  if (sibling === undefined) return null;
  const cs = getComputedStyle(sibling);
  return {
    id: sibling.getAttribute("data-thread-card"),
    style: { backgroundColor: cs.backgroundColor, opacity: cs.opacity },
  };
}, cardInfo.id);

await mkdir(OUT, { recursive: true });
await page.screenshot({
  path: `${OUT}before.png`,
  clip: {
    x: Math.max(0, cardInfo.rect.x - 40),
    y: Math.max(0, cardInfo.rect.y - 20),
    width: Math.min(VIEW.width, cardInfo.rect.width + 240),
    height: Math.min(VIEW.height, cardInfo.rect.height + 80),
  },
});

// Hover the card's center, then let the color transition settle.
await page.mouse.move(
  cardInfo.rect.x + cardInfo.rect.width / 2,
  cardInfo.rect.y + cardInfo.rect.height / 2,
);
await sleep(500);

// Capture the hovered state, then read the styles.
await page.screenshot({
  path: `${OUT}after.png`,
  clip: {
    x: Math.max(0, cardInfo.rect.x - 40),
    y: Math.max(0, cardInfo.rect.y - 20),
    width: Math.min(VIEW.width, cardInfo.rect.width + 240),
    height: Math.min(VIEW.height, cardInfo.rect.height + 80),
  },
});

const hoverInfo = await page.evaluate(
  (hoverId, siblingId) => {
    const card = document.querySelector(`[data-thread-card="${CSS.escape(hoverId)}"]`);
    const sibling = document.querySelector(
      `[data-thread-card="${CSS.escape(siblingId)}"]`,
    );
    const read = (el) => {
      const cs = getComputedStyle(el);
      return { backgroundColor: cs.backgroundColor, opacity: cs.opacity };
    };
    return {
      hovered: card !== null ? read(card) : null,
      sibling: sibling !== null ? read(sibling) : null,
    };
  },
  cardInfo.id,
  siblingInfo?.id ?? "",
);

console.log(JSON.stringify({ cardInfo, siblingInfo, hoverInfo }, null, 2));
await writeFile(
  `${OUT}evidence.json`,
  JSON.stringify({ cardInfo, siblingInfo, hoverInfo }, null, 2) + "\n",
);

await browser.close();