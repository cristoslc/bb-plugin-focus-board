/**
 * v1.7.16 demo storyboard (2026-11-20).
 *
 * Seven bullets filmed, five skipped (the manifest and the release PR carry
 * the reasons): the thread-page action slot — the control mounts in bb's own
 * thread-page header, which the harness does not render (the mock captures
 * the registration only); the one-pane click's split — the thread lands in a
 * native bb pane the harness cannot render, so the observable is the host
 * call the uat-native-open suite asserts; the bb 0.49 stand-down — keys off
 * a host version the mock does not stage, and the visible result is board
 * chrome that no longer renders; the split/unsplit reload — a host window
 * action the harness cannot stage, and the fix proves an absence (the
 * loading flash gone); the directory reference — the outcome is host
 * navigation (the preferred editor opens), nothing the harness can render.
 *
 * - lane-bulk-fold: the A-while-ago lane's own menu folds all three seed
 *   families at once (Collapse all), then hides their idle children (the
 *   lane-menu suite's bulk-entries steps, on camera).
 * - sweep-lane-to-done: the same lane's sweep pill arms (N → Done) and
 *   confirms; the pill counts the batches out six at a time until the lane
 *   is empty (the sweep-stalls fix's pace is the story).
 * - unread-open-recenter: clicking the Unread lane's thr_rpc_auth opens the
 *   pane, the read mark (the mock host's setRead is a no-op, so the suite's
 *   push_update drives it) re-lanes the card into its idle bucket, and the
 *   board pans to keep it in view (the uat-views-mobile recenter steps).
 * - horizontal-family-rows: the View menu's Horizontal pick re-lays the
 *   lanes as rows; the A-while-ago row's big family expands through Show
 *   all, and the row grows to fit all nine child rows instead of cutting
 *   the card at the fixed height.
 * - phone-horizontal-labels: at 390×844 with laneDirection=horizontal, the
 *   label sits above the row and the cards span it; a touch pan scrolls the
 *   row so the next card peeks in.
 * - keys-stay-on-board: a planted editable pane (the probe-shortcut-typing
 *   staging, exactly where bb's thread chat sits) takes the "c" and the "/"
 *   as text with no composer and no search jump; with nothing focused, "c"
 *   still opens the New Thread dialog on the board.
 * - mention-chip-opens-thread: the pane on thr_review_pr with the host
 *   mention anchor (?mentionAnchor=1, the "File not found." regression's
 *   fixture) renders the agent's @thread: reference as bb's file:// anchor;
 *   clicking it opens the referenced thread in the pane instead.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.16
 */

export const baseParams = "groupBy=status";

const VIEW_MENU = '[role="listbox"][aria-label="View"]';

/** Click a selector inside a scope with the real pointer, after gliding. */
async function clickScoped(g, scope, selector, { settle = 0.8 } = {}) {
  const point = await g.page.evaluate(
    ({ scope, selector }) => {
      const root = document.querySelector(scope);
      const el = root === null ? null : root.querySelector(selector);
      if (el === null) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const box = el.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    },
    { scope, selector },
  );
  if (point === null) throw new Error(`no ${selector} inside ${scope}`);
  await g.glide(point, { frames: 4 });
  await g.page.mouse.click(point.x, point.y);
  await g.sleep(settle * 1000);
  return point;
}

/**
 * Pick a menu entry by its exact text. The lane menu's bulk entries are
 * role="menuitemradio" (menuPick only reaches role="menuitem"), so the
 * entries the recorder clicks by text need their own pick.
 */
