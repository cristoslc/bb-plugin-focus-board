/**
 * v1.7.9 demo storyboard (2026-11-07).
 *
 * One bullet filmed, two skipped (the release PR and the coverage table
 * carry the reasons): the phone pane gestures skip board-wide work behind
 * an invisible sheet, and the board's paint-once load lands its mounts in
 * the same frame as paint on a local fixture — an absence and a timing,
 * neither distinguishable on screen.
 *
 * - errored-card-menu: an errored card's context menu offers Retry beside
 *   the Ignore error acknowledgment (the renamed Clear error); picking
 *   Ignore error acks the error with the old write and the card settles
 *   out of Needs you.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.9
 */

export const baseParams = "groupBy=status&demo=1";

const CARD = '[data-thread-card="thr_deploy_fail"]';
const MENU = '[role="menu"][aria-label="Thread actions"]';

export const demos = [
  {
    id: "errored-card-menu",
    viewport: { width: 1280, height: 800, deviceScaleFactor: 2 },
    ready: "[data-thread-card]",
    steps: async (g) => {
      // The errored card at rest in Needs you: the error arm the pair acts on.
      await g.glide(await g.centerOf(CARD), { frames: 4 });
      await g.shot("card-at-rest", { hold: 1.2 });
      // Right-click opens the card's menu: Retry beside Ignore error,
      // between the state toggles.
      await g.rightClickCard(CARD, { settle: 1.0 });
      await g.waitFor(MENU, 8_000);
      await g.sleep(400);
      await g.shot("menu-retry-beside-ignore-error", { hold: 2.6 });
      // The acknowledgment acts: the old write lifts the flag, the menu
      // closes, and the card settles out of Needs you.
      await g.menuPick("Ignore error", { settle: 1.0 });
      await g.sleep(600);
      await g.shot("ignored-card-settles", { hold: 2.4 });
    },
  },
];
