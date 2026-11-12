// Rest-vs-hover evidence for the lane name+caret trigger's hover tone (the
// operator's stronger-hover ruling, dec_9yke6uqevbqt; the pair landed in PRs
// #394/#395 carrying the dropdown chips' `hover:bg-accent`).
//
// Frames, per theme, in docs/screenshots/lane-name-hover/:
//   rest-<theme>.png  — pointer parked in the bottom corner of the board
//   hover-<theme>.png — pointer parked ON the name+caret pair
//   pair-<theme>.png  — the two stacked, captioned, so the difference reads at
//                       a glance (the pair is the frame the ruling asked for)
// plus evidence.json: the trigger's pinned class set, its settled computed
// background and caret tone at rest and on hover, and the contrast each
// candidate fill scores against the canvas (the numbers behind the pick).
//
// Exits 1 when the hover read regresses: the fill is no longer bb's
// interactive-state step, or the caret no longer reaches full ink.
//
// Usage: start the harness server first —
//   npx vite --config scripts/screenshot/vite.config.ts --port 5231 --strictPort
// then `node scripts/screenshot/repro-lane-name-hover-tone.mjs`.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5231/";
const OUT = new URL("../../docs/screenshots/lane-name-hover/", import.meta.url).pathname;
const TRIGGER = 'section[data-column-id="unread"] header button[data-lane-menu-trigger]';
const THEMES = ["dark", "light"];

/** WCAG relative luminance of an sRGB triple. */
function luminance([r, g, b]) {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

function composite({ rgb, alpha }, backdrop) {
  return rgb.map((channel, i) => Math.round(channel * alpha + backdrop[i] * (1 - alpha)));
}

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
});
page.on("response", (response) => {
  if (response.status() === 404) errors.push(`[404] ${response.url()}`);
});

await page.goto(`${BASE}?groupBy=status`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
await new Promise((resolve) => setTimeout(resolve, 700));

/** Resolve a theme token to sRGB by painting it (canvas round-trips color-mix). */
async function readTokens(names) {
  return page.evaluate((tokenNames) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const probe = document.createElement("div");
    document.body.append(probe);
    const out = {};
    for (const name of tokenNames) {
      probe.style.backgroundColor = `var(${name})`;
      const resolved = getComputedStyle(probe).backgroundColor;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = resolved;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      out[name] = { resolved, rgb: [r, g, b], alpha: Number((a / 255).toFixed(3)) };
    }
    probe.remove();
    return out;
  }, names);
}

/** The lane header's own strip, a hair wider than the lane, as a clip box. */
async function headerClip() {
  return page.evaluate((selector) => {
    const trigger = document.querySelector(selector);
    if (trigger === null) throw new Error(`no trigger at ${selector}`);
    const section = trigger.closest("section");
    if (section === null) throw new Error("the trigger left its lane");
    const s = section.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    return {
      x: Math.round(s.left) - 6,
      y: Math.round(s.top) - 4,
      width: Math.round(s.width) + 12,
      height: Math.round(t.bottom - s.top) + 10,
    };
  }, TRIGGER);
}

/** The trigger's settled styles, at rest or under the parked pointer. */
async function readTrigger() {
  return page.evaluate((selector) => {
    const trigger = document.querySelector(selector);
    if (trigger === null) return null;
    const style = getComputedStyle(trigger);
    const caret = trigger.querySelector("svg");
    return {
      classes: trigger.className,
      background: style.backgroundColor,
      color: style.color,
      cursor: style.cursor,
      caret: caret === null ? null : getComputedStyle(caret).color,
      caretClasses: caret?.getAttribute("class") ?? null,
      ariaExpanded: trigger.getAttribute("aria-expanded"),
      ariaLabel: trigger.getAttribute("aria-label"),
    };
  }, TRIGGER);
}

const rest = async () => {
  await page.mouse.move(4, 796);
  await new Promise((resolve) => setTimeout(resolve, 250));
};
const park = async () => {
  await page.hover(TRIGGER);
  await new Promise((resolve) => setTimeout(resolve, 350));
};

