// [REDWORK] Wallpaper settings on a phone (this thread's report): opens Focus
// Board settings on the Appearance tab at 390x844 with a touch phone
// emulation, measures the sheet's inner layout with DOM boxes (never by eye),
// drives the crop preview and the sliders, and repeats the same measurements
// at a desktop width to name where the break begins. Artifacts land in
// docs/screenshots/repro-settings-mobile/ (`phone-sheet.png`,
// `desktop-dialog.png`, `evidence.json`). Exits non-zero when the compact
// sheet violates the layout contract the same script describes.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:58124/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-settings-mobile/", import.meta.url).pathname;

// A 1200x800 image: data url, so the run needs no network for the preview.
const stripes = Array.from({ length: 12 }, (_, i) =>
  `<rect x="${i * 100}" y="0" width="50" height="800" fill="${i % 2 === 0 ? "#e11d48" : "#1e3a8a"}"/>`,
).join("");
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">` +
  `<rect width="1200" height="800" fill="#94a3b8"/>${stripes}` +
  `<circle cx="600" cy="400" r="150" fill="none" stroke="#facc15" stroke-width="24"/>` +
  `</svg>`;
const WALLPAPER_URL = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const STORED_WALLPAPER = JSON.stringify({
  version: 1,
  global: { url: WALLPAPER_URL, dim: 0.1, fit: "cover", zoom: 1, focusX: 40, focusY: 60 },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});

const measure = async (page, label) =>
  page.evaluate((stateLabel) => {
    const box = (el) => {
      if (el === null || el === undefined) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    };
    const q = (selector) => document.querySelector(selector);
    const panel = q("[data-persistent-drawer-content]");
    const dialog = q("[role='dialog']");
    const body = q("[data-settings-body]");
    const rail = q("[role='tablist']");
    const tabpanel = q("[role='tabpanel']");
    const picker = tabpanel?.querySelector(".rounded-md.border.bg-popover") ?? null;
    const presetGrid = picker?.querySelector(".grid") ?? null;
    const firstPreset = picker?.querySelector("button[aria-label^='Wallpaper preset']") ?? null;
    const openverseGrid = picker?.querySelector(".grid.max-h-40") ?? null;
    const preview = q("[data-wallpaper-viewport]");
    const imageBox = q("[data-wallpaper-imagebox]");
    const cropWindow = q("[data-wallpaper-crop-window]");
    const dimSlider = q("input[aria-label='Wallpaper dim']");
    const zoomSlider = q("input[aria-label='Wallpaper zoom']");
    const fitRow = dimSlider?.closest("label")?.parentElement ?? null;
    const sheetContent = dialog?.querySelector("[data-persistent-drawer-content], div");
    const clip = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowX: getComputedStyle(el).overflowX,
        overflowY: getComputedStyle(el).overflowY,
        horizontalOverflow: el.scrollWidth > el.clientWidth + 1,
        verticalOverflow: el.scrollHeight > el.clientHeight + 1,
        box: box(el),
        rect: { right: Math.round(r.right), bottom: Math.round(r.bottom) },
      };
    };
    // Hit-test the control's own center: a control the sheet clips or covers
    // is not tappable however healthy its box looks.
    const hit = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return { hit: false, reason: "zero box" };
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const target = document.elementFromPoint(x, y);
      const reachable = target !== null && (target === el || el.contains(target));
      return {
        hit: reachable,
        at: { x: Math.round(x), y: Math.round(y) },
        got: target === null ? null : `${target.tagName.toLowerCase()}${target.getAttribute("aria-label") === null ? "" : `[aria-label="${target.getAttribute("aria-label")}"]`}`,
      };
    };
    const sheetPanel = panel ?? dialog;
    const viewportHeight = window.innerHeight;
    const styleOf = (el) => (el === null ? null : el.getAttribute("style"));
    return {
      label: stateLabel,
      window: { w: window.innerWidth, h: window.innerHeight },
      dialogRole: dialog?.getAttribute("role") ?? null,
      drawer: clip(sheetPanel),
      dialogContent: clip(sheetContent),
      body: {
        ...clip(body),
        inlineHeight: body?.style.height ?? null,
        computedHeight: body === null ? null : getComputedStyle(body).height,
        display: body === null ? null : getComputedStyle(body).display,
        flexDirection: body === null ? null : getComputedStyle(body).flexDirection,
      },
      rail: { ...clip(rail), w: box(rail)?.w ?? null },
      tabpanel: clip(tabpanel),
      picker: clip(picker),
      presetGrid: clip(presetGrid),
      firstPreset: box(firstPreset),
      openverseGrid: clip(openverseGrid),
      preview: { ...box(preview), style: styleOf(preview) },
      imageBox: clip(imageBox),
      cropWindow: { ...box(cropWindow), hit: hit(cropWindow) },
      dimSlider: { ...box(dimSlider), hit: hit(dimSlider) },
      zoomSlider: { ...box(zoomSlider), hit: hit(zoomSlider) },
      fitRow: box(fitRow),
      pickerChildOffenders: picker === null ? null : [...picker.querySelectorAll("*")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && Math.round(r.right) > Math.round(picker.getBoundingClientRect().right) + 1;
        })
        .slice(0, 8)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          aria: el.getAttribute("aria-label"),
          cls: (el.getAttribute("class") ?? "").slice(0, 70),
          right: Math.round(el.getBoundingClientRect().right),
        })),
      bodyTallerThanSheet: sheetPanel === null || body === null
        ? null
        : Math.round(body.getBoundingClientRect().height) > Math.round(sheetPanel.getBoundingClientRect().height),
      sheetScroller: clip(body?.parentElement ?? null),
      bodyPin: viewportHeight > 0 ? Math.round((body?.getBoundingClientRect().height ?? 0)) : null,
      documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  }, label);

