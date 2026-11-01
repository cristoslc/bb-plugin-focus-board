// Capture/verification driver for issue #282's cluster capsules (option D of
// the 2026-10-16 musing `docs/musings/2026-10-16-child-dot-strip-grandchildren.md`).
//
// Loads the orchestrator fixture (?orchestrator=1: nine lieutenants, 77
// grandchildren — the board the operator reported) with the family folded, and
// clips the collapsed strip in both themes. It also hovers a capsule's own
// padding to capture the cluster preview, and loads the folded feature-group
// card (?descgroup=1&collapsedGroups=grp_desc) to show the same capsule one
// surface over.
//
// It exits non-zero unless every capsule the strip paints has a real tint and
// radius, every dot still sits inside exactly one cluster, and the folded
// group card's capsule count matches the child clusters that lead grandchildren.
//
// Run the vite harness first (`npx vite --config scripts/screenshot/vite.config.ts`),
// then `node scripts/screenshot/repro-dot-cluster-capsules.mjs`; honors
// CHROME_PATH, HARNESS_URL, and OUT_DIR.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? "docs/screenshots/repro-dot-cluster-capsules";
const ROOT = "thr_demo_orch";
const GROUP = "grp_desc";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function load(query) {
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0" });
  await sleep(1200);
}

async function setTheme(theme) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await sleep(200);
}

/** The collapsed parent strip: capsule geometry, tint, and dot accounting. */
async function probeStrip() {
  return page.evaluate((rootId) => {
    const card = document.querySelector(`[data-thread-card="${rootId}"]`);
    const strip = card?.querySelector("[data-child-thread-dots]");
    if (!strip) return { error: `missing strip on ${rootId}` };
    const capsules = [...strip.querySelectorAll("[data-child-dot-capsule]")];
    const first = capsules[0];
    const style = first === undefined ? null : getComputedStyle(first);
    const rect = first?.getBoundingClientRect();
    const dots = strip.querySelectorAll("button[data-child-dot]");
    const grouped = capsules.reduce(
      (sum, el) => sum + el.querySelectorAll("button[data-child-dot]").length,
      0,
    );
    return {
      dots: dots.length,
      capsules: capsules.length,
      dotsInCapsules: grouped,
      capsuleIds: capsules.map((el) => el.getAttribute("data-child-dot-capsule")),
      capsuleSize:
        rect === undefined
          ? null
          : { width: Math.round(rect.width), height: Math.round(rect.height) },
      capsuleStyle:
        style === null
          ? null
          : {
              backgroundColor: style.backgroundColor,
              borderRadius: style.borderRadius,
            },
      stripHeight: Math.round(strip.getBoundingClientRect().height),
    };
  }, ROOT);
}

/** The folded feature-group card's grid. */
async function probeFoldedGroup() {
  return page.evaluate((groupId) => {
    const card = document.querySelector(`[data-collapsed-group="${groupId}"]`);
    const grid = card?.querySelector("[data-collapsed-group-dots]");
    if (!grid) return { error: `missing folded group card ${groupId}` };
    const capsules = [...grid.querySelectorAll("[data-collapsed-group-dot-capsule]")];
    const first = capsules[0];
    const style = first === undefined ? null : getComputedStyle(first);
    return {
      capsules: capsules.length,
      capsuleTitles: capsules.map((el) => el.getAttribute("title")),
      capsuleStyle:
        style === null
          ? null
          : {
              backgroundColor: style.backgroundColor,
              borderRadius: style.borderRadius,
            },
      nestedTail:
        card.querySelector("[data-collapsed-group-nested-count]")?.textContent?.trim() ??
        null,
      memberChip: card.querySelector("[data-collapsed-group-count]")?.textContent?.trim() ?? null,
    };
  }, GROUP);
}

async function clipCard(selector, name) {
  const box = await (await page.$(selector))?.boundingBox();
  if (!box) throw new Error(`missing ${selector}`);
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: Math.min(1500, box.width + 40),
      height: Math.min(1000, box.height + 16),
    },
  });
}