/** Stack the two clipped frames with captions on one page and shoot it. */
async function stackPair(theme, clip) {
  const read = async (path) =>
    `data:image/png;base64,${(await readFile(path)).toString("base64")}`;
  const restSrc = await read(`${OUT}rest-${theme}.png`);
  const hoverSrc = await read(`${OUT}hover-${theme}.png`);
  const label = theme === "dark" ? "dark theme" : "light theme";
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: clip.width * 2, height: clip.height * 2 * 2 + 96, deviceScaleFactor: 2 });
  await sheet.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;background:#000;color:#9a9a9a;
      font:500 11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
    body{padding:8px}
    figure{margin:0 0 4px}
    figcaption{padding:2px 0 4px}
    img{display:block;width:${clip.width * 2}px}
  </style></head><body>
    <figure><figcaption>${label} — rest (pointer off the pair)</figcaption>
      <img src="${restSrc}"></figure>
    <figure><figcaption>${label} — hover (pointer parked on the pair)</figcaption>
      <img src="${hoverSrc}"></figure>
  </body></html>`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const body = await sheet.$("body");
  await body.screenshot({ path: `${OUT}pair-${theme}.png` });
  await sheet.close();
}

const report = { ruling: "dec_9yke6uqevbqt", url: BASE, themes: {}, fills: {}, errors };
const failures = [];

for (const theme of THEMES) {
  await page.evaluate((next) => {
    document.documentElement.classList.toggle("dark", next === "dark");
  }, theme);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const tokens = await readTokens([
    "--canvas",
    "--ink",
    "--muted-foreground",
    "--accent",
    "--muted",
    "--state-hover",
    "--state-active",
  ]);
  const canvas = tokens["--canvas"].rgb;
  report.fills[theme] = Object.fromEntries(
    ["--accent", "--muted", "--state-hover", "--state-active"].map((token) => {
      const fill = composite(tokens[token], canvas);
      return [token, { fill, vsCanvas: contrast(fill, canvas), resolved: tokens[token].resolved }];
    }),
  );
  const clip = await headerClip();
  await rest();
  const restore = await readTrigger();
  await page.screenshot({ path: `${OUT}rest-${theme}.png`, clip });

  await park();
  const hover = await readTrigger();
  await page.screenshot({ path: `${OUT}hover-${theme}.png`, clip });

  report.themes[theme] = { clip, rest: restore, hover };
  await stackPair(theme, clip);

  // The shipped read: bb's interactive-state fill on hover, and a caret that
  // reaches full ink (the rest tone is muted-foreground at 60%).
  const hoverFill = /oklab\(([^)]*)\)/.exec(hover.background) ?? [];
  const alpha = Number(hoverFill[1]?.split("/")[1]?.trim() ?? "1");
  const stateActiveAlpha = tokens["--state-active"].alpha;
  if (Math.abs(alpha - stateActiveAlpha) > 0.01) {
    failures.push(
      `${theme}: hover fill alpha ${alpha} is not the state-active step ${stateActiveAlpha} (${hover.background})`,
    );
  }
  if (!hover.classes.includes("hover:bg-state-active")) {
    failures.push(`${theme}: the trigger lost hover:bg-state-active`);
  }
  if (hover.classes.includes("hover:bg-accent")) {
    failures.push(`${theme}: the trigger still carries the chips' hover:bg-accent`);
  }
  if (hover.caret !== tokens["--ink"].resolved) {
    failures.push(
      `${theme}: the caret did not lift to full ink (${hover.caret} vs ${tokens["--ink"].resolved})`,
    );
  }
  if (restore.caretClasses?.includes("text-muted-foreground/60") !== true) {
    failures.push(`${theme}: the caret's rest tone left muted-foreground/60 (${restore.caretClasses})`);
  }
  if (restore.background !== "rgba(0, 0, 0, 0)") {
    failures.push(`${theme}: the trigger paints at rest (${restore.background}) — rest must not change`);
  }
  if (restore.cursor !== "pointer" || hover.cursor !== "pointer") {
    failures.push(`${theme}: the pointer cursor is gone (${restore.cursor} / ${hover.cursor})`);
  }
  if (restore.ariaLabel !== hover.ariaLabel || hover.ariaExpanded !== "false") {
    failures.push(`${theme}: the trigger's aria semantics moved`);
  }
}

await writeFile(`${OUT}/evidence.json`, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

console.log(JSON.stringify(report.fills, null, 2));
if (failures.length > 0) {
  console.error(`\nFAILED:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`\nframes + evidence.json written to ${OUT}`);
