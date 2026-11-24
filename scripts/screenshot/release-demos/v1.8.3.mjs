/**
 * v1.8.3 demo storyboard (2026-11-24).
 *
 * Two bullets filmed, two skipped (the manifest carries the reasons): both
 * skipped ones observe what bb's native pane SHOWS, and the harness's split
 * stand-in is placement-only with no thread content — the same limit the
 * 1.8.1 and 1.8.2 storyboards recorded. The race fix additionally needs a
 * slowed pane mount the harness cannot stage honestly.
 *
 * - pane-header-menu: the board's own thread pane, deep-linked open (the
 *   same `/t/<threadId>` route the uat-pane suites enter); the header's
 *   mark-plus-caret opens the Focus Board menu and Mark Done applies from
 *   its checked first row — the affordance the pane's old checkbox drew.
 * - slash-search-focus: a card click splits the window (`?nativeSplit=1`
 *   arms the harness's split chrome); a click inside the board hands the
 *   keyboard to bb's pane container, and "/" still focuses the search field,
 *   typing filters the board while the thread stays open beside it.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.8.3
 */

export const baseParams = "groupBy=status";

const DEMO_THREAD = '[data-thread-card="thr_review_pr"]';
const SEARCH_FIELD = 'input[aria-label="Search threads"]';

/**
 * Open a card through its own anchor: the app's pane-opening handler lives
 * on the card's anchor (the uat runner's pageClickCard path), so the click
 * goes through the DOM to that anchor while the pointer shows the gesture
 * on top of the card.
 */
async function clickCardAnchor(g, selector, { settle = 0.7 } = {}) {
  await g.page.evaluate((sel) => {
    const host = document.querySelector(sel);
    const el = host?.matches("a[href]") ? host : host?.querySelector("a[href]");
    if (!(el instanceof HTMLElement)) throw new Error(`no anchor for ${sel}`);
    el.click();
  }, selector);
  await g.shot("thread-opens-beside", { hold: settle });
}

export const demos = [
  {
    id: "pane-header-menu",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    params: "#/plugins/focus-board/board/t/thr_review_pr",
    ready: "[data-thread-menu-trigger]",
    steps: async (g) => {
      // The pane sits open beside the board; the before-picture is the
      // header row carrying the control where the pane's old checkbox sat.
      await g.shot("pane-at-rest", { hold: 1.4 });
      // The mark plus caret opens the shared popover, the same component
      // bb's native thread page carries in its chrome row.
      await g.clickAria("Focus Board thread menu", { settle: 1.0 });
      await g.shot("menu-open", { hold: 1.6 });
      // Done from the menu's checked first row: the row the pane's old
      // checkbox answered, and the card settles out of its lane.
      await g.clickButton("Mark Done", { settle: 1.2 });
      await g.shot("done-settled", { hold: 2.4 });
    },
  },
  {
    id: "slash-search-focus",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    params: "&nativeSplit=1",
    ready: DEMO_THREAD,
    steps: async (g) => {
      // The click that fills the native pane: the split halves the board
      // and the host focuses the thread pane (the mock mirrors both).
      await g.scrollInto(DEMO_THREAD, { hold: 0.5 });
      await clickCardAnchor(g, DEMO_THREAD, { settle: 0.9 });
      await g.sleep(900);
      // A click inside the board hands the keyboard to bb's pane container
      // (bb 0.50.1 focuses its split pane on pointerdown; the mock's
      // containers carry the same `data-split-pane-id` shell).
      const empty = await g.page.evaluate(() => {
        const board = document.querySelector("[data-focus-board-panel]");
        if (board === null) throw new Error("no [data-focus-board-panel] on the page");
        const r = board.getBoundingClientRect();
        // Bottom-right of the board: past the lanes' last cards on a wide board.
        return { x: Math.round(r.right - 24), y: Math.round(r.bottom - 120) };
      });
      await g.glide(empty, { frames: 4 });
      await g.page.mouse.click(empty.x, empty.y);
      await g.sleep(500);
      await g.shot("board-clicked", { hold: 0.9 });
      // The "/" the bug deaded: the search field takes focus despite the
      // keyboard sitting in bb's pane container. Fail the capture loudly
      // rather than film the dead state.
      await g.page.keyboard.type("/", { delay: 60 });
      await g.sleep(500);
      const focused = await g.page.evaluate((sel) => document.activeElement === document.querySelector(sel), SEARCH_FIELD);
      if (focused !== true) throw new Error('"/" did not focus the search field after a board click');
      await g.shot("slash-focuses-search", { hold: 1.6 });
      // The keystrokes land where the click's focus rules put them: the
      // query arrives in the field and the board narrows live.
      await g.typeText("review", { settle: 1.2 });
      const typed = await g.page.evaluate((sel) => {
        const input = document.querySelector(sel);
        if (input === null) throw new Error("no search field on the page");
        return (input.value ?? "").trim();
      }, SEARCH_FIELD);
      if (typed !== "review") throw new Error(`the query did not land in the search field: "${typed}"`);
      await g.shot("query-filters-the-board", { hold: 2.2 });
    },
  },
];
