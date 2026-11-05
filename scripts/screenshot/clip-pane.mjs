// Generic pane clipper for the pane-parity audit's before/after frames:
// boots the screenshot harness, opens the named thread's pane, and captures
// the pane's aside as <out>/<name>.png. Nothing asserts; the PR reads the
// frames. One positional NAME (the output file stem), optional THREAD_ID
// (default thr_uat_queue) and QUERY (extra fixture params, e.g.
// pendingQuestion=1).
//
//   node scripts/screenshot/clip-pane.mjs <name>
//   node scripts/screenshot/clip-pane.mjs <name> THREAD_ID=thr_uat_queue QUERY=pendingQuestion=1
//
// Run the vite harness first; honors CHROME_PATH, HARNESS_URL, OUT_DIR.
import puppeteer from "puppeteer-core";

const stem = process.argv[2] ?? "";
if (!stem) {
  console.error("Usage: node scripts/screenshot/clip-pane.mjs <file-stem> [THREAD_ID=...] [QUERY=...]");
  process.exit(1);
}
const args = Object.fromEntries(process.argv.slice(3).map((a) => a.split("=")));
const THREAD_ID = args.THREAD_ID ?? "thr_uat_queue";
const QUERY = args.QUERY ?? "";
const HARNESS = process.env.HARNESS_URL ?? "http://localhost:4173/";
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/repro-pending-question-pane";
await import("node:fs").then((fs) => fs.mkdirSync(OUT_DIR, { recursive: true }));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1920,1080", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1920, height: 1080 },
});
const page = await browser.newPage();
const url = QUERY
  ? `${HARNESS}${HARNESS.includes("?") ? "&" : "?"}open=${encodeURIComponent(THREAD_ID)}&${QUERY}`
  : `${HARNESS}${HARNESS.includes("?") ? "&" : "?"}open=${encodeURIComponent(THREAD_ID)}`;
await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 3500));

// main.tsx's ?open= seed opens the pane route directly; fall back to
// clicking the board card when the seed is absent.
const opened = await page.evaluate(() => document.querySelector('aside[aria-label^="Thread:"]') !== null).catch(() => false);
if (!opened) {
  const box = await page.evaluate((id) => {
    const target = document.querySelector(`[data-thread-card="${id}"]`);
    if (!target) return null;
    target.scrollIntoView({ block: "center" });
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 40) };
  }, THREAD_ID);
  if (!box) { console.error("board card not found:", THREAD_ID); await browser.close(); process.exit(1); }
  await new Promise((r) => setTimeout(r, 600));
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 2500));
}
const clip = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label^="Thread:"]');
  if (!aside) return null;
  const r = aside.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
if (!clip) { console.error("pane did not open"); await browser.close(); process.exit(1); }
await page.screenshot({ path: `${OUT_DIR}/${stem}.png`, clip });
console.log(`wrote ${OUT_DIR}/${stem}.png`);
await browser.close();
