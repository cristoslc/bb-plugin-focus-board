/**
 * v1.8.5 demo storyboard (2026-11-28).
 *
 * One bullet ships in this release: the Parent view's Done row (and the
 * Focus view's folded boxes) now sweep only the cards the board renders, so
 * a card hidden behind a context lane's "+N more" chip stays Done instead of
 * being archived from behind the chip. The gif walks the rendered-scope
 * sweep on the `?donemore=1` fixture (data.ts SIM_DONE_MORE_THREADS): a
 * family whose eight Done children overflow their context lane's Done row,
 * which the base demo board's single-card Done row can never stage.
 *
 * The frame the bullet turns on is "armed": the rail's pill reads 5 — the
 * rendered cards only — while the lane's chip still advertises "+4 more",
 * and the arm's highlight lands on exactly the rendered four. Confirm
 * sweeps those five and the chip's four stay Done, rendered once the swept
 * cards leave and the pill counts them in their place.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.8.5
 */
export const baseParams = "demo=1&donemore=1&groupBy=parent";

export const demos = [
  {
    id: "done-row-rendered-sweep",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    // Stage before the lead-in: bring the fixture family's chipped Done row
    // on screen. The scroll re-locks a lane and re-cuts the chips, which
    // shifts the lanes under the first scroll, so the pan settles and
    // corrects until the chip rests right of center.
    setup: async (g, page) => {
      await page.evaluate(async () => {
        const scroller = document.querySelector("[data-parent-board]");
        const chip = () =>
          [...document.querySelectorAll("body *")].find(
            (el) => el.childElementCount === 0 && el.textContent?.trim() === "+4 more",
          );
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        if (!scroller) return;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const el = chip();
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const delta = rect.x + rect.width / 2 - 1060;
          if (Math.abs(delta) < 24) return;
          scroller.scrollLeft += delta;
          el.scrollIntoView({ block: "center", behavior: "instant" });
          await sleep(380);
        }
      });
    },
    steps: async (g, page) => {
      await g.shot("rest", { hold: 1.6 });
      // Arm: the pill counts the row's rendered candidates only, and the
      // highlight lands on the rendered four — never the chip's tail.
      await g.clickAria("Arm sweep for this row: 5 eligible threads", { settle: 1.6 });
      await g.shot("armed", { hold: 1.8 });
      // Confirm: the rendered five archive; the chip's four stay Done. A
      // clean sweep posts no banner — the pill dropping to the revealed
      // four is the settled state, so wait the run out and hold on it.
      await g.clickAria("Confirm sweep of 5 threads", { settle: 1.2 });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("button[data-sweep-button]")].every(
            (b) => !(b.getAttribute("aria-label") ?? "").startsWith("Sweeping"),
          ),
        { timeout: 10_000 },
      );
      await g.shot("kept", { hold: 2.6 });
    },
  },
];
