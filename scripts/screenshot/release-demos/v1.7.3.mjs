/**
 * v1.7.3 demo storyboards (2026-10-31).
 *
 * Captured against the v1.7.3 tag's own build: the descendant dots, the group
 * picker's filter, and its name-uniqueness refusal all shipped in this release.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.3
 */
export const baseParams = "demo=1&collapsed=thr_demo_needs";

export const demos = [
  // Added — a folded feature-group card shows every descendant's status dot,
  // and clicking one opens that thread while the group stays folded.
  {
    id: "group-descendant-dots",
    params: "&descgroup=1&collapsedGroups=grp_desc",
    steps: async (g) => {
      await g.scrollInto('[data-collapsed-group="grp_desc"]', { hold: 0.5 });
      await g.shot("folded", { hold: 1.4 });
      await g.click(
        '[data-collapsed-group="grp_desc"] [data-collapsed-group-dot-button="thr_desc_c1_a"]',
        { settle: 1.6 },
      );
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.shot("opened", { hold: 2.4 });
    },
  },

  // Added — the group picker gains a filter field and a scrolling list, and
  // lists groups alphabetically instead of in creation order.
  {
    id: "group-picker-filter",
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_demo_work"]', { hold: 0.5 });
      await g.rightClickCard('[data-thread-card="thr_demo_work"]', { settle: 1.2 });
      await g.menuPick("Group…", { settle: 1.4 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.shot("picker", { hold: 1.8 });
      await g.page.evaluate(() => {
        const field = document.querySelector('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])');
        if (field instanceof HTMLElement) field.focus();
      });
      await g.typeText("chat", { settle: 1.2 });
      await g.shot("filtered", { hold: 2.0 });
    },
  },
];
