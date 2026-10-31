/**
 * v1.5.0 demo storyboards (2026-10-16).
 *
 * One gif per demonstrable changelog bullet. Captured against the v1.5.0 tag's
 * own build, because the release's board predates the fixtures, chrome, and
 * gestures that later releases changed; each demo runs on the harness data
 * that tag shipped.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.5.0
 */
export const baseParams = "demo=1";

const DEMO = "thr_demo_work";
const BIG = "thr_demo_big";

export const demos = [
  // Added — the pane's composer names its project and checkout at rest.
  {
    id: "pane-context-line",
    params: `&collapsed=${DEMO}`,
    ready: `[data-thread-card="${DEMO}"]`,
    steps: async (g) => {
      await g.shot("board", { hold: 0.9 });
      await g.hover(`[data-thread-card="${DEMO}"]`, { settle: 0.6 });
      await g.domClick(`[data-thread-card="${DEMO}"] a`, { settle: 1.2 });
      await g.waitFor('[data-testid="pane-context-row"]', 8_000);
      await g.sleep(500);
      const line = await g.centerOf('[data-testid="pane-context-row"]');
      await g.glide(line, { frames: 7 });
      await g.shot("line", { hold: 2.2 });
    },
  },

  // Added — a collapsed family's child dot previews its child and opens it.
  {
    id: "child-dot-preview",
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.shot("board", { hold: 0.9 });
      await g.hover('[data-child-dot="thr_demo_needs_c1"]', { settle: 1.6 });
      await g.click('[data-child-dot="thr_demo_needs_c1"]', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(500);
      await g.shot("pane", { hold: 1.8 });
    },
  },

  // Added — a card menu action zooms the board to one family.
  {
    id: "zoom-to-family",
    steps: async (g) => {
      await g.scrollInto(`[data-thread-card="${DEMO}"]`, { hold: 0.6 });
      await g.rightClickCard(`[data-thread-card="${DEMO}"]`, { settle: 1.0 });
      await g.menuPick("Zoom to family", { settle: 1.8 });
      await g.shot("parent", { hold: 2.4 });
    },
  },

  // Added — a family's child section can hide its idle children.
  {
    id: "idle-filter",
    clip: `[data-thread-card="${DEMO}"]`,
    clipPad: 14,
    steps: async (g) => {
      await g.scrollInto(`[data-thread-card="${DEMO}"]`, { hold: 0.4 });
      await g.shot("expanded", { hold: 1.2 });
      await g.hover('[data-thread-card="thr_demo_work"] [data-idle-children-toggle]', { settle: 0.8 });
      await g.click('[data-thread-card="thr_demo_work"] [data-idle-children-toggle]', { settle: 1.8 });
      const toggle = await g.centerOf('[data-thread-card="thr_demo_work"] [data-idle-children-toggle]');
      await g.glide(toggle, { frames: 4 });
      await g.shot("count", { hold: 1.6 });
    },
  },

  // Changed — the State filter menu lists Pinned.
  {
    id: "state-pinned",
    steps: async (g) => {
      await g.shot("board", { hold: 0.8 });
      await g.clickButton("State:", { settle: 1.0 });
      await g.waitFor('[role="listbox"]', 8_000);
      const pinned = await g.page.evaluate(() => {
        const option = [...document.querySelectorAll('[role="option"]')].find(
          (el) => (el.textContent ?? "").trim() === "Pinned",
        );
        if (!option) return null;
        const r = option.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (pinned === null) throw new Error('State menu has no "Pinned" row');
      await g.glide(pinned, { frames: 5 });
      await g.shot("pinned-row", { hold: 1.4 });
      await g.page.mouse.click(pinned.x, pinned.y);
      await g.shot("checked", { hold: 0.9 });
      await g.pressKey("Escape", { settle: 1.6 });
    },
  },

  // Changed — the View dropdown shows a kanban board and names the view Focus.
  {
    id: "view-kanban-icon",
    steps: async (g) => {
      await g.shot("board", { hold: 0.8 });
      await g.click('[aria-label="View"]', { settle: 1.4 });
      const chosen = await g.centerOf('[role="option"]');
      await g.glide(chosen, { frames: 4 });
      await g.shot("open", { hold: 2.4 });
    },
  },

  // Changed — the View dropdown stays on the row while the band has room,
  // and drops into the borrowed ribbon once the board is squeezed.
  {
    id: "view-ribbon-fold",
    viewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.shot("palette", { hold: 1.4 });
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(700);
      await g.shot("ribbon", { hold: 2.4 });
    },
  },

  // Fixed — right-clicking a Parent view lane header opens the thread menu.
  {
    id: "lane-header-menu",
    params: "&groupBy=parent",
    steps: async (g) => {
      await g.shot("lanes", { hold: 1.0 });
      await g.rightClickCard("[data-lane-header]", { settle: 1.8, deep: true });
    },
  },

  // Fixed — a nested child row shows its child's ticket chips.
  {
    id: "nested-child-chips",
    clip: '[data-thread-card="thr_demo_gutter"]',
    clipPad: 14,
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_demo_gutter"]', { hold: 0.4 });
      await g.shot("rows", { hold: 1.0 });
      const chip = await g.page.evaluate(() => {
        const row = document.querySelector('[data-child-chip-rows] [data-ticket-chip]');
        if (!row) return null;
        const r = row.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (chip === null) throw new Error("nested child row rendered no ticket chip");
      await g.glide(chip, { frames: 5 });
      await g.shot("chip", { hold: 2.0 });
    },
  },

  // Fixed — a big family's capped row list rests on whole rows.
  {
    id: "family-row-snap",
    clip: `[data-thread-card="${BIG}"]`,
    clipPad: 14,
    steps: async (g) => {
      await g.scrollInto(`[data-thread-card="${BIG}"]`, { hold: 0.4 });
      await g.shot("top", { hold: 1.0 });
      const list = await g.centerOf(`[data-thread-card="${BIG}"] [data-child-thread-section]`);
      await g.glide(list, { frames: 4 });
      await g.page.mouse.move(list.x, list.y);
      await g.page.mouse.wheel({ deltaY: 90 });
      await g.sleep(400);
      await g.shot("scrolled", { hold: 2.2 });
    },
  },

  // Fixed — choosing Zoom to group lands the board on the Group view.
  {
    id: "zoom-to-group",
    steps: async (g) => {
      await g.shot("board", { hold: 0.9 });
      await g.rightClickCard('[data-group-box="grp_chat_imagegent"]', { settle: 1.0 });
      await g.menuPick("Zoom to group", { settle: 1.8 });
      await g.shot("group-view", { hold: 2.4 });
    },
  },

  // Fixed — hovering a card in light mode no longer mutes it.
  {
    id: "light-hover",
    theme: "light",
    steps: async (g) => {
      await g.shot("rest", { hold: 1.0 });
      await g.hover('[data-thread-card="thr_chips_pair"]', { settle: 2.0 });
    },
  },

  // Fixed — bare reference ids in pane messages become chips too.
  {
    id: "pane-link-chips",
    params: "&collapsed=thr_review_pr",
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_review_pr"]', { hold: 0.4 });
      await g.hover('[data-thread-card="thr_review_pr"]', { settle: 0.6 });
      await g.domClick('[data-thread-card="thr_review_pr"] a', { settle: 1.2 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(700);
      // The bare-id line is the pane's last message; scroll the transcript to
      // it, then hold on the chip the bare `@thr_glyph_glue` token painted.
      await g.page.evaluate(() => {
        const pane = document.querySelector('aside[aria-label^="Thread:"]');
        const scrollers = pane ? [...pane.querySelectorAll("*")] : [];
        for (const el of scrollers) {
          if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight;
        }
      });
      await g.sleep(600);
      const chip =
        '[data-focus-board-ref-kind="thread"][data-focus-board-ref-id="thr_glyph_glue"]';
      await g.waitFor(chip, 8_000);
      const point = await g.centerOf(chip);
      await g.glide(point, { frames: 6 });
      await g.shot("chips", { hold: 2.2 });
    },
  },

  // Fixed — a drag whose slot already holds the card refuses with a banner.
  {
    id: "refusal-banner",
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_drag_done"]', { hold: 0.4 });
      await g.shot("before", { hold: 0.9 });
      await g.drag(
        '[data-thread-card="thr_drag_done"]',
        '[data-rank-slot="thr_drag_done"]',
        { yRatio: 0.35, settle: 1.6 },
      );
      await g.shot("banner", { hold: 2.4 });
    },
  },
];
