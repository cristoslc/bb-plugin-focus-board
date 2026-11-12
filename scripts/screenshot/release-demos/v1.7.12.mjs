/**
 * v1.7.12 demo storyboard (2026-11-12).
 *
 * Four clips, one per bullet of the release section — all four film on the
 * base fixture the UAT suites already walk, so no seed fixture is needed:
 *
 * - group-frame-done: the group's dashed frame follows its done member into
 *   the Done lane. Marking thr_column_sort done with the card's own
 *   two-click Mark Done checkbox (the uat-group-done-fence suite's gesture)
 *   re-wraps the Working frame around the remaining member live, and the
 *   Done lane gains the frame around the settled card.
 * - group-filter-child: the Group filter keeps a matched family whole.
 *   Picking "Alpha rework" in the toolbar's Group dropdown (the write the
 *   uat-group-filter-family suite asserts on) removes the Beta lane while
 *   the Beta-group child keeps its nested row inside the Alpha parent card.
 * - lane-chip-hover: a lane's name+caret pair takes the interactive fill on
 *   hover and sharpens its caret — a hover-in, hold, hover-out, hover-again
 *   clip, because a still cannot show a rest state and a hover state at
 *   once. Each hover-in ends with a one-pixel re-enter and a settle: the
 *   card the glide crossed releases its hover freeze and remounts the lane
 *   header under the stationary pointer, which swallows the pair's
 *   mouseenter — the re-enter re-fires it on the fresh node.
 * - lane-dissolve: a card that empties its lane finishes its dissolve before
 *   the lane closes. The Needs-you lane holds two cards; marking both done
 *   with the cards' own two-click checkboxes empties it, and the second
 *   departure wipes its ghost out top-down inside the lane's held frame
 *   (the card-transport clock, 400ms wipe + 200ms collapse, filmed as a
 *   slow burst), then the lane closes with the ghost.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.12
 */

/** The card's two-click done checkbox, scoped to one card: hover reveals it
 *  in the state-dot slot, the first click arms ("Click again to confirm"),
 *  the second confirms. */