async function openSettings(page) {
  await page.evaluate(() => {
    const byLabel = (label) =>
      document.querySelector(`button[aria-label="${CSS.escape(label)}"]`);
    const gear = byLabel("Focus Board settings") ?? byLabel("What's new");
    if (gear === null) throw new Error("no settings icon in the toolbar");
    gear.click();
  });
  await page.waitForSelector("[role='dialog'] [role='tab'], [data-settings-body] [role='tab']", { timeout: 10_000 });
  await sleep(400);
  await page.evaluate(() => {
    const appearance = [...document.querySelectorAll("[role='tab']")].find(
      (tab) => tab.textContent?.trim() === "Appearance",
    );
    if (appearance === undefined) throw new Error("no Appearance tab in the settings rail");
    appearance.click();
  });
  await page.waitForSelector("[data-wallpaper-viewport]", { timeout: 10_000 });
  await sleep(900);
}

const dragOnCrop = async (page) => {
  const box = await page.evaluate(() => {
    const el = document.querySelector("[data-wallpaper-imagebox]");
    if (el === null) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (box === null) return { dragged: false, reason: "no crop image box" };
  const before = await page.evaluate(() => {
    const raw = window.localStorage.getItem("focus-board:wallpaper");
    return raw === null ? null : JSON.parse(raw);
  });
  const from = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 };
  const to = { x: box.x + box.w * 0.7, y: box.y + box.h * 0.7 };
  await page.evaluate(
    ({ from: a, to: b }) => {
      const el = document.querySelector("[data-wallpaper-imagebox]");
      if (el === null) throw new Error("no crop image box");
      const fire = (type, point) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            isPrimary: true,
            clientX: point.x,
            clientY: point.y,
          }),
        );
      fire("pointerdown", a);
      fire("pointermove", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      fire("pointermove", b);
      fire("pointerup", b);
    },
    { from, to },
  );
  await sleep(700);
  const after = await page.evaluate(() => {
    const raw = window.localStorage.getItem("focus-board:wallpaper");
    return raw === null ? null : JSON.parse(raw);
  });
  return {
    dragged: true,
    from,
    to,
    focusBefore: before === null ? null : before.global,
    focusAfter: after === null ? null : after.global,
    changed:
      after !== null &&
      (after.global?.focusX !== before?.global?.focusX ||
        after.global?.focusY !== before?.global?.focusY),
  };
};

const dragSlider = async (page, label) => {
  const box = await page.evaluate((ariaLabel) => {
    const el = document.querySelector(`input[aria-label="${CSS.escape(ariaLabel)}"]`);
    if (el === null) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, value: el.value };
  }, label);
  if (box === null) return { dragged: false, reason: `no ${label}` };
  const y = box.y + box.h / 2;
  await page.mouse.move(box.x + box.w * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.85, y, { steps: 8 });
  await page.mouse.up();
  await sleep(500);
  const after = await page.evaluate((ariaLabel) => {
    const el = document.querySelector(`input[aria-label="${CSS.escape(ariaLabel)}"]`);
    const raw = window.localStorage.getItem("focus-board:wallpaper");
    return { value: el?.value ?? null, stored: raw === null ? null : JSON.parse(raw).global };
  }, label);
  return { dragged: true, before: box.value, after: after.value, stored: after.stored };
};

