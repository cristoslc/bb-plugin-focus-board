// Frames and measurements for the Focus Board control in bb's own thread-page
// header (`app.slots.experimental_threadHeaderAction`, components/
// thread-header-actions.tsx), after the trigger stopped drawing a checkbox
// and became the plugin's mark plus a caret (operator, 2026-11-20).
//
// Surface, stated plainly: the repo's own Chrome harness
// (`scripts/screenshot`), which mounts the REAL app against the simulated
// host, on a `?page=thread-header` mount that puts the registered control
// inside a replica of bb's page-header content row (48px, right-aligned 28px
// controls, scripts/screenshot/mock-sdk.tsx). The control, its CSS and its
// behaviour are the shipped ones; the row around it is the replica. The live
// host page is not driven here: bb serves an installed bundle, so a candidate
// build reaches bb's own thread page only after a merge.
//
// It reads the trigger's box, its glyphs' rendered sizes and its ARIA, opens
// the menu, photographs both the unchecked and the checked (done) row, and
// repeats closed/open at phone width with a coarse pointer emulated, where the
// chrome box grows to 36px.
//
// Usage: LABEL=after node scripts/screenshot/probe-thread-header-trigger.mjs
// LABEL names the build under test ("before" = the checkbox trigger, captured
// by stashing the component change); artifacts land in
// docs/screenshots/thread-header-trigger/ and merge into its evidence.json.
// The harness loads the compiled dist/app.css, so run `npm run build` first —
// the probe does not build, and a stale stylesheet photographs the old control.
// Honors CHROME_PATH, PORT, and OUT_DIR.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import puppeteer from "puppeteer-core";
import { startHarness } from "../uat/harness.mjs";

const LABEL = process.env.LABEL ?? "after";
const PORT = Number(process.env.PORT ?? "5199");
const OUT_DIR = process.env.OUT_DIR ?? "docs/screenshots/thread-header-trigger";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT_DIR, { recursive: true });

/** The trigger, whichever build is under test: box, glyphs, ARIA. */
const MEASURE_TRIGGER = () => {
  const button = document.querySelector('[data-focus-board-thread-header-row] button');
  if (button === null) return { missing: "trigger" };
  const box = button.getBoundingClientRect();
  const glyphs = [...button.querySelectorAll("[data-icon-root]")].map((glyph) => {
    const rect = glyph.getBoundingClientRect();
    return {
      icon: glyph.getAttribute("data-icon"),
      painted: { w: Math.round(rect.width * 100) / 100, h: Math.round(rect.height * 100) / 100 },
      computed: getComputedStyle(glyph).width,
    };
  });
  const styles = getComputedStyle(button);
  return {
    name: button.getAttribute("aria-label"),
    title: button.getAttribute("title"),
    haspopup: button.getAttribute("aria-haspopup"),
    expanded: button.getAttribute("aria-expanded"),
    box: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.round(box.width * 100) / 100,
      h: Math.round(box.height * 100) / 100,
    },
    styles: {
      display: styles.display,
      gap: styles.gap,
      color: styles.color,
      radius: styles.borderRadius,
    },
    glyphs,
    checkboxPresent: button.querySelector('[data-icon="Checkbox"],[data-icon="CheckboxChecked"]') !== null,
  };
};

/** The open menu: box, shell parent, and one row per entry with its state. */
const MEASURE_MENU = () => {
  const menu = document.querySelector('[role="menu"]');
  if (menu === null) return { missing: "menu" };
  const box = menu.getBoundingClientRect();
  const rows = [...menu.querySelectorAll('[role="menuitem"],[role="menuitemradio"]')].map((row) => ({
    role: row.getAttribute("role"),
    label: (row.textContent ?? "").trim(),
    checked: row.getAttribute("aria-checked"),
    stateMark: row.querySelector('[data-icon="Check"].ml-auto') !== null,
  }));
  return {
    box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) },
    parent: menu.parentElement?.tagName ?? null,
    label: menu.getAttribute("aria-label"),
    rows,
  };
};

async function waitFor(page, selector, what) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const found = await page.evaluate((sel) => document.querySelector(sel) !== null, selector);
    if (found) return;
    await sleep(250);
  }
  throw new Error(`${what} never mounted (${selector})`);
}

