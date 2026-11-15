/**
 * Real-time recordings of the readiness gate's loading view
 * (components/loading-view.tsx), for the "the dots land once and stop" report.
 *
 * Why this exists beside `capture-loading-view.mjs`: that script FREEZES every
 * animation and places it at a chosen `currentTime`, which proves the keyframes
 * exist and says nothing about what an operator watching a real load sees. The
 * bug that shipped through two reviews was invisible to frozen frames, because
 * the view is on screen for less time than the cycle's first dip
 * (measured: 41ms on a warm harness load, 234ms modeled, so the row always
 * died between the landing and the first breath). This records the compositor's
 * own output through CDP's screencast, in real time, with the frame timestamps
 * Chrome reported, so the gif's timing IS the load's timing.
 *
 * Three recordings, each faithful to a load the operator can hit:
 * - `live-dwell-234ms.gif`  the measured modeled dwell: view paint to board
 *                           paint in ~234ms, recorded until the board shows.
 * - `live-dwell-600ms.gif`  the production-shaped dwell: the mount fan-in on a
 *                           large workspace (~0.6s per lib/idle-callback's
 *                           measured note), which is the longest a healthy
 *                           load commonly holds.
 * - `live-hold.gif`         2.6s of a held gate (`?sidebarDelay=60000`), which
 *                           is the only recording that can show a REPEAT: the
 *                           gate's ceiling is 1.8s, so a held gate is what a
 *                           hung mount looks like.
 *
 * Usage:
 *   npm run build
 *   node scripts/screenshot/capture-loading-view-live.mjs   # CHROME_PATH if needed
 */
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const execFileP = promisify(execFile);
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.HARNESS_PORT ?? "5482");
const OUT_DIR =
  process.env.OUT_DIR ?? new URL("../../docs/screenshots/loading-view/", import.meta.url).pathname;
/** The two dwells, in ms: the modeled harness median measured for this fix, and
 *  the production-shaped fan-in the gate documents (lib/idle-callback). */
const DWELLS = (process.env.DWELLS ?? "234,600").split(",").map(Number);
/** How long a held-gate recording runs. Past the 1.8s ceiling, so the loop's
 *  second pass is inside the file. */
const HOLD_MS = Number(process.env.HOLD_MS ?? "2600");
/** The recording frame: a fixed box centred on the status line, wide enough
 *  for the motif and the line at a legible size once scaled for the gif. */
const FRAME_WIDTH = 520;
const FRAME_HEIGHT = 150;
/** Screencast cadence: every painted frame. Chrome sends one per compositor
 *  frame the content changes, so this is the real cadence, not a guess. */
const GIF_FPS = 25;

await mkdir(OUT_DIR, { recursive: true });
const { child, base } = await startHarness(PORT);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  args: ["--hide-scrollbars"],
});

/** One recording: boot `url`, record from the view's first paint, and stop at
 *  `stopAfterMs` (or when the board paints, whichever is first, for a dwell). */
