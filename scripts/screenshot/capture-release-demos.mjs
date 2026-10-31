/**
 * Capture a release's demo gifs from its storyboards.
 *
 *   npm run build                                  # the harness loads dist/app.css
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.5.0
 *
 * Optional: `--only idle-filter,zoom-to-family` records the named demos,
 * `--out <dir>` moves the gifs (default `docs/screenshots/release-demos/`,
 * gitignored — the gifs are release assets, never repo media), and
 * `--frames <dir>` keeps the PNGs. Honors HARNESS_URL, CHROME_PATH,
 * DEMO_GIF_WIDTH, DEMO_FPS.
 *
 * A release's storyboards live in `scripts/screenshot/release-demos/<version>.mjs`
 * and export `baseParams` (the harness query every demo starts from) plus
 * `demos`. See `docs/releases/demo-gif-convention.md` for the rule that keeps
 * them honest: each gif demonstrates one changelog bullet, from that tag's
 * build.
 */
import { mkdtemp, stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, launchBrowser, recordDemo } from "./release-demos/runner.mjs";

const OUT_DIR = fileURLToPath(
  new URL(process.env.DEMO_OUT_DIR ?? "../../docs/screenshots/release-demos/", import.meta.url),
);

function parseArgs(argv) {
  const rest = [];
  const options = { only: null, out: OUT_DIR, frames: process.env.DEMO_FRAMES_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--only") options.only = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--frames") options.frames = argv[++i];
    else rest.push(arg);
  }
  return { release: rest[0], options };
}

const { release, options } = parseArgs(process.argv.slice(2));
if (!release) {
  console.error("usage: node scripts/screenshot/capture-release-demos.mjs <version> [--only id,id] [--out dir] [--frames dir]");
  process.exit(2);
}

const storyboard = await import(`./release-demos/${release}.mjs`);
const demos = options.only
  ? storyboard.demos.filter((demo) => options.only.includes(demo.id))
  : storyboard.demos;
if (demos.length === 0) {
  console.error(`no demos selected for ${release}`);
  process.exit(2);
}

const outDir = await ensureDir(options.out);
const framesRoot = options.frames ?? (await mkdtemp(path.join(os.tmpdir(), `demos-${release}-`)));
await ensureDir(framesRoot);

const browser = await launchBrowser();
const failures = [];
try {
  for (const demo of demos) {
    const label = `${release}/${demo.id}`;
    try {
      const result = await recordDemo(browser, demo, {
        release,
        baseParams: storyboard.baseParams ?? "",
        outDir,
        framesRoot,
      });
      const { size } = await stat(result.gifPath);
      console.log(
        `ok   ${label.padEnd(34)} ${result.seconds.toFixed(1)}s  ${(size / 1024 / 1024).toFixed(2)}MB  ${result.frames} frames  ${result.gifPath}`,
      );
    } catch (error) {
      failures.push({ label, error });
      console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
    // A short gap keeps two demos from fighting over the same dev server.
    await sleep(150);
  }
} finally {
  await browser.close().catch(() => {});
}

if (failures.length > 0) {
  console.error(`\n${failures.length} demo(s) failed:`);
  for (const failure of failures) console.error(`  ${failure.label}`);
  process.exit(1);
}
console.log(`\n${demos.length} demo(s) into ${outDir}`);
