/**
 * v1.7.2 demo storyboards (2026-10-29).
 *
 * A fix-only release: the phone's pane repaint and the settings sheet's stacked
 * tabs. Captured against the v1.7.2 tag's own build.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.2
 */
export const baseParams = "demo=1&collapsed=thr_demo_needs";

const PHONE = { width: 390, height: 844, deviceScaleFactor: 2 };

export const demos = [
  // Fixed — the settings sheet stacks its tabs above the panel on a phone, and
  // the wallpaper crop preview fits the picker.
  {
    id: "phone-settings-sheet",
    viewport: PHONE,
    steps: async (g) => {
      await g.shot("board", { hold: 1.2 });
      await g.clickAria("Focus Board settings", { settle: 1.4 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.shot("behavior", { hold: 1.6 });
      await g.clickButton("Appearance", { settle: 1.6 });
      await g.shot("appearance", { hold: 1.8 });
      await g.page.evaluate(() => {
        const panel = document.querySelector('[role="dialog"]');
        for (const el of panel ? [...panel.querySelectorAll("*")] : []) {
          if (el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight;
        }
      });
      await g.sleep(500);
      await g.shot("wallpaper", { hold: 2.4 });
    },
  },
];