async function record({ name, url, stopAfterMs, stopAtBoard }) {
  const page = await browser.newPage();
  // The instrument: stamp the view's first paint and the board's first card.
  // It observes the DOCUMENT node because it runs before the parser creates
  // `document.documentElement`; observing a null root throws inside an injected
  // script, which leaves a silent instrument.
  await page.evaluateOnNewDocument(() => {
    window.__live = { viewAt: null, cardAt: null };
    const note = () => {
      if (window.__live.viewAt === null && document.querySelector("[data-loading-dot]") !== null) {
        window.__live.viewAt = (performance.timeOrigin + performance.now()) / 1000;
      }
      if (window.__live.cardAt === null && document.querySelector("[data-thread-card]") !== null) {
        window.__live.cardAt = (performance.timeOrigin + performance.now()) / 1000;
      }
    };
    new MutationObserver(note).observe(document, { childList: true, subtree: true });
  });

  const client = await page.createCDPSession();
  await client.send("Page.enable");
  const frames = [];
  client.on("Page.screencastFrame", (frame) => {
    frames.push({ data: frame.data, at: frame.metadata.timestamp });
    client.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    everyNthFrame: 1,
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-loading-dot]", { timeout: 60_000 });
  const viewAt = await page.evaluate(() => window.__live.viewAt);

  // Frame the motif, not the whole status box: the box spans the panel's full
  // width, so cropping it leaves the three 8px dots a few pixels wide in the
  // gif and hides exactly the change the recording exists to show.
  const box = await page.evaluate(() => {
    const el = document.querySelector("[data-loading-view] [role=status]");
    if (el === null) throw new Error("the loading view's status box never rendered");
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const crop = {
    x: Math.round(box.x + box.width / 2 - FRAME_WIDTH / 2) & ~1,
    y: Math.round(box.y + box.height / 2 - FRAME_HEIGHT / 2) & ~1,
  };
  // Clamp to the recorded viewport and keep both sides even: the screencast
  // delivers the whole viewport as mjpeg (yuv420), where an odd crop dimension
  // or one past the frame edge fails the filter graph instead of cropping.
  crop.x = Math.max(0, Math.min(1280 - FRAME_WIDTH, crop.x));
  crop.y = Math.max(0, Math.min(800 - FRAME_HEIGHT, crop.y));
  crop.width = FRAME_WIDTH;
  crop.height = FRAME_HEIGHT;

  if (stopAtBoard) {
    await page.waitForSelector("[data-thread-card]", { timeout: 60_000 });
    // A beat of the board, so the recording ends on what replaced the view.
    await new Promise((resolve) => setTimeout(resolve, 150));
  } else {
    await new Promise((resolve) => setTimeout(resolve, stopAfterMs));
  }
  await client.send("Page.stopScreencast");
  const cardAt = await page.evaluate(() => window.__live.cardAt);

  const start = viewAt;
  const end = stopAtBoard && cardAt !== null ? cardAt + 0.15 : start + stopAfterMs / 1000;
  const kept = frames.filter((frame) => frame.at >= start && frame.at <= end);
  if (kept.length < 4) {
    throw new Error(`${name}: only ${kept.length} frames inside the window — the recording proves nothing`);
  }
  await page.close();
  return { name, kept, crop, dwellMs: cardAt === null ? null : (cardAt - start) * 1000 };
}

/** Assemble the timestamped JPEGs into a looping gif, cropping to the motif. */
async function toGif({ name, kept, crop, dwellMs }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "loading-view-live-"));
  const lines = [];
  for (const [index, frame] of kept.entries()) {
    const file = `frame-${String(index).padStart(4, "0")}.jpg`;
    await writeFile(path.join(dir, file), Buffer.from(frame.data, "base64"));
    const next = kept[index + 1]?.at ?? frame.at + 1 / GIF_FPS;
    // Real elapsed time between Chrome's frames, floored at one output frame so
    // a burst of same-instant frames cannot produce a zero duration.
    const duration = Math.max(1 / GIF_FPS, next - frame.at);
    lines.push(`file '${file}'`, `duration ${duration.toFixed(4)}`);
  }
  lines.push(`file 'frame-${String(kept.length - 1).padStart(4, "0")}.jpg'`, `duration 0.4`);
  const list = path.join(dir, "frames.txt");
  await writeFile(list, `${lines.join("\n")}\n`);
  const out = path.join(OUT_DIR, `${name}.gif`);
  const vf = [
    `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`,
    "scale=720:-2:flags=lanczos",
    `fps=${GIF_FPS}`,
    "split[a][b]",
    "[a]palettegen=max_colors=96[p]",
    "[b][p]paletteuse=dither=bayer:bayer_scale=4",
  ].join(",");
  await execFileP("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-vf",
    vf,
    "-loop",
    "0",
    out,
  ]);
  const { size } = await readFile(out).then((buffer) => ({ size: buffer.byteLength }));
  console.log(
    `  ${name}.gif  ${kept.length} real frames, ${(kept.at(-1).at - kept[0].at).toFixed(2)}s, ${Math.round(size / 1024)}KB${
      dwellMs === null ? "" : `, board painted ${dwellMs.toFixed(0)}ms after the view`
    }`,
  );
}

try {
  for (const dwell of DWELLS) {
    const run = await record({
      name: `live-dwell-${dwell}ms`,
      url: `${base}?sidebarDelay=${dwell}`,
      stopAfterMs: 0,
      stopAtBoard: true,
    });
    await toGif(run);
  }
  const held = await record({
    name: "live-hold",
    url: `${base}?sidebarDelay=60000`,
    stopAfterMs: HOLD_MS,
    stopAtBoard: false,
  });
  await toGif(held);
} finally {
  await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5000))]);
  child.kill();
}
