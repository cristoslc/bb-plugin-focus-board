/**
 * The shared GIF/still recorder for the screenshot harness.
 *
 * A storyboard is data: an ordered list of holds, pointer moves, clicks,
 * menus and synthetic HTML5 drags. This module turns that list into frames at
 * a fixed rate (one screenshot per frame, so a 24 fps GIF is a real 24
 * screenshots per second of story), overlays a synthetic cursor (headless
 * screenshots carry no OS pointer), and assembles the frames with ffmpeg
 * through a palette pass.
 *
 * Why the frames are stepped rather than sampled in real time: a screenshot
 * costs tens of milliseconds, so a wall-clock sampler cannot hit 24 fps and
 * would make the pointer's speed depend on machine load. Stepping the
 * pointer along an eased path and capturing every step makes the GIF's
 * motion deterministic and its timing exactly `1 / fps` per frame.
 *
 * The module is also the stills toolkit: `openSession`, `pointOf`, `click`,
 * `openMenu` and `drag` are the same gestures the storyboard engine runs, so
 * a still cannot drift from the GIF it illustrates.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const execFileP = promisify(execFile);

export const CHROME_DEFAULT =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const HARNESS_DEFAULT = process.env.HARNESS_URL ?? "http://localhost:5173/";

/** The pointer overlay: a fixed, click-through arrow the driver translates. */
const CURSOR_SVG = `
<svg id="gif-cursor" width="21" height="28" viewBox="0 0 21 28"
     style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
            filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))" aria-hidden="true">
  <path d="M2.5 1.5 L2.5 20.5 L7.6 15.8 L10.7 23.4 L14.3 21.9 L11.2 14.4 L17.5 14.4 Z"
        fill="#fff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

/** Easing for a pointer path. The default leans out: a hand accelerates from
 *  rest, then settles onto the target instead of stopping dead. */
export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
export function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

/** `steps` points from `from` to `to`, inclusive of the target, never of the
 *  start (the caller is already there). */
export function pathPoints(from, to, steps, ease = easeOut) {
  const count = Math.max(1, Math.round(steps));
  return Array.from({ length: count }, (_, index) => {
    const t = ease((index + 1) / count);
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
}

/** Launch the system Chrome for the harness. */
export async function launchRecorderBrowser({
  width = 1680,
  height = 945,
  deviceScaleFactor = 2,
  args = ["--hide-scrollbars"],
} = {}) {
  return puppeteer.launch({
    executablePath: CHROME_DEFAULT,
    headless: true,
    defaultViewport: { width, height, deviceScaleFactor },
    args,
  });
}

/** Install the synthetic drag plumbing in the page once per session. */
async function installDragHelpers(page) {
  await page.evaluate(() => {
    const recorder = {
      transfer: null,
      source: null,
      /**
       * A DataTransfer that enforces the browser's protected mode: the
       * payload is unreadable during dragover and readable only at dragstart
       * and drop, exactly as a real drag behaves. `types` stays readable
       * throughout (the board's lane marker rides there).
       */
      makeTransfer() {
        const transfer = new DataTransfer();
        const realGetData = transfer.getData.bind(transfer);
        const reading = { on: false };
        Object.defineProperty(transfer, "getData", {
          configurable: true,
          value: (format) => (reading.on ? realGetData(format) : ""),
        });
        transfer._armRead = (on) => {
          reading.on = on;
        };
        return transfer;
      },
      start(selector) {
        const source = document.querySelector(selector);
        if (source === null) throw new Error(`recorder: no drag source ${selector}`);
        this.transfer = this.makeTransfer();
        this.source = source;
        this.transfer._armRead(true);
        source.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: this.transfer,
          }),
        );
        this.transfer._armRead(false);
        return [...this.transfer.types];
      },
      over(x, y) {
        if (this.transfer === null) throw new Error("recorder: dragover without a drag");
        const target = document.elementFromPoint(x, y);
        if (target === null) return { hit: false };
        const event = new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: this.transfer,
          clientX: x,
          clientY: y,
        });
        target.dispatchEvent(event);
        return {
          hit: true,
          allowed: event.defaultPrevented,
          tag: target.tagName.toLowerCase(),
          group: target.closest("[data-group-box]")?.getAttribute("data-group-box") ?? null,
          slot: target.closest("[data-rank-slot]")?.getAttribute("data-rank-slot") ?? null,
        };
      },
      drop(x, y) {
        if (this.transfer === null) throw new Error("recorder: drop without a drag");
        const target = document.elementFromPoint(x, y);
        if (target === null) throw new Error("recorder: drop point is off-page");
        this.transfer._armRead(true);
        const event = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: this.transfer,
          clientX: x,
          clientY: y,
        });
        target.dispatchEvent(event);
        this.transfer._armRead(true);
        if (this.source !== null) {
          this.source.dispatchEvent(
            new DragEvent("dragend", { bubbles: true, dataTransfer: this.transfer }),
          );
        }
        this.transfer = null;
        this.source = null;
        return {
          allowed: event.defaultPrevented,
          tag: target.tagName.toLowerCase(),
          group: target.closest("[data-group-box]")?.getAttribute("data-group-box") ?? null,
          slot: target.closest("[data-rank-slot]")?.getAttribute("data-rank-slot") ?? null,
        };
      },
      cancel() {
        if (this.transfer !== null && this.source !== null) {
          this.source.dispatchEvent(
            new DragEvent("dragend", { bubbles: true, dataTransfer: this.transfer }),
          );
        }
        this.transfer = null;
        this.source = null;
      },
      cursor(x, y) {
        const cursor = document.getElementById("gif-cursor");
        if (cursor !== null) cursor.style.transform = `translate(${x}px, ${y}px)`;
      },
    };
    window.__gifRecorder = recorder;
  });
}

/**
 * Open a harness page for recording: navigate, wait for the board, pin the
 * theme, inject the cursor and the drag plumbing.
 */
export async function openSession(browser, {
  base = HARNESS_DEFAULT,
  query = "",
  theme = "dark",
  waitFor = "section[aria-label]",
  timeout = 60_000,
  cursor = true,
} = {}) {
  const page = await browser.newPage();
  await page.goto(`${base}${query}`, { waitUntil: "domcontentloaded", timeout });
  await page.waitForSelector(waitFor, { timeout });
  await page.evaluate((mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
  }, theme);
  if (cursor) {
    await page.evaluate((svg) => {
      document.body.insertAdjacentHTML("beforeend", svg);
    }, CURSOR_SVG);
  }
  await installDragHelpers(page);
  await new Promise((resolve) => setTimeout(resolve, 600));

  const session = {
    page,
    theme,
    async cursorAt(x, y) {
      await page.mouse.move(x, y);
      await page.evaluate((px, py) => window.__gifRecorder.cursor(px, py), x, y);
    },
    async pointOf(target) {
      return resolveTarget(session, target);
    },
    async click(target, { button = "left", settle = 180 } = {}) {
      const point = await resolveTarget(session, target);
      await session.cursorAt(point.x, point.y);
      await page.mouse.click(point.x, point.y, { button });
      await new Promise((resolve) => setTimeout(resolve, settle));
      return point;
    },
    async rightClick(target, { settle = 300 } = {}) {
      return session.click(target, { button: "right", settle });
    },
    async closeMenu({ point = { x: 900, y: 820 }, settle = 250 } = {}) {
      await session.cursorAt(point.x, point.y);
      await page.mouse.click(point.x, point.y);
      await new Promise((resolve) => setTimeout(resolve, settle));
    },
    async menuEntry(label) {
      return pointOfMenuItem(page, label);
    },
    async startDrag(target) {
      const point = await resolveTarget(session, target);
      await session.cursorAt(point.x, point.y);
      const selector = target.selector ?? cardSelector(target.card);
      const types = await page.evaluate((sel) => window.__gifRecorder.start(sel), selector);
      return { point, types };
    },
    async dragOver(x, y) {
      return page.evaluate((px, py) => window.__gifRecorder.over(px, py), x, y);
    },
    async drop(x, y) {
      return page.evaluate((px, py) => window.__gifRecorder.drop(px, py), x, y);
    },
    async cancelDrag() {
      await page.evaluate(() => window.__gifRecorder.cancel());
    },
  };
  return session;
}

/* ── Targets ──────────────────────────────────────────────────────────── */

export const cardSelector = (id) => `li[data-rank-slot="${id}"] a[draggable]`;
export const slotSelector = (id) => `li[data-rank-slot="${id}"]`;

/** A card's draggable anchor. */
export const card = (id) => ({ selector: cardSelector(id), scroll: true });
/** A card's whole slot (its nested rows included). */
export const slot = (id) => ({ selector: slotSelector(id), scroll: true });
/** A feature-group frame's surface: the dashed box in one lane. */
export const box = (id, at = [0.97, 0.08]) => ({
  selector: `li[data-group-box="${id}"] > div`,
  at,
});
/** The label of an expanded group frame. */
export const boxLabel = (id) => ({ selector: `[data-group-box-label="${id}"]`, scroll: true });
/** The fold chevron beside an expanded group frame's label. */
export const boxChevron = (id) => ({ selector: `[data-group-box-collapse="${id}"]`, scroll: true });
/** A collapsed group card's dashed surface. */
export const foldedBox = (id, at = [0.5, 0.5]) => ({
  selector: `[data-collapsed-group-card="${id}"]`,
  at,
});
/** The toolbar's View chip. */
export const viewChip = () => ({ selector: 'button[aria-label="View"]' });
/** A lane's sweep pill. */
export const sweep = (columnId) => ({
  selector: `section[data-column-id="${columnId}"] [data-sweep-button]`,
});
/** Any fixed page point. */
export const fixed = (x, y) => ({ point: { x, y } });
/** A menu row, resolved after the menu is open. */
export const menuItem = (label) => ({ menuItem: label });

/** Resolve a descriptor to a page point. */
async function resolveTarget(session, target) {
  if (target.point !== undefined) return target.point;
  if (target.menuItem !== undefined) return pointOfMenuItem(session.page, target.menuItem);
  const selector = target.selector ?? cardSelector(target.card);
  if (selector === undefined) throw new Error("recorder: target has no selector");
  const rect = await session.page.evaluate(
    (sel, shouldScroll) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      if (shouldScroll) el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    selector,
    target.scroll === true,
  );
  if (rect === null) throw new Error(`recorder: no element for ${selector}`);
  const [fx, fy] = target.at ?? [0.5, 0.5];
  return { x: rect.x + rect.width * fx, y: rect.y + rect.height * fy };
}

/** The center of a visible menu row, by its exact label. */
export async function pointOfMenuItem(page, label) {
  const rect = await page.evaluate((text) => {
    const rows = [...document.querySelectorAll('[role="menuitem"], [role="option"]')];
    const row = rows.find((el) => el.textContent?.trim() === text);
    if (row === undefined) return null;
    const r = row.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, label);
  if (rect === null) throw new Error(`recorder: no menu row reading exactly "${label}"`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The innermost element whose text names the target, scrolled into view. */
export async function pointOfText(page, text) {
  const rect = await page.evaluate((value) => {
    const matches = [...document.querySelectorAll("body *")].filter(
      (el) => el.textContent?.trim() === value,
    );
    if (matches.length === 0) return null;
    const el = matches
      .map((candidate) => {
        const r = candidate.getBoundingClientRect();
        return { candidate, area: r.width * r.height };
      })
      .sort((a, b) => a.area - b.area)[0].candidate;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, text);
  if (rect === null) throw new Error(`recorder: no element reading exactly "${text}"`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/* ── Frame capture ────────────────────────────────────────────────────── */

/** A numbered frame recorder at a fixed rate. */
export function createFrameRecorder({ page, fps, dir, prefix = "frame" }) {
  let index = 0;
  const framePath = (i) => path.join(dir, `${prefix}-${String(i + 1).padStart(4, "0")}.png`);
  return {
    fps,
    dir,
    get count() {
      return index;
    },
    async frame() {
      await page.screenshot({ path: framePath(index), timeout: 60_000 });
      index += 1;
    },
    /** Hold the current picture for `ms`, one captured frame per tick. */
    async hold(ms) {
      const count = Math.max(1, Math.round((ms / 1000) * fps));
      for (let i = 0; i < count; i += 1) await this.frame();
    },
  };
}

/** Assemble a numbered frame sequence into a palette-optimized GIF. */
export async function assembleGif({
  dir,
  prefix = "frame",
  outPath,
  fps = 24,
  width = 1200,
  colors = 192,
  dither = "none",
  statsMode = "single",
  bayerScale = 4,
}) {
  const ditherArg = dither === "bayer" ? `dither=bayer:bayer_scale=${bayerScale}` : `dither=${dither}`;
  const filter =
    `[0:v]fps=${fps},scale=${width}:-2:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=${statsMode}[p];` +
    `[b][p]paletteuse=${ditherArg}:diff_mode=rectangle[out]`;
  await execFileP("ffmpeg", [
    "-y",
    "-framerate",
    String(fps),
    "-i",
    path.join(dir, `${prefix}-%04d.png`),
    "-filter_complex",
    filter,
    "-map",
    "[out]",
    "-loop",
    "0",
    outPath,
  ]);
  return outPath;
}

/** A temp frames dir that the caller cleans up (or keeps, for inspection). */
export async function makeFramesDir(tag = "gif") {
  return mkdtemp(path.join(os.tmpdir(), `${tag}-`));
}

export async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

export async function writeFrameList(dir, frames) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "frames.txt"), `${frames.join("\n")}\n`);
}

/* ── Storyboard engine ───────────────────────────────────────────────── */

/**
 * Run a storyboard. Every visual step captures frames at the recorder's
 * fixed rate, so the GIF's timing is the storyboard's timing, not the
 * machine's.
 *
 * Step shapes:
 *   { hold: 1200 }                         still, one frame per tick
 *   { move: <target>, ms: 500 }            glide the cursor
 *   { click: <target>, ms, hold, button }  glide, click, hold the result
 *   { menu: <target>, entry, open, hover, hold }  right-click → row → click
 *   { drag: { from, to, ms, hover, settle, grab } }
 *   { closeMenu: true }
 *   { note: "..." }                        a label in the log, no frames
 *   { run: async (session) => {} }         escape hatch for a one-off page action
 */
export async function runStoryboard(session, recorder, steps, { log = console.log } = {}) {
  for (const step of steps) {
    if (step.note !== undefined) {
      log(`  · ${step.note}`);
      continue;
    }
    if (step.hold !== undefined) {
      await recorder.hold(step.hold);
      continue;
    }
    if (step.move !== undefined) {
      const to = await resolveTarget(session, step.move);
      await glide(session, recorder, to, step.ms ?? 450);
      continue;
    }
    if (step.click !== undefined) {
      const to = await resolveTarget(session, step.click);
      await glide(session, recorder, to, step.ms ?? 350);
      await recorder.hold(step.hover ?? 120);
      await session.page.mouse.click(to.x, to.y, { button: step.button ?? "left" });
      await recorder.hold(step.after ?? 500);
      continue;
    }
    if (step.menu !== undefined) {
      await openMenuAndChoose(session, recorder, step);
      continue;
    }
    if (step.drag !== undefined) {
      await performDrag(session, recorder, step.drag);
      continue;
    }
    if (step.closeMenu === true) {
      await session.closeMenu();
      await recorder.hold(step.after ?? 300);
      continue;
    }
    if (step.run !== undefined) {
      await step.run(session, recorder);
      continue;
    }
    throw new Error(`recorder: unknown storyboard step ${JSON.stringify(step)}`);
  }
}

async function glide(session, recorder, to, ms) {
  const from = await session.page.evaluate(() => {
    const cursor = document.getElementById("gif-cursor");
    if (cursor === null) return { x: 0, y: 0 };
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(cursor.style.transform);
    return match === null ? { x: 0, y: 0 } : { x: Number(match[1]), y: Number(match[2]) };
  });
  const steps = Math.max(1, Math.round((ms / 1000) * recorder.fps));
  for (const point of pathPoints(from, to, steps, easeOut)) {
    await session.cursorAt(point.x, point.y);
    await recorder.frame();
  }
}

async function openMenuAndChoose(session, recorder, step) {
  const to = await resolveTarget(session, step.menu);
  await glide(session, recorder, to, step.ms ?? 350);
  await session.page.mouse.click(to.x, to.y, { button: "right" });
  await recorder.hold(step.open ?? 450);
  const entry = await session.menuEntry(step.entry);
  await glide(session, recorder, entry, step.hoverMs ?? 450);
  await recorder.hold(step.hoverHold ?? 250);
  await session.page.mouse.click(entry.x, entry.y);
  await recorder.hold(step.after ?? 600);
}

async function performDrag(session, recorder, drag) {
  const from = await resolveTarget(session, drag.from);
  await glide(session, recorder, from, drag.approach ?? 450);
  await session.startDrag(drag.from);
  await recorder.hold(drag.grab ?? 250);
  const to = await resolveTarget(session, drag.to);
  const steps = Math.max(1, Math.round(((drag.ms ?? 1200) / 1000) * recorder.fps));
  const points = pathPoints(from, to, steps, easeOut);
  for (const point of points) {
    await session.cursorAt(point.x, point.y);
    await session.dragOver(point.x, point.y);
    await recorder.frame();
  }
  // The final hover repeats at the drop point: the board's ring / insertion
  // line settles under a stationary pointer before the release.
  const hoverTicks = Math.max(1, Math.round(((drag.hover ?? 600) / 1000) * recorder.fps));
  for (let i = 0; i < hoverTicks; i += 1) {
    await session.dragOver(to.x, to.y);
    await recorder.frame();
  }
  await session.drop(to.x, to.y);
  await recorder.hold(drag.settle ?? 900);
}
