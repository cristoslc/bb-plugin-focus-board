/**
 * Chip placement repro/verification for issue #104: the card's three chip
 * regions — issues first row left within the midpoint + gutter cap, PRs first
 * row right (bumped only when the issues claim the room), tags bottom-right
 * and right-anchored.
 *
 * Loads the demo board (`?demo=1`, the fixture cards `thr_chip_*`), measures
 * each card's chip area in real Chrome, and exits non-zero when a clause of
 * the placement contract is violated. Every card is shot in both themes.
 *
 * The "before" pass (the pre-#104 layout) is preserved by running the script
 * with the component reverted and `OUT_PREFIX=before`; it is expected to fail
 * the assertions, which is the reproduction.
 *
 * Run once vite is up (`npx vite --config scripts/screenshot/vite.config.ts`),
 * then `node scripts/screenshot/repro-chip-placement.mjs`. Honors CHROME_PATH,
 * HARNESS_URL, OUT_DIR, and OUT_PREFIX.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-chip-placement/", import.meta.url).pathname;
const PREFIX = process.env.OUT_PREFIX ?? "after";

/**
 * Each card, with the clauses it must satisfy:
 * - `cap: "midpoint"` — the issues region stays inside the midpoint + gutter.
 * - `cap: "full"` — a lone ticket name may claim the whole row.
 * - `prBumped` — the pulls region sits below the issues region, still right.
 * - `tagsUnderPr` — the tag block sits below the PRs block.
 * - `tagsSameRow` — with no PR the tag block rides row one's right end.
 * - `shrinks` — the lone long id scaled its text below the 10px base.
 */
const CARDS = [
  {
    id: "thr_chip_typical",
    label: "one short issue + one PR + a tag",
    cap: "full",
    hasPulls: true,
    tagsUnderPr: true,
    prBumped: false,
  },
  {
    id: "thr_chip_cluster",
    label: "two short issues + a PR",
    cap: "midpoint",
    hasPulls: true,
    prBumped: false,
  },
  {
    id: "thr_chip_wrap",
    label: "a long id list held to the midpoint cap",
    cap: "midpoint",
    hasPulls: true,
    prBumped: false,
  },
  {
    id: "thr_chip_long",
    label: "one long external ticket bumps the PR down",
    cap: "full",
    hasPulls: true,
    prBumped: true,
  },
  {
    id: "thr_chip_shrink",
    label: "one very long id scales to fit, never breaks",
    cap: "full",
    hasPulls: false,
    shrinks: true,
  },
  {
    id: "thr_chip_tags",
    label: "a PR with a long hyphenated tag under it",
    cap: "midpoint",
    hasPulls: true,
    tagsUnderPr: true,
    prBumped: false,
  },
  {
    id: "thr_chip_tag_row",
    label: "with no PR a tag rides the first row's right end",
    cap: "full",
    hasPulls: false,
    tagsSameRow: true,
  },
];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 480, height: 1100, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.goto(`${BASE}?demo=1&groupBy=status`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
await new Promise((resolve) => setTimeout(resolve, 900));

const measure = (cardId) => {
  const card = document.querySelector(`[data-thread-card="${cardId}"]`);
  if (card === null) return { ok: false, reason: "card missing" };
  const area = card.querySelector("[data-ticket-chip-area]");
  if (area === null) return { ok: false, reason: "chip area missing" };
  const areaRect = area.getBoundingClientRect();
  const cs = getComputedStyle(area);
  const padL = Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.borderLeftWidth);
  const padR = Number.parseFloat(cs.paddingRight) + Number.parseFloat(cs.borderRightWidth);
  const contentLeft = areaRect.left + padL;
  const contentRight = areaRect.right - padR;
  const contentWidth = contentRight - contentLeft;
  const midpoint = contentLeft + contentWidth / 2;
  const region = (name) => card.querySelector(`[data-ticket-chip-region="${name}"]`);
  const box = (el) => {
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Number(r.left.toFixed(2)),
      right: Number(r.right.toFixed(2)),
      top: Number(r.top.toFixed(2)),
      bottom: Number(r.bottom.toFixed(2)),
      width: Number(r.width.toFixed(2)),
      height: Number(r.height.toFixed(2)),
    };
  };
  const ids = Array.from(card.querySelectorAll("[data-ticket-id]"))
    .filter((el) => el.closest("[data-ticket-tag]") === null)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: el.getAttribute("aria-label") ?? el.textContent,
        width: Number(r.width.toFixed(2)),
        height: Number(r.height.toFixed(2)),
        fontSize: getComputedStyle(el).fontSize,
        nowrap: (getComputedStyle(el).whiteSpace ?? "").includes("nowrap"),
      };
    });
  const tagIds = Array.from(card.querySelectorAll("[data-ticket-tag] [data-ticket-id]")).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: el.textContent,
      width: Number(r.width.toFixed(2)),
      height: Number(r.height.toFixed(2)),
      fontSize: getComputedStyle(el).fontSize,
      lines: el.getClientRects().length,
    };
  });
  const idsFlow = card.querySelector("[data-ticket-ids]");
  return {
    ok: true,
    area: { left: Number(contentLeft.toFixed(2)), right: Number(contentRight.toFixed(2)), width: Number(contentWidth.toFixed(2)) },
    midpoint: Number(midpoint.toFixed(2)),
    issues: box(region("issues")),
    pulls: box(region("pulls")),
    tags: box(region("tags")),
    ids,
    idsFontSize: idsFlow === null ? null : getComputedStyle(idsFlow).fontSize,
    tagIds,
  };
};

