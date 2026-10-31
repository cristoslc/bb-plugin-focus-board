// The touch pickup's visible lift (issue #336), captured mid-drag: hold a card
// on a touch viewport, move the finger, and shoot the board WHILE the finger is
// still down — the one frame neither the jsdom tests nor the UAT's after-settle
// screenshots can show.
//
// Run the vite harness first:
//   npm run build && npx vite --config scripts/screenshot/vite.config.ts
// then: node scripts/screenshot/probe-touch-lift.mjs
//
// Writes docs/screenshots/touch-lift/{armed,mid-drag,cancelled}.png plus
// evidence.json (the ghost's box against the finger's, the armed card's
// computed opacity, and what the ⋯ trigger reads at each stage).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "..", "docs", "screenshots", "touch-lift");
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
await page.setViewport({ width: 1024, height: 768, hasTouch: true, isMobile: true });
await page.goto(`${base}?groupBy=status`, { waitUntil: "networkidle2" });
const cardSel = '[data-thread-card="thr_ship_release"]';
await page.waitForSelector(cardSel, { timeout: 15000 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = { steps: [] };

const read = () =>
  page.evaluate(() => {
    const ghost = document.querySelector("[data-touch-drag-ghost]");
    const armed = document.querySelector("[data-touch-drag-armed]");
    const menu = document.querySelector('[role="menu"]');
    const box = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        top: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        opacity: getComputedStyle(el).opacity,
        transform: getComputedStyle(el).transform,
        shadow: getComputedStyle(el).boxShadow.slice(0, 40),
      };
    };
    const trigger = armed === null
      ? null
      : armed.parentElement?.querySelector("[data-card-menu-trigger]");
    return {
      ghost: box(ghost),
      ghostParent: ghost?.parentElement?.tagName.toLowerCase() ?? null,
      ghostAriaHidden: ghost?.getAttribute("aria-hidden") ?? null,
      armedCard: box(armed),
      armedId: armed?.getAttribute("data-thread-card") ?? null,
      menuOpen: menu !== null,
      trigger: trigger === null
        ? null
        : {
            label: trigger.getAttribute("aria-label"),
            box: box(trigger),
          },
    };
  });

const target = await page.$eval(cardSel, (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 24) };
});
const touch = page.touchscreen;
await touch.touchStart(target.x, target.y);
await sleep(600);
// The arm: the lift is on, the finger has not moved.
evidence.steps.push({ at: "armed", reading: await read() });
await page.screenshot({ path: path.join(outDir, "armed.png") });

// 140px right and 120px down, in steps, then shoot mid-drag.
const to = { x: target.x + 140, y: target.y + 120 };
for (let i = 1; i <= 6; i += 1) {
  await touch.touchMove(
    target.x + ((to.x - target.x) * i) / 6,
    target.y + ((to.y - target.y) * i) / 6,
  );
  await sleep(16);
}
evidence.steps.push({ at: "mid-drag", finger: to, reading: await read() });
await page.screenshot({ path: path.join(outDir, "mid-drag.png") });

// Release where it stands: a safe cancel — the snapshot resolves, no write.
await touch.touchEnd();
await sleep(400);
evidence.steps.push({ at: "released", reading: await read() });
await page.screenshot({ path: path.join(outDir, "cancelled.png") });

await fs.writeFile(path.join(outDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