await mkdir(OUT, { recursive: true });
const evidence = { states: [], violations: [], drags: {} };

// ── Phone: 390x844, isMobile, hasTouch ────────────────────────────────────
{
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((stored) => {
    localStorage.setItem("focus-board:wallpaper", stored);
  }, STORED_WALLPAPER);
  const errors = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  await page.goto(`${BASE}?groupBy=status&lastSeenUnreleased=current`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await openSettings(page);

  const phoneSheet = await measure(page, "phone-390x844-appearance");
  phoneSheet.pageErrors = errors;
  await page.screenshot({ path: `${OUT}phone-sheet.png` });

  // Driving the controls: the crop preview takes a touch-pointer drag, the
  // two sliders take a real pointer drag.
  evidence.drags.crop = await dragOnCrop(page);
  evidence.drags.dim = await dragSlider(page, "Wallpaper dim");
  evidence.drags.zoom = await dragSlider(page, "Wallpaper zoom");

  // Openverse results, if the network is reachable: type a query and search.
  await page.evaluate(() => {
    const input = document.querySelector("input[aria-label='Search Openverse']");
    if (input !== null) input.focus();
  });
  await page.keyboard.type("forest", { delay: 15 });
  await page.evaluate(() => {
    const button = document.querySelector("button[aria-label='Search']");
    if (button !== null) button.click();
  });
  await sleep(4000);
  phoneSheet.openverse = await page.evaluate(() => {
    const input = document.querySelector("input[aria-label='Search Openverse']");
    const block = input?.closest("div.mt-2") ?? null;
    const results = block?.querySelector(".grid.max-h-40") ?? null;
    return {
      text: block?.textContent?.replace(/\s+/g, " ").trim().slice(0, 240) ?? null,
      resultCount: results === null ? 0 : results.children.length,
      resultsBox: results === null ? null : (() => {
        const r = results.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width), right: Math.round(r.right) };
      })(),
    };
  });
  evidence.states.push(phoneSheet);
  // Reachability after the sheet scrolls: a control that only exists below
  // the visible box is not "squeezed", it is unreachable. The sheet's own
  // content container is the one scroll surface on compact.
  phoneSheet.reachAfterScroll = await page.evaluate(() => {
    const panel = document.querySelector("[role='tabpanel']");
    const scroller = document.querySelector("[data-settings-body]")?.parentElement ?? panel;
    if (scroller === null || scroller === undefined) return null;
    scroller.scrollTop = scroller.scrollHeight;
    const read = (ariaLabel) => {
      const el = document.querySelector(`input[aria-label="${CSS.escape(ariaLabel)}"]`);
      if (el === null) return { present: false };
      const r = el.getBoundingClientRect();
      const target = r.width <= 0 || r.height <= 0 ? null : document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        present: true,
        w: Math.round(r.width),
        top: Math.round(r.top),
        inWindow: r.top >= 0 && r.bottom <= window.innerHeight,
        hit: target !== null && (target === el || el.contains(target)),
      };
    };
    return {
      scroller: scroller.tagName.toLowerCase(),
      sheetScrolls: scroller.scrollHeight > scroller.clientHeight + 1,
      scrollTop: scroller.scrollTop,
      dim: read("Wallpaper dim"),
      zoom: read("Wallpaper zoom"),
    };
  });
  await page.screenshot({ path: `${OUT}phone-sheet-scrolled.png` });
  await page.close();
}

// ── Desktop: 1280x800 (the dialog branch) ─────────────────────────────────
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((stored) => {
    localStorage.setItem("focus-board:wallpaper", stored);
  }, STORED_WALLPAPER);
  const errors = [];
  page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
  await page.goto(`${BASE}?groupBy=status&lastSeenUnreleased=current`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await openSettings(page);
  const desktop = await measure(page, "desktop-1280x800-appearance");
  desktop.pageErrors = errors;
  evidence.states.push(desktop);
  await page.screenshot({ path: `${OUT}desktop-dialog.png` });
  await page.close();
}

