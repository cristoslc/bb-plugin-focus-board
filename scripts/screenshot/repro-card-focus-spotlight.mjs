// Headless verification for the focus spotlight: with the thread pane open
// (activeThreadId), the pane-held card — and its family — keep the same
// solid, opaque surface the hovered card gets, while the OTHER cards recede
// (the mouseover rules) with NO pointer anywhere near the board. The user
// state "focused on one thread" holds whether it came from hover or from
// clicking into the card. The driver clicks a card (opens the pane), moves
// the pointer to a neutral spot (no card under it), waits for the
// transitions to settle, and verifies:
//   1. the clicked card wears data-focus-solid
//   2. its background-color is fully OPAQUE and darker than the rest state
//   3. its opacity stays 1 — the focused card never fades
//   4. a sibling card (another family) recedes (opacity < 1)
// A data-card-faded or data-sweep-highlighted sibling keeps its own dim
// semantics and is only recorded. Exits 1 when a check fails (CI-able).
// Artifacts land in docs/screenshots/repro-card-focus-spotlight/
// (before/after PNGs + evidence.json). Run the vite harness first (same as
// shoot.mjs), then `node scripts/screenshot/repro-card-focus-spotlight.mjs`;
// honors the same CHROME_PATH, HARNESS_URL, and OUT_DIR overrides.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2 };
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT =
  process.env.OUT_DIR ??
  new URL("../../docs/screenshots/repro-card-focus-spotlight/", import.meta.url)
    .pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The alpha of a computed CSS color (modern `lab/… /a)` space syntax, or the
 *  legacy `rgba(r,g,b,a)` comma syntax); 1 when the color has no alpha. */
function alphaOf(browserColor) {
  const slash = browserColor.match(/\/\s*([0-9.]+)\s*\)\s*$/);
  if (slash !== null) return parseFloat(slash[1]);
  const comma = browserColor.match(/,\s*([0-9.]+)\s*\)\s*$/);
  if (comma !== null) return parseFloat(comma[1]);
  return 1;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport(VIEW);
await page.goto(`${BASE}?groupBy=status`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
await sleep(600);

/** Pick the first card div fully inside the viewport, optionally excluding
 *  one thread id (the already-picked focus target). */
async function visibleCard(excludeId) {
  return page.evaluate((exclude) => {
      // Card divs only: child rows are anchors wearing the same attr, and
      // they live inside their family card's own opaque surface.
      const cards = [...document.querySelectorAll("div[data-thread-card]")];
      const visible = cards.find((el) => {
        if (exclude !== null && el.getAttribute("data-thread-card") === exclude)
          return false;
        const r = el.getBoundingClientRect();
        return (
          r.width > 100 &&
          r.height > 40 &&
          r.top > 0 &&
          r.bottom < window.innerHeight &&
          r.left > 0 &&
          r.right < window.innerWidth
        );
      });
      if (visible === undefined) return null;
      const r = visible.getBoundingClientRect();
      const cs = getComputedStyle(visible);
      return {
        id: visible.getAttribute("data-thread-card"),
        faded: visible.hasAttribute("data-card-faded"),
        sweepHighlighted: visible.hasAttribute("data-sweep-highlighted"),
        focusSolid: visible.hasAttribute("data-focus-solid"),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        style: {
          backgroundColor: cs.backgroundColor,
          opacity: cs.opacity,
        },
      };
    },
    excludeId,
  );
}

// Read any card div by id (rect + computed styles + markers), wherever it
// sits in the viewport.
async function cardRead(id) {
  return page.evaluate((threadId) => {
      const el = document.querySelector(`div[data-thread-card="${CSS.escape(threadId)}"]`);
      if (!(el instanceof HTMLElement)) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        id: el.getAttribute("data-thread-card"),
        faded: el.hasAttribute("data-card-faded"),
        sweepHighlighted: el.hasAttribute("data-sweep-highlighted"),
        focusSolid: el.hasAttribute("data-focus-solid"),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        style: {
          backgroundColor: cs.backgroundColor,
          opacity: cs.opacity,
        },
      };
    },
    id,
  );
}

// Read the click target and a sibling card's style with no pointer anywhere
// near the board (no hover armed, no focus armed).
const cardInfo = await visibleCard(null);
if (cardInfo === null) {
  console.error("no visible top-level card found in the viewport");
  process.exit(1);
}
const restingInfo = await visibleCard(cardInfo.id);
const siblingInfo = await visibleCard(cardInfo.id);

