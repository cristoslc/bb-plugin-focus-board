/**
 * v1.7.0 demo storyboards (2026-10-22).
 *
 * Captured against the v1.7.0 tag's own build: the horizontal row board, the
 * parent view's row sweeps, and the settings' appearance tabs all shipped in
 * this release, so the release's own tree is what the gifs show.
 *
 * The two wallpaper demos (2026-11-04) complete this release's coverage: the
 * crop and framing bullets waited on a seeded photo wallpaper the tag's
 * harness never had (gradients only), so they ride the `?wallpaper=photo`
 * fixture (`assets/wallpaper-photo.png`) added afterward. The capture still
 * runs on the tag's own build — the fixture seeds a wallpaper document, not
 * product code; the crop controls, the paint, and the pane are all this
 * release's tree.
 *
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.0
 */
export const baseParams = "demo=1&collapsed=thr_demo_needs";

const WORKPULSE = "?workpulse=3&collapsedGroups=grp_wp_0,grp_wp_1,grp_wp_2";

export const demos = [
  // Added — the board's lanes can run horizontal, chosen in Appearance.
  {
    id: "horizontal-lanes",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.shot("columns", { hold: 1.4 });
      await g.clickAria("Focus Board settings", { settle: 1.2 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.clickButton("Appearance", { settle: 1.2 });
      await g.shot("appearance", { hold: 1.4 });
      await g.selectRadio("Lane direction", "Horizontal", { settle: 1.2 });
      await g.pressKey("Escape", { settle: 1.6 });
      await g.shot("rows", { hold: 2.4 });
    },
  },

  // Added — every sweepable Parent-view row carries its own sweep.
  {
    id: "row-sweep",
    params: "&groupBy=parent&collapsed=thr_demo_needs",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.shot("lanes", { hold: 1.2 });
      await g.clickAria("Arm sweep", { settle: 1.6 });
      await g.shot("armed", { hold: 2.0 });
    },
  },

  // Added — the search field gains a search button while it holds text and is
  // focused.
  {
    id: "search-button",
    steps: async (g) => {
      await g.shot("rest", { hold: 1.0 });
      await g.click('[aria-label="Search threads"]', { settle: 0.6 });
      await g.typeText("rank", { settle: 1.0 });
      await g.shot("button", { hold: 1.8 });
      await g.pressKey("Escape", { settle: 0.8 });
      await g.click('[aria-label="Search threads"]', { settle: 1.4 });
      await g.shot("back", { hold: 1.6 });
      await g.clickAria("Search", { settle: 1.4 });
      await g.shot("reconfirmed", { hold: 1.8 });
    },
  },

  // Added — a keyboard shortcut opens the New Thread composer.
  {
    id: "new-thread-shortcut",
    steps: async (g) => {
      await g.shot("board", { hold: 1.2 });
      await g.page.mouse.move(700, 500);
      await g.pressKey("c", { settle: 1.8 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.shot("composer", { hold: 2.4 });
    },
  },

  // Added — a family box folds into one normal card, and unfolds again.
  {
    id: "group-box-fold",
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.scrollInto('[data-group-box="grp_chat_imagegent"]', { hold: 0.5 });
      await g.shot("box", { hold: 1.2 });
      await g.clickAria("Collapse group", { settle: 1.6 });
      await g.shot("folded", { hold: 2.0 });
      await g.clickAria("Expand group", { settle: 1.6 });
      await g.shot("expanded", { hold: 2.0 });
    },
  },

  // Changed — opening a thread holds its card in the spotlight while the rest
  // of the board recedes.
  {
    id: "pane-spotlight",
    steps: async (g) => {
      await g.shot("board", { hold: 1.0 });
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.6 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.park(560, 520);
      await g.shot("spotlight", { hold: 2.4 });
    },
  },

  // Fixed — the thread pane stops before the board runs out of room.
  {
    id: "pane-width-floor",
    steps: async (g) => {
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.shot("open", { hold: 1.2 });
      const handle = await g.centerOf('[role="separator"][aria-label="Resize thread pane"]');
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 320, y: handle.y, frames: 8 }],
        { settle: 1.8 },
      );
      await g.shot("floor", { hold: 2.4 });
    },
  },

  // Fixed — the search field steps down to "Search", then to the magnifier,
  // instead of painting half a word.
  {
    id: "search-placeholder-step",
    steps: async (g) => {
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(600);
      await g.shot("wide", { hold: 1.4 });
      const handle = await g.centerOf('[role="separator"][aria-label="Resize thread pane"]');
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 860, y: handle.y, frames: 6 }],
        { settle: 1.6 },
      );
      await g.dragPath(
        '[role="separator"][aria-label="Resize thread pane"]',
        [{ x: 760, y: handle.y, frames: 5 }],
        { settle: 1.8 },
      );
      await g.shot("narrow", { hold: 2.4 });
    },
  },

  // Fixed — a big family folds on whole rows and reveals the rest in one click.
  {
    id: "family-show-all",
    clip: '[data-thread-card="thr_demo_big"]',
    clipPad: 14,
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.shot("folded", { hold: 1.4 });
      await g.click('[data-show-all-rows]', { settle: 1.8 });
      await g.shot("revealed", { hold: 2.4 });
    },
  },

  // Fixed — a Forgejo chip names its item, not its host.
  {
    id: "cove-chip",
    clip: '[data-thread-card="thr_chips_cove"]',
    clipPad: 16,
    steps: async (g) => {
      await g.shot("card", { hold: 1.2 });
      await g.hover('[data-thread-card="thr_chips_cove"] [data-ticket-chip]', { settle: 1.8 });
      await g.shot("chip", { hold: 2.2 });
    },
  },

  // Added — a child thread started from a grouped parent joins its group; the
  // dialog names the group before the prompt is spent.
  {
    id: "child-joins-group",
    params: "&collapsed=thr_demo_needs",
    steps: async (g) => {
      await g.scrollInto('[data-group-box="grp_chat_imagegent"]', { hold: 0.4 });
      const member = await g.centerOf('[data-group-box="grp_chat_imagegent"] [data-thread-card]');
      await g.glide(member, { frames: 4 });
      await g.rightClickCard('[data-group-box="grp_chat_imagegent"] [data-thread-card]', {
        settle: 1.2,
      });
      await g.menuPick("New child thread…", { settle: 1.6 });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.shot("dialog", { hold: 2.4 });
    },
  },

  // Added — a collapsed family's working dots breathe at the thread's token
  // rate: three folded boxes, three measured rates.
  {
    id: "dot-rate-pulse",
    params: WORKPULSE.replace(/^\?/, "&"),
    clip: '[data-collapsed-group="grp_wp_0"]',
    clipPad: 12,
    gifWidth: 900,
    steps: async (g) => {
      await g.shot("still", { hold: 0.8 });
      await g.burst("pulse", { frames: 26, hold: 0.13 });
    },
  },

  // Fixed — hiding idle children no longer buries a busy grandchild. The
  // fixture (`?idlebusy=1`) is three tiers under an idle root: the idle leaf
  // disappears with the filter on, while the idle child that hosts a running
  // grandchild keeps its row (and the grandchild with it).
  {
    id: "idle-filter-keeps-the-busy-grandchild",
    params: "&idlebusy=1",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_idle_busy_root"]',
    setup: async (g) => {
      await g.alignTo('[data-thread-card="thr_idle_busy_root"]');
      await g.clipUnion(['[data-thread-card="thr_idle_busy_root"]'], 28);
    },
    steps: async (g) => {
      await g.shot("whole-family", { hold: 1.6 });
      await g.domClick('[data-thread-card="thr_idle_busy_root"] [data-idle-children-toggle]', {
        settle: 1.2,
      });
      await g.shot("filtered", { hold: 2.6 });
    },
  },

  // Added — the wallpaper crop tunes over the image itself. `?wallpaper=photo`
  // seeds the harness's photo fixture as an untouched-default layer, so the
  // Appearance picker's preview paints the image at its own (16:9) aspect with
  // the board's paint frame laid over it. The setup silently opens the dialog
  // and pins the clip before the first captured frame (the lead-in), so the
  // gif's every frame is clipped and the encoder's interframe diff holds: the
  // first pass let the full-page opening frames mix sizes into one concat and
  // the gif landed at 39MB. The steps then drive all three crop controls: the
  // fit toggle (letterbox bars vanish into a filled, cropped paint), the zoom
  // slider (the frame shrinks inside the image), and a drag on the preview (the
  // frame reframes to the pointer).
  {
    id: "wallpaper-crop-tuning",
    params: "&wallpaper=photo",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    gifWidth: 760,
    setup: async (g) => {
      // Uncaptured path to the picker: a real click on the settings gear, the
      // Appearance tab, and the wallpaper block scrolled to centre.
      await g.page.evaluate(() => {
        const gear = [...document.querySelectorAll("button")].find((el) =>
          (el.getAttribute("aria-label") ?? "").startsWith("Focus Board settings"),
        );
        if (!(gear instanceof HTMLElement)) throw new Error("no settings gear in the toolbar");
        gear.click();
      });
      await g.waitFor('[role="dialog"]', 8_000);
      await g.sleep(400);
      await g.page.evaluate(() => {
        const tab = [...document.querySelectorAll("button")].find(
          (el) => (el.textContent ?? "").trim().startsWith("Appearance"),
        );
        if (!(tab instanceof HTMLElement)) throw new Error("no Appearance tab in the settings dialog");
        tab.click();
      });
      await g.waitFor("[data-wallpaper-viewport]", 8_000);
      // Let the picker settle before scrolling: the edge-color sampler's one
      // commit fires here, and its re-render resets the dialog's scroll — a
      // clip measured before it frames a scrolled-back region.
      await g.sleep(1600);
      await g.page.evaluate(() => {
        const preview = document.querySelector("[data-wallpaper-viewport]");
        if (preview instanceof HTMLElement) preview.scrollIntoView({ block: "center", behavior: "instant" });
      });
      await g.sleep(500);
      // The story's stage: the preview plus the url/dim/fit/zoom rows under it.
      await g.clipUnion(
        [
          "[data-wallpaper-viewport]",
          '[aria-label="Wallpaper image url"]',
          '[aria-label="Wallpaper fit: fill"]',
          '[aria-label="Wallpaper zoom"]',
        ],
        16,
      );
    },
    steps: async (g) => {
      await g.shot("letterbox", { hold: 1.8 });
      // The fit toggle: the control sits on camera inside the pinned clip, so
      // click it without the scrollIntoView clickAria parks — scrolling the
      // dialog here would slide the clip's content a beat later.
      const fill = await g.rectOf('[aria-label="Wallpaper fit: fill"]');
      if (fill === null) throw new Error("the picker has no fill toggle");
      const fillPoint = { x: fill.x + fill.width / 2, y: fill.y + fill.height / 2 };
      await g.glide(fillPoint, { frames: 4 });
      await g.page.mouse.click(fillPoint.x, fillPoint.y);
      await g.shot("filled", { hold: 2.0 });
      // The zoom slider: press at its thumb (the untouched layer sits at 1,
      // the track's left end) and walk it to about 60% while the paint's
      // frame shrinks around the focal point.
      const zoom = await g.rectOf('[aria-label="Wallpaper zoom"]');
      if (zoom === null) throw new Error("the picker has no zoom slider");
      const thumb = { x: zoom.x + 4, y: zoom.y + zoom.height / 2 };
      await g.glide(thumb, { frames: 3 });
      await g.page.mouse.move(thumb.x, thumb.y);
      await g.page.mouse.down();
      const travel = zoom.width - 8;
      for (let i = 1; i <= 8; i += 1) {
        const x = thumb.x + (travel * 0.6 * i) / 8;
        await g.page.mouse.move(x, thumb.y);
        await g.syncCursor(x, thumb.y);
        await g.shot(`zoom-${String(i).padStart(2, "0")}`, { hold: g.frameSeconds });
      }
      await g.page.mouse.up();
      await g.shot("zoomed", { hold: 1.4 });
      // The focal-point drag: pressing the preview reframes the crop window
      // to the pointer, then the drag walks it toward the sun.
      const box = await g.rectOf("[data-wallpaper-viewport] [data-wallpaper-imagebox]");
      if (box === null) throw new Error("the picker preview has no image box");
      await g.glide({ x: box.x + box.width * 0.32, y: box.y + box.height * 0.4 }, { frames: 3 });
      await g.page.mouse.down();
      await g.shot("grab", { hold: 0.5 });
      for (let i = 1; i <= 8; i += 1) {
        const x = box.x + box.width * (0.32 + 0.44 * (i / 8));
        const y = box.y + box.height * (0.4 + 0.18 * (i / 8));
        await g.page.mouse.move(x, y);
        await g.syncCursor(x, y);
        await g.shot(`reframe-${String(i).padStart(2, "0")}`, { hold: g.frameSeconds });
      }
      await g.page.mouse.up();
      await g.shot("reframed", { hold: 2.0 });
    },
  },

  // Added — the wallpaper frames the window, not the board's viewport. The
  // seeded photo paints into a window-sized box behind the board; the pane's
  // open and close below only carve the porthole the board looks through. The
  // board at rest shows the letterboxed paint; opening the thread pane covers
  // the pine shore without moving the sun, ridges, or bars; closing it
  // restores the view. (The pane's own resize drag is pointer-capture based
  // on this build; the open/close pair is the bullet's named gesture.)
  {
    id: "wallpaper-frames-window",
    params: "&wallpaper=photo",
    viewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
    steps: async (g) => {
      await g.shot("board", { hold: 1.0 });
      await g.domClick('[data-thread-card="thr_demo_work"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.sleep(500);
      await g.shot("pane-open", { hold: 2.0 });
      await g.domClick('[aria-label="Close thread pane"]', { settle: 1.4 });
      await g.shot("board-restored", { hold: 2.2 });
    },
  },
];