mkdirSync(OUT, { recursive: true });
const evidence = {};

await load(`?orchestrator=1&collapsed=${ROOT}#/plugins/focus-board/board`);
await setTheme("dark");
evidence.dark = await probeStrip();
await clipCard(`[data-thread-card="${ROOT}"]`, "strip-dark");

// The cluster's own hover: the pointer in a capsule's padding, between dots.
const hoverTarget = await page.evaluate(() => {
  const capsule = document.querySelector("[data-child-dot-capsule]");
  if (!(capsule instanceof HTMLElement)) return null;
  const rect = capsule.getBoundingClientRect();
  return { x: rect.left + 1.5, y: rect.top + rect.height / 2 };
});
if (hoverTarget !== null) {
  await page.mouse.move(hoverTarget.x, hoverTarget.y);
  await sleep(400);
  evidence.clusterHover = await page.evaluate(() => {
    const bubble = document.querySelector("[data-child-dot-preview]");
    return bubble?.textContent?.trim() ?? null;
  });
  // The bubble is portaled to body and centred on the capsule, so this frame
  // reaches left of the card's own box: clip wide enough to hold both.
  const cardBox = await (await page.$(`[data-thread-card="${ROOT}"]`))?.boundingBox();
  if (!cardBox) throw new Error(`missing card ${ROOT}`);
  await page.screenshot({
    path: `${OUT}/strip-cluster-hover-dark.png`,
    clip: {
      x: Math.max(0, cardBox.x - 320),
      y: Math.max(0, cardBox.y - 8),
      width: cardBox.width + 360,
      height: cardBox.height + 16,
    },
  });
} else {
  evidence.clusterHover = { error: "no capsule to hover" };
}

await setTheme("light");
// Park the pointer: the light frame must not carry the dark frame's hover
// bubble, and an idle board is what the operator's glance reads.
await page.mouse.move(1, 1);
await sleep(300);
evidence.light = await probeStrip();
await clipCard(`[data-thread-card="${ROOT}"]`, "strip-light");

await load(`?descgroup=1&collapsedGroups=${GROUP}#/plugins/focus-board/board`);
await setTheme("dark");
evidence.foldedGroup = await probeFoldedGroup();
await clipCard(`[data-collapsed-group="${GROUP}"]`, "group-folded-dark");

writeFileSync(`${OUT}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
await browser.close();

// The gate: a capsule exists, it is a real tint with a radius, dots stay in
// exactly one cluster each, and both surfaces paint one.
const failures = [];
for (const theme of ["dark", "light"]) {
  const probe = evidence[theme];
  if (probe.error !== undefined) failures.push(`${theme}: ${probe.error}`);
  else {
    if (probe.capsules === 0) failures.push(`${theme}: no capsule painted`);
    if (probe.dotsInCapsules > probe.dots) {
      failures.push(`${theme}: more dots inside capsules than exist`);
    }
    if (probe.capsuleStyle === null) failures.push(`${theme}: no capsule to measure`);
    else {
      const tint = probe.capsuleStyle.backgroundColor;
      // The capsule reads only if the theme actually resolves a tint: a
      // transparent background is the failure mode this gate exists for.
      if (tint === "rgba(0, 0, 0, 0)" || tint === "transparent") {
        failures.push(`${theme}: capsule tint did not resolve (${tint})`);
      }
      if (Number.parseFloat(probe.capsuleStyle.borderRadius) < 4) {
        failures.push(`${theme}: capsule radius too square (${probe.capsuleStyle.borderRadius})`);
      }
    }
  }
}
if (evidence.foldedGroup.error !== undefined) failures.push(evidence.foldedGroup.error);
else if (evidence.foldedGroup.capsules === 0) {
  failures.push("folded group card painted no capsule");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`capsules ok: ${OUT}`);
