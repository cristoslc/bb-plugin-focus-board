/**
 * Release-safety screenshots: render the harness across the states a nightly
 * release's judgement gate reviews before tagging —
 *   - board and open thread pane at desktop 1920x1080, narrow-desktop
 *     1280x800, tablet 768x1024, and phone 390x844;
 *   - the two layouts other than the status columns: the parent-lane board
 *     (groupBy=parent, a separate component) and the group/family-boxes view
 *     (groupBy=group);
 *   - the compact filter ribbon open on phone (below the 767px compact
 *     breakpoint the palette collapses into a header toggle);
 *   - the empty-workspace board a first-run operator sees (`?empty=1`) in
 *     dark at desktop and phone;
 *   - a light-theme board; and
 *   - the three toolbar modals: settings (Behavior tab), new thread, and
 *     What's new (seeded unseen via ?lastSeenVersion).
 *
 * Run after `npm run build` (the harness loads dist/app.css), e.g. via
 * `npm run release-shots`. Uses the system Chrome through puppeteer-core
 * (nothing is downloaded); set CHROME_PATH if Chrome is not in the default
 * place. Captures into docs/release-safety/ and exits non-zero if any shot
 * fails.
 */
import { mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { startHarness } from "./harness.mjs";
import { notifyGateFailure } from "../release-notify.mjs";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = fileURLToPath(new URL("../../docs/release-safety/", import.meta.url));

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  narrowDesktop: { width: 1280, height: 800, deviceScaleFactor: 2 }, // laptop-ish
  tablet: { width: 768, height: 1024, deviceScaleFactor: 2 }, // iPad-ish
  phone: { width: 390, height: 844, deviceScaleFactor: 2 }, // iPhone 14-ish
};

/** A real mouse click starts an HTML5 drag and swallows the mouseup, so
 *  dispatch the click programmatically instead (same as shoot.mjs). */
