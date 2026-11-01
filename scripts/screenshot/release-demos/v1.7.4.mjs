/**
 * v1.7.4 demo storyboards (2026-11-01).
 *
 * Six bullets, six gifs. The four touch clips stage the gesture the way the
 * touch UAT suites proved it: a wide touch device (1024x768, the column read
 * needs its drop target in frame) with `hasTouch`/`isMobile`, a real CDP
 * finger through `page.touchscreen`, and the 420ms hold the suites use (the
 * arm fires at 180ms). The pan clips move the finger BEFORE the arm deadline,
 * because a finger that moves first pans — that ordering IS the fix.
 *
 * The state-flip clip drives the harness's own `__uat.pushThreadUpdate`, the
 * same patch the attended-lane suite pushes, so the card re-lanes live while
 * its pane stays open.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.4
 */

/** Viewport point for a card: its centre, or a third along its flow axis. */
const pageCardPoint = (spec) => {
  const el = document.querySelector(`[data-thread-card="${spec.card}"]`);
  if (el === null) throw new Error(`no card ${spec.card}`);
  const box = el.getBoundingClientRect();
  const horizontal =
    document.querySelector("[data-columns-board]")?.getAttribute("data-lane-direction") ===
    "horizontal";
  const along = spec.edge === "before" ? 0.2 : spec.edge === "onto" ? 0.5 : 0.8;
  return {
    x: Math.round(horizontal ? box.left + box.width * along : box.left + box.width / 2),
    y: Math.round(horizontal ? box.top + box.height / 2 : box.top + box.height * along),
  };
};

/** Viewport point on the board's toolbar band, the origin no scroller owns. */
const pageToolbarPoint = () => {
  const toolbar = document.querySelector("[data-board-toolbar]");
  if (toolbar === null) throw new Error("no [data-board-toolbar]");
  const box = toolbar.getBoundingClientRect();
  return { x: Math.round(box.left + 8), y: Math.round(box.top + 3) };
};

/** Viewport point inside the rightmost lane's card list: nothing to its right. */
const pageLastLanePoint = () => {
  const lanes = [...document.querySelectorAll("section[data-column-id]")];
  const last = lanes[lanes.length - 1];
  if (last === undefined) throw new Error("no lane sections");
  const list = last.querySelector("[data-card-list]");
  if (list === null) throw new Error("last lane has no card list");
  const box = list.getBoundingClientRect();
  return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
};

export const baseParams = "";

