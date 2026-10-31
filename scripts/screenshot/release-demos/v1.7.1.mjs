/**
 * v1.7.1 demo storyboards (2026-10-28).
 *
 * Captured against the v1.7.1 tag's own build: the chip shape and the
 * server-backed family state are the release's surface, so the tag's board is
 * the one the gifs show.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.1
 */
export const baseParams = "demo=1&collapsed=thr_demo_needs";

export const demos = [
  // Changed — the card's ticket chips land in a fixed shape: issues on the
  // first row's left, PRs on its right, tags in the bottom-right corner.
  {
    id: "chip-shape",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_chip_cluster"]', { hold: 0.6 });
      await g.shot("cluster", { hold: 1.4 });
      await g.hover('[data-thread-card="thr_chip_cluster"] [data-ticket-chip]', { settle: 1.4 });
      await g.hover('[data-thread-card="thr_chip_tags"]', { settle: 1.6 });
      // Squeezing the board with the pane proves the shape holds at a narrow
      // card width instead of sliding the PR chip under the issues.
      await g.domClick('[data-thread-card="thr_chip_wrap"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      const handle = await g.centerOf('[role="separator"][aria-label="Resize thread pane"]');
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 620, y: handle.y, frames: 6 }],
        { settle: 1.8 },
      );
      await g.shot("narrow", { hold: 2.4 });
    },
  },

];
