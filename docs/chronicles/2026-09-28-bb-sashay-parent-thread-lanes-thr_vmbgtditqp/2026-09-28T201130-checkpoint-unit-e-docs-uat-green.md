---
type: checkpoint
timestamp: 2026-09-28T201130
responding-to: Unit E: model + renderer green
---

## Unit E: docs, UAT, and full verification green

Housekeeping completed:

- `docs/test-coverage-matrix.md`: updated the "Parent lane order" row to match the new recency rule and added a "Parent lane project grouping" row.
- `README.md`: added one clause to the Group-by bullet mentioning parent-thread recency and the optional project grouping toggle.
- `CHANGELOG.md`: updated the `[Unreleased]` parent-thread entry to describe recency-by-default and the project-grouping toggle.
- `tests/manual/uat-parent-lanes.yaml`: added steps exercising the lane-order toggle (default Recency, switch to By project, switch back) and verified the suite passes.
- `tests/parent-lane-board.test.tsx`: added a cheap test that clicking "By project" invokes `onParentLaneOrderChange`.

Verification: `npx tsc --noEmit`, `npm test` (466 tests), `npm run build`, and `CHROME_PATH=... npm run uat -- tests/manual/uat-parent-lanes.yaml` all pass.

**Commits in this unit:**
