/**
 * Storyboard-driven recorder for a release's demo gifs.
 *
 * A release's demos live in `release-demos/<version>.mjs` as a list of small
 * storyboards (a clip target, a URL, and a few gesture calls); this module
 * owns everything they share — the synthetic cursor, the gesture primitives,
 * the frame timing, and the ffmpeg palette-optimized assembly — so a new
 * demo costs a storyboard, not a new script.
 *
 * Run against the harness (see `scripts/screenshot/README.md`):
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.5.0
 *
 * Env: HARNESS_URL, CHROME_PATH, DEMO_OUT_DIR (gif destination, default
 * docs/screenshots/release-demos/), DEMO_FRAMES_DIR, DEMO_GIF_WIDTH (1100),
 * DEMO_FPS (12). Every gif is written as `<version>-<id>.gif`.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const execFileP = promisify(execFile);

export const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
export const GIF_WIDTH = Number(process.env.DEMO_GIF_WIDTH ?? "1100");
const FPS = Number(process.env.DEMO_FPS ?? "12");

/** Desktop board, big enough that one lane's cards and the pane both fit. */
export const DESKTOP = { width: 1600, height: 1000, deviceScaleFactor: 2 };
/** The release harness's phone size. */
export const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };
/** A laptop window: the width where the toolbar starts folding. */
export const LAPTOP = { width: 1280, height: 800, deviceScaleFactor: 2 };

/** A synthetic pointer: headless screenshots carry no OS cursor, so the gif's
 *  pointer is an overlay arrow the driver moves with the mouse. */