/** The union of the trigger and (when open) the menu, padded and clamped. */
async function clip(page, name) {
  const region = await page.evaluate(() => {
    const trigger = document.querySelector('[data-focus-board-thread-header-row] button');
    if (trigger === null) return null;
    const t = trigger.getBoundingClientRect();
    const menu = document.querySelector('[role="menu"]');
    const m = menu === null ? null : menu.getBoundingClientRect();
    const left = Math.max(0, Math.min(t.x, m?.x ?? t.x) - 16);
    const bottom = Math.max(t.bottom, m?.bottom ?? t.bottom) + 16;
    return {
      x: left,
      y: 0,
      width: Math.min(window.innerWidth - left, Math.max(t.right, m?.right ?? t.right) - left + 16),
      height: bottom,
    };
  });
  if (region === null) throw new Error(`nothing to clip for ${name}`);
  await page.screenshot({ path: `${OUT_DIR}/${LABEL}-${name}.png`, clip: region });
  return region;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--window-size=1440,900", "--disable-gpu", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const harness = await startHarness(PORT);
const evidence = {
  label: LABEL,
  reported:
    "2026-11-20: the Focus Board menu in bb's thread header reads as a checkbox, which no longer carries its meaning",
  surface:
    "the repo's Chrome harness, ?page=thread-header: the real registered control on the real compiled CSS, inside a replica of bb's page-header content row (48px, right-aligned 28px controls). The live host page is not driven: bb serves the installed bundle, so a candidate build reaches bb's own thread page after a merge.",
  command: `LABEL=${LABEL} node scripts/screenshot/probe-thread-header-trigger.mjs`,
  frames: {},
};

const setTheme = (page, theme) =>
  page.evaluate((value) => {
    document.documentElement.classList.toggle("dark", value === "dark");
  }, theme);

/** One harness page at a theme and thread, with the control mounted. */
async function openPage({ theme, thread, viewport }) {
  const page = await browser.newPage();
  if (viewport !== undefined) await page.setViewport(viewport);
  await page.goto(`${harness.base}?page=thread-header&thread=${thread}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await waitFor(page, "[data-focus-board-thread-header-row] button", "the header control");
  await setTheme(page, theme);
  await sleep(600);
  return page;
}

const openMenu = async (page) => {
  await page.click("[data-focus-board-thread-header-row] button");
  await sleep(400);
};
const closeMenu = async (page) => {
  await page.keyboard.press("Escape");
  await sleep(300);
};

// ---------- Desktop: closed and open, both themes ----------
for (const theme of ["dark", "light"]) {
  const page = await openPage({ theme, thread: "thr_permissions" });
  const closed = await page.evaluate(MEASURE_TRIGGER);
  await clip(page, `closed-${theme}`);
  await openMenu(page);
  const open = { trigger: await page.evaluate(MEASURE_TRIGGER), menu: await page.evaluate(MEASURE_MENU) };
  await clip(page, `open-${theme}`);
  if (theme === "dark") {
    await page.screenshot({ path: `${OUT_DIR}/${LABEL}-open-page-dark.png` });
    evidence.desktop = { thread: "thr_permissions", closed, open };
  } else {
    evidence.desktopLight = { thread: "thr_permissions", closed, open };
  }
  await page.close();
}

// ---------- The done state: the menu's checked first row ----------
{
  const page = await openPage({ theme: "dark", thread: "thr_license" });
  await openMenu(page);
  evidence.doneThread = {
    thread: "thr_license",
    trigger: await page.evaluate(MEASURE_TRIGGER),
    menu: await page.evaluate(MEASURE_MENU),
  };
  await clip(page, "open-done-dark");
  await page.close();
}

// ---------- Phone width, coarse pointer: the 36px box ----------
{
  const page = await openPage({
    theme: "dark",
    thread: "thr_permissions",
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
  evidence.coarse = {
    media: await page.evaluate(() => ({
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
      maxMd: window.matchMedia("(max-width: 767px)").matches,
      width: window.innerWidth,
    })),
  };
  evidence.coarse.closed = await page.evaluate(MEASURE_TRIGGER);
  await clip(page, "coarse-closed");
  await openMenu(page);
  evidence.coarse.open = { trigger: await page.evaluate(MEASURE_TRIGGER), menu: await page.evaluate(MEASURE_MENU) };
  await clip(page, "coarse-open");
  await page.screenshot({ path: `${OUT_DIR}/${LABEL}-coarse-open-page.png` });
  await page.close();
}

await browser.close();
harness.child.kill();

// Merge into the folder's one evidence.json: the two labels describe the same
// control before and after, so they share a file.
const evidencePath = `${OUT_DIR}/evidence.json`;
let merged = {};
try {
  merged = JSON.parse(readFileSync(evidencePath, "utf8"));
} catch {
  merged = { reported: evidence.reported, surface: evidence.surface, runs: {} };
}
merged.reported = evidence.reported;
merged.surface = evidence.surface;
merged.runs = { ...(merged.runs ?? {}), [LABEL]: { ...evidence, label: undefined, frames: undefined } };
writeFileSync(evidencePath, JSON.stringify(merged, null, 2));
console.log(`frames + evidence for "${LABEL}" in ${OUT_DIR}`);
