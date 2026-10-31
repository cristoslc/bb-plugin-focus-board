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
];
