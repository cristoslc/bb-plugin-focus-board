/**
 * v1.7.7 demo storyboard (2026-11-05).
 *
 * Five bullets filmed, four skipped (the release PR and the coverage table
 * carry the reasons): message actions — the per-message bar is the host
 * chat's chrome, the mock chat renders bubbles only; the single
 * pending-question form — the answer surface is that same host chrome and
 * the fix itself proves an absence (the pane's own card is removed);
 * the file-change title click — the maximize's outcome is host navigation
 * (bb's main view opens the diff), nothing the harness can render; ticket
 * chips' idle-callback fetches — fetch timing, the pixels identical either
 * way.
 *
 * - composer-focus: the pane opens on the message composer focused (the
 *   mock composer paints the pane's focusRequest bump as a ring) and a
 *   switch to another thread keeps the ring.
 * - new-project-on-the-row: the dialog at rest shows the folder-plus on
 *   the project row's line; the click runs bb's typical create over the
 *   mock's pickFolder, and the toolbar's Project filter reads the created
 *   project back.
 * - magic-rename-gated-row: a destroyed environment renders the fallback
 *   modal's thread-model row disabled, with its actual state named
 *   (?envgate=1, this release's fixture).
 * - magic-rename-model-probe: the failing first generation opens the
 *   fallback; picking "Use the thread's active model" probes on the
 *   thread's own model and commits the rename on the closed editor
 *   (?failautotitle=plain).
 * - working-stays: two threads' turns end at once; the plain one drops to
 *   its idle bucket, the one still carrying background work stays in the
 *   Working lane (activity patched over the harness's pushThreadUpdate).
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.7
 */

export const baseParams = "";

export const demos = [
  {
    id: "composer-focus",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_uat_queue"]',
    steps: async (g) => {
      // Open the pane from the card's anchor: no click touches the composer.
      await g.domClick('[data-thread-card="thr_uat_queue"] a', { settle: 1.2 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(500);
      // The composer arrived focused: the ring is on without any click.
      await g.shot("opened-focused", { hold: 1.6 });
      // Switch to another thread: the counter bumps again and the ring holds.
      await g.domClick('[data-thread-card="thr_rpc_auth"] a', { settle: 1.2 });
      await g.sleep(700);
      await g.shot("switched-focused", { hold: 2.0 });
    },
  },

  {
    id: "new-project-on-the-row",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // Open the New Thread dialog from the toolbar.
      await g.clickButton("New thread", { settle: 1.2 });
      // At rest the folder-plus sits on the project row's line, at the
      // pickers row's open left edge — no stacked shape, no dead band.
      await g.shot("button-on-the-row", { hold: 1.2 });

      // The click runs bb's typical create: the mock's pickFolder answers
      // with a picked folder, the name derives from it, and the create
      // carries the local_path source — no hand-typed field this cut.
      await g.click("[data-new-project-option]", { settle: 1.6 });
      await g.sleep(600);
      await g.shot("created-from-the-pick", { hold: 1.4 });

      // The composer's picker is host chrome the harness cannot render, so
      // prove the create where the board shows it: close the dialog and
      // open the toolbar's Project filter, which reads the same sidebar
      // list the created project joined.
      await g.pressKey("Escape", { settle: 0.8 });
      const chip = await g.page.evaluate(() => {
        const button = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find(
          (el) => (el.textContent ?? "").trim().startsWith("Project"),
        );
        if (!button) return null;
        const box = button.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      });
      if (chip === null) throw new Error("Project filter chip not found");
      await g.glide(chip, { frames: 4 });
      await g.page.mouse.click(chip.x, chip.y);
      await g.sleep(600);
      await g.shot("project-filter-lists-created", { hold: 2.2 });
    },
  },

  {
    id: "magic-rename-gated-row",
    params: "&envgate=1&failautotitle=plain&groupBy=status",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_uat_queue"]',
    steps: async (g) => {
      // The pane opens from the card's anchor; the header's ✨ runs the first
      // generation, which failautotitle=plain fails, so the fallback modal
      // opens. envgate=1 serves the destroyed-environment verdict the gate
      // reads instead of a ready marker.
      await g.domClick('[data-thread-card="thr_uat_queue"] a', { settle: 1.2 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.click('button[title="Rename thread"]', { settle: 0.9 });
      await g.clickAria("Auto-rename from the thread prompt", { settle: 1.6 });
      // The thread-model row renders disabled with the actual state named.
      await g.shot("row-blocked", { hold: 2.6 });
    },
  },

  {
    id: "magic-rename-model-probe",
    params: "&failautotitle=plain&groupBy=status",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_uat_queue"]',
    steps: async (g) => {
      await g.domClick('[data-thread-card="thr_uat_queue"] a', { settle: 1.2 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.click('button[title="Rename thread"]', { settle: 0.9 });
      await g.clickAria("Auto-rename from the thread prompt", { settle: 1.6 });
      // The failing first generation opened the fallback; the probe pick
      // runs on the thread's own model pair and commits the rename.
      await g.clickAria("Use the thread's active model", { settle: 1.8 });
      await g.sleep(700);
      // The editor closed and the card carries the generated title.
      await g.shot("renamed-from-the-thread-model", { hold: 2.4 });
    },
  },

  {
    id: "working-stays",
    params: "&groupBy=status",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_rpc_auth"]',
    steps: async (g) => {
      const push = (threadId, patch) =>
        g.page.evaluate(
          ({ threadId, patch }) => {
            const harness = globalThis.__uat;
            if (!harness || typeof harness.pushThreadUpdate !== "function") {
              throw new Error("the harness exposes no __uat.pushThreadUpdate");
            }
            harness.pushThreadUpdate(threadId, patch);
          },
          { threadId, patch },
        );

      // Two turns start: both cards rise into the Working lane together.
      await push("thr_rpc_auth", { status: "active", runtimeStatus: "active" });
      await push("thr_review_pr", { status: "active", runtimeStatus: "active" });
      await g.sleep(1100);
      await g.shot("both-working", { hold: 1.6 });

      // Both turns end at once. The plain one drops to its idle bucket;
      // the one still carrying background work stays put.
      await push("thr_rpc_auth", { status: "idle", runtimeStatus: "idle" });
      await push("thr_review_pr", {
        status: "idle",
        runtimeStatus: "idle",
        activity: { backgroundAgents: 1, backgroundCommands: 0, workflows: 0 },
      });
      await g.sleep(1100);
      await g.shot("one-stays-working", { hold: 2.4 });
    },
  },
];
