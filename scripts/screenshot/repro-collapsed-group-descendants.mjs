// Verification for issue #321: the folded feature-group card paints the
// parent card's dot grid two generations deep.
//
// Opens `?descgroup=1&collapsedGroups=grp_desc`, whose board carries one
// feature group of two members: the first a family root with two children and
// three grandchildren (data.ts SIM_DESC_GROUP_THREADS), the second childless.
// The folded card's grid is measured in real geometry (the three glyph tiers'
// rendered sizes, so "the smallest still distinguishable" is a number, not a
// claim), the count chip is checked against the dots it claims, and the dot's
// own gestures are driven for real: a grandchild dot opens that thread's pane
// and leaves the box folded, the strip's background expands the box.
//
// Exits non-zero on any violation. Artifacts land in
// docs/screenshots/repro-collapsed-group-descendants/ (`card-dark.png`,
// `card-light.png`, `board.png`, `expanded.png`, `evidence.json`).
//
// Run the vite harness first (see scripts/screenshot/README.md), then
//   HARNESS_URL=http://localhost:5173/ node scripts/screenshot/repro-collapsed-group-descendants.mjs
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR.
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT =
  process.env.OUT_DIR ?? "docs/screenshots/repro-collapsed-group-descendants";
const GROUP = "grp_desc";
const QUERY = `?descgroup=1&collapsedGroups=${GROUP}`;

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 3 });

const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
  return ok;
};

