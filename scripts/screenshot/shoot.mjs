/**
 * Screenshot driver: renders the harness in headless Chrome and captures the
 * README screenshots into docs/screenshots/.
 *
 * One-time setup: `npm i --no-save puppeteer-core` (uses the system Chrome,
 * no browser download). Then, in two terminals:
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/shoot.mjs
 */
import { mkdir } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/", import.meta.url).pathname;

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2 }, // iPhone 14-ish
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEWPORTS.desktop,
  args: ["--hide-scrollbars"],
});

let currentTheme = "dark";

async function goto(target, query) {
  await target.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await target.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await target.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  }, currentTheme);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

/** A real mouse click starts an HTML5 drag and swallows the mouseup, so
 *  dispatch the click programmatically instead. */
async function openPermissionsPane(target) {
  await target.evaluate(() => {
    const el = document.querySelector('a[href$="thr_permissions"]');
    if (!el) throw new Error("card not found");
    el.click();
  });
  await target.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

// Each shot gets its OWN page with the viewport set once, at creation. The
// earlier driver flipped one shared page's viewport between shots, and Chrome
// reliably wedged its emulation state partway through (TargetCloseError on
// Emulation.setTouchEmulationEnabled), failing roughly two runs in three. One
// page per shot removes the repeated emulation flips entirely.
const SHOTS = [
  // The screenshots are the demo surface: `?demo=1` adds the fresh demo
  // families (data.ts SIM_DEMO_THREADS) and `?collapsed=` folds one of them,
  // so every shot shows nested child threads both folded ("N child threads"
  // over its status-dot strip) and unfolded, in addition to all the base
  // elements the fixture covers. UAT suites never set the flag and keep the
  // base fixture their lane and column-order assertions are pinned to.
  { name: "board-thread-pane", viewport: "desktop", pane: true, query: "?groupBy=status&demo=1&collapsed=thr_demo_needs,thr_demo_work" },
  { name: "phone-board", viewport: "phone", pane: false, query: "?groupBy=status&demo=1&collapsed=thr_demo_needs,thr_demo_work" },
  { name: "phone-thread-pane", viewport: "phone", pane: true, query: "?groupBy=status&demo=1&collapsed=thr_demo_needs,thr_demo_work" },
];

async function captureAll() {
  for (const { name, viewport, pane, query } of SHOTS) {
    console.log(`  ${name}`);
    const shotPage = await browser.newPage();
    try {
      await shotPage.setViewport(VIEWPORTS[viewport]);
      await goto(shotPage, query);
      if (pane) await openPermissionsPane(shotPage);
      await shotPage.screenshot({
        path: `${OUT}${name}-${currentTheme}.png`,
        timeout: 30_000,
      });
    } finally {
      await shotPage.close().catch(() => {});
    }
  }
}

await mkdir(OUT, { recursive: true });

for (const theme of ["dark", "light"]) {
  currentTheme = theme;
  console.log(`${theme} theme`);
  await captureAll();
}

await browser.close();
console.log("done");