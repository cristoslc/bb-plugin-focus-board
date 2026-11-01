/**
 * v1.6.0 demo storyboards (2026-10-18).
 *
 * Captured against the v1.6.0 tag's own build: the dot-strip gestures and the
 * collapsed strip's descendant dots are the release's whole surface, and the
 * board that shipped them is the board the gifs must show.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.6.0
 */
export const baseParams = "demo=1";

const NEEDS = "thr_demo_needs";
const GUTTER = "thr_demo_gutter";

/** Two windows side by side: each half is 900px of a real board, and the gif
 *  is their hstack at 1500px. Both pages get the same viewport, so the two
 *  halves cut near the same place (Pinned / Needs you / Unread are on screen). */
const TWO_WINDOWS = { width: 900, height: 760, deviceScaleFactor: 2 };
const TWO_WINDOWS_GIF = 1500;

export const demos = [
  // Added — a card can drop into a collapsed family's dot field.
  {
    id: "dot-field-drop",
    params: `&collapsed=${NEEDS}`,
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_deploy_fail"]', { hold: 0.6 });
      await g.shot("before", { hold: 1.2 });
      await g.drag(
        '[data-thread-card="thr_deploy_fail"]',
        `[data-thread-card="${NEEDS}"] [data-child-thread-dots]`,
        { yRatio: 0.5, frames: 7, settle: 1.8 },
      );
      await g.shot("joined", { hold: 2.2 });
    },
  },

  // Added — a dot that leaves its collapsed strip turns into a card drag, and
  // a release back on the dots is refused.
  {
    id: "dot-escape",
    viewport: { width: 1100, height: 820, deviceScaleFactor: 2 },
    params: `&collapsed=${NEEDS}`,
    steps: async (g) => {
      await g.shot("strip", { hold: 1.0 });
      const strip = await g.rectOf(`[data-thread-card="${NEEDS}"] [data-child-thread-dots]`);
      await g.dragPath(
        '[data-child-dot="thr_demo_needs_c1"]',
        [
          // Out of the strip: the family card lights under the soft ring as
          // the gesture becomes an ordinary card drag.
          { x: strip.x + strip.width + 40, y: strip.y + 150, frames: 5 },
          { selector: '[data-child-dot="thr_demo_needs_c1"]', frames: 5 },
        ],
        { settle: 1.6 },
      );
      await g.shot("refused", { hold: 2.2 });
    },
  },

  // Added — a collapsed strip's dot drags to reorder its tier of the family.
  {
    id: "dot-reorder",
    params: `&collapsed=${NEEDS}`,
    setup: async (g) => {
      await g.alignTo(`[data-thread-card="${NEEDS}"]`);
      await g.clipUnion([`[data-thread-card="${NEEDS}"]`], 320);
    },
    steps: async (g) => {
      await g.shot("order", { hold: 1.2 });
      await g.dragPath(
        '[data-child-dot="thr_demo_needs_c0"]',
        [{ selector: '[data-child-dot="thr_demo_needs_c2"]', frames: 7 }],
        { settle: 1.8 },
      );
      await g.shot("reordered", { hold: 2.2 });
    },
  },

  // Changed — the collapsed strip paints the whole family, grandchildren in
  // family order, and a parent dot's hover preview names its sub-threads.
  {
    id: "dot-descendants",
    params: `&collapsed=${GUTTER}`,
    setup: async (g) => {
      await g.alignTo(`[data-thread-card="${GUTTER}"]`);
      await g.clipUnion([`[data-thread-card="${GUTTER}"]`], 320);
    },
    steps: async (g) => {
      await g.shot("strip", { hold: 1.2 });
      await g.hover('[data-child-dot="thr_demo_gutter_c1"]', { settle: 1.8 });
      await g.shot("preview", { hold: 2.2 });
    },
  },

  // Fixed — two boards stop erasing each other's Done marks. Window A marks
  // one card done from its card menu, window B marks another; the Done row is
  // one host store, so BOTH cards leave Unread in BOTH windows instead of the
  // second write owning the whole set.
  {
    id: "two-windows-share-done",
    windows: 2,
    viewport: TWO_WINDOWS,
    gifWidth: TWO_WINDOWS_GIF,
    ready: '[data-thread-card="thr_rpc_auth"]',
    steps: async (g) => {
      await g.shot("both-windows", { hold: 1.0 });
      await g.rightClickCard('[data-thread-card="thr_rpc_auth"]', { settle: 1.0 });
      await g.menuPick("Mark Done", { settle: 1.3 });
      await g.shot("a-marked", { hold: 1.2 });
      g.use("peer");
      await g.rightClickCard('[data-thread-card="thr_uat_queue"]', { settle: 1.0 });
      await g.menuPick("Mark Done", { settle: 1.3 });
      await g.shot("b-marked", { hold: 1.4 });
      g.use("main");
      await g.shot("both-gone", { hold: 1.8 });
    },
  },

  // Fixed — a family folded in one window stays folded when the other folds
  // one. The fold is a row in the host's family-state store, so window B
  // paints the dot strip without ever being touched.
  {
    id: "two-windows-share-a-fold",
    windows: 2,
    viewport: TWO_WINDOWS,
    gifWidth: TWO_WINDOWS_GIF,
    ready: `[data-thread-card="${NEEDS}"]`,
    steps: async (g) => {
      await g.shot("both-windows", { hold: 1.0 });
      await g.clickButtonIn(`[data-thread-card="${NEEDS}"]`, "3 child threads", { settle: 1.3 });
      await g.shot("a-folded", { hold: 1.2 });
      g.use("peer");
      await g.shot("b-folded", { hold: 2.0 });
    },
  },

  // Fixed — a group created in one window survives a simultaneous change in
  // another. The registry is the host's, so the frame appears in window B
  // while window B is the one holding no draft at all.
  {
    id: "two-windows-share-a-group",
    windows: 2,
    viewport: TWO_WINDOWS,
    gifWidth: TWO_WINDOWS_GIF,
    ready: `[data-thread-card="${NEEDS}"]`,
    steps: async (g) => {
      await g.shot("both-windows", { hold: 1.0 });
      await g.rightClickCard(`[data-thread-card="${NEEDS}"]`, { settle: 1.0 });
      await g.menuPick("Group…", { settle: 1.3 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.page.evaluate(() => {
        const field = document.querySelector('[role="dialog"] [aria-label="New group name"]');
        if (field instanceof HTMLElement) field.focus();
      });
      await g.typeText("Ledger migration", { settle: 1.0 });
      await g.clickButton("Create & assign", { settle: 1.6 });
      await g.shot("a-created", { hold: 1.2 });
      g.use("peer");
      await g.shot("b-framed", { hold: 2.0 });
    },
  },

  // Fixed — a rank drag in one window survives another window's drop. The move
  // is one host write, so window B's Unread lane reads the same stored order.
  {
    id: "two-windows-share-a-rank",
    windows: 2,
    viewport: TWO_WINDOWS,
    gifWidth: TWO_WINDOWS_GIF,
    ready: '[data-thread-card="thr_uat_queue"]',
    steps: async (g) => {
      await g.shot("both-windows", { hold: 1.0 });
      await g.dragPath(
        '[data-thread-card="thr_review_pr"]',
        [{ selector: '[data-thread-card="thr_uat_queue"]', yRatio: 0.2, frames: 7 }],
        { settle: 1.5 },
      );
      await g.shot("a-reordered", { hold: 1.2 });
      g.use("peer");
      await g.shot("b-reordered", { hold: 2.0 });
    },
  },

  // Fixed — a wallpaper chosen in one window survives the second window's dim
  // change. Both windows are one document over the same store: window A picks
  // the Pine preset, then window B's dim write keeps the image instead of
  // dropping it (the bug wrote the whole document from a stale window).
  {
    id: "two-windows-keep-the-wallpaper",
    windows: 2,
    viewport: TWO_WINDOWS,
    gifWidth: TWO_WINDOWS_GIF,
    params: "&lastSeenUnreleased=current",
    steps: async (g) => {
      await g.shot("both-windows", { hold: 1.0 });
      await g.clickAria("Focus Board settings", { settle: 1.0 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.clickButton("Appearance", { settle: 0.8 });
      await g.clickAria("Wallpaper preset: Pine", { settle: 1.6 });
      await g.page.keyboard.press("Escape");
      await g.sleep(500);
      await g.shot("a-wallpapered", { hold: 1.2 });
      g.use("peer");
      await g.clickAria("Focus Board settings", { settle: 1.0 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.clickButton("Appearance", { settle: 0.8 });
      await g.clickAria("Wallpaper preset: Pine", { settle: 1.2 });
      await g.click('[aria-label="Wallpaper dim"]', { settle: 1.4 });
      await g.page.keyboard.press("Escape");
      await g.sleep(500);
      await g.shot("b-dimmed", { hold: 1.4 });
      g.use("main");
      await g.shot("a-keeps-the-image", { hold: 2.2 });
    },
  },
];