await page.goto(`${BASE}${QUERY}`, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForSelector(`[data-collapsed-group="${GROUP}"]`, { timeout: 60_000 });
// Let the fold's arrival and the first pulse frame settle before measuring.
await new Promise((resolve) => setTimeout(resolve, 800));

/** The grid's census: chip figures, dots per tier, and the glyph geometry. */
async function census() {
  return page.evaluate((groupId) => {
    const card = document.querySelector(`[data-collapsed-group="${groupId}"]`);
    if (card === null) return { error: "missing folded card" };
    const glyphs = (tier) =>
      [...card.querySelectorAll(`[data-collapsed-group-dot-tier="${tier}"]`)];
    const rect = (el) => {
      const box = el.getBoundingClientRect();
      return { width: box.width, height: box.height };
    };
    const tiers = {
      member: glyphs("member"),
      child: glyphs("child"),
      grandchild: glyphs("grandchild"),
    };
    const chip = card.querySelector(`[data-collapsed-group-count="${groupId}"]`);
    const nestedChip = card.querySelector(
      `[data-collapsed-group-nested-count="${groupId}"]`,
    );
    const strip = card.querySelector(`[data-collapsed-group-dots="${groupId}"]`);
    const cardRect = card.getBoundingClientRect();
    const stripRect = strip?.getBoundingClientRect() ?? null;
    return {
      chip: chip?.textContent?.trim() ?? null,
      nestedChip: nestedChip?.textContent?.trim() ?? null,
      order: [...card.querySelectorAll("[data-collapsed-group-dot]")].map((dot) =>
        dot.getAttribute("data-collapsed-group-dot"),
      ),
      sizes: Object.fromEntries(
        Object.entries(tiers).map(([tier, els]) => [
          tier,
          {
            count: els.length,
            rect: els[0] === undefined ? null : rect(els[0]),
            colors: els.map((el) => getComputedStyle(el).backgroundColor),
            pulsing: els.filter((el) => el.hasAttribute("data-dot-pulse")).length,
            animating: els.filter(
              (el) => getComputedStyle(el).animationName !== "none",
            ).length,
            titles: els.map((el) => el.getAttribute("title")),
          },
        ]),
      ),
      stripWidth: stripRect === null ? null : stripRect.width,
      cardWidth: cardRect.width,
      cardHeight: cardRect.height,
      stripFitsCard:
        stripRect !== null && stripRect.right <= cardRect.right + 0.5,
      chipFigures: [
        ...(chip?.textContent?.trim().match(/\d+/g) ?? []),
        ...(nestedChip?.textContent?.trim().match(/\d+/g) ?? []),
      ].map(Number),
    };
  }, GROUP);
}

const folded = await census();
if (folded.error !== undefined) throw new Error(folded.error);

// 1. Three tiers, in family order: the root, its children with their own
//    children under them, then the childless member's lone dot.
check(
  JSON.stringify(folded.order) ===
    JSON.stringify([
      "thr_desc_root",
      "thr_desc_c1",
      "thr_desc_c1_a",
      "thr_desc_c1_b",
      "thr_desc_c2",
      "thr_desc_c2_a",
      "thr_desc_solo",
    ]),
  `dot order is ${JSON.stringify(folded.order)}`,
);

// 2. The generations render at three distinct sizes, the smallest still a
//    real dot (>= 2px on the shipped stylesheet).
const sizes = folded.sizes;
check(sizes.member.count === 2, `member tier paints ${sizes.member.count} dots`);
check(sizes.child.count === 2, `child tier paints ${sizes.child.count} dots`);
check(sizes.grandchild.count === 3, `grandchild tier paints ${sizes.grandchild.count} dots`);
check(
  sizes.member.rect.width > sizes.child.rect.width &&
    sizes.child.rect.width > sizes.grandchild.rect.width,
  `tier sizes are not strictly descending: ${JSON.stringify({
    member: sizes.member.rect,
    child: sizes.child.rect,
    grandchild: sizes.grandchild.rect,
  })}`,
);
check(
  sizes.grandchild.rect.width >= 2,
  `the smallest tier is ${sizes.grandchild.rect.width}px, below the 2px floor`,
);

// 3. The counts and the dots agree in the stated form: the header chip names
//    the leading tier, the strip's tail names every deeper dot, and the two
//    figures sum to the dots painted.
const [members, nested] = folded.chipFigures;
const total = folded.order.length;
check(
  members === sizes.member.count,
  `chip's member figure ${members} != ${sizes.member.count} leading dots`,
);
check(
  nested === sizes.child.count + sizes.grandchild.count,
  `chip's nested figure ${nested} != ${sizes.child.count + sizes.grandchild.count} deeper dots`,
);
check(members + nested === total, `chip figures ${members}+${nested} != ${total} dots`);

// 4. Behaviour parity: the working descendants breathe at measured rates,
//    every dot previews its thread with its state label, and the idle dot
//    reads quiet.
check(sizes.member.pulsing === 1, `member pulses: ${sizes.member.pulsing}/1 (the root works, the solo member is unread)`);
check(sizes.child.pulsing === 1, `child tier pulses: ${sizes.child.pulsing}/1`);
check(sizes.grandchild.pulsing === 1, `grandchild pulses: ${sizes.grandchild.pulsing}/1`);
check(
  sizes.grandchild.titles.every((title) => title !== null && title.includes(" · ")),
  `a grandchild dot is missing its state preview: ${JSON.stringify(sizes.grandchild.titles)}`,
);
const idleDot = sizes.grandchild.colors.findIndex((color) => color.includes("0.3"));
check(idleDot !== -1, `no quiet idle colour on the grandchild tier: ${JSON.stringify(sizes.grandchild.colors)}`);

// 5. The grid stays inside the card (a wide grid wraps, never clips).
check(folded.stripFitsCard, "the dot strip paints past the folded card's right edge");

// Artifacts: the folded card per theme, then the board.
const card = await page.$(`[data-collapsed-group-card="${GROUP}"]`);
if (card === null) throw new Error("missing folded card body");
await card.screenshot({ path: `${OUT}/card-dark.png` });
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await new Promise((resolve) => setTimeout(resolve, 200));
await card.screenshot({ path: `${OUT}/card-light.png` });
await page.screenshot({ path: `${OUT}/board.png` });

// 6. A dot click opens its own thread and leaves the box folded.
await page.click('[data-collapsed-group-dot-button="thr_desc_c1_a"]');
await page.waitForSelector('aside[role="complementary"]', { timeout: 10_000 });
const afterDotClick = await page.evaluate((groupId) => ({
  pane: document
    .querySelector('aside[role="complementary"]')
    ?.getAttribute("aria-label"),
  folded: document.querySelector(`[data-collapsed-group="${groupId}"]`) !== null,
}), GROUP);
check(
  afterDotClick.folded,
  "clicking a descendant dot unfolded the group instead of only opening the thread",
);

// 7. The strip's background still expands the group.
await page.evaluate((groupId) => {
  document
    .querySelector(`[data-collapsed-group-dots="${groupId}"]`)
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}, GROUP);
await new Promise((resolve) => setTimeout(resolve, 500));
const expanded = await page.evaluate((groupId) => ({
  folded: document.querySelector(`[data-collapsed-group="${groupId}"]`) !== null,
  members: document.querySelectorAll(`[data-group-box-member="${groupId}"]`).length,
}), GROUP);
check(!expanded.folded, "the strip's background click left the group folded");
check(expanded.members === 2, `expanded box renders ${expanded.members}/2 member cards`);
await page.screenshot({ path: `${OUT}/expanded.png` });

const evidence = {
  query: QUERY,
  viewport: { width: 1400, height: 900, deviceScaleFactor: 3 },
  folded,
  afterDotClick,
  expanded,
  problems,
  checkedAt: new Date().toISOString(),
};
writeFileSync(`${OUT}/evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);

await browser.close();

console.log(JSON.stringify({ chip: folded.chip, sizes: Object.fromEntries(
  Object.entries(folded.sizes).map(([tier, data]) => [tier, data.rect]),
), problems }, null, 2));
if (problems.length > 0) process.exitCode = 1;