const themes = ["dark", "light"];
const results = [];
let violations = 0;

for (const spec of CARDS) {
  for (const theme of themes) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const handle = await page.waitForSelector(`[data-thread-card="${spec.id}"]`, { timeout: 10_000 });
    await handle.screenshot({ path: `${OUT}${PREFIX}-${spec.id}-${theme}.png`, timeout: 15_000 });
  }
}

// Measure once per card in the dark theme (geometry is theme-independent).
await page.evaluate(() => {
  document.documentElement.classList.add("dark");
});
await new Promise((resolve) => setTimeout(resolve, 250));

for (const spec of CARDS) {
  const got = await page.evaluate(measure, spec.id);
  const problems = [];
  if (got.ok !== true) {
    problems.push(got.reason);
  } else {
    // Every ticket id keeps its own single line, and never breaks mid-token.
    for (const id of got.ids) {
      if (id.height > 18) problems.push(`id ${JSON.stringify(id.text)} spans ${id.height}px (wrapped)`);
      if (!id.nowrap) problems.push(`id ${JSON.stringify(id.text)} is not nowrap`);
    }
    // A tag never shrinks its text, and a tag with no hyphen stays one line.
    for (const tag of got.tagIds) {
      if (Number.parseFloat(tag.fontSize) < 9.9) {
        problems.push(`tag ${JSON.stringify(tag.text)} shrank to ${tag.fontSize}`);
      }
      if (!tag.text.includes("-") && tag.lines > 1) {
        problems.push(`tag ${JSON.stringify(tag.text)} broke without a hyphen to break at`);
      }
    }
    // The issues region's cap.
    if (spec.cap === "midpoint") {
      if (got.issues === null) problems.push("missing issues region");
      else if (got.issues.right > got.midpoint + 1) {
        problems.push(`issues region crosses the midpoint (${got.issues.right} > ${got.midpoint})`);
      }
    } else if (got.issues !== null && got.issues.right > got.area.right + 1) {
      problems.push(`issues region overruns the row (${got.issues.right} > ${got.area.right})`);
    }
    // The PR region always ends at the row's right edge.
    if (spec.hasPulls) {
      if (got.pulls === null) problems.push("missing pulls region");
      else if (got.pulls.right < got.area.right - 2) {
        problems.push(`pulls region not right-anchored (${got.pulls.right} < ${got.area.right})`);
      }
    }
    // The PR bumps only when the issues claim the room.
    if (spec.prBumped !== undefined && got.pulls !== null && got.issues !== null) {
      const bumped = got.pulls.top > got.issues.top + 2;
      if (bumped !== spec.prBumped) {
        problems.push(`PR ${bumped ? "was" : "was not"} bumped to the next row`);
      }
    }
    // The tag block: right-anchored, ≤75%, under the PR when there is one.
    if (got.tags !== null) {
      if (got.tags.right < got.area.right - 2) {
        problems.push(`tag block not right-anchored (${got.tags.right} < ${got.area.right})`);
      }
      if (got.tags.width > got.area.width * 0.75 + 1) {
        problems.push(`tag block ${got.tags.width}px exceeds 75% of the row (${got.area.width}px)`);
      }
      if (spec.tagsUnderPr === true && got.pulls !== null && got.tags.top < got.pulls.bottom - 1) {
        problems.push("tag block is not below the PR block");
      }
      if (spec.tagsSameRow === true && got.issues !== null && Math.abs(got.tags.top - got.issues.top) > 2) {
        problems.push("tag block did not ride the first row");
      }
    } else if (spec.tagsUnderPr === true) {
      problems.push("missing tags region");
    }
    // The shrink case: the lone long id scaled below the 10px base.
    if (spec.shrinks === true) {
      const font = Number.parseFloat(got.idsFontSize ?? "10");
      if (!(font < 9.9)) problems.push(`long id did not scale (font-size ${got.idsFontSize})`);
    }
  }
  if (problems.length > 0) violations += 1;
  results.push({ card: spec.id, label: spec.label, problems, measurements: got });
  console.log(`${problems.length === 0 ? "PASS" : "FAIL"} ${spec.id} — ${spec.label}`);
  for (const problem of problems) console.log(`  · ${problem}`);
}

writeFileSync(`${OUT}${PREFIX}-evidence.json`, JSON.stringify({ prefix: PREFIX, results }, null, 2));
await browser.close();
console.log(`\n${violations === 0 ? "all cards satisfy the contract" : `${violations} card(s) violate the contract`}`);
if (violations > 0) process.exitCode = 1;