// ── The breakpoint itself: 768x1024 is the dialog branch again ────────────
{
  const page = await browser.newPage();
  await page.setViewport({ width: 768, height: 1024, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((stored) => {
    localStorage.setItem("focus-board:wallpaper", stored);
  }, STORED_WALLPAPER);
  await page.goto(`${BASE}?groupBy=status&lastSeenUnreleased=current`, { waitUntil: "networkidle0" });
  await sleep(1200);
  await openSettings(page);
  const tablet = await measure(page, "tablet-768x1024-appearance");
  evidence.states.push(tablet);
  await page.screenshot({ path: `${OUT}tablet-dialog.png` });
  await page.close();
}

// ── The contract ─────────────────────────────────────────────────────────
const [phone, desktop, tablet] = evidence.states;
const MIN_PANEL = 300; // the panel fills the sheet beside nothing
const violations = [];
if (phone.window.w !== 390) violations.push(`phone viewport is ${phone.window.w}x${phone.window.h}, not 390x844`);
if (phone.dialogRole !== "dialog") violations.push("compact settings did not render its dialog sheet");
// A strip, not a side rail: one row of tabs as wide as the sheet.
if (phone.rail.h > 56) {
  violations.push(`phone tab rail is ${phone.rail.h}px tall (stacked tabs, not a one-row strip)`);
}
if (phone.rail.w !== null && phone.body.box !== null && phone.rail.w < phone.body.box.w - 8) {
  violations.push(`phone tab strip is ${phone.rail.w}px wide inside a ${phone.body.box.w}px sheet`);
}
if (phone.tabpanel.box !== null && phone.tabpanel.box.w < MIN_PANEL) {
  violations.push(`phone Appearance panel is ${phone.tabpanel.box.w}px wide (< ${MIN_PANEL}px)`);
}
if (phone.body.inlineHeight !== null && phone.body.inlineHeight !== "" && phone.body.inlineHeight !== "auto") {
  violations.push(`phone settings body pins height ${phone.body.inlineHeight} inside a variable-height sheet`);
}
if (phone.picker.horizontalOverflow) {
  violations.push(`phone wallpaper picker overflows horizontally (scrollWidth ${phone.picker.scrollWidth} > clientWidth ${phone.picker.clientWidth}; offenders ${JSON.stringify(phone.pickerChildOffenders)})`);
}
if (phone.preview !== null && phone.picker.box !== null && phone.preview.w > phone.picker.box.w) {
  violations.push(`phone crop preview is ${phone.preview.w}px wide inside a ${phone.picker.box.w}px picker`);
}
// A body taller than the sheet is fine when the sheet itself scrolls; what
// is forbidden is a taller body with nowhere to scroll it.
if (phone.bodyTallerThanSheet === true && phone.sheetScroller.scrollHeight <= phone.sheetScroller.clientHeight + 1) {
  violations.push("phone settings body is taller than the sheet and the sheet does not scroll (content clipped)");
}
if (phone.reachAfterScroll !== null && phone.reachAfterScroll !== undefined) {
  if (phone.reachAfterScroll.sheetScrolls !== true) {
    violations.push("phone sheet is not scrollable after the compact stack");
  }
  for (const name of ["dim", "zoom"]) {
    const control = phone.reachAfterScroll[name];
    if (control.present !== true) violations.push(`phone ${name} slider is missing`);
    else if (control.w <= 0) violations.push(`phone ${name} slider has zero width`);
    else if (control.hit !== true) violations.push(`phone ${name} slider is not hit-testable after the sheet scrolls (${JSON.stringify(control)})`);
  }
}
if (phone.openverseGrid !== null && phone.openverseGrid.horizontalOverflow) {
  violations.push(`phone Openverse results overflow horizontally (${phone.openverseGrid.scrollWidth} > ${phone.openverseGrid.clientWidth})`);
}
if (evidence.drags.crop.dragged === true && evidence.drags.crop.changed !== true) {
  violations.push("dragging the phone crop preview changed no focus value");
}
if (evidence.drags.dim.dragged === true && evidence.drags.dim.before === evidence.drags.dim.after) {
  violations.push("dragging the phone Dim slider changed no value");
}
if (evidence.drags.zoom.dragged === true && evidence.drags.zoom.before === evidence.drags.zoom.after) {
  violations.push("dragging the phone Zoom slider changed no value");
}
if (desktop.body.inlineHeight !== "440px") {
  violations.push(`desktop settings body lost its 440px pin (${desktop.body.inlineHeight ?? desktop.body.computedHeight})`);
}
if (desktop.rail.w !== 160) violations.push(`desktop tab rail is ${desktop.rail.w}px, not 160px`);
if (tablet.rail.w !== 160) violations.push(`768px viewport lost the desktop rail (${tablet.rail.w}px)`);
if (tablet.body.inlineHeight !== "440px") {
  violations.push(`768px viewport lost the desktop body pin (${tablet.body.inlineHeight})`);
}

evidence.violations = violations;
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (violations.length > 0 || evidence.states.some((state) => (state.pageErrors ?? []).length > 0)) {
  process.exitCode = 1;
}
await browser.close();
