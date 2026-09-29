# Checkpoint: Unit C — docs, coverage matrix, and UAT suite green

**Sashay:** bb-plugin-focus-board parent-thread-lanes (bb thread `thr_vmbgtditqp`, PR #9).

## Done

- Added the parent-lanes workflow paths to `docs/test-coverage-matrix.md`.
- Updated `README.md` to list "Parent thread" in the Group-by feature bullet.
- Added a `[Unreleased]` `### Added` entry to `CHANGELOG.md` describing the new
  pivoted Attention grid.
- Created `tests/manual/uat-parent-lanes.yaml` with six steps covering:
  - family lane and Standalone lane render;
  - lane header click opens the parent pane;
  - child card click opens the child pane;
  - deep-linked active child is scrolled into view horizontally;
  - a search that drops all families leaves the Standalone lane;
  - switching back to Attention renders normal columns.
- Extended the screenshot harness:
  - `scripts/screenshot/data.ts` now includes `thr_parent_lane` / `thr_child_lane`,
    a low-attention idle family that does not disturb existing UAT counts.
  - `scripts/screenshot/main.tsx` seeds `focus-board:search` from `?q=` so a
    UAT step can drive a search-filtered board state.
  - `scripts/screenshot/mock-sdk.tsx` gained a `threads.get` stub so the pane's
    inline-code link verifier does not throw in the harness.
- Added `aria-label={lane.label}` to parent-lane `<section>` elements so the
  UAT runner's `waitForSelector('section[aria-label]')` works.

## Verification

- `npm test` — 458 tests passed.
- `npx tsc --noEmit` — green.
- `npm run build` — green.
- `npm run uat -- tests/manual/uat-parent-lanes.yaml` — 6/6 steps passed;
  report at `docs/uat/parent-lanes.md`.

## Next

Unit D is the E2E run; it is already captured by the UAT suite above, so the
remaining work is the E2E chronicle and the final PR handoff.
