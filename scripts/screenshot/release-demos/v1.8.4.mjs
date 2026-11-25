/**
 * v1.8.4 demo storyboard (2026-11-25).
 *
 * Two bullets filmed, one skipped (the manifest carries the reason): the
 * skipped one observes what bb's HOST answers — a split ask answered by a
 * whole-page navigation, and a late answer — and the harness's split
 * stand-in renders placement only with no host navigation or delayed reply
 * to stage, the limit the 1.8.1–1.8.3 storyboards recorded.
 *
 * - idle-earlier-sweep: the base board's own idle lanes need no fixture.
 *   Earlier holds the two threads past the 2-day idle threshold
 *   (thr_icon_lazy, thr_env_edge) so its pill proposes them with the count,
 *   while Today and Recent hold hours-old threads and rest bare — the
 *   "fresher buckets stay manual" facet visible as absence. The pill click
 *   arms with both preselected (2 → Done); the second click confirms, and
 *   the cards land in the Done lane.
 * - mark-done-closes-pane: the board's own thread pane, deep-linked open
 *   (the same /t/<threadId> route the uat-pane suites and v1.8.3's
 *   pane-header-menu demo enter). Mark Done from the header's shared menu
 *   now closes the pane once the done_set write lands, leaving the board
 *   with the card at the top of the Done lane; the capture asserts the
 *   close and the landing rather than filming them unverified.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.8.4
 */

export const baseParams = "groupBy=status";

const EARLIER_LANE = '[data-column-id="idle-earlier"]';
const EARLIER_PILL = `${EARLIER_LANE} [data-sweep-button]`;
const TODAY_PILL = '[data-column-id="idle-today"] [data-sweep-button]';
const SWEPT_CARD = '[data-thread-card="thr_icon_lazy"]';
const PANE = 'aside[aria-label^="Thread:"]';
const DONE_LANE = '[data-column-id="done"]';

/**
 * Click a scoped control at its own coordinates: the pointer glides there so
 * the gesture is visible, then the click lands as a real pointer event (the
 * clickAria path) instead of an el.click(). The sweep pill's arm and confirm
 * are the same button, so the state change rides the click, and scoping by
 * lane keeps the gesture on the Earlier bucket when another lane's pill is
 * also eligible.
 */
async function clickScoped(g, selector, shotName, { settle = 0.9, frames = 4 } = {}) {
  const point = await g.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!(el instanceof HTMLElement)) throw new Error(`no element for ${sel}`);
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await g.glide(point, { frames });
  await g.page.mouse.click(point.x, point.y);
  await g.shot(shotName, { hold: settle });
  return point;
}

export const demos = [
  {
    id: "idle-earlier-sweep",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    // The pill only renders while the lane proposes something, so the ready
    // wait doubles as the assertion that the Earlier arm is live: if the
    // predicate ever flips back, the capture fails loudly instead of
    // filming a bare lane.
    ready: EARLIER_PILL,
    steps: async (g) => {
      // At rest beside the fresher buckets: Earlier's pill carries the
      // count (2), Today and Recent rest bare — the manual-only split the
      // bullet names, asserted rather than assumed.
      await g.scrollInto(EARLIER_LANE, { hold: 1.0 });
      const todayBare = await g.page.evaluate(
        (sel) => document.querySelector(sel) === null,
        TODAY_PILL,
      );
      if (todayBare !== true) throw new Error("Idle · Today shows a pill; the fresher buckets must stay manual");
      await g.shot("idle-lanes-at-rest", { hold: 1.4 });
      // The pill click arms the sweep: both past-threshold threads
      // preselect, the pill reads "2 → Done", the cards wear the selection.
      await clickScoped(g, EARLIER_PILL, "armed-2-to-done", { settle: 1.2 });
      // The second click confirms: the run sweeps both cards to Done.
      await clickScoped(g, EARLIER_PILL, "sweep-confirmed", { settle: 1.8 });
      const landed = await g.page.evaluate(
        ({ sel, lane }) => {
          const card = document.querySelector(sel);
          return card !== null && card.closest(`[data-column-id="${lane}"]`) !== null;
        },
        { sel: SWEPT_CARD, lane: "done" },
      );
      if (landed !== true) throw new Error("the swept card did not land in the Done lane");
      await g.scrollInto(SWEPT_CARD, { hold: 0.6 });
      await g.shot("cards-land-in-done", { hold: 2.2 });
    },
  },
  {
    id: "mark-done-closes-pane",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    params: "#/plugins/focus-board/board/t/thr_review_pr",
    ready: "[data-thread-menu-trigger]",
    steps: async (g) => {
      // The pane sits open beside the board; the header carries the shared
      // Focus Board menu control where the pane's old checkbox sat.
      await g.shot("pane-at-rest", { hold: 1.4 });
      await g.clickAria("Focus Board thread menu", { settle: 1.0 });
      await g.shot("menu-open", { hold: 1.2 });
      // Done from the menu's checked first row: the write settles, then the
      // pane closes itself — the behavior this release adds. Fail the
      // capture loudly rather than film a pane that stayed open.
      await g.clickButton("Mark Done", { settle: 1.6 });
      const closed = await g.page.evaluate(
        (sel) => document.querySelector(sel) === null,
        PANE,
      );
      if (closed !== true) throw new Error("the pane did not close after Mark Done");
      // The close leaves the board looking at the thread just finished:
      // the card, first in the Done lane (activity recency — the demo
      // board's done cards are 26 hours and older).
      const first = await g.page.evaluate((lane) => {
        const column = document.querySelector(lane);
        if (column === null) throw new Error("no Done lane on the board");
        return (
          column.querySelector("[data-thread-card]")?.getAttribute("data-thread-card") ?? null
        );
      }, DONE_LANE);
      if (first !== "thr_review_pr") {
        throw new Error(`expected thr_review_pr first in Done, found ${String(first)}`);
      }
      await g.scrollInto('[data-thread-card="thr_review_pr"]', { hold: 0.6 });
      await g.shot("pane-closed-card-in-done", { hold: 2.2 });
    },
  },
];
