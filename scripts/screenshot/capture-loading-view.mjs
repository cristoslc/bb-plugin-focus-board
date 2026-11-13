/**
 * Stills and a short love-letter to the readiness gate's loading view
 * (components/loading-view.tsx): each candidate treatment, framed from the
 * moment the gate paints the view.
 *
 * The staged loading answer is the harness's own (`?sidebarDelay=`, the same
 * knob the load bench uses): the polled sidebar answers "loading" for that
 * many ms, so the gate stays up and its view is photographable. `?loadingView=`
 * picks the candidate; absent is the shipped default.
 *
 * What lands in docs/screenshots/loading-view/:
 * - `deal-150ms.png`   the default, ~150ms in (the gesture nearly landed)
 * - `deal-rest.png`    the default, rested (the gate still holding)
 * - `deal-ceiling.png` the default at ~1.9s, past the gate's 1.8s ceiling hold
 * - `deal-reduced-motion.png`  the default with prefers-reduced-motion: reduce
 * - `line-70ms.png`    the quiet candidate, mid-gesture at ~70ms
 * - `still-rest.png`   the control (the screen this replaced)
 * - `deal.gif`         the default playing, ~40ms per frame
 *
 * Usage (boots its own harness, like the load bench):
 *   npm run build
 *   node scripts/screenshot/capture-loading-view.mjs     # CHROME_PATH if needed
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const execFileP = promisify(execFile);
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5481");
const OUT_DIR = process.env.OUT_DIR ?? new URL("../../docs/screenshots/loading-view/", import.meta.url).pathname;
/** Long enough that the gate holds through every frame this script shoots:
 *  the sidebar stays "loading" for the whole run, which is what keeps the
 *  staged hold up well past the gate's 1.8s ceiling frame. */
const STAGED_SIDEBAR_MS = 60_000;

/** The frame every still uses: the status box plus a margin, floored to one
 *  height so the three candidates are directly comparable (the default's dot
 *  row grows the box; the floor keeps the same canvas around them). */
const FRAME_MIN_HEIGHT = 160;
const FRAME_MARGIN = 24;

await mkdir(OUT_DIR, { recursive: true });
const { child, base } = await startHarness(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
// Record when the gate first paints its view, so "at 150ms" is measured from
// the view's own appearance rather than from navigation (which carries the
// module graph and the first mount before the gate ever renders).
await page.evaluateOnNewDocument(() => {
  window.__loadingViewShownAt = null;
  const note = () => {
    if (window.__loadingViewShownAt !== null) return;
    if (document.querySelector("[data-loading-view]") !== null) {
      window.__loadingViewShownAt = performance.now();
    }
  };
  new MutationObserver(note).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
});

/** Navigate with the staged sidebar hold and wait for the gate's view. */
async function showLoadingView(variant) {
  const query = `?sidebarDelay=${STAGED_SIDEBAR_MS}&loadingView=${variant}`;
  await page.goto(`${base}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-loading-view]", { timeout: 60_000 });
}

/** Frame the status box. */
async function frame() {
  const box = await page.evaluate(() => {
    const el = document.querySelector("[data-loading-view] [role=status]");
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (box === null) throw new Error("the loading view's status box never rendered");
  return {
    x: Math.max(0, Math.round(box.x - FRAME_MARGIN)),
    y: Math.max(0, Math.round(box.y - FRAME_MARGIN)),
    width: Math.round(box.width + FRAME_MARGIN * 2),
    height: Math.max(FRAME_MIN_HEIGHT, Math.round(box.height + FRAME_MARGIN * 2)),
  };
}

/**
 * Freeze every running animation at exactly `ms` into its own timeline, so the
 * frame is the gesture's real state at that moment rather than whatever a
 * ~100ms screenshot round trip happened to catch. A paused, filled animation
 * is what the compositor would have painted at that instant.
 */
async function freezeAt(ms) {
  await page.evaluate((t) => {
    for (const animation of document.getAnimations()) {
      animation.pause();
      animation.currentTime = t;
    }
  }, ms);
}

/** Frame the motif itself (the dot row and the line) for the gif: the wide
 *  in-place stills keep the box context, but a playing gesture needs the
 *  detail at a legible size. */
async function motifFrame() {
  const box = await page.evaluate(() => {
    const el = document.querySelector("[data-loading-view] [role=status]");
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (box === null) throw new Error("the loading view's status box never rendered");
  const width = 520;
  const height = 150;
  return {
    x: Math.round(box.x + box.width / 2 - width / 2),
    y: Math.round(box.y + box.height / 2 - height / 2),
    width,
    height,
  };
}

async function still(name, variant, ms) {
  await showLoadingView(variant);
  const clip = await frame();
  await freezeAt(ms);
  await page.screenshot({ path: path.join(OUT_DIR, name), clip, timeout: 30_000 });
  console.log(`  ${name}`);
}

try {
  console.log(`stills → ${OUT_DIR}`);
  // Candidates, all shot at the same ~150ms so the comparison is like for like.
  await still("deal-150ms.png", "deal", 150);
  await still("deal-rest.png", "deal", 600);
  await still("deal-ceiling.png", "deal", 1900);
  // The quiet candidate needs an earlier frame to be honest about it: its
  // whole gesture is a 140ms ease, and at 150ms it has already landed.
  await still("line-70ms.png", "line", 70);
  // The control: no motif, no motion, today's screen.
  await still("still-rest.png", "still", 150);

  // Reduced motion: the same frame, with the OS preference the stylesheet
  // keys on. Nothing animates; the resting row is the state.
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await still("deal-reduced-motion.png", "deal", 150);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  // The gif: the landing itself, frozen every 40ms of the gesture and played
  // back at that rate, so the animation is exactly what the browser paints.
  const FRAME_MS = 40;
  const FRAME_COUNT = 8;
  const framesDir = process.env.FRAMES_DIR ?? (await mkdtemp(path.join(os.tmpdir(), "loading-view-gif-")));
  await showLoadingView("deal");
  const clip = await motifFrame();
  const frames = [];
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    const name = `frame-${String(index).padStart(3, "0")}`;
    await freezeAt(index * FRAME_MS);
    await page.screenshot({ path: path.join(framesDir, `${name}.png`), clip, timeout: 30_000 });
    frames.push(name);
  }
  const list = path.join(framesDir, "frames.txt");
  const seconds = FRAME_MS / 1000;
  const entries = frames.map((name) => `file '${name}.png'\nduration ${seconds}`);
  entries.push(`file '${frames.at(-1)}.png'\nduration ${seconds}`);
  await writeFile(list, `${entries.join("\n")}\n`);
  const gifPath = path.join(OUT_DIR, "deal.gif");
  const vf = [
    `fps=${Math.round(1000 / FRAME_MS)}`,
    "scale=720:-2:flags=lanczos",
    "split[a][b]",
    "[a]palettegen=max_colors=128[p]",
    "[b][p]paletteuse=dither=bayer:bayer_scale=4",
  ].join(",");
  await execFileP("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-loop", "0", gifPath]);
  console.log(`  deal.gif (${frames.length} frames in ${framesDir})`);
} finally {
  await browser.close();
  child.kill();
}
