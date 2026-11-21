/**
 * v1.8.1 demo storyboard (2026-11-21).
 *
 * Two bullets filmed, three skipped (the manifest and the release PR carry
 * the reasons): the thread-header control's menu mark and its macOS popover
 * fix both mount in bb's own thread-page header, which the harness does not
 * render (the mock captures the slot's registration only); the New Thread
 * dialog's spawn lands the created thread in bb's own pane, and the mock's
 * split stand-in is placement-only — it renders no thread — so the observable
 * is the pane record the uat-native-open suite asserts.
 *
 * - first-run-ask: a fresh install (`?firstRun=1` drops the stored answer)
 *   meets the setup question once the board settles; the pick writes the
 *   same declared setting the gear modal and the configuration page carry.
 * - split-recenter: the board panned so the clicked card sits near its
 *   right edge (`?nativeSplit=1` arms the harness's split chrome); the
 *   click opens the thread beside the board, the split halves the board and
 *   re-creates the panel the way bb's workspace renderer does, and the fit
 *   brings the clicked card back into the narrowed range.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.8.1
 */

export const baseParams = "groupBy=status";

const SPLIT_CARD = '[data-thread-card="thr_icon_lazy"]';

/**
 * Put the split demo's card near the board's right edge: the pointer pans
 * the board with a real wheel (the operator's scroll to reach the lane),
 * then a deterministic fine-place sits the card's right edge 80px inside
 * the board's right edge, so the split's halving is what pushes the card
 * out — the staging the uat-native-open suite's keep-in-view step pins.
 */
async function stageCardNearRightEdge(g) {
  const center = await g.page.evaluate(() => {
    const board = document.querySelector("[data-columns-board]");
    if (board === null) return null;
    const r = board.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (center === null) throw new Error("no [data-columns-board] on the page");
  await g.glide(center, { frames: 4 });
  await g.page.mouse.wheel({ deltaX: 500 });
  await g.sleep(400);
  await g.page.evaluate(() => {
    const board = document.querySelector("[data-columns-board]");
    const card = document.querySelector('[data-thread-card="thr_icon_lazy"]');
    if (board === null || card === null) throw new Error("board or card missing");
    const b = board.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    board.scrollLeft += c.right - b.right + 80;
  });
  await g.sleep(300);
}

/**
 * The split demo's card, opened through its own anchor: the app's
 * pane-opening handler lives on the card's anchor (the uat runner's
 * pageClickCard path), so the click goes through the DOM to that anchor
 * while the pointer shows the gesture on top of the card.
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
    id: "first-run-ask",
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
    params: "&firstRun=1",
    ready: "[data-open-preference-dialog]",
    steps: async (g) => {
      // The board paints first, then the question arrives: the lead-in
      // holds both at rest, the before-picture the answer changes.
      await g.shot("ask-open", { hold: 1.8 });
      // The pick: a real click on the highlighted default. The answer is
      // the declared setting, so the modal row and the configuration page
      // read the same value from here on.
      await g.clickAria("Beside the board", { settle: 1.0 });
      await g.shot("answered", { hold: 2.8 });
    },
  },
  {
    id: "split-recenter",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    params: "&nativeSplit=1",
    ready: SPLIT_CARD,
    steps: async (g) => {
      await stageCardNearRightEdge(g);
      await g.shot("card-at-the-right-edge", { hold: 1.6 });
      // The click opens the thread beside the board: the pointer glides to
      // the card, the DOM click fires the card's own anchor (the app's
      // pane-opening handler lives there, the uat runner's pageClickCard
      // path), and the host's split halves the board and re-creates the
      // panel. The fit brings the clicked card back into the narrowed
      // range; the right-hand strip is the harness's stand-in for bb's own
      // pane.
      const card = await g.centerOf(SPLIT_CARD);
      await g.glide(card, { frames: 4 });
      await clickCardAnchor(g, SPLIT_CARD, { settle: 0.7 });
      await g.sleep(1000);
      await g.shot("split-keeps-the-card", { hold: 3.0 });
    },
  },
];
