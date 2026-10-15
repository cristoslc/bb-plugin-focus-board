/**
 * Board-scale bench (issue #186): renders the harness at `?scale=500` and
 * measures what the issue cares about, printed as one JSON object per
 * measurement on stdout:
 *
 * - `toggleDone`: wall-clock from the confirm click to the settled board
 *   (the moved card carries its done classes), repeated over five distinct
 *   cards; the board repainted fully each time before the memoization.
 * - `burstRpcCalls`: a fabricated burst of ten done-changed signals (one
 *   animation-frame window) and how many refetch passes the sim served —
 *   with coalescing this is 3 calls (done_list, pin_parks_list,
 *   sweep_config_get), without it 30.
 *
 * Run once vite is up: `npx vite --config scripts/screenshot/vite.config.ts`
 * then `node scripts/screenshot/bench-board.mjs`. Requires the compiled
 * stylesheet (`npm run build` first — the harness imports ../../dist/app.css).
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const SCALE = Number(process.env.BENCH_SCALE ?? "500");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.goto(`${BASE}?scale=${SCALE}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
await page.waitForSelector('[data-thread-card="thr_scale_1"]', { timeout: 30_000 });
await new Promise((resolve) => setTimeout(resolve, 1000));

const cardCount = await page.evaluate(
  () => document.querySelectorAll("[data-thread-card]").length,
);
console.log(JSON.stringify({ cardCount }));

/**
 * One done-toggle measurement: hover-arm is unnecessary (opacity does not
 * block clicks), so the first click arms and the second fires the write.
 * The settle watch: the moved card's `opacity-50` class (done treatment)
 * arriving on the fresh node, plus the LONG TASKS the gesture's commit
 * produced on the main thread — the render cost the memoization targets.
 */
async function measureToggle(threadId) {
  await page.evaluate((id) => {
    const log = globalThis.__uat?.simRpcLog;
    if (log) log.clear();
    globalThis.__benchWindow = { start: 0, tasks: [] };
    return true;
  }, threadId);
  const result = await page.evaluate(async (id) => {
    const watch = globalThis.__benchWindow;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        watch.tasks.push(Math.round(entry.duration));
      }
    });
    observer.observe({ entryTypes: ["longtask"] });
    const start = performance.now();
    const card = document.querySelector(`[data-thread-card="${id}"]`);
    if (!card) throw new Error(`missing card ${id}`);
    const checkbox = card.querySelector("[data-done-checkbox]");
    if (!checkbox) throw new Error(`no done checkbox on ${id}`);
    checkbox.click(); // arm
    await new Promise((resolve) => requestAnimationFrame(resolve));
    checkbox.click(); // confirm
    // Settle: the card gains the done treatment's opacity-50 class. The
    // card element is RECREATED when it moves lanes, so the fresh node is
    // re-queried each tick.
    await new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const tick = () => {
        const moved = document.querySelector(`[data-thread-card="${id}"]`);
        if (moved?.classList.contains("opacity-50")) {
          resolve(undefined);
        } else if (performance.now() - startedAt > 20_000) {
          reject(new Error("toggle done never settled"));
        } else {
          requestAnimationFrame(tick);
        }
      };
      tick();
    });
    const settled = performance.now() - start;
    observer.disconnect();
    // The echo's coalesced pass lands ~50ms after the write; drain it into
    // the same long-task window.
    await new Promise((resolve) => setTimeout(resolve, 350));
    return { settled: Math.round(settled), longTasks: watch.tasks };
  }, threadId);
  const calls = await page.evaluate(() => globalThis.__uat.simRpcLog.calls());
  console.log(JSON.stringify({ toggleDone: result.settled, longTasks: result.longTasks, echoRpcCalls: calls.length }));
  return result;
}

for (const index of [3, 17, 41, 66, 90]) {
  await measureToggle(`thr_scale_${index}`);
}

// The burst: ten done-changed signals inside one animation-frame window,
// measured for refetch passes AND main-thread block time (the render side
// of the burst, which the memoization shrinks).
const burst = await page.evaluate(async () => {
  const log = globalThis.__uat.simRpcLog;
  log.clear();
  const watch = globalThis.__benchWindow = { start: 0, tasks: [] };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) watch.tasks.push(Math.round(entry.duration));
  });
  observer.observe({ entryTypes: ["longtask"] });
  const start = performance.now();
  for (let i = 0; i < 10; i++) globalThis.__uat.simSignal("done-changed");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  // The coalesced pass fires a quiet window (50ms) after the burst.
  await new Promise((resolve) => setTimeout(resolve, 300));
  observer.disconnect();
  return { elapsed: performance.now() - start, calls: log.calls(), longTasks: watch.tasks };
});
// One done-changed echo whose data did not change: the render-side cost of
// A signal with nothing to update — post-memoization it should skip every
// card's subtree (no 500-card re-render), pre-memoization it repainted.
const idleEcho = await page.evaluate(async () => {
  const log = globalThis.__uat.simRpcLog;
  log.clear();
  const watch = globalThis.__benchWindow = { start: 0, tasks: [] };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) watch.tasks.push(Math.round(entry.duration));
  });
  observer.observe({ entryTypes: ["longtask"] });
  const start = performance.now();
  globalThis.__uat.simSignal("done-changed");
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 300));
  observer.disconnect();
  return { elapsed: performance.now() - start, longTasks: watch.tasks };
});
console.log(JSON.stringify({ idleEchoWallMs: Math.round(idleEcho.elapsed), idleEchoLongTasks: idleEcho.longTasks }));

const counts = {};
for (const method of burst.calls) counts[method] = (counts[method] ?? 0) + 1;
console.log(JSON.stringify({ burstRpcCalls: counts, burstWallMs: Math.round(burst.elapsed), burstLongTasks: burst.longTasks }));

await browser.close();
console.log("done");