export const demos = [
  // Added — holding a card on touch picks it up to drag it: the hold lifts a
  // floating snapshot that rides the thumb, the slide shows the insertion
  // line, and the release writes the same reorder a cursor drag does. The
  // menu facet rides the same gesture: no long-press menu opens over it.
  {
    id: "touch-hold-drag",
    params: "&groupBy=status",
    viewport: { width: 1024, height: 768, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    ready: '[data-thread-card="thr_ship_release"]',
    steps: async (g) => {
      const from = await g.page.evaluate(pageCardPoint, { card: "thr_ship_release" });
      const to = await g.page.evaluate(pageCardPoint, { card: "thr_rpc_auth", edge: "before" });
      const touch = g.page.touchscreen;
      await touch.touchStart(from.x, from.y);
      await g.sleep(420);
      await g.shot("picked-up", { hold: 1.2 });
      const steps = 8;
      for (let index = 1; index <= steps; index += 1) {
        await touch.touchMove(
          from.x + ((to.x - from.x) * index) / steps,
          from.y + ((to.y - from.y) * index) / steps,
        );
        await g.sleep(110);
        if (index === 4) await g.shot("rides", { hold: 1.0 });
      }
      await g.shot("insertion", { hold: 0.9 });
      await touch.touchEnd();
      await g.sleep(900);
      await g.shot("dropped", { hold: 1.8 });
    },
  },

  // Changed — a folded family's dots sit in a capsule for each child that has
  // sub-threads: Family D folded puts the capsule around the child whose own
  // grandchild hangs under it, and hovering the pill names the child and its
  // sub-thread count.
  {
    id: "family-dots-capsule",
    params: "&demo=1&collapsed=thr_demo_gutter",
    viewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_demo_gutter"]',
    steps: async (g) => {
      await g.scrollInto('[data-thread-card="thr_demo_gutter"]', { hold: 0.5 });
      await g.shot("folded", { hold: 1.6 });
      await g.hover('[data-child-dot-capsule="thr_demo_gutter_c1"]', { settle: 1.6 });
      await g.shot("hovered", { hold: 2.2 });
    },
  },

  // Fixed — a running thread reads Working even while its pane is open: the
  // pane is open on the card (the attention freeze active) when the thread
  // starts running, and the card re-lanes to Working live instead of sitting
  // under its old lane for as long as the pane stays open.
  {
    id: "attended-state-releanes",
    params: "&demo=1",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_demo_gutter"]',
    steps: async (g) => {
      await g.domClick('[data-thread-card="thr_demo_gutter"]', { settle: 1.2 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.shot("pane-open", { hold: 1.4 });
      await g.page.evaluate(() => {
        const harness = globalThis.__uat;
        if (!harness || typeof harness.pushThreadUpdate !== "function") {
          throw new Error("the harness exposes no __uat.pushThreadUpdate");
        }
        harness.pushThreadUpdate("thr_demo_gutter", {
          status: "active",
          runtimeStatus: "active",
        });
      });
      await g.sleep(1200);
      await g.shot("re-laned", { hold: 2.2 });
    },
  },

  // Fixed — a phone's board pans under a finger instead of lifting a card:
  // the finger moves before the hold finishes, so the gesture is a pan, the
  // board scrolls under it, and no card ever lifts.
  {
    id: "phone-board-pan",
    params: "&groupBy=status",
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    ready: '[data-thread-card="thr_ship_release"]',
    steps: async (g) => {
      const from = await g.page.evaluate(pageCardPoint, { card: "thr_ship_release" });
      const touch = g.page.touchscreen;
      await touch.touchStart(from.x, from.y);
      const steps = 10;
      for (let index = 1; index <= steps; index += 1) {
        await touch.touchMove(from.x, from.y + 30 * index);
        await g.sleep(90);
        if (index === 5) await g.shot("mid-pan", { hold: 1.0 });
      }
      await touch.touchEnd();
      await g.sleep(800);
      await g.shot("panned", { hold: 1.8 });
    },
  },

  // Fixed — a slide that starts on the toolbar pans the board, never the page
  // behind it: the finger lands on the toolbar band and drags, and the board's
  // own scroller answers instead of the gesture escaping the panel.
  {
    id: "toolbar-slide-pan",
    params: "&groupBy=status",
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    ready: "[data-board-toolbar]",
    steps: async (g) => {
      const from = await g.page.evaluate(pageToolbarPoint);
      const touch = g.page.touchscreen;
      await touch.touchStart(from.x, from.y);
      const steps = 10;
      for (let index = 1; index <= steps; index += 1) {
        await touch.touchMove(from.x, from.y + 26 * index);
        await g.sleep(90);
        if (index === 5) await g.shot("mid-pan", { hold: 1.0 });
      }
      await touch.touchEnd();
      await g.sleep(800);
      await g.shot("panned", { hold: 1.8 });
    },
  },

  // Fixed — a lane with nothing to its right stops trapping the slide: the
  // finger starts inside the last lane's card list and drags toward it, and
  // the pan hands outward to the board instead of rubber-banding in a list
  // with no range.
  {
    id: "lane-trap-slide",
    params: "&groupBy=status",
    viewport: { width: 1024, height: 768, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    ready: '[data-thread-card="thr_ship_release"]',
    steps: async (g) => {
      const from = await g.page.evaluate(pageLastLanePoint);
      const touch = g.page.touchscreen;
      await touch.touchStart(from.x, from.y);
      const steps = 10;
      for (let index = 1; index <= steps; index += 1) {
        await touch.touchMove(from.x + 34 * index, from.y);
        await g.sleep(90);
        if (index === 5) await g.shot("mid-slide", { hold: 1.0 });
      }
      await touch.touchEnd();
      await g.sleep(800);
      await g.shot("handed-out", { hold: 1.8 });
    },
  },
];
