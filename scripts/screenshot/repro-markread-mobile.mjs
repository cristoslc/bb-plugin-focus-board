// Headless repro for the mobile Mark Read menu bug: at phone size with the
// thread pane open, the thread-actions menu renders as a standalone ellipsis
// (⋯) button instead of the split caret (icon + divider + ChevronDown) that
// the Open in menu shows on the same header.
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts`, then
// `node scripts/screenshot/repro-markread-mobile.mjs`. Writes evidence to
// docs/screenshots/repro-markread-mobile/ (screenshot + DOM dump).
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/repro-markread-mobile/", import.meta.url).pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(`${BASE}?groupBy=status&demo=1`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 400));

// Open the thread pane (same programmatic click the screenshot driver uses).
await page.evaluate(() => {
  const el = document.querySelector('a[href$="thr_permissions"]');
  if (!el) throw new Error("thread card not found");
  el.click();
});
await page.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 10_000 });
await new Promise((r) => setTimeout(r, 500));

// Evidence: inspect the pane header's controls.
const evidence = await page.evaluate(() => {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (!pane) throw new Error("pane not found");
  const header = pane.querySelector("header");
  const compactQuery = window.matchMedia("(max-width: 767px)").matches;
  const controls = [...header.querySelectorAll("button")].map((b) => ({
    ariaLabel: b.getAttribute("aria-label") ?? b.textContent?.trim(),
    html: b.outerHTML,
    width: b.getBoundingClientRect().width,
  }));
  return {
    viewport: { w: innerWidth, h: innerHeight },
    compactViewport: compactQuery,
    headerControls: controls,
    headerHTML: header.outerHTML,
  };
});

await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2));
await page.screenshot({ path: `${OUT}phone-thread-pane.png`, fullPage: false });

console.log(JSON.stringify({ out: OUT, compactViewport: evidence.compactViewport, controls: evidence.headerControls.map(({ ariaLabel, width }) => ({ ariaLabel, width })) }, null, 2));
await browser.close();