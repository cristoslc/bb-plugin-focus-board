/**
 * v1.7.8 demo storyboard (2026-11-06).
 *
 * Three bullets filmed, one skipped (the release PR and the coverage table
 * carry the reason): the load-time dissolve — the fix proves an absence,
 * the board simply stops repainting a few hundred ms after it looks
 * loaded, and no frame distinguishes the landed state from any other.
 *
 * - lane-menu-opens: a lane's name+caret pair opens the lane's own menu —
 *   the sort row with the direction pair, Remove custom order, and Sweep
 *   this lane — where the bare header used to be a drop surface and the
 *   hand-order badge rode the strip.
 * - lane-sort-direction: the direction pair acts. Picking Oldest first
 *   re-orders the lane live, and the reopened menu checks the picked side
 *   (the choice persists per lane).
 * - whats-new-credits: the What's-new feed renders the bracket note as a
 *   muted attribution line under its entry — 1.7.7's working-stays item
 *   carries the note, so the shipped feed stages the read.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.8
 */

export const baseParams = "groupBy=status&demo=1&collapsed=thr_demo_needs,thr_demo_work";

const TRIGGER = 'section[data-column-id="unread"] header button[data-lane-menu-trigger]';
const MENU = '[role="menu"][aria-label="Lane actions"]';

export const demos = [
  {
    id: "lane-menu-opens",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The lane at rest: bare name, caret, count; no hand-order badge.
      await g.glide(await g.centerOf(TRIGGER), { frames: 4 });
      await g.shot("lane-at-rest", { hold: 1.2 });
      // The name+caret pair is the target; the click opens the lane's menu.
      await g.click(TRIGGER, { settle: 1.0 });
      await g.waitFor(MENU, 8_000);
      await g.sleep(400);
      await g.shot("menu-open", { hold: 2.6 });
    },
  },

  {
    id: "lane-sort-direction",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // Open the menu: the sort row reads the lane's order, Newest first
      // checked.
      await g.click(TRIGGER, { settle: 1.0 });
      await g.waitFor(MENU, 8_000);
      await g.shot("newest-checked", { hold: 1.6 });
      // The pick is a real action: the lane re-orders live under the menu.
      const oldest = await g.page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="menuitemradio"]')].find(
          (candidate) => (candidate.textContent ?? "").trim() === "Oldest first",
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (oldest === null) throw new Error("no Oldest first direction row");
      await g.glide(oldest, { frames: 4 });
      await g.page.mouse.click(oldest.x, oldest.y);
      await g.sleep(900);
      await g.shot("oldest-picked-lane-reordered", { hold: 2.2 });
      // The choice persists per lane: the reopened menu checks Oldest first.
      await g.pressKey("Escape", { settle: 0.8 });
      await g.click(TRIGGER, { settle: 1.0 });
      await g.waitFor(MENU, 8_000);
      await g.sleep(400);
      await g.shot("reopened-checks-oldest", { hold: 2.4 });
    },
  },

  {
    id: "whats-new-credits",
    params: "&lastSeenVersion=0.1.0&lastSeenUnreleased=0",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The gift opens the feed straight on the news; the entries list
      // newest first. The double-duty button names itself by title, not
      // text (its visible face is the gift glyph).
      await g.domClick('button[title="What\'s new"]', { settle: 1.4 });
      await g.waitFor('[role="dialog"]', 8_000);
      // The credited item: 1.7.7's working-stays bullet ends with the
      // bracket note, which renders as the muted attribution line.
      await g.scrollInto('[data-whats-new-contributor]', { hold: 0.8 });
      await g.sleep(400);
      await g.shot("attribution-line", { hold: 2.6 });
    },
  },
];