async function openPane(target) {
  await target.evaluate(() => {
    const el = document.querySelector('a[href$="thr_permissions"]');
    if (!el) throw new Error("card not found");
    el.click();
  });
  await target.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** On a compact viewport (below 767px wide) the filter palette collapses
 *  into a header ribbon toggle (components/board-toolbar.tsx). */
async function openFilterRibbon(target) {
  await target.evaluate(() => {
    const el = document.querySelector('button[title="Show filter palette"]');
    if (!el) throw new Error("filter ribbon toggle not found");
    el.click();
  });
  await target.waitForSelector("#focus-board-filter-ribbon", { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** The toolbar's gear/gift button and the New thread button both open a
 *  dialog; the modal's tabs (Behavior, Appearance, What's new) switch via
 *  role="tab" inside it. On a prerelease dev build with unreleased bullets
 *  the gear always renders as the gift, so the settings-tab shots open it
 *  through the gift and then click their tab. */
async function openToolbarModal(target, titleOrText) {
  await target.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find(
      (el) =>
        el.getAttribute("title") === label || el.textContent?.trim() === label,
    );
    if (!button) throw new Error(`toolbar button "${label}" not found`);
    button.click();
  }, titleOrText);
  await target.waitForSelector('[role="dialog"]', { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function selectModalTab(target, label) {
  await target.evaluate((name) => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(
      (el) => el.textContent?.trim() === name,
    );
    if (!tab) throw new Error(`modal tab "${name}" not found`);
    tab.click();
  }, label);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const BASE_PARAMS = "groupBy=status&demo=1&collapsed=thr_demo_needs,thr_demo_work";
const LANES_PARAMS = "groupBy=parent&demo=1&collapsed=thr_demo_needs,thr_demo_work";
// A stale (never-current) unreleased fingerprint keeps What's-new content
// unseen: the toolbar's double-duty button always renders as the gift that
// opens the modal, whatever a previous page in this browser profile stored.
// The prerelease check in lib/whats-new.ts keys on this fingerprint, not on
// lastSeenVersion.
const MODAL_PARAMS = `${BASE_PARAMS}&lastSeenVersion=0.1.0&lastSeenUnreleased=0`;

const SHOTS = [
  { name: "board-desktop", viewport: "desktop" },
  { name: "pane-desktop", viewport: "desktop", pane: true },
  { name: "board-narrow-desktop", viewport: "narrowDesktop" },
  { name: "pane-narrow-desktop", viewport: "narrowDesktop", pane: true },
  { name: "board-tablet", viewport: "tablet" },
  { name: "pane-tablet", viewport: "tablet", pane: true },
  { name: "board-phone", viewport: "phone" },
  { name: "pane-phone", viewport: "phone", pane: true },
  { name: "palette-phone", viewport: "phone", palette: true },
  { name: "empty-desktop", viewport: "desktop", url: "empty=1", wait: 'div[role="status"]' },
  { name: "empty-phone", viewport: "phone", url: "empty=1", wait: 'div[role="status"]' },
  { name: "board-desktop-light", viewport: "desktop", theme: "light" },
  { name: "lanes-desktop", viewport: "desktop", url: LANES_PARAMS },
  { name: "lanes-phone", viewport: "phone", url: LANES_PARAMS },
  { name: "families-desktop", viewport: "desktop", url: "groupBy=group&demo=1&collapsed=thr_demo_needs,thr_demo_work" },
  { name: "modal-whats-new-desktop", viewport: "desktop", url: MODAL_PARAMS, toolbarButton: "What's new" },
  { name: "modal-settings-desktop", viewport: "desktop", url: MODAL_PARAMS, toolbarButton: "What's new", modalTab: "Behavior" },
  { name: "modal-appearance-desktop", viewport: "desktop", url: MODAL_PARAMS, toolbarButton: "What's new", modalTab: "Appearance" },
  { name: "modal-new-thread-desktop", viewport: "desktop", toolbarButton: "New thread" },
];

const harness = await startHarness(5199);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const failures = [];
try {
  await mkdir(OUT_DIR, { recursive: true });
  for (const shot of SHOTS) {
    const { name, viewport } = shot;
    const theme = shot.theme ?? "dark";
    console.log(`  ${name}`);
    // One page per shot: flipping one shared page's emulation state wedges
    // Chrome (see shoot.mjs's note), so each shot gets its own page. Media
    // features are set once per page, before navigation.
    const page = await browser.newPage();
    try {
      await page.setViewport(VIEWPORTS[viewport]);
      await page.emulateMediaFeatures([
        { name: "prefers-color-scheme", value: theme },
      ]);
      const url = `${harness.base}?${shot.url ?? BASE_PARAMS}`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      // The board mounts as per-column sections; the empty-workspace board
      // renders the EmptyState copy instead of any column, so its shots wait
      // on that role="status" region (empty-state.tsx) rather than a section.
      await page.waitForSelector(shot.wait ?? "section[aria-label]", {
        timeout: 30_000,
      });
      await page.evaluate((mode) => {
        document.documentElement.classList.toggle("dark", mode === "dark");
      }, theme);
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (shot.pane) await openPane(page);
      if (shot.palette) await openFilterRibbon(page);
      if (shot.toolbarButton) {
        await openToolbarModal(page, shot.toolbarButton);
        if (shot.modalTab) await selectModalTab(page, shot.modalTab);
      }
      await page.screenshot({
        path: `${OUT_DIR}${name}.png`,
        timeout: 30_000,
      });
    } catch (error) {
      failures.push(`${name}: ${error?.message ?? error}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
  harness.child.kill();
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAILED ${f}`);
  // The release notification contract (release.md §2b): name the failed gate
  // on the operator's channel before the throw. Best effort; the throw's own
  // exit code is untouched.
  await notifyGateFailure({
    gate: "release-shots",
    detail: `${failures.length} of ${SHOTS.length} shots failed`,
  });
  throw new Error(`${failures.length} of ${SHOTS.length} release-safety shots failed`);
}
console.log(`${SHOTS.length} shots captured in ${OUT_DIR}`);