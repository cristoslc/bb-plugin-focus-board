/**
 * The README overview storyboard.
 *
 * One board tells the Focus view's story in five beats:
 *   1. the board at rest — expanded and folded groups, two collapsed parents,
 *      a pulsing attention card, pinned cards, the Done projection;
 *   2. a group folded into its dot-grid card with its own chevron;
 *   3. a card dragged onto a parent INSIDE a group to nest it;
 *   4. a card dragged onto a group of one to join it.
 *
 * The query folds the ledger and bridge families and the "Docs sweep" group,
 * so both group states and both parent states are on screen at rest; the
 * story folds "Chat pipeline" on camera.
 *
 * Deliberately not GIF beats (each is a still): Zoom to family and its
 * Parent view, the group context menu, the group footprint highlight, the
 * card menu, the toolbar's View menu, and the Done lane's armed sweep. The
 * Parent view is a sparse surface for a small family, and every menu or
 * highlight costs seconds of screen time without changing board state a
 * still cannot show. The nest and join drags are the motion only a GIF
 * carries.
 */
import { boxChevron, card, fixed } from "../lib/recorder.mjs";

export const overviewGif = {
  name: "overview",
  query:
    "?overview=1&collapsedGroups=grp_docs&collapsed=thr_ov_ledger_parent,thr_ov_bridge_parent",
  width: 1680,
  height: 945,
  fps: 24,
  gifWidth: 1000,
  colors: 64,
  out: "overview.gif",
  steps: [
    { note: "the board at rest" },
    { hold: 1200 },

    { note: "fold the Chat pipeline group with its own chevron" },
    { click: boxChevron("grp_chat"), ms: 500, hover: 120, after: 900 },

    { note: "drag an idle card onto the parent inside Release 1.0" },
    {
      drag: {
        from: card("thr_ov_drag_card"),
        to: { selector: 'li[data-rank-slot="thr_ov_release_parent"]', at: [0.5, 0.55] },
        approach: 300,
        grab: 180,
        ms: 1000,
        hover: 450,
        settle: 800,
      },
    },
    { hold: 200 },

    { note: "drag an unread card onto the Triage group of one" },
    {
      drag: {
        from: card("thr_ov_join_unread"),
        to: { selector: '[data-group-box-label="grp_triage"]' },
        approach: 300,
        grab: 180,
        ms: 900,
        hover: 400,
        settle: 750,
      },
    },
    { note: "park the pointer and hold the finished board" },
    { move: fixed(1500, 720), ms: 350 },
    { hold: 1500 },
  ],
};
