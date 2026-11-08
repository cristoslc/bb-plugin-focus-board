/**
 * v1.7.10 demo storyboard (2026-11-08).
 *
 * Both clips film the View menu release: the grouping rows are role="option"
 * buttons (so clickButton, not menuPick, reaches them) and the structural
 * rows are the app's radiogroup pairs (selectRadio).
 *
 * - no-grouping-grid-sort: the No grouping pick renders the board as a card
 *   grid, and the View menu's Sort by row re-orders it live (Alphabetical
 *   re-sorts in place; the reopened menu shows the picked side checked).
 *   The opening frame also carries the None-row rename: the menu's row
 *   reads "No grouping" before the pick lands. One asset covers both
 *   bullets; the release PR says so.
 *
 * - view-menu-pairs: the grouped board's View menu carries the two-choice
 *   pairs; picking Horizontal re-lays the lanes as rows, and the Nest child
 *   threads pair folds families back to single cards.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.10
 */

export const baseParams = "groupBy=status&demo=1";

const VIEW_MENU = '[role="listbox"][aria-label="View"]';

export const demos = [
  {
    id: "no-grouping-grid-sort",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The grouped board at rest: lanes, the before-picture the pick replaces.
      await g.shot("grouped-board-at-rest", { hold: 1.2 });
      // The View menu open: the grouping rows, one of them now reading
      // "No grouping" (the renamed None row).
      await g.clickAria("View");
      await g.waitFor(VIEW_MENU, 8_000);
      await g.sleep(400);
      await g.shot("menu-no-grouping-row", { hold: 2.2 });
      // The pick: the board re-renders as a responsive card grid.
      await g.clickButton("No grouping");
      await g.waitFor("[data-card-grid]", 8_000);
      await g.sleep(600);
      await g.shot("grid-at-rest", { hold: 2.4 });
      // The grid's own order rows: Sort by beside Order.
      await g.clickAria("View");
      await g.waitFor(VIEW_MENU, 8_000);
      await g.sleep(400);
      await g.shot("menu-sort-by-row", { hold: 2.0 });
      // Alphabetical, ascending: the grid re-sorts in place behind the menu,
      // and the reopened row shows the picked side checked.
      await g.selectRadio("Sort by", "Alphabetical");
      await g.sleep(600);
      await g.shot("menu-alphabetical-checked", { hold: 2.0 });
      // A second trigger click closes the open menu (Escape after a radio
      // click does not reach this popover shell).
      await g.clickAria("View");
      await g.sleep(600);
      await g.shot("grid-alphabetical", { hold: 2.4 });
    },
  },
  {
    id: "view-menu-pairs",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The grouped board at rest: vertical lanes, families nested.
      await g.shot("lanes-vertical-at-rest", { hold: 1.2 });
      // The View menu open: Lane direction and Nest child threads as
      // two-choice pairs, the old nesting checkbox gone.
      await g.clickAria("View");
      await g.waitFor(VIEW_MENU, 8_000);
      await g.sleep(400);
      await g.shot("menu-two-choice-pairs", { hold: 2.2 });
      // Horizontal: the lanes re-lay as rows, in place. The menu stays open
      // after a pair pick, so the nesting pair is picked in the same menu —
      // a second trigger click here would toggle the menu closed.
      await g.selectRadio("Lane direction", "Horizontal");
      await g.sleep(900);
      await g.shot("lanes-horizontal", { hold: 2.4 });
      // Nesting Off: families fold to single cards.
      await g.selectRadio("Nest child threads", "Off");
      await g.sleep(900);
      await g.shot("nesting-off", { hold: 2.4 });
      // A second trigger click closes the open menu (Escape after a radio
      // click does not reach this popover shell).
      await g.clickAria("View");
      await g.sleep(500);
      await g.shot("board-settled", { hold: 2.0 });
    },
  },
];