async function clickCardDoneCheckbox(g, threadId, labelPrefix, { settle = 0.9, frames = 4 } = {}) {
  const point = await g.page.evaluate(
    ({ threadId, labelPrefix }) => {
      const card = document.querySelector(`[data-thread-card="${threadId}"]`);
      if (card === null) return null;
      const el = [...card.querySelectorAll("button")].find((candidate) =>
        (candidate.getAttribute("aria-label") ?? "").startsWith(labelPrefix),
      );
      if (el === null) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { threadId, labelPrefix },
  );
  if (point === null) throw new Error(`no "${labelPrefix}" button in ${threadId}`);
  await g.glide(point, { frames });
  await g.page.mouse.click(point.x, point.y);
  await g.shot(`cb${String(g.frames.length).padStart(3, "0")}`, { hold: settle });
  return point;
}

/** Whether the card has reached the Done lane (the arriving card mounts
 *  there at transport start, so this reads true the moment the move fires). */
async function doneReached(g, threadId) {
  return g.page.evaluate((id) => {
    const done = document.querySelector('section[data-column-id="done"]');
    return done !== null && done.querySelector(`[data-thread-card="${id}"]`) !== null;
  }, threadId);
}

/** Confirm an armed done checkbox and film the departure live: one click,
 *  then a frame-by-frame burst that re-asserts the camera before every
 *  shot — the board slides to the card's new lane the moment the move
 *  fires, so only a per-frame hold keeps the lane's wipe and close on
 *  camera. Returns whether the card reached Done; the caller re-aims and
 *  retries when it did not (the lane's re-layout or a stray pointer-leave
 *  can stale the point — the armed state disarms on pointer-leave, and a
 *  pulse frame can shift the small hitbox). */
async function confirmAndFilm(g, threadId, point, camera, burstName, frames) {
  await g.page.mouse.click(point.x, point.y);
  for (let index = 0; index < frames; index += 1) {
    await holdBoardCamera(g, camera);
    await g.shot(`${burstName}-${String(index).padStart(3, "0")}`, { hold: 0.1 });
    await holdBoardCamera(g, camera);
  }
  return doneReached(g, threadId);
}

/** A freshly aimed checkbox point, re-armed when the earlier arm was reset.
 *  Returns null when the card is no longer on the board (it already left). */
async function armedPoint(g, threadId) {
  const state = await g.page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-card="${id}"]`);
    if (card === null) return null;
    const btn = [...card.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("Mark Done"),
    );
    if (btn === null) return null;
    btn.scrollIntoView({ block: "center", behavior: "instant" });
    const r = btn.getBoundingClientRect();
    return {
      armed: (btn.getAttribute("aria-label") ?? "") === "Mark Done",
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    };
  }, threadId);
  if (state === null) return null;
  if (!state.armed) {
    await g.glide({ x: state.x, y: state.y }, { frames: 4 });
    await g.page.mouse.click(state.x, state.y);
    await g.sleep(250);
  }
  return state;
}

/** The toolbar's Group filter trigger: the summary chip reads "Group: …". */
async function groupTrigger(g) {
  const point = await g.page.evaluate(() => {
    const el = [...document.querySelectorAll('button[aria-haspopup="listbox"]')].find(
      (candidate) => (candidate.textContent ?? "").startsWith("Group:"),
    );
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (point === null) throw new Error("no Group filter trigger in the toolbar");
  return point;
}

/** The board's saved scroll position: marking a card done slides the board
 *  to the card's new lane (the attended card's keep-in-view fit), which
 *  yanks the camera off the lane whose close is the story. The demo holds
 *  the camera by re-asserting the rest position after the slide fires. */
async function boardScrollLeft(g) {
  return g.page.evaluate(() => document.querySelector("[data-columns-board]")?.scrollLeft ?? 0);
}

async function holdBoardCamera(g, left) {
  await g.page.evaluate((saved) => {
    const el = document.querySelector("[data-columns-board]");
    if (el !== null) el.scrollLeft = saved;
  }, left);
}

export const baseParams = "";

const LANE_TRIGGER = 'section[data-column-id="unread"] header button[data-lane-menu-trigger]';
const WORKING_FRAME = 'section[data-column-id="working"] [data-group-box="grp_chat_imagegent"]';
const DONE_FRAME = 'section[data-column-id="done"] [data-group-box="grp_chat_imagegent"]';

export const demos = [
  {
    id: "group-frame-done",
    params: "?groupBy=status",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_column_sort"]',
    steps: async (g) => {
      // The group's frame in the Working lane around both members: the
      // before-picture the done mark moves.
      await g.scrollInto(WORKING_FRAME, { hold: 0.6 });
      await g.shot("working-frame-around-both", { hold: 1.4 });
      // The card's own two-click checkbox: hover reveals it, the first
      // click arms it. The camera holds on the Working lane through the
      // departure (the done mark slides the board to the card's new lane;
      // the hold re-asserts the rest position), so the frame re-wrapping
      // the remaining member plays on camera.
      const camera = await boardScrollLeft(g);
      const point = await clickCardDoneCheckbox(g, "thr_column_sort", "Arm Mark Done");
      // Confirm and film the wipe; one self-healing retry re-aims the
      // checkbox when the first confirm's click missed the small hitbox.
      if (!(await confirmAndFilm(g, "thr_column_sort", point, camera, "departing", 10))) {
        const again = await armedPoint(g, "thr_column_sort");
        if (again !== null) {
          await confirmAndFilm(g, "thr_column_sort", again, camera, "departing-retry", 10);
        }
      }
      await g.shot("working-frame-holds-remainder", { hold: 1.2 });
      // The Done lane's own frame around the settled member.
      await g.scrollInto(DONE_FRAME, { hold: 0.6 });
      await g.shot("done-frame-wraps-settled", { hold: 2.2 });
    },
  },

  {
    id: "group-filter-child",
    params: "?groupBy=group&groupfamily=1",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_gf_parent"]',
    steps: async (g) => {
      // The unfiltered Group board: the Alpha parent card, and the
      // Beta-group child living in its own Beta lane.
      await g.scrollInto('[data-thread-card="thr_gf_parent"]', { hold: 0.6 });
      await g.shot("all-groups-at-rest", { hold: 1.4 });
      // The Group dropdown, summary reading "All groups".
      const trigger = await groupTrigger(g);
      await g.glide(trigger, { frames: 4 });
      await g.page.mouse.click(trigger.x, trigger.y);
      await g.waitFor('[role="listbox"][aria-label="Group"]', 8_000);
      await g.sleep(400);
      await g.shot("group-menu-open", { hold: 1.8 });
      // The pick: "Alpha rework" replaces the selection and closes.
      const alpha = await g.page.evaluate(() => {
        const el = [
          ...document.querySelectorAll('[role="listbox"][aria-label="Group"] [role="option"]'),
        ].find((candidate) => (candidate.textContent ?? "").trim() === "Alpha rework");
        if (el === null) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (alpha === null) throw new Error('no "Alpha rework" row in the Group dropdown');
      await g.glide(alpha, { frames: 4 });
      await g.page.mouse.click(alpha.x, alpha.y);
      await g.sleep(900);
      // The filtered board: the Beta lane is gone, and the parent card
      // keeps BOTH nested rows — the cross-group child included.
      await g.alignTo('[data-thread-card="thr_gf_parent"]');
      await g.shot("alpha-only-parent-whole", { hold: 2.4 });
    },
  },

  {
    id: "lane-chip-hover",
    params: "?groupBy=status",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The lane header at rest: bare name, caret, count.
      await g.shot("lane-header-at-rest", { hold: 1.2 });
      // Hover in: the name+caret pair takes the interactive fill and the
      // caret sharpens to full ink. The re-enter defeats the remount race:
      // the card the glide crossed releases its hover freeze as the pointer
      // leaves it, and the header it remounts under the stationary pointer
      // never sees the mouseenter — one pixel back and forth re-fires it.
      const trigger = await g.centerOf(LANE_TRIGGER);
      await g.glide(trigger, { frames: 5 });
      await g.page.mouse.move(trigger.x + 1, trigger.y + 1);
      await g.page.mouse.move(trigger.x, trigger.y);
      await g.sleep(400);
      await g.shot("chip-lit", { hold: 1.4 });
      // Hover out: the fill drops and the caret dims again.
      const off = await g.centerOf('[data-thread-card="thr_uat_queue"]');
      await g.glide(off, { frames: 5 });
      await g.sleep(300);
      await g.shot("chip-dropped", { hold: 1.0 });
      // Hover back: the chip returns — it is the hover state, not a one-off.
      await g.glide(trigger, { frames: 5 });
      await g.page.mouse.move(trigger.x + 1, trigger.y + 1);
      await g.page.mouse.move(trigger.x, trigger.y);
      await g.sleep(400);
      await g.shot("chip-relit", { hold: 1.6 });
    },
  },

  {
    id: "lane-dissolve",
    params: "?groupBy=status",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_deploy_fail"]',
    steps: async (g) => {
      // The Needs-you lane at rest: two cards wanting the operator.
      await g.shot("needs-you-lane-at-rest", { hold: 1.4 });
      // The camera holds on the lane through both departures: marking a
      // card done slides the board to the card's new lane (the attended
      // card's keep-in-view fit), which would pull the view to Done and
      // take the lane's close off camera.
      const camera = await boardScrollLeft(g);
      // The first mark: thr_permissions departs, the lane holds one card.
      const first = await clickCardDoneCheckbox(g, "thr_permissions", "Arm Mark Done");
      if (!(await confirmAndFilm(g, "thr_permissions", first, camera, "first-departing", 6))) {
        const again = await armedPoint(g, "thr_permissions");
        if (again !== null) {
          await confirmAndFilm(g, "thr_permissions", again, camera, "first-departing-retry", 6);
        }
      }
      await g.shot("lane-holds-one", { hold: 1.0 });
      // The second mark empties the lane: the ghost wipes out top-down
      // inside the lane's held frame (the card-transport clock: 400ms wipe,
      // 200ms collapse), then the lane closes with the ghost.
      const second = await clickCardDoneCheckbox(g, "thr_deploy_fail", "Arm Mark Done");
      if (!(await confirmAndFilm(g, "thr_deploy_fail", second, camera, "dissolve", 12))) {
        const again = await armedPoint(g, "thr_deploy_fail");
        if (again !== null) {
          await confirmAndFilm(g, "thr_deploy_fail", again, camera, "dissolve-retry", 12);
        }
      }
      await g.shot("lane-closed", { hold: 2.2 });
    },
  },
];
