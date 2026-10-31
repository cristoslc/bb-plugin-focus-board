/**
 * Capture the README's overview GIF from the harness.
 *
 *   npm run build                                      # harness loads dist/app.css
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-overview-gif.mjs
 *
 * The storyboard lives in `storyboards/overview.mjs`; this entry only opens
 * the harness, runs it at a fixed frame rate, and assembles the palette GIF.
 * FRAMES_DIR keeps the raw frames, GIF_WIDTH / GIF_FPS override the output,
 * and OUT_DIR / HARNESS_URL / CHROME_PATH behave like the other captures.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import {
  assembleGif,
  createFrameRecorder,
  launchRecorderBrowser,
  makeFramesDir,
  openSession,
  removeDir,
  runStoryboard,
} from "./lib/recorder.mjs";
import { overviewGif } from "./storyboards/overview.mjs";

const OUT_DIR =
  process.env.OUT_DIR ?? new URL("../../docs/screenshots/", import.meta.url).pathname;
const dir = process.env.FRAMES_DIR ?? (await makeFramesDir("overview-gif"));
const keepFrames = process.env.FRAMES_DIR !== undefined;
const fps = Number(process.env.GIF_FPS ?? overviewGif.fps);
const gifWidth = Number(process.env.GIF_WIDTH ?? overviewGif.gifWidth);
const browser = await launchRecorderBrowser({
  width: overviewGif.width,
  height: overviewGif.height,
});

try {
  const session = await openSession(browser, {
    query: overviewGif.query,
    waitFor: "[data-group-box]",
  });
  const recorder = createFrameRecorder({ page: session.page, fps, dir });
  await runStoryboard(session, recorder, overviewGif.steps, {
    log: (line) => console.log(line),
  });
  const gifPath = path.join(OUT_DIR, overviewGif.out);
  await assembleGif({
    dir,
    outPath: gifPath,
    fps,
    width: gifWidth,
    colors: overviewGif.colors,
  });
  const { size } = await stat(gifPath);
  console.log(
    `  ${overviewGif.out}: ${recorder.count} frames, ${(recorder.count / fps).toFixed(2)}s at ${fps} fps, ${(size / 1024 / 1024).toFixed(2)} MB`,
  );
} finally {
  await browser.close().catch(() => {});
  if (!keepFrames) await removeDir(dir);
}
console.log(`done — ${keepFrames ? `frames in ${dir}` : "frames cleaned up"}`);
