// [REDWORK] Wallpaper frame regression driver (issue #201): the wallpaper
// paints into a box equal to the browser window, anchored at the window's
// origin, so toggling the thread pane only carves the porthole — it never
// refits the crop. Measures the paint layer's box (and the root/board boxes)
// with the pane closed, open, and closed again, asserting the window frame
// in every state; captures a screenshot per state. Artifacts land in
// docs/screenshots/repro-wallpaper-wobble/. Exits non-zero when a state
// breaks the frame.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:58123/";
const OUT = new URL("../../docs/screenshots/repro-wallpaper-wobble/", import.meta.url).pathname;

// A 1200x800 image whose features (stripes, ring, cross) make any crop or
// scale change legible in the screenshots. Data url: no network in the run.
const stripes = Array.from({ length: 12 }, (_, i) =>
  `<rect x="${i * 100}" y="0" width="50" height="800" fill="${i % 2 === 0 ? "#e11d48" : "#1e3a8a"}"/>`,
).join("");
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">` +
  `<rect width="1200" height="800" fill="#94a3b8"/>${stripes}` +
  `<circle cx="600" cy="400" r="150" fill="none" stroke="#facc15" stroke-width="24"/>` +
  `<path d="M600 250V550M450 400h300" stroke="#22c55e" stroke-width="16"/>` +
  `</svg>`;
const WALLPAPER_URL = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const STORED = JSON.stringify({
  version: 1,
  global: { url: WALLPAPER_URL, dim: 0.1, fit: "cover", zoom: 1 },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
await page.evaluateOnNewDocument((stored) => {
  localStorage.setItem("focus-board:wallpaper", stored);
}, STORED);

await mkdir(OUT, { recursive: true });
await page.goto(BASE, { waitUntil: "networkidle0" });
await sleep(1200);

const measure = async () =>
  page.evaluate(() => {
    const rect = (el) => {
      if (el === null || el === undefined) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const root = document.querySelector("[data-focus-board-panel]");
    // The paint layer: an aria-hidden clip wrapper's style-carrying child.
    const paint = root?.querySelector("div[aria-hidden] > div[style*='background-image']") ?? null;
    const boardColumn = root?.lastElementChild ?? null;
    const pane = document.querySelector("aside[role='complementary']");
    const style = paint === null ? null : getComputedStyle(paint);
    return {
      window: { w: window.innerWidth, h: window.innerHeight },
      root: rect(root),
      paint: rect(paint),
      board: rect(boardColumn),
      pane: rect(pane),
      backgroundSize: style?.backgroundSize ?? null,
      backgroundPosition: style?.backgroundPosition ?? null,
      transform: style?.transform ?? null,
    };
  });

const snapshot = async (label) => {
  await sleep(500);
  const data = await measure();
  const file = `${OUT}${label}.png`;
  await page.screenshot({ path: file });
  return { label, ...data, file };
};

const evidence = { pageErrors: errors, states: [], frameViolations: [] };

// The fixed behavior: the paint's box equals the browser window's box in
// every pane state (issue #201).
const expectWindowFrame = (state) => {
  const violations = [];
  if (state.paint === null) violations.push(`${state.label}: no paint layer found`);
  else if (state.paint.x !== 0 || state.paint.y !== 0 || state.paint.w !== state.window.w || state.paint.h !== state.window.h)
    violations.push(`${state.label}: paint box ${JSON.stringify(state.paint)} is not the window frame ${JSON.stringify({ x: 0, y: 0, w: state.window.w, h: state.window.h })}`);
  return violations;
};

// A: pane closed.
evidence.states.push(await snapshot("A-pane-closed"));

// B: open the first card's pane.
const firstCard = await page.$("[data-thread-card] a");
if (firstCard === null) throw new Error("no thread card anchor found");
await firstCard.click();
await sleep(1000);
evidence.states.push(await snapshot("B-pane-open"));

// C: close the pane again (the pane's own close button; Escape stays in the
// pane's chat composer).
await page.evaluate(() => {
  const close = Array.from(document.querySelectorAll("aside[role='complementary'] button")).find((button) =>
    (button.getAttribute("aria-label") ?? "").startsWith("Close"),
  );
  if (close === null || close === undefined) throw new Error("no pane close button found");
  close.click();
});
await sleep(800);
const c = await snapshot("C-pane-closed-again");
evidence.states.push(c);

evidence.frameViolations.push(...[evidence.states[0], evidence.states[1], c].flatMap(expectWindowFrame));

await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (errors.length > 0 || evidence.frameViolations.length > 0) process.exitCode = 1;
await browser.close();