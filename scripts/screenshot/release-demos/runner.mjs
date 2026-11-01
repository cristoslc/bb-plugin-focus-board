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
import { LEAD_IN_SECONDS, leadInFor } from "../lib/lead-in.mjs";

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
 *
 * A demo may record TWO windows. `page` is the window the storyboard drives by
 * default and `peer` is a second live page against the same mocked host, so a
 * write in one lands in the other exactly as bb's second window sees it. Every
 * `shot` captures both and the assembly stacks them side by side; `use("peer")`
 * re-points the gestures at the second window without breaking the lockstep
 * (`scripts/uat/run.mjs` drives the same pairing for its suites).
 */
export class Stage {
  constructor(page, framesDir, { theme, peer } = {}) {
    this.windows = { main: page, ...(peer === undefined ? {} : { peer }) };
    this.active = "main";
    this.framesDir = framesDir;
    this.frames = [];
    this.clip = null;
    this.theme = theme;
    this.cursors = Object.fromEntries(
      Object.keys(this.windows).map((key) => [key, { x: 0, y: 0 }]),
    );
  }

  /** The window every gesture currently drives. */
  get page() {
    return this.windows[this.active];
  }

  /** How many windows this demo records (1 unless a peer page was opened). */
  get windowCount() {
    return Object.keys(this.windows).length;
  }

  /** The active window's cursor position, for `glide`'s start point. */
  get cursorAt() {
    return this.cursors[this.active];
  }

  /** Re-point the gestures at a named window; the frames keep capturing both. */
  use(name) {
    if (this.windows[name] === undefined) {
      throw new Error(`this demo has no ${name} window (have ${Object.keys(this.windows).join(", ")})`);
    }
    this.active = name;
    return this;
  }

