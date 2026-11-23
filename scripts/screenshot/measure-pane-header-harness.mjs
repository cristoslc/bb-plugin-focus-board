// Harness-based header measurement for the pane-header parity work: opens
// the named thread's pane on the screenshot harness (which serves the built
// dist/app.css against the real app) and reads the header row's shape, per
// viewport and theme. Artifacts: docs/screenshots/pane-header-parity/harness-
// <label>/, kept apart from the live probe's `<label>/` frames
// (scripts/screenshot/probe-pane-header-parity.mjs) so a harness reading never
// overwrites a live one.
//
// Usage: node scripts/screenshot/measure-pane-header-harness.mjs <label>
// [THREAD_ID=...] Honors HARNESS_URL, CHROME_PATH, OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const label = process.argv[2] ?? "run";
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split("=")));
const THREAD_ID = args.THREAD_ID ?? "thr_uat_queue";
const HARNESS = process.env.HARNESS_URL ?? "http://localhost:4173/";
const OUT_DIR = process.env.OUT_DIR ?? `docs/screenshots/pane-header-parity/harness-${label}`;
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MEASURE = `(function () {
  const root = document.querySelector('aside[role="complementary"] > header');
  if (root === null) return { missing: true };
  const R = root.getBoundingClientRect();
  const c = getComputedStyle(root);
  const row = root.firstElementChild;
  const rowBox = row === null ? null : row.getBoundingClientRect();
  const rowC = row === null ? null : getComputedStyle(row);
  return {
    headerCls: root.className,
    headerH: Math.round(R.height), headerPad: c.padding,
    headerBg: c.backgroundColor, borderBottom: c.borderBottomWidth + '|' + c.borderBottomColor,
    rowCls: row === null ? null : row.className,
    rowH: rowBox === null ? null : Math.round(rowBox.height),
    rowHRule: rowC === null ? null : rowC.height,
    buttons: [...root.querySelectorAll('button')].map((el) => {
      const b = el.getBoundingClientRect();
      return { aria: el.getAttribute('aria-label'), h: Math.round(b.height), w: Math.round(b.width) };
    }),
    titleSpan: root.querySelector('[title="Rename thread"] span')
      ? { fs: getComputedStyle(root.querySelector('[title="Rename thread"] span')).fontSize,
          fw: getComputedStyle(root.querySelector('[title="Rename thread"] span')).fontWeight }
      : null,
  };
})`;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--window-size=1920,1080", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1920, height: 1080 },
});
const evidence = { label, harnessedAt: HARNESS, viewport: {}, theme: {} };
const page = await browser.newPage();

for (const [name, viewport, isMobile] of [
  ["desktop", { width: 1920, height: 1080 }, false],
  ["phone", { width: 390, height: 844, hasTouch: true, isMobile: true }, true],
]) {
  await page.setViewport(viewport);
  await page.goto(`${HARNESS}?open=${encodeURIComponent(THREAD_ID)}`, {
    waitUntil: "networkidle2", timeout: 30000,
  });
  await sleep(3500);
  // main.tsx's ?open= seed opens the pane route; fall back to the card click
  // the capture driver uses when the seed is absent (clip-pane.mjs).
  const seedOpen = await page
    .evaluate(() => document.querySelector('aside[role="complementary"][aria-label^="Thread:"]') !== null)
    .catch(() => false);
  if (seedOpen !== true) {
    const box = await page.evaluate((id) => {
      const target = document.querySelector(`[data-thread-card="${id}"]`);
      if (target === null) return null;
      target.scrollIntoView({ block: "center" });
      const r = target.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 40) };
    }, THREAD_ID);
    if (box !== null) {
      await page.mouse.click(box.x, box.y);
      await sleep(2500);
    }
  }
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    await sleep(400);
    const m = await page.evaluate(`${MEASURE}()`);
    evidence.theme[`${name}-${theme}`] = m;
    await page.screenshot({ path: `${OUT_DIR}/${name}-${theme}.png`, fullPage: false });
    // Header-row clip (±10px) for the side-by-side pairs in the PR.
    const box = await page.evaluate(() => {
      const root = document.querySelector('aside[role="complementary"] > header');
      if (root === null) return null;
      const r = root.getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y - 10), width: Math.ceil(r.width), height: Math.ceil(r.height + 20) };
    });
    if (box !== null) {
      await page.screenshot({ path: `${OUT_DIR}/clip-${name}-${theme}.png`, clip: box });
    }
  }
}
writeFileSync(`${OUT_DIR}/harness-measure.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.theme["desktop-dark"], null, 2));
console.log(JSON.stringify(evidence.theme["phone-dark"], null, 2));
await browser.close();
process.exit(0);
