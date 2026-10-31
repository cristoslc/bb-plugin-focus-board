/**
 * v1.7.0 demo storyboards (2026-10-22).
 *
 * Captured against the v1.7.0 tag's own build: the horizontal row board, the
 * parent view's row sweeps, and the settings' appearance tabs all shipped in
 * this release, so the release's own tree is what the gifs show.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.0
 */
export const baseParams = "demo=1&collapsed=thr_demo_needs";

const WORKPULSE = "?workpulse=3&collapsedGroups=grp_wp_0,grp_wp_1,grp_wp_2";

export const demos = [
  // Added — the board's lanes can run horizontal, chosen in Appearance.
  {
    id: "horizontal-lanes",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.shot("columns", { hold: 1.4 });
      await g.clickAria("Focus Board settings", { settle: 1.2 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.clickButton("Appearance", { settle: 1.2 });
      await g.shot("appearance", { hold: 1.4 });
      await g.selectRadio("Lane direction", "Horizontal", { settle: 1.2 });
      await g.pressKey("Escape", { settle: 1.6 });
      await g.shot("rows", { hold: 2.4 });
    },
  },

  // Added — every sweepable Parent-view row carries its own sweep.
  {
    id: "row-sweep",
    params: "&groupBy=parent&collapsed=thr_demo_needs",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.shot("lanes", { hold: 1.2 });
      await g.clickAria("Arm sweep", { settle: 1.6 });
      await g.shot("armed", { hold: 2.0 });
    },
  },

  // Added — the search field gains a search button while it holds text and is
  // focused.
  {
    id: "search-button",
    steps: async (g) => {
      await g.shot("rest", { hold: 1.0 });
      await g.click('[aria-label="Search threads"]', { settle: 0.6 });
      await g.typeText("rank", { settle: 1.0 });
      await g.shot("button", { hold: 1.8 });
      await g.pressKey("Escape", { settle: 0.8 });
      await g.click('[aria-label="Search threads"]', { settle: 1.4 });
      await g.shot("back", { hold: 1.6 });
      await g.clickAria("Search", { settle: 1.4 });
      await g.shot("reconfirmed", { hold: 1.8 });
    },
  },

  // Added — a keyboard shortcut opens the New Thread composer.
  {
    id: "new-thread-shortcut",
    steps: async (g) => {
      await g.shot("board", { hold: 1.2 });
      await g.page.mouse.move(700, 500);
      await g.pressKey("c", { settle: 1.8 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.shot("composer", { hold: 2.4 });
    },
  },

  // Added — a family box folds into one normal card, and unfolds again.
  {
    id: "group-box-fold",
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.scrollInto('[data-group-box="grp_chat_imagegent"]', { hold: 0.5 });
      await g.shot("box", { hold: 1.2 });
      await g.clickAria("Collapse group", { settle: 1.6 });
      await g.shot("folded", { hold: 2.0 });
      await g.clickAria("Expand group", { settle: 1.6 });
      await g.shot("expanded", { hold: 2.0 });
    },
  },

  // Changed — opening a thread holds its card in the spotlight while the rest
  // of the board recedes.
  {
    id: "pane-spotlight",
    steps: async (g) => {
      await g.shot("board", { hold: 1.0 });
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.6 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.park(560, 520);
      await g.shot("spotlight", { hold: 2.4 });
    },
  },

  // Fixed — the thread pane stops before the board runs out of room.
  {
    id: "pane-width-floor",
    steps: async (g) => {
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.shot("open", { hold: 1.2 });
      const handle = await g.centerOf('[role="separator"][aria-label="Resize thread pane"]');
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 320, y: handle.y, frames: 8 }],
        { settle: 1.8 },
      );
      await g.shot("floor", { hold: 2.4 });
    },
  },

  // Fixed — the search field steps down to "Search", then to the magnifier,
  // instead of painting half a word.
  {
    id: "search-placeholder-step",
    steps: async (g) => {
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.shot("wide", { hold: 1.4 });
      const handle = await g.centerOf('[role="separator"][aria-label="Resize thread pane"]');
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 860, y: handle.y, frames: 6 }],
        { settle: 1.6 },
      );
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 760, y: handle.y, frames: 5 }],
        { settle: 1.8 },
      );
      await g.shot("narrow", { hold: 2.4 });
    },
  },

  // Fixed — a big family folds on whole rows and reveals the rest in one click.
  {
    id: "family-show-all",
    clip: '[data-thread-card="thr_demo_big"]',
    clipPad: 14,
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.shot("folded", { hold: 1.4 });
      await g.click('[data-show-all-rows]', { settle: 1.8 });
      await g.shot("revealed", { hold: 2.4 });
    },
  },

  // Fixed — a Forgejo chip names its item, not its host.
  {
    id: "cove-chip",
    clip: '[data-thread-card="thr_chips_cove"]',
    clipPad: 16,
    steps: async (g) => {
      await g.shot("card", { hold: 1.2 });
      await g.hover('[data-thread-card="thr_chips_cove"] [data-ticket-chip]', { settle: 1.8 });
      await g.shot("chip", { hold: 2.2 });
    },
  },

  // Added — a child thread started from a grouped parent joins its group; the
  // dialog names the group before the prompt is spent.
  {
    id: "child-joins-group",
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.scrollInto('[data-group-box="grp_chat_imagegent"]', { hold: 0.4 });
      const member = await g.centerOf('[data-group-box="grp_chat_imagegent"] [data-thread-card]');
      await g.glide(member, { frames: 4 });
      await g.rightClickCard('[data-group-box="grp_chat_imagegent"] [data-thread-card]', {
        settle: 1.2,
      });
      await g.menuPick("New child thread…", { settle: 1.6 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.shot("dialog", { hold: 2.4 });
    },
  },

  // Added — a collapsed family's working dots breathe at the thread's token
  // rate: three folded boxes, three measured rates.
  {
    id: "dot-rate-pulse",
    params: WORKPULSE.replace(/^\?/, "&"),
    clip: '[data-collapsed-group="grp_wp_0"]',
    clipPad: 12,
    gifWidth: 900,
    steps: async (g) => {
      await g.shot("still", { hold: 0.8 });
      await g.burst("pulse", { frames: 26, hold: 0.13 });
    },
  },
];