  async prepare() {
    for (const page of Object.values(this.windows)) {
      if (this.theme !== undefined) {
        await page.evaluate((theme) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }, this.theme);
      }
      await page.evaluate((svg) => {
        document.body.insertAdjacentHTML("beforeend", svg);
      }, CURSOR_SVG);
    }
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
    const keys = Object.keys(this.windows);
    const files = [];
    for (const key of keys) {
      const file = path.join(
        this.framesDir,
        keys.length === 1 ? `${name}.png` : `${name}__${key}.png`,
      );
      const options = { path: file, timeout: 30_000 };
      if (this.clip !== null) options.clip = this.clip;
      await this.windows[key].screenshot(options);
      files.push(file);
    }
    this.frames.push({ name, hold, files });
    return keys.length === 1 ? files[0] : files;
  }

  /**
   * The opening beat: the staged board at rest, before the storyboard's first
   * gesture. `recordDemo` calls this once per demo with the demo's own lead-in,
   * so no storyboard has to remember it (see `lib/lead-in.mjs`).
   */
  async leadIn(seconds = LEAD_IN_SECONDS) {
    if (seconds <= 0) return;
    await this.shot("lead-in", { hold: seconds });
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

  async centerOf(selector, { yRatio = 0.5, xRatio = 0.5 } = {}) {
    const r = await this.rectOf(selector);
    if (r === null) throw new Error(`no element for ${selector}`);
    return { x: r.x + r.width * xRatio, y: r.y + r.height * yRatio };
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
    this.cursors[this.active] = { x, y };
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

  /** Click the first button inside `scope` whose visible text starts with
   *  `prefix`. The fold labels repeat across families ("3 child threads"), so
   *  a gesture that must hit one family's control scopes it to that card. */
  async clickButtonIn(scope, prefix, { settle = 1, frames = 4 } = {}) {
    const point = await this.page.evaluate(
      ({ scope, prefix }) => {
        const root = document.querySelector(scope);
        if (root === null) return null;
        const button = [...root.querySelectorAll("button")].find((el) =>
          (el.textContent ?? "").trim().startsWith(prefix),
        );
        if (!button) return null;
        button.scrollIntoView({ block: "center", behavior: "instant" });
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { scope, prefix },
    );
    if (point === null) throw new Error(`no button starting with "${prefix}" inside ${scope}`);
    await this.glide(point, { frames });
    await this.page.mouse.click(point.x, point.y);
    await this.shot(`bi${String(this.frames.length).padStart(3, "0")}`, { hold: settle });
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
    for (const page of Object.values(this.windows)) {
      await page.setViewport({ width, height, deviceScaleFactor: 2 });
    }
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

  /** Assemble this demo's frames into one palette-optimized gif. Two-window
   *  demos are stacked side by side (window A left, window B right) behind a
   *  hairline divider, so one gif shows what both windows see. */
  async assemble(gifPath, { width = GIF_WIDTH } = {}) {
    if (this.frames.length === 0) throw new Error("no frames captured");
    const keys = Object.keys(this.windows);
    const lists = [];
    for (let index = 0; index < keys.length; index += 1) {
      const list = path.join(
        this.framesDir,
        keys.length === 1 ? "frames.txt" : `frames-${keys[index]}.txt`,
      );
      const entries = this.frames.map(
        (frame) => `file '${path.basename(frame.files[index])}'\nduration ${frame.hold}`,
      );
      // The concat demuxer ignores the last entry's duration, so the final
      // frame is listed twice; the repeat carries the settle hold.
      entries.push(`file '${path.basename(this.frames.at(-1).files[index])}'\nduration 0.1`);
      await writeFile(list, `${entries.join("\n")}\n`);
      lists.push(list);
    }
    const args = ["-y"];
    for (const list of lists) args.push("-f", "concat", "-safe", "0", "-i", list);
    if (keys.length === 1) {
      const vf = [
        `fps=${FPS}`,
        `scale=${width}:-2:flags=lanczos`,
        "split[a][b]",
        "[a]palettegen=max_colors=192[p]",
        "[b][p]paletteuse=dither=bayer:bayer_scale=4",
      ].join(",");
      args.push("-vf", vf, "-loop", "0", gifPath);
    } else {
      const half = Math.floor(width / 2);
      const filter = [
        `[0:v]fps=${FPS},scale=${half}:-2:flags=lanczos,setsar=1[a]`,
        `[1:v]fps=${FPS},scale=${half}:-2:flags=lanczos,setsar=1[b]`,
        `[a][b]hstack=inputs=2,drawbox=x=${half - 1}:y=0:w=2:h=ih:color=0x52525b:t=fill,split[c][d]`,
        "[c]palettegen=max_colors=192[p]",
        "[d][p]paletteuse=dither=bayer:bayer_scale=4[out]",
      ].join(";");
      args.push("-filter_complex", filter, "-map", "[out]", "-loop", "0", gifPath);
    }
    await execFileP("ffmpeg", args);
    return gifPath;
  }
}

/**
 * Record one storyboard against the harness. Each demo gets a fresh page, so
 * one demo's clicks and folds never leak into the next.
 */
export async function recordDemo(browser, demo, { release, baseParams = "", outDir, framesRoot }) {
  const viewport = demo.viewport ?? DESKTOP;
  const windowCount = demo.windows ?? 1;
  if (windowCount !== 1 && windowCount !== 2) {
    throw new Error(`${demo.id}: windows must be 1 or 2, got ${JSON.stringify(demo.windows)}`);
  }
  const page = await browser.newPage();
  const peer = windowCount === 2 ? await browser.newPage() : undefined;
  const framesDir = await mkdtemp(path.join(framesRoot, `${release}-${demo.id}-`));
  const stage = new Stage(page, framesDir, { theme: demo.theme, peer });
  // Two windows are two documents over ONE mocked host: the `sharedHost`
  // token turns on the harness's cross-page host row (a fresh token per demo,
  // so no earlier capture's write can replay into this one), so a fold, a done
  // mark, a rank move or a group write in one window reaches the other the way
  // bb's does.
  const hostToken = `${release}-${demo.id}-${Math.random().toString(36).slice(2, 8)}`;
  const query = `${baseParams}${demo.params ?? ""}${
    peer === undefined ? "" : `&sharedHost=${encodeURIComponent(hostToken)}`
  }`.replace(/^&/, "");
  try {
    await page.setViewport(viewport);
    if (peer !== undefined) await peer.setViewport(viewport);
    // Start every demo from a clean profile: the app persists filters,
    // folds, and toggles in localStorage, and a previous demo's write would
    // otherwise hide cards this one needs. Cleared before either page loads,
    // so the shared host log starts empty for the pair too.
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.evaluate(() => window.localStorage.clear());
    await page.goto(`${BASE}?${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector(demo.ready ?? "[data-thread-card]", { timeout: 60_000 });
    if (peer !== undefined) {
      await peer.goto(`${BASE}?${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await peer.waitForSelector(demo.ready ?? "[data-thread-card]", { timeout: 60_000 });
    }
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
    const rest = { x: viewport.width - 120, y: viewport.height - 100 };
    await stage.park(rest.x, rest.y);
    if (peer !== undefined) {
      // Both pointers start parked, so neither window's cursor sits at 0,0.
      stage.use("peer").park(rest.x, rest.y);
      stage.use("main");
    }
    if (typeof demo.setup === "function") await demo.setup(stage, page);
    // The orientation beat (see lib/lead-in.mjs): the staged board at rest
    // before the first gesture, once, for every demo in this release.
    await stage.leadIn(leadInFor(demo));
    await demo.steps(stage, page);
    const gifPath = path.join(outDir, `${release}-${demo.id}.gif`);
    await stage.assemble(gifPath, { width: demo.gifWidth ?? GIF_WIDTH });
    const seconds = stage.frames.reduce((sum, frame) => sum + frame.hold, 0);
    return { gifPath, frames: stage.frames.length, seconds };
  } finally {
    await page.close().catch(() => {});
    if (peer !== undefined) await peer.close().catch(() => {});
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