async function menuRadio(g, label, { hoverHold = 0.8, settle = 0.7 } = {}) {
  await g.page.waitForFunction(
    (text) =>
      [...document.querySelectorAll('[role="menuitemradio"]')].some(
        (el) => el.textContent?.trim() === text,
      ),
    { timeout: 8_000 },
    label,
  );
  const entry = await g.page.evaluate((text) => {
    const el = [...document.querySelectorAll('[role="menuitemradio"]')].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    const box = el.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, label);
  await g.glide(entry, { frames: 4 });
  await g.shot(`mh${String(g.frames.length).padStart(3, "0")}`, { hold: hoverHold });
  await g.page.mouse.click(entry.x, entry.y);
  await g.shot(`mc${String(g.frames.length).padStart(3, "0")}`, { hold: settle });
  return entry;
}

export const demos = [
  {
    id: "lane-bulk-fold",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-column-id="idle-awhile"] [data-thread-card]',
    steps: async (g) => {
      // The A-while-ago lane at rest: three seed families, expanded, idle
      // children shown — the before-picture the bulk entries change.
      await g.scrollInto('[data-column-id="idle-awhile"]');
      await g.sleep(400);
      await g.shot("lane-at-rest", { hold: 1.4 });
      // The lane's own menu: the four bulk entries under the lane's order
      // rows. Collapse all folds every family in the lane in one write.
      await g.clickAria("Idle · A while ago lane actions");
      await g.sleep(500);
      await g.shot("lane-menu-open", { hold: 1.6 });
      await menuRadio(g, "Collapse all");
      await g.sleep(700);
      await g.shot("families-collapsed", { hold: 2.2 });
      // The second pair: hide the lane's idle children behind their cards.
      await g.clickAria("Idle · A while ago lane actions");
      await g.sleep(500);
      await menuRadio(g, "Hide idle children");
      await g.sleep(700);
      await g.shot("idle-children-hidden", { hold: 2.6 });
    },
  },

  {
    id: "sweep-lane-to-done",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-column-id="idle-awhile"] [data-thread-card]',
    params: "&scale=40",
    steps: async (g) => {
      // The scale fixture (?scale=40, issue #186) fattens the A-while-ago
      // lane with old idle threads — the busy board the bullet's numbers
      // name, so the sweep runs more than one batch of six.
      await g.scrollInto('[data-column-id="idle-awhile"]');
      await g.sleep(600);
      await g.shot("lane-at-rest", { hold: 1.4 });
      // Arm: the lane header's pill turns amber and names the destination.
      await clickScoped(g, '[data-column-id="idle-awhile"]', "[data-sweep-button]", { settle: 0.9 });
      await g.shot("sweep-armed", { hold: 1.8 });
      // Confirm: the cards go out six at a time, one repaint per batch —
      // the whole lane lands in Done in about half a second.
      await clickScoped(g, '[data-column-id="idle-awhile"]', "[data-sweep-button]", { settle: 0 });
      await g.shot("sweep-running", { hold: 1.4 });
      await g.sleep(700);
      await g.shot("lane-swept", { hold: 2.6 });
    },
  },

  {
    id: "unread-open-recenter",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_rpc_auth"]',
    steps: async (g) => {
      // The Unread lane in view, the card on screen: the before-picture.
      await g.scrollInto('[data-thread-card="thr_rpc_auth"]');
      await g.sleep(400);
      await g.shot("unread-in-view", { hold: 1.4 });
      // One click: the pane opens, and the read mark the host would send a
      // beat later re-lanes the card into its idle bucket — the board pans
      // to keep the card the operator just opened in view.
      await g.click('[data-thread-card="thr_rpc_auth"]', { settle: 0.6 });
      await g.page.evaluate(() => {
        const harness = globalThis.__uat;
        if (!harness || typeof harness.pushThreadUpdate !== "function") {
          throw new Error("the harness exposes no __uat.pushThreadUpdate");
        }
        harness.pushThreadUpdate("thr_rpc_auth", { isUnread: false });
      });
      await g.sleep(1200);
      await g.shot("board-followed", { hold: 2.8 });
    },
  },

  {
    id: "horizontal-family-rows",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The grouped board at rest: vertical lanes, families nested.
      await g.shot("lanes-vertical-at-rest", { hold: 1.2 });
      // The View menu's Horizontal pick re-lays the lanes as rows, in place.
      await g.clickAria("View");
      await g.waitFor(VIEW_MENU, 8_000);
      await g.sleep(400);
      await g.selectRadio("Lane direction", "Horizontal");
      await g.sleep(900);
      await g.shot("lanes-horizontal", { hold: 2.0 });
      // The A-while-ago row's big family: nine children capped behind Show
      // all. Picking it expands every row onto the card, and the row grows
      // to fit instead of cutting the card at the fixed height.
      await g.scrollInto('[data-thread-card="thr_big_family"]');
      await g.sleep(500);
      await g.shot("big-family-capped", { hold: 1.6 });
      await clickScoped(g, '[data-thread-card="thr_big_family"]', "[data-show-all-rows]", { settle: 0.8 });
      await g.shot("family-rows-on-card", { hold: 2.8 });
    },
  },

  {
    id: "phone-horizontal-labels",
    viewport: { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    ready: '[data-thread-card="thr_rpc_auth"]',
    params: "&laneDirection=horizontal",
    steps: async (g) => {
      // The phone's Horizontal board at rest: each lane's label stacked
      // above its cards, the row's whole width given to the cards, the next
      // card peeking in at the edge.
      await g.shot("phone-horizontal-at-rest", { hold: 1.6 });
      // A touch pan along the Unread row scrolls the row (the board does
      // not scroll at this width): the peeking card slides in. The finger
      // moves before the hold arms — and rests before lifting, so the
      // gesture ends a settled pan instead of a fling that springs back.
      const from = await g.centerOf('[data-thread-card="thr_rpc_auth"]');
      await g.touchStart(from.x, from.y);
      for (let step = 1; step <= 4; step += 1) {
        await g.touchMove(from.x - step * 50, from.y);
        await g.sleep(60);
      }
      await g.touchMove(from.x - 200, from.y);
      await g.sleep(250);
      await g.touchEnd();
      await g.sleep(700);
      await g.shot("row-scrolled", { hold: 2.4 });
    },
  },

  {
    id: "keys-stay-on-board",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // A planted editable pane, outside the board's own panel root exactly
      // where bb's thread chat sits (the probe-shortcut-typing staging, in
      // the board theme): a rich-text editor and a textarea.
      await g.page.evaluate(() => {
        const pane = document.createElement("div");
        pane.id = "demo-foreign-pane";
        pane.style.cssText =
          "position:fixed;left:16px;top:64px;z-index:99999;padding:10px;border:1px solid var(--border);" +
          "background:var(--card);color:var(--foreground);border-radius:10px;font-size:13px;display:flex;gap:8px";
        const editor = document.createElement("div");
        editor.id = "demo-foreign-editor";
        editor.setAttribute("contenteditable", "true");
        editor.style.cssText = "min-width:200px;min-height:22px;outline:none";
        const box = document.createElement("textarea");
        box.id = "demo-foreign-textarea";
        box.style.cssText = "min-width:120px;min-height:26px;font-size:13px";
        pane.append(editor, box);
        document.body.appendChild(pane);
      });
      await g.sleep(300);
      await g.shot("foreign-pane-planted", { hold: 1.4 });
      // "c" in another pane's editor: the letter lands as text and the New
      // Thread composer never opens.
      await g.click("#demo-foreign-editor", { settle: 0.4 });
      await g.page.keyboard.type("c", { delay: 60 });
      await g.sleep(600);
      await g.shot("letter-in-editor", { hold: 2.0 });
      // "/" in another pane's textarea: the slash lands and the board's
      // search field stays where it is.
      await g.click("#demo-foreign-textarea", { settle: 0.4 });
      await g.page.keyboard.type("find /", { delay: 60 });
      await g.sleep(600);
      await g.shot("slash-in-textarea", { hold: 2.0 });
      // With nothing focused, "c" is still the board's key: the New Thread
      // dialog opens.
      await g.page.evaluate(() => {
        const active = document.activeElement;
        if (active !== null && typeof active.blur === "function") active.blur();
      });
      await g.sleep(300);
      await g.pressKey("c", { settle: 1.0 });
      await g.shot("composer-on-the-board", { hold: 2.6 });
    },
  },

  {
    id: "mention-chip-opens-thread",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_review_pr"]',
    params: "&mentionAnchor=1",
    steps: async (g) => {
      // The pane on thr_review_pr, carrying the host mention anchor: bb
      // renders the agent's @thread: token as a file:// link into the
      // workspace's file preview — the click that used to read "File not
      // found."
      await g.domClick('[data-thread-card="thr_review_pr"] a', { settle: 1.4 });
      await g.waitFor('aside[aria-label^="Thread:"]', 8_000);
      await g.scrollInto('a[href*="thr_glyph_glue"]', { hold: 0.4 });
      await g.sleep(400);
      await g.shot("anchor-in-pane", { hold: 1.8 });
      // The pane claims the click and opens the referenced thread itself.
      await g.click('a[href*="thr_glyph_glue"]', { settle: 1.2 });
      await g.sleep(700);
      await g.shot("referenced-thread-open", { hold: 2.8 });
    },
  },
];
