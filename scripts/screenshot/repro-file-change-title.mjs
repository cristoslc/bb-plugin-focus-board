// Runtime probe for the pane-parity audit's Gap 4 — file-change row titles
// in the pane. bb renders the path segment with the timeline's file accent
// (`span.text-timeline-accent`), and the main view's resolver opens the
// file's diff on click; the plugin path passes no resolver, so in the pane
// the title is a colored dead spot.
//
// On the PRE-fix served build this probe proves the dead claim: the pane
// stays open and no navigation follows the click. After the fix lands and
// the main checkout rebuilds, the same probe proves the fallback: clicking
// the title leaves the plugin panel (the thread opens in the main view).
//
// Usage: THREAD_ID=<board card id> node scripts/screenshot/repro-file-change-title.mjs
// Honors BB_APP, CHROME_PATH, OUT_DIR (default
// docs/screenshots/repro-file-change-title). Exits 0 when a file-change
// title was found and clicked; the verdict line says which way the click
// went.
import puppeteer from "puppeteer-core";

const APP = process.env.BB_APP ?? "http://127.0.0.1:38886/plugins/focus-board/board";
const THREAD_ID = process.env.THREAD_ID ?? "";
if (!THREAD_ID) {
  console.error("Set THREAD_ID to a board card whose transcript carries file-change rows.");
  process.exit(1);
}
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/repro-file-change-title";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1600,1200", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
await page.goto(APP, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 4000));
await page.evaluate((id) => {
  document.querySelector(`[data-thread-card="${id}"]`)?.scrollIntoView({ block: "center", inline: "center" });
}, THREAD_ID);
await new Promise((r) => setTimeout(r, 800));
const box = await page.evaluate((id) => {
  const target = document.querySelector(`[data-thread-card="${id}"]`);
  if (!target) return null;
  const r = target.getBoundingClientRect();
  return { x: r.x + Math.min(r.width / 2, 150), y: r.y + Math.min(r.height / 2, 40) };
}, THREAD_ID);
if (!box) { console.error("board card not found:", THREAD_ID); await browser.close(); process.exit(1); }
await page.mouse.click(box.x, box.y);
await new Promise((r) => setTimeout(r, 5000));

// The pane restores bb's persisted reading position (a stored mid-transcript
// anchor can open the pane away from the newest rows), so wheel to the bottom
// first (trusted gestures; programmatic writes get reconciled), then walk the
// transcript one wheel tick at a time: the timeline virtualizes, so only the
// mounted window can match. The pointer parks over the pane's own scroller,
// or the wheel scrolls the board behind it.
const paneRect = await page.evaluate(() => {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  const el = [...(pane?.querySelectorAll("*") ?? [])].find((e) =>
    (e.className ?? "").toString().includes("thread-scrollbar"),
  );
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: Math.min(r.y + r.height / 2, r.y + r.height - 40), h: r.height };
});
if (!paneRect) { console.error("no pane scroller found"); await browser.close(); process.exit(1); }
await page.mouse.move(paneRect.x, paneRect.y);
for (let i = 0; i < 3; i++) {
  await page.mouse.wheel({ deltaY: 4000 });
  await new Promise((r) => setTimeout(r, 300));
}
await new Promise((r) => setTimeout(r, 1200));
let found;
for (let page_ = 0; page_ < 30; page_ += 1) {
  found = await page.evaluate(() => {
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    const segments = pane
      ? [...pane.querySelectorAll("span.text-timeline-accent")]
          .map((el) => (el.textContent ?? "").trim())
          .filter((text) => text.length > 0 && text.length < 120)
      : [];
    return segments.slice(0, 6);
  });
  if (Array.isArray(found) && found.length > 0) break;
  const top = await page.evaluate(() => {
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    const el = [...(pane?.querySelectorAll("*") ?? [])].find((e) =>
      (e.className ?? "").toString().includes("thread-scrollbar"),
    );
    return el ? Math.round(el.scrollTop) : -1;
  });
  if (top <= 0) break;
  await page.mouse.wheel({ deltaY: -700 });
  await new Promise((r) => setTimeout(r, 900));
}

if (!Array.isArray(found) || found.length === 0) {
  console.error("no file-change title segment found in this transcript");
  await browser.close();
  process.exit(1);
}
console.log("file-accent title segments in the pane:", JSON.stringify(found));

const spot = await page.evaluate(() => {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  const segment = pane?.querySelector("span.text-timeline-accent");
  if (!segment) return null;
  segment.scrollIntoView({ block: "center" });
  const r = segment.getBoundingClientRect();
  return { x: r.x + Math.min(r.width / 2, 120), y: r.y + r.height / 2 };
});
if (!spot) { console.error("segment vanished before the click"); await browser.close(); process.exit(1); }
const beforeUrl = page.url();
await page.mouse.click(spot.x, spot.y);
await new Promise((r) => setTimeout(r, 2500));

const after = await page.evaluate(() => ({
  paneGone: document.querySelector('aside[aria-label^="Thread:"]') === null,
  location: location.pathname + location.hash.slice(0, 40),
}));
const navigated = after.paneGone || after.location !== beforeUrl.replace(location.origin, "");
await page.screenshot({ path: `${OUT_DIR}/pane-file-title-after-click.png` });
console.log(navigated
  ? `LIVE: clicking the title left the pane (main view at ${after.location}); the maximize fallback works.`
  : `DEAD: the pane stays and nothing navigates — the title click is still inert (the pre-fix shape; the audit's Gap 4).`);
await browser.close();
