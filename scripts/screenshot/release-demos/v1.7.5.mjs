/**
 * v1.7.5 demo storyboard (2026-11-03).
 *
 * One bullet, one gif: dragging a card against a board edge pans the board.
 * The clip stages the gesture exactly the way the six-step uat-drag-autoscroll
 * suite proved it in real Chrome: a synthetic HTML5 drag from a card in the
 * Unread lane, parked inside the columns board's right edge zone, held there
 * while the autoscroll loop pans the board to its far end and reveals the
 * Done lane, then glided back inward — the pan stops the moment the pointer
 * leaves the zone — and dropped on the revealed slot's leading corner, the
 * same dragover + drop + dragend the suite's finish stage commits.
 *
 * The park fires its dragovers through page.evaluate only: a CDP mousemove
 * per frame throttles the loop to a third of its pace (measured 65px/s vs
 * 180px/s), and the pointer is parked anyway. The cursor overlay is synced on
 * the approach and the inward glide, where the pointer actually moves.
 *
 * Viewport 1024x640 is what gives the edge bite: the demo board's nine lanes
 * span 2444px horizontally (range 1424), so the Done lane starts fully
 * offscreen and the pan's full travel is the story. Parked 16px inside the
 * 48px zone the loop runs ~280px/s, so the hold spans the whole pan.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.5
 */

export const baseParams = "";

export const demos = [
  {
    id: "drag-edge-pan",
    params: "&groupBy=status",
    viewport: { width: 1024, height: 640, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_review_pr"]',
    steps: async (g) => {
      const SOURCE = '[data-thread-card="thr_review_pr"]';
      const SLOT = '[data-rank-slot="thr_pane_padding"]';

      // The park point: 16px inside the board's right edge (the zone is 48px).
      const park = await g.page.evaluate(() => {
        const board = document.querySelector("[data-columns-board]");
        if (board === null) throw new Error("no [data-columns-board]");
        const box = board.getBoundingClientRect();
        return { x: Math.round(box.right - 16), y: Math.round(box.top + box.height / 2) };
      });

      const dragoverAt = (point) =>
        g.page.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          el?.dispatchEvent(
            new DragEvent("dragover", {
              bubbles: true,
              cancelable: true,
              dataTransfer: window.__demoDrag,
              clientX: x,
              clientY: y,
            }),
          );
        }, point);

      // Start the drag on the source card's draggable anchor.
      const from = await g.centerOf(SOURCE);
      await g.park(from.x, from.y);
      await g.page.evaluate((sel) => {
        const anchor =
          document.querySelector(`${sel} a[draggable]`) ?? document.querySelector(sel);
        if (!(anchor instanceof HTMLElement)) throw new Error(`drag source ${sel} not found`);
        window.__demoDrag = new DataTransfer();
        anchor.dispatchEvent(
          new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.__demoDrag }),
        );
      }, SOURCE);

      // Approach: carry the card toward the edge, cursor riding along.
      const steps = 4;
      for (let index = 1; index <= steps; index += 1) {
        const x = from.x + ((park.x - from.x) * index) / steps;
        const y = from.y + ((park.y - from.y) * index) / steps;
        await g.page.mouse.move(x, y);
        await g.syncCursor(x, y);
        await dragoverAt({ x, y });
        await g.shot(`approach-${index}`, { hold: 0.3 });
      }

      // Parked in the zone: dragover-only frames while the loop pans the board
      // and reveals the Done lane. The overlay arrow stays put because the
      // pointer does.
      const parkFrames = 18;
      for (let index = 1; index <= parkFrames; index += 1) {
        await dragoverAt(park);
        await g.shot(`park-${index}`, { hold: 0.3 });
      }

      // Inward: the pan stops, and the card glides to the revealed slot's
      // LEADING corner — the insertion edge, not the card's mid, which the
      // app reads as a nest attempt and no-ops.
      const corner = await g.centerOf(SLOT, { xRatio: 0.04, yRatio: 0.04 });
      const glideSteps = 6;
      for (let index = 1; index <= glideSteps; index += 1) {
        const x = park.x + ((corner.x - park.x) * index) / glideSteps;
        const y = park.y + ((corner.y - park.y) * index) / glideSteps;
        await g.page.mouse.move(x, y);
        await g.syncCursor(x, y);
        await dragoverAt({ x, y });
        await g.shot(`glide-${index}`, { hold: 0.3 });
      }

      // The suite's finish stage: dragover + drop on the slot at the corner
      // coordinates, then dragend on the source anchor.
      await g.page.evaluate(({ sel, x, y, fromSel }) => {
        const slot = document.querySelector(sel);
        if (slot === null) throw new Error(`drop target ${sel} not found`);
        const point = {
          bubbles: true,
          cancelable: true,
          dataTransfer: window.__demoDrag,
          clientX: x,
          clientY: y,
        };
        slot.dispatchEvent(new DragEvent("dragover", point));
        slot.dispatchEvent(new DragEvent("drop", point));
        const anchor =
          document.querySelector(`${fromSel} a[draggable]`) ?? document.querySelector(fromSel);
        anchor?.dispatchEvent(
          new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer: window.__demoDrag }),
        );
        window.__demoDrag = undefined;
      }, { sel: SLOT, x: corner.x, y: corner.y, fromSel: SOURCE });

      // Let the card's entrance animation finish before the closing frame.
      await g.sleep(700);
      await g.shot("dropped", { hold: 1.8 });
    },
  },
];