const CURSOR_SVG = `
<svg id="demo-cursor" width="21" height="28" viewBox="0 0 21 28"
     style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
            filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))" aria-hidden="true">
  <path d="M2.5 1.5 L2.5 20.5 L7.6 15.8 L10.7 23.4 L14.3 21.9 L11.2 14.4 L17.5 14.4 Z"
        fill="#fff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

/**
 * One demo's recording session. Every frame is a PNG with its own duration;
 * `shot` captures a frame, and the motion helpers capture while they move so
 * the pointer reads as moving in the finished gif.
 */
export class Stage {
  constructor(page, framesDir, { theme } = {}) {
    this.page = page;
    this.framesDir = framesDir;
    this.frames = [];
    this.clip = null;
    this.theme = theme;
    this.cursorAt = { x: 0, y: 0 };
  }

  async prepare() {
    if (this.theme !== undefined) {
      await this.page.evaluate((theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
      }, this.theme);
    }
    await this.page.evaluate((svg) => {
      document.body.insertAdjacentHTML("beforeend", svg);
    }, CURSOR_SVG);
  }

  /** Sample an animation: N frames, each `hold` seconds apart in the gif. */
  async burst(name, { frames = 24, hold = 0.12 } = {}) {
    for (let i = 0; i < frames; i += 1) {
      await this.shot(`${name}-${String(i).padStart(3, "0")}`, { hold });
      await sleep(hold * 1000 - 40);
    }
  }

  async sleep(ms) {
    await sleep(ms);
  }

  /** Frame duration defaults: a settle hold, or a motion step. */
  async shot(name, { hold = 0.45 } = {}) {
    const file = path.join(this.framesDir, `${name}.png`);
    const options = { path: file, timeout: 30_000 };
    if (this.clip !== null) options.clip = this.clip;
    await this.page.screenshot(options);
    this.frames.push({ name, hold });
    return file;
  }

  /** Pin the capture to one element (plus padding) for the whole demo. */
  async clipTo(selector, pad = 12) {
    const box = await this.rectOf(selector);
    if (box === null) throw new Error(`clip target ${selector} not found`);
    this.clip = {
      x: Math.max(0, Math.round(box.x - pad)),
      y: Math.max(0, Math.round(box.y - pad)),
      width: Math.round(box.width + pad * 2),
      height: Math.round(box.height + pad * 2),
    };
    return this.clip;
  }

  /** Pin the capture to the bounding box of several elements (a card plus
   *  the tooltip that opens beside it, a banner row above it). */
  async clipUnion(selectors, pad = 16) {
    let box = null;
    for (const selector of selectors) {
      const rect = await this.rectOf(selector);
      if (rect === null) continue;
      if (box === null) box = { ...rect };
      else {
        const right = Math.max(box.x + box.width, rect.x + rect.width);
        const bottom = Math.max(box.y + box.height, rect.y + rect.height);
        box.x = Math.min(box.x, rect.x);
        box.y = Math.min(box.y, rect.y);
        box.width = right - box.x;
        box.height = bottom - box.y;
      }
    }
    if (box === null) throw new Error(`no clip target among ${selectors.join(", ")}`);
    this.clip = {
      x: Math.max(0, Math.round(box.x - pad)),
      y: Math.max(0, Math.round(box.y - pad)),
      width: Math.round(box.width + pad * 2),
      height: Math.round(box.height + pad * 2),
    };
    return this.clip;
  }

  async rectOf(selector) {
    return this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, selector);
  }

  async centerOf(selector) {
    const r = await this.rectOf(selector);
    if (r === null) throw new Error(`no element for ${selector}`);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  /** The innermost element whose trimmed text is exactly `text`. */
  async pointText(text) {
    const rect = await this.page.evaluate((text) => {
      const matches = [...document.querySelectorAll("body *")].filter(
        (el) => el.textContent?.trim() === text,
      );
      if (matches.length === 0) return null;
      // Rank by box area: icons and wrapper spans make leaf checks fail, so
      // the smallest box is the label itself rather than the menu around it.
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
    if (rect === null) throw new Error(`no element reading exactly "${text}"`);
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }

  /** Park the pointer somewhere without capturing a frame. */
  async park(x, y) {
    await this.page.mouse.move(x, y);
    await this.syncCursor(x, y);
  }

  async syncCursor(x, y) {
    this.cursorAt = { x, y };
    await this.page.evaluate(({ x, y }) => {
      const cursor = document.getElementById("demo-cursor");
      if (cursor) cursor.style.transform = `translate(${x}px, ${y}px)`;
    }, { x, y });
  }

  /** Move the pointer to a point, capturing `frames` frames along the way. */
  async glide(to, { frames = 5, hold = 0.1, from } = {}) {
    const start = from ?? this.cursorAt;
    for (let i = 1; i <= frames; i += 1) {
      const t = i / frames;
      const x = start.x + (to.x - start.x) * t;
      const y = start.y + (to.y - start.y) * t;
      await this.page.mouse.move(x, y);
      await this.syncCursor(x, y);
      await this.shot(`m${String(this.frames.length).padStart(3, "0")}`, { hold });
    }
  }

  async waitFor(selector, timeout = 10_000) {
    return this.page.waitForSelector(selector, { timeout });
  }

  /** Scroll an element into view, capturing the scroll so a lower lane's
   *  gesture does not look like it happened off camera. */
  async scrollInto(selector, { hold = 0.5 } = {}) {
    await this.alignTo(selector);
    await this.shot(`s${String(this.frames.length).padStart(3, "0")}`, { hold });
  }

  /** Scroll an element into view without capturing a frame (setup only). */
  async alignTo(selector) {
    await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el instanceof HTMLElement) el.scrollIntoView({ block: "center", behavior: "instant" });
    }, selector);
    await this.page.mouse.move(this.cursorAt.x, this.cursorAt.y);
  }

  /** A card's own context menu, opened where the pointer sits: dispatching on
   *  the card element keeps a nested child row from claiming the gesture.
   *  `deep` hands the event to whatever sits under the pointer instead (a
   *  lane header's menu hangs off the header's inner control, not the band). */
  async rightClickCard(selector, { settle = 0.8, frames = 4, deep = false } = {}) {
    const to = await this.centerOf(selector);
    await this.glide(to, { frames });
    await this.page.evaluate(
      ({ sel, x, y, deep }) => {
        const el = deep === true ? document.elementFromPoint(x, y) : document.querySelector(sel);
        if (!(el instanceof HTMLElement)) throw new Error(`no element for ${sel}`);
        el.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      },
      { sel: selector, x: to.x, y: to.y, deep },
    );
    await this.shot(`r${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return to;
  }

  /** Click the first button whose visible text starts with `prefix`. */
  async clickButton(prefix, { settle = 0.8, frames = 4 } = {}) {
    const point = await this.page.evaluate((value) => {
      const button = [...document.querySelectorAll("button")].find((el) =>
        (el.textContent ?? "").trim().startsWith(value),
      );
      if (!button) return null;
      button.scrollIntoView({ block: "center", behavior: "instant" });
      const r = button.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, prefix);
    if (point === null) throw new Error(`no button starting with "${prefix}"`);
    await this.glide(point, { frames });
    await this.page.mouse.click(point.x, point.y);
    await this.shot(`b${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return point;
  }

  /** Click the first control whose aria-label starts with `prefix`. */
  async clickAria(prefix, { settle = 0.9, frames = 4, root = "button" } = {}) {
    const point = await this.page.evaluate(
      ({ prefix, root }) => {
        const el = [...document.querySelectorAll(root)].find((candidate) =>
          (candidate.getAttribute("aria-label") ?? "").startsWith(prefix),
        );
        if (!el) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { prefix, root },
    );
    if (point === null) throw new Error(`no ${root} whose aria-label starts with "${prefix}"`);
    await this.glide(point, { frames });
    await this.page.mouse.click(point.x, point.y);
    await this.shot(`a${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return point;
  }

  /** Pick an option of a labeled radio group (the settings' choice rows). */
  async selectRadio(groupLabel, optionText, { settle = 1.2, frames = 4 } = {}) {
    const point = await this.page.evaluate(
      ({ groupLabel, optionText }) => {
        const group = document.querySelector(`[role="radiogroup"][aria-label="${groupLabel}"]`);
        if (!group) return null;
        const option = [...group.querySelectorAll("*")].find(
          (el) => el.childElementCount === 0 && (el.textContent ?? "").trim() === optionText,
        );
        const target = option?.closest('[role="radio"]') ?? option;
        if (!(target instanceof HTMLElement)) return null;
        target.scrollIntoView({ block: "center", behavior: "instant" });
        const r = target.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { groupLabel, optionText },
    );
    if (point === null) throw new Error(`radio "${optionText}" in "${groupLabel}" not found`);
    await this.glide(point, { frames });
    await this.page.mouse.click(point.x, point.y);
    await this.shot(`rr${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return point;
  }

  /** Type into the focused element or a named input. */
  async typeText(text, { settle = 0.9 } = {}) {
    await this.page.keyboard.type(text, { delay: 45 });
    await this.shot(`t${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
  }

  /** Reload the board and hold on it (file a fold that should survive). */
  async reload({ settle = 1.8 } = {}) {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
    await this.shot(`re${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
  }

  async setViewport(width, height) {
    await this.page.setViewport({ width, height, deviceScaleFactor: 2 });
  }

  async pressKey(key, { settle = 0.9 } = {}) {
    await this.page.keyboard.press(key);
    await this.shot(`k${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
  }

  async waitForText(text, timeout = 10_000) {
    return this.page.waitForFunction(
      (value) =>
        [...document.querySelectorAll("body *")].some(
          (el) => el.childElementCount === 0 && el.textContent?.trim() === value,
        ),
      { timeout },
      text,
    );
  }

  /** Hover an element with a real mouse move, holding a frame on arrival. */
  async hover(selector, { settle = 0.6, frames = 5 } = {}) {
    const to = await this.centerOf(selector);
    await this.glide(to, { frames });
    await this.shot(`h${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return to;
  }

  /** A real mouse click at an element's centre. */
  async click(selector, { settle = 0.5, frames = 4 } = {}) {
    const to = await this.centerOf(selector);
    await this.glide(to, { frames });
    await this.page.mouse.click(to.x, to.y);
    await this.shot(`c${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return to;
  }

  /** Click through the DOM instead of the mouse: an HTML5 draggable anchor
   *  swallows a real mouseup, so pane-opening clicks must not use the mouse. */
  async domClick(selector, { settle = 0.6 } = {}) {
    await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!(el instanceof HTMLElement)) throw new Error(`no element for ${sel}`);
      el.click();
    }, selector);
    await this.shot(`d${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
  }

  async rightClick(selector, { settle = 0.7, frames = 4 } = {}) {
    const to = await this.centerOf(selector);
    await this.glide(to, { frames });
    await this.page.mouse.click(to.x, to.y, { button: "right" });
    await this.shot(`r${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return to;
  }

  /** Hover a menu entry by its label, then run it with a real click. */
  async menuPick(label, { hoverHold = 0.8, settle = 0.7 } = {}) {
    await this.page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('[role="menuitem"]')].some(
          (el) => el.textContent?.trim() === text,
        ),
      { timeout: 8_000 },
      label,
    );
    // Center on the labelled entry itself: several entries share the role.
    const entry = await this.page.evaluate((text) => {
      const el = [...document.querySelectorAll('[role="menuitem"]')].find(
        (candidate) => candidate.textContent?.trim() === text,
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, label);
    if (entry === null) throw new Error(`menu entry "${label}" not found`);
    await this.glide(entry, { frames: 4 });
    await this.shot(`mh${String(this.frames.length).padStart(3, "0")}`, { hold: hoverHold });
    await this.page.mouse.click(entry.x, entry.y);
    await this.shot(`mc${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
    return entry;
  }

  /**
   * A drag along a real pointer path: dragstart on the source's draggable
   * anchor, a dragover per step on the waypoint under the pointer (so the
   * app's drop indicator follows), then drop and dragend on the last one.
   * Waypoints are `{ x, y }` points or `{ selector, yRatio }` resolved when
   * the step runs, so a strip's dot or a lane's floor can be named, and a
   * gesture that leaves the dots and comes back is two waypoints.
   */
  async dragPath(fromSelector, waypoints, { hold = 0.1, settle = 1.2, framesPerLeg = 4 } = {}) {
    const from = await this.centerOf(fromSelector);
    const legs = [];
    let cursor = { ...from };
    for (const waypoint of waypoints) {
      const target =
        waypoint.selector !== undefined
          ? await this.centerOf(waypoint.selector, waypoint)
          : { x: waypoint.x, y: waypoint.y };
      legs.push({ target, frames: waypoint.frames ?? framesPerLeg });
    }
    await this.glide(from, { frames: 4 });
    // ONE DataTransfer for the whole gesture, parked on the page: the board's
    // dragstart writes the payload into it and its dragover/drop read that
    // same payload, exactly as a real drag does.
    await this.page.evaluate((sel) => {
      const anchor =
        document.querySelector(`${sel} a[draggable]`) ?? document.querySelector(sel);
      if (!(anchor instanceof HTMLElement)) throw new Error(`drag source ${sel} not found`);
      window.__demoDrag = new DataTransfer();
      anchor.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: window.__demoDrag,
        }),
      );
    }, fromSelector);
    for (const leg of legs) {
      for (let i = 1; i <= leg.frames; i += 1) {
        const t = i / leg.frames;
        const x = cursor.x + (leg.target.x - cursor.x) * t;
        const y = cursor.y + (leg.target.y - cursor.y) * t;
        await this.page.mouse.move(x, y);
        await this.syncCursor(x, y);
        await this.page.evaluate(({ x, y }) => {
          const target = document.elementFromPoint(x, y);
          target?.dispatchEvent(
            new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              dataTransfer: window.__demoDrag,
              clientX: x,
              clientY: y,
            }),
          );
        }, { x, y });
        await this.shot(`g${String(this.frames.length).padStart(3, "0")}`, { hold });
      }
      cursor = { ...leg.target };
    }
    // The drop lands on the gesture's last named target, not on whatever the
    // pointer happens to be over: a rank slot's hit box is the row, and the
    // pointer resting at its centre can read as the card inside it.
    await this.page.evaluate(({ x, y, sel }) => {
      const destination = sel === undefined ? null : document.querySelector(sel);
      const target =
        destination instanceof HTMLElement ? destination : document.elementFromPoint(x, y);
      target?.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: window.__demoDrag,
          clientX: x,
          clientY: y,
        }),
      );
    }, { ...cursor, sel: waypoints.at(-1)?.selector });
    // dragend closes the gesture: the board clears its drag state on it.
    await this.page.evaluate((sel) => {
      const anchor =
        document.querySelector(`${sel} a[draggable]`) ?? document.querySelector(sel);
      anchor?.dispatchEvent(
        new DragEvent("dragend", {
          bubbles: true,
          cancelable: true,
          dataTransfer: window.__demoDrag,
        }),
      );
      window.__demoDrag = undefined;
    }, fromSelector);
    await this.shot(`gd${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
  }

  /** A drag from one element to another, for the simple case. */
  async drag(fromSelector, toSelector, { yRatio = 0.5, frames = 6, hold = 0.1, settle = 1.2 } = {}) {
    await this.dragPath(fromSelector, [{ selector: toSelector, yRatio, frames }], { hold, settle });
  }

  /** Assemble this demo's frames into one palette-optimized gif. */
  async assemble(gifPath, { width = GIF_WIDTH } = {}) {
    if (this.frames.length === 0) throw new Error("no frames captured");
    const list = path.join(this.framesDir, "frames.txt");
    const entries = this.frames.map(
      ({ name, hold }) => `file '${name}.png'\nduration ${hold}`,
    );
    // The concat demuxer ignores the last entry's duration, so the final
    // frame is listed twice; the repeat carries the settle hold.
    entries.push(`file '${this.frames.at(-1).name}.png'\nduration 0.1`);
    await writeFile(list, `${entries.join("\n")}\n`);
    const vf = [
      `fps=${FPS}`,
      `scale=${width}:-2:flags=lanczos`,
      "split[a][b]",
      "[a]palettegen=max_colors=192[p]",
      "[b][p]paletteuse=dither=bayer:bayer_scale=4",
    ].join(",");
    await execFileP("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", list,
      "-vf", vf, "-loop", "0", gifPath,
    ]);
    return gifPath;
  }
}

/**
 * Record one storyboard against the harness. Each demo gets a fresh page, so
 * one demo's clicks and folds never leak into the next.
 */
export async function recordDemo(browser, demo, { release, baseParams = "", outDir, framesRoot }) {
  const viewport = demo.viewport ?? DESKTOP;
  const page = await browser.newPage();
  const framesDir = await mkdtemp(path.join(framesRoot, `${release}-${demo.id}-`));
  const stage = new Stage(page, framesDir, { theme: demo.theme });
  const query = `${baseParams}${demo.params ?? ""}`.replace(/^&/, "");
  try {
    await page.setViewport(viewport);
    // Start every demo from a clean profile: the app persists filters,
    // folds, and toggles in localStorage, and a previous demo's write would
    // otherwise hide cards this one needs.
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${BASE}?${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector(demo.ready ?? "[data-thread-card]", { timeout: 60_000 });
    await stage.sleep(demo.settle ?? 700);
    if (typeof demo.clip === "string") {
      // The clip is pinned once, so the target has to be on camera before the
      // rect is read: a lower lane's card sits below the fold until scrolled.
      await stage.alignTo(demo.clip);
      await stage.clipTo(demo.clip, demo.clipPad ?? 12);
    } else if (demo.clipBox !== undefined) {
      // A fixed band (the toolbar, before it carried a data attribute).
      stage.clip = demo.clipBox;
    }
    await stage.prepare();
    await stage.park(viewport.width - 120, viewport.height - 100);
    if (typeof demo.setup === "function") await demo.setup(stage, page);
    await demo.steps(stage, page);
    const gifPath = path.join(outDir, `${release}-${demo.id}.gif`);
    await stage.assemble(gifPath, { width: demo.gifWidth ?? GIF_WIDTH });
    const seconds = stage.frames.reduce((sum, frame) => sum + frame.hold, 0);
    return { gifPath, frames: stage.frames.length, seconds };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--hide-scrollbars"],
  });
}

export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
  return dir;
}

export { sleep };
