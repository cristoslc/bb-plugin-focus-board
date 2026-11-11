/**
 * v1.7.11 demo storyboard (2026-11-11).
 *
 * One clip films the family-lane fix: a working family holds the Working
 * lane when one of its children's turns ends into an unread reply. Family A
 * (thr_demo_work) is the demo board's own working family — an idle parent
 * lifted into Working by two active children — so no seed fixture is needed;
 * the turn-end patch rides the harness's __uat.pushThreadUpdate, the v1.7.7
 * working-stays clip's driver. Under the shipped DRIVE_STATE_ORDER the
 * still-running sibling outranks the unread arm, so the family card stays
 * put; the pre-fix build dragged it into Unread.
 *
 *   npm run build
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-release-demos.mjs v1.7.11
 */

export const baseParams = "groupBy=status&demo=1";

export const demos = [
  {
    id: "working-family-holds-lane",
    params: "",
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    ready: '[data-thread-card="thr_demo_work"]',
    steps: async (g) => {
      const push = (threadId, patch) =>
        g.page.evaluate(
          ({ threadId, patch }) => {
            const harness = globalThis.__uat;
            if (!harness || typeof harness.pushThreadUpdate !== "function") {
              throw new Error("the harness exposes no __uat.pushThreadUpdate");
            }
            harness.pushThreadUpdate(threadId, patch);
          },
          { threadId, patch },
        );

      // The working family at rest in the Working lane: the parent card with
      // its nested rows, the before-picture the reply lands against.
      await g.scrollInto('[data-thread-card="thr_demo_work"]');
      await g.sleep(400);
      await g.shot("family-working-at-rest", { hold: 1.4 });

      // One child's turn ends into an unread reply: its row flips to the
      // unread arm while its sibling keeps running. The family card holds
      // the Working lane — the fix; the pre-fix build moved it to Unread.
      const now = Date.now();
      await push("thr_demo_work_c1", {
        status: "idle",
        runtimeStatus: "idle",
        isUnread: true,
        updatedAt: now,
        lastReadAt: now - 6 * 60 * 1000,
      });
      await g.sleep(1100);
      await g.shot("child-unread-family-holds", { hold: 2.6 });
    },
  },
];
