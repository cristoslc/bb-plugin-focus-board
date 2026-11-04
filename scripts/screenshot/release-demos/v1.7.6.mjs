/**
 * v1.7.6 demo storyboard (2026-11-04).
 *
 * One bullet, one gif: the New Thread dialog gains New project. The clip
 * opens the dialog from the toolbar, activates the New project option under
 * the composer, types a name into the inline field, and creates — the field
 * closes and the dialog returns to its resting row, exactly the write the
 * unit suite proves in jsdom. The composer's project picker is bb's host
 * compose surface, which the harness has no host for, so the picker seed is
 * filmed where the board CAN show the outcome: the dialog closes and the
 * toolbar's Project filter lists the created "Side quest" project, the same
 * sidebar list the created project joined.
 *
 * The mock SDK's projects.create (this release's fixture) appends the
 * created project to the sim sidebar and wakes it, so the filter reads the
 * write back the way a real host re-reads its project list.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.6
 */

export const baseParams = "";

export const demos = [
  {
    id: "new-project-from-the-dialog",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // Open the New Thread dialog from the toolbar.
      await g.clickButton("New thread", { settle: 1.2 });

      // The option under the composer swaps itself for the inline field.
      await g.click("[data-new-project-option]", { settle: 1 });

      // The field is autofocused; type the project name into it.
      await g.typeText("Side quest", { settle: 0.8 });

      // Create: the write lands, the field closes, the dialog returns to
      // its resting option row.
      await g.clickAria("Create project", { settle: 1.2 });
      await g.sleep(400);
      await g.shot("created", { hold: 1.6 });

      // The picker is host chrome the harness cannot render, so prove the
      // create where the board shows it: close the dialog and open the
      // toolbar's Project filter, which reads the same sidebar list the
      // created project joined.
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
      await g.shot("project-filter-lists-side-quest", { hold: 2.4 });
    },
  },
];
