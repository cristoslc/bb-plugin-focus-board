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

  // Added — a child in a different group than its parent shows twice. The
  // fixture (`?dualgroups=1`) pins the parent in "Release train" and puts its
  // child in "Follow-ups": one shot of the Pinned lane and the Idle·Recent
  // lane shows the child as a nested row AND as its own card in its group.
  {
    id: "dual-group-child-keeps-both-homes",
    params: "&dualgroups=1",
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_dual_parent"]',
    steps: async (g) => {
      await g.shot("both-homes", { hold: 1.4 });
      await g.page.evaluate(() => {
        const own = document.querySelector('[data-group-box="grp_dual_child"]');
        if (own instanceof HTMLElement) own.scrollIntoView({ block: "center", behavior: "instant" });
      });
      await g.sleep(400);
      await g.hover('[data-group-box="grp_dual_child"] [data-thread-card="thr_dual_child"]', {
        settle: 1.6,
      });
      await g.shot("own-card", { hold: 2.2 });
    },
  },

  // Added — a pinned member keeps its group's dashed frame. The fixture
  // (`?pinnedgroup=1`) is a group of one whose only member is pinned, so the
  // Pinned lane frames a single card.
  {
    id: "pinned-member-keeps-its-frame",
    params: "&pinnedgroup=1",
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
    ready: '[data-group-box="grp_pinned_only"]',
    steps: async (g) => {
      await g.scrollInto('[data-group-box="grp_pinned_only"]', { hold: 0.4 });
      await g.shot("framed", { hold: 1.6 });
      await g.hover('[data-thread-card="thr_pinned_solo"]', { settle: 1.6 });
      await g.shot("hovered", { hold: 2.2 });
    },
  },

  // Added — two groups can no longer share a name. The picker's rename lands
  // on the other group's exact name and the row refuses inline, on a board
  // where a second write could otherwise have created a twin.
  {
    id: "group-rename-refuses-a-taken-name",
    params: "&dualgroups=1",
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
    // The clip is the picker dialog itself, so the gif is its own width: a
    // 1100px upscale of a 560px dialog is blurry AND several times the bytes.
    gifWidth: 700,
    ready: '[data-thread-card="thr_dual_parent"]',
    setup: async (g) => {
      // The dialog is opened WITHOUT frames: every captured frame then shares
      // one clip, so the gif never mixes a full board with a dialog close-up.
      await g.page.evaluate(() => {
        const card = document.querySelector('[data-thread-card="thr_dual_parent"]');
        const r = card.getBoundingClientRect();
        card.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true,
            clientX: r.x + 20,
            clientY: r.y + 20,
          }),
        );
      });
      await g.waitFor('[role="menuitem"]', 8_000);
      await g.page.evaluate(() => {
        const entry = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
          (el.textContent ?? "").trim().startsWith("Change group"),
        );
        if (!(entry instanceof HTMLElement)) throw new Error("no Change group entry");
        entry.click();
      });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.page.evaluate(() => {
        const rename = document.querySelector('[data-group-rename="grp_dual_child"]');
        if (rename instanceof HTMLElement) rename.click();
      });
      // The row's editor mounts a frame later than the click lands, so the
      // field is awaited before it is focused: a select() on a node React is
      // about to replace leaves the caret nowhere and the typing goes missing.
      await g.waitFor('[data-group-rename-input="grp_dual_child"]', 8_000);
      await g.sleep(300);
      // Prefilled with the group's own name: select all so the typed text
      // REPLACES it (the gesture is "type the other group's name", not
      // "append it").
      const prefilled = await g.page.evaluate(() => {
        const input = document.querySelector('[data-group-rename-input="grp_dual_child"]');
        if (!(input instanceof HTMLInputElement)) return 0;
        input.focus();
        // React re-asserts `value` on every keystroke and drops the selection
        // with it, so a select-all + type appends instead of replacing. The
        // caret sits at the end, so real Backspace presses clear the field.
        return input.value.length;
      });
      for (let index = 0; index < prefilled; index += 1) {
        await g.page.keyboard.press("Backspace");
      }
      await g.sleep(150);
      // A fixed band around the dialog with room BELOW it: the refusal line
      // grows the dialog (and re-centres it), and one clip for every frame
      // keeps the gif's geometry steady instead of resizing mid-story.
      const dialog = await g.rectOf('[role="dialog"]');
      g.clip = {
        x: Math.max(0, Math.round(dialog.x - 12)),
        y: Math.max(0, Math.round(dialog.y - 48)),
        width: Math.round(dialog.width + 24),
        height: Math.round(dialog.height + 120),
      };
    },
    steps: async (g) => {
      await g.shot("editing", { hold: 1.4 });
      await g.typeText("Release train", { settle: 1.0 });
      const typedValue = await g.page.evaluate(
        () => document.querySelector('[data-group-rename-input="grp_dual_child"]')?.value ?? null,
      );
      if (typedValue !== "Release train") {
        throw new Error(`the rename field holds ${JSON.stringify(typedValue)} instead of the typed name`);
      }
      await g.shot("typed", { hold: 1.2 });
      await g.page.evaluate(() => {
        const save = document.querySelector('[data-group-rename-confirm="grp_dual_child"]');
        if (save instanceof HTMLElement) save.click();
      });
      await g.waitFor('[data-group-rename-error]', 8_000);
      // Shot on the refusal itself: the row's editor state settles a beat
      // later (the dialog re-reads the registry), and a frame taken after that
      // shows an empty field instead of the refusal.
      await g.shot("refused", { hold: 2.8 });
    },
  }
];
