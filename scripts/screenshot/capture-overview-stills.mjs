/**
 * Capture the README overview stills from the harness.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-overview-stills.mjs
 *
 * Each shot opens its own harness page (a modal, a highlight, or a scroll
 * state must never leak into the next picture) and reuses the GIF recorder's
 * gestures, so a still cannot drift from the storyboard it illustrates.
 * OUT_DIR / HARNESS_URL / CHROME_PATH behave like the other captures.
 */
import path from "node:path";
import {
  box,
  card,
  launchRecorderBrowser,
  openSession,
  pointOfMenuItem,
} from "./lib/recorder.mjs";

const OUT_DIR =
  process.env.OUT_DIR ?? new URL("../../docs/screenshots/", import.meta.url).pathname;
const OVERVIEW =
  "?overview=1&collapsedGroups=grp_docs&collapsed=thr_ov_ledger_parent,thr_ov_bridge_parent";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A padded clip around one element (CSS px). */
async function clipOf(page, selector, pad = 12) {
  const rect = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
  if (rect === null) throw new Error(`stills: no element for ${selector}`);
  return {
    x: Math.max(0, Math.round(rect.x - pad)),
    y: Math.max(0, Math.round(rect.y - pad)),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  };
}

/** A padded clip around the union of several element boxes. */
async function clipUnion(page, selectors, pad = 12) {
  const rect = await page.evaluate((list) => {
    const boxes = list
      .map((sel) => document.querySelector(sel))
      .filter((el) => el !== null)
      .map((el) => el.getBoundingClientRect());
    if (boxes.length === 0) return null;
    const left = Math.min(...boxes.map((r) => r.x));
    const top = Math.min(...boxes.map((r) => r.y));
    const right = Math.max(...boxes.map((r) => r.x + r.width));
    const bottom = Math.max(...boxes.map((r) => r.y + r.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }, selectors);
  if (rect === null) throw new Error(`stills: no elements for ${selectors.join(", ")}`);
  return {
    x: Math.max(0, Math.round(rect.x - pad)),
    y: Math.max(0, Math.round(rect.y - pad)),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
  };
}

/** The lane's content height: its header through the lowest card, so a
 *  still of a mostly-empty column does not carry half a screen of floor. */
async function laneClip(page, columnId, pad = 10) {
  const rect = await page.evaluate((id) => {
    const lane = document.querySelector(`section[data-column-id="${id}"]`);
    if (lane === null) return null;
    const box = lane.getBoundingClientRect();
    const anchors = [...lane.querySelectorAll("a[href]")].map((el) =>
      el.getBoundingClientRect(),
    );
    const bottom = anchors.length === 0 ? box.bottom : Math.max(...anchors.map((r) => r.bottom));
    return { x: box.x, y: box.y, width: box.width, bottom };
  }, columnId);
  if (rect === null) throw new Error(`stills: no lane ${columnId}`);
  return {
    x: Math.max(0, Math.round(rect.x - pad)),
    y: Math.max(0, Math.round(rect.y - pad)),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.bottom - rect.y + pad * 2),
  };
}

/** Right-click a card and run one menu entry. */
async function openCardMenu(session, threadId, entry) {
  const point = await session.pointOf(card(threadId));
  await session.rightClick({ point }, { settle: 350 });
  const row = await pointOfMenuItem(session.page, entry);
  await session.page.mouse.move(row.x, row.y);
  await sleep(180);
  await session.page.mouse.click(row.x, row.y);
  await sleep(450);
}

const SHOTS = [
  {
    name: "overview-groups",
    query: OVERVIEW,
    note: "the scenario board at rest: expanded and folded groups, two collapsed parents, the Done projection",
    full: true,
  },
  {
    name: "overview-group-highlight",
    query: OVERVIEW,
    note: "clicking the Release 1.0 frame lights its footprint in Unread, Working and Done",
    async setup(session) {
      await session.click(box("grp_release"), { settle: 500 });
    },
    full: true,
  },
  {
    name: "overview-group-menu",
    query: OVERVIEW,
    note: "a group frame's context menu: spawn, zoom, rename, fold, ungroup",
    async setup(session) {
      const frame = await session.pointOf(box("grp_chat"));
      await session.rightClick({ point: frame }, { settle: 400 });
      const row = await pointOfMenuItem(session.page, "Collapse group");
      await session.page.mouse.move(row.x, row.y);
      await sleep(220);
    },
    clip: (session) =>
      clipUnion(session.page, ['[data-group-box="grp_chat"]', '[role="menu"]'], 14),
  },
  {
    name: "overview-group-picker",
    query: OVERVIEW,
    note: "the group picker: current group, filter, rename and delete rows, and the new-group field",
    async setup(session) {
      await openCardMenu(session, "thr_ov_release_parent", "Change group…");
      await session.page.waitForSelector("[data-group-dialog]", { timeout: 5_000 });
      // The dialog fades and zooms in; a 400ms wait caught it mid-animation
      // (the board showed through the surface), so hold past the entrance.
      await sleep(1400);
      const row = await session.page.evaluate(() => {
        const el = document.querySelector('[data-group-row="grp_chat"]');
        if (el === null) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (row !== null) await session.page.mouse.move(row.x, row.y);
      await sleep(250);
    },
    clip: (session) => clipOf(session.page, "[data-group-dialog]", 18),
  },
  {
    name: "overview-card-menu",
    query: OVERVIEW,
    note: "a card's actions: pin, read, done, snooze, group, zoom, spawn, keep, archive",
    async setup(session) {
      const point = await session.pointOf(card("thr_ov_release_parent"));
      await session.rightClick({ point }, { settle: 400 });
      const row = await pointOfMenuItem(session.page, "Zoom to family");
      await session.page.mouse.move(row.x, row.y);
      await sleep(220);
    },
    clip: (session) =>
      clipUnion(
        session.page,
        ['li[data-rank-slot="thr_ov_release_parent"]', '[role="menu"]'],
        14,
      ),
  },
  {
    name: "overview-view-menu",
    query: OVERVIEW,
    note: "the View menu: the board's eight groupings and the nesting toggle",
    async setup(session) {
      await session.click({ selector: 'button[aria-label="View"]' }, { settle: 400 });
      const row = await pointOfMenuItem(session.page, "Last activity");
      await session.page.mouse.move(row.x, row.y);
      await sleep(200);
    },
    clip: () => ({ x: 320, y: 0, width: 520, height: 420 }),
  },
  {
    name: "overview-group-filter",
    query: OVERVIEW,
    note: "the Group filter: the board's groups plus the No group bucket",
    async setup(session) {
      const point = await session.page.evaluate(() => {
        const button = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find(
          (el) => el.textContent?.includes("Group:"),
        );
        if (button === null || button === undefined) return null;
        const r = button.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (point === null) throw new Error("stills: no Group filter trigger");
      await session.click({ point }, { settle: 400 });
      const row = await pointOfMenuItem(session.page, "No group");
      await session.page.mouse.move(row.x, row.y);
      await sleep(200);
    },
    clip: () => ({ x: 610, y: 0, width: 560, height: 330 }),
  },
  {
    name: "overview-group-dots",
    query: "?descgroup=1&collapsedGroups=grp_desc",
    waitFor: '[data-collapsed-group-card="grp_desc"]',
    note: "a folded group card's dot grid: members, their children, and grandchildren at three sizes",
    full: false,
    clip: (session) => clipOf(session.page, '[data-collapsed-group-card="grp_desc"]', 14),
  },
  {
    name: "overview-done-sweep",
    query: OVERVIEW,
    note: "the Done lane armed: settled cards tinted, the pill reading its destination, cancel beside it, the projection above",
    async setup(session) {
      await session.click(
        { selector: 'section[data-column-id="done"] [data-sweep-button]' },
        { settle: 550 },
      );
    },
    clip: (session) => laneClip(session.page, "done", 10),
  },
  {
    name: "overview-family-fold",
    query: "?demo=1",
    note: "a family past five rows folds behind Show all N, with whole rows and no clipped card",
    async setup(session) {
      const point = await session.pointOf({ selector: 'li[data-rank-slot="thr_demo_big"]' });
      await session.page.mouse.move(point.x, point.y);
      await sleep(300);
    },
    clip: (session) => clipOf(session.page, 'li[data-rank-slot="thr_demo_big"]', 14),
  },
  {
    name: "overview-horizontal-wallpaper",
    query: `${OVERVIEW}&laneDirection=horizontal&wallpaper=fog`,
    note: "horizontal lane rows over a bundled wallpaper (the Appearance choices)",
    // A full-bleed gradient at 2x is a 1.3MB PNG; native resolution keeps
    // the text crisp at README width and the file light.
    scale: 1,
    async setup(session) {
      await session.page.evaluate(() => {
        const board = document.querySelector("[data-columns-board]");
        if (board !== null) board.scrollTop = 520;
      });
      await sleep(500);
    },
    full: true,
  },
  {
    name: "overview-parent-view",
    query: OVERVIEW,
    note: "Zoom to family on the ten-child bridge family: the Parent view scoped to it",
    async setup(session) {
      await openCardMenu(session, "thr_ov_bridge_parent", "Zoom to family");
      await sleep(900);
      await session.page.evaluate(() => {
        for (const el of document.querySelectorAll("*")) {
          if (el.scrollTop) el.scrollTop = 0;
        }
      });
      await sleep(250);
    },
    full: true,
  },
];

const browser = await launchRecorderBrowser({ width: 1680, height: 945, deviceScaleFactor: 2 });
const failures = [];
try {
  for (const shot of SHOTS) {
    console.log(`  ${shot.name}`);
    const session = await openSession(browser, {
      query: shot.query,
      waitFor: shot.waitFor ?? "[data-group-box]",
      cursor: false,
    });
    try {
      if (shot.setup !== undefined) await shot.setup(session);
      if (shot.scale !== undefined) {
        await session.page.setViewport({
          width: 1680,
          height: 945,
          deviceScaleFactor: shot.scale,
        });
        await sleep(300);
      }
      const options = { path: path.join(OUT_DIR, `${shot.name}.png`), timeout: 60_000 };
      if (shot.clip !== undefined) options.clip = await shot.clip(session);
      await session.page.screenshot(options);
      if (shot.clip === undefined && shot.full !== true) {
        throw new Error(`stills: ${shot.name} has neither a full flag nor a clip`);
      }
    } catch (error) {
      failures.push(`${shot.name}: ${error?.message ?? error}`);
    } finally {
      await session.page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAILED ${failure}`);
  throw new Error(`${failures.length} of ${SHOTS.length} overview stills failed`);
}
console.log(`${SHOTS.length} stills captured in ${OUT_DIR}`);