const failures = [];
if (restingInfo === null || siblingInfo === null) {
  const which = restingInfo === null ? "resting baseline" : "sibling";
  console.error(`only one visible top-level card found — cannot record the ${which}`);
  process.exit(1);
}
if (siblingInfo.faded || siblingInfo.sweepHighlighted) {
  // Exempt card: its own dim system is in charge; the focus recede must not
  // stack a second dim on it. Recorded, never asserted.
  console.warn(
    `sibling ${siblingInfo.id} carries its own dim semantics ` +
      `(data-card-faded=${siblingInfo.faded}, data-sweep-highlighted=${siblingInfo.sweepHighlighted}); ` +
      "the recede check is skipped for it",
  );
}

await mkdir(OUT, { recursive: true });
const clip = (info) => ({
  x: Math.max(0, info.rect.x - 40),
  y: Math.max(0, info.rect.y - 20),
  width: Math.min(VIEW.width - Math.max(0, info.rect.x - 40), info.rect.width + 240),
  height: Math.min(VIEW.height, info.rect.height + 80),
});
await page.screenshot({ path: `${OUT}before.png`, clip: clip(cardInfo) });

// CLICK the card's center — the click-into surface (opens the pane, the
// board's activeThreadId) — then move the pointer to a neutral top-edge
// spot (no card under it) and let the surface + recede transitions settle.
await page.mouse.click(
  cardInfo.rect.x + cardInfo.rect.width / 2,
  cardInfo.rect.y + cardInfo.rect.height / 2,
);
await sleep(300);
await page.mouse.move(VIEW.width / 2, 4);
await sleep(800);

const focusedInfo = await cardRead(cardInfo.id);
if (focusedInfo === null) {
  failures.push(
    `the clicked card ${cardInfo.id} left the viewport after the click — ` +
      "the pane/layout moved it; re-run on a viewport that anchors it",
  );
} else {
  // Same-card reads for the checks: marker, opaque darker surface, opacity.
  if (!focusedInfo.focusSolid) {
    failures.push(
      `clicked card ${focusedInfo.id} does not carry data-focus-solid with the pane open`,
    );
  }
  const alpha = alphaOf(focusedInfo.style.backgroundColor);
  if (alpha < 1) {
    failures.push(
      `focused card surface is translucent (alpha ${alpha}, ${focusedInfo.style.backgroundColor}) — ` +
        "the lane/wallpaper bleeds through the pane-held card",
    );
  }
  if (focusedInfo.style.backgroundColor === restingInfo.style.backgroundColor) {
    failures.push(
      `focused card surface is still the rest state (${focusedInfo.style.backgroundColor}) — ` +
        "the darker solid mix did not land",
    );
  }
  if (focusedInfo.style.opacity !== "1") {
    failures.push(`focused card's opacity faded to ${focusedInfo.style.opacity}`);
  }

  // The recede: a sibling card from ANOTHER family (not a descendant of the
  // focused card, and not itself carrying dim semantics) must be faded out
  // while the pane holds the clicked thread.
  if (!siblingInfo.faded && !siblingInfo.sweepHighlighted) {
    const sibling = await page.evaluate((siblingId) => {
      const target = document.querySelector(`[data-thread-card="${CSS.escape(siblingId)}"]`);
      const focused = document.querySelector("[data-focus-solid]");
      if (target === null || focused === null) return null;
      const separated =
        target === focused.parentNode ||
        (!focused.contains(target) && !target.contains(focused));
      const cs = getComputedStyle(target);
      return {
        separated,
        focusSolid: target.hasAttribute("data-focus-solid"),
        opacity: cs.opacity,
      };
    }, siblingInfo.id);
    if (sibling === null) {
      console.warn("recede check skipped: the sibling card left the viewport after the click");
    } else if (sibling.separated) {
      if (sibling.focusSolid) {
        failures.push(
          `sibling ${siblingInfo.id} joined the focused family — another card should read it, ` +
            "the familySolid forcing is too wide",
        );
      } else if (parseFloat(sibling.opacity) >= 1) {
        failures.push(
          `sibling ${siblingInfo.id} did not recede (opacity ${sibling.opacity}) — ` +
            "the focus spotlight never armed on the clicked card",
        );
      }
    } else {
      console.warn(
        "recede check skipped: the only sibling card belongs to the focused family",
      );
    }
  }
}

await page.screenshot({
  path: `${OUT}after.png`,
  clip: clip(focusedInfo ?? cardInfo),
});
await writeFile(
  `${OUT}evidence.json`,
  JSON.stringify(
    {
      check: "focus spotlight (pane-held card solid, others recede)",
      viewport: VIEW,
      before: { clicked: cardInfo, resting: restingInfo, sibling: siblingInfo },
      after: { focused: focusedInfo },
      failures,
    },
    null,
    2,
  ) + "\n",
);
await browser.close();

if (failures.length > 0) {
  console.error(`repro-card-focus-spotlight FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("repro-card-focus-spotlight OK");