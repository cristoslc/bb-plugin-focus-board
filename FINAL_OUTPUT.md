# Unit E report: recency lane order + optional project grouping

Branch: `bb/sashay-parent-thread-lanes-thr_vmbgtditqp`

## What changed

- `components/parent-lanes.ts`: default lane ordering is now family recency (max `updatedAt` over parent + non-archived members, done children included, archived excluded). Removed the attention-derived lane walk (`walkLiveFamilyRank`, `standaloneLaneRank`, `standaloneRepresentative`, `stateRank`). Added `ParentLaneSection` and `sectionParentLanes` for optional project grouping.
- `components/preferences.ts`: added `PARENT_LANE_ORDER_KEY`, `ParentLaneOrder` type, and `parseParentLaneOrderStored`.
- `app.tsx`: reads/writes the lane-order preference and passes it to `ParentLaneBoard`.
- `components/parent-lane-board.tsx`: added a small "Recency" / "By project" segmented toggle; renders flat recency lanes or project sections (with Standalone always trailing).
- `tests/parent-lanes.test.ts`: red-first suite covering recency order, done-child last touch, ties, pinned tiebreak, archived exclusion, project sections, section ordering, and Standalone trailing.
- `tests/parent-lane-board.test.tsx`: added a cheap toggle click test.
- `docs/test-coverage-matrix.md`: updated lane-order row; added project-grouping row.
- `README.md`: Group-by bullet now mentions parent-thread recency + project toggle.
- `CHANGELOG.md`: `[Unreleased]` parent-thread entry now describes recency default and By project toggle.
- `tests/manual/uat-parent-lanes.yaml`: added toggle steps (default Recency, switch to By project, switch back).

## Verification

| Command | Result |
|---------|--------|
| `npx tsc --noEmit` | pass |
| `npm test` | 466 tests pass |
| `npm run build` | pass |
| `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run uat -- tests/manual/uat-parent-lanes.yaml` | all steps passed |

## Commit SHAs

- `3e27191` Unit E: recency lane order + optional project grouping for parent-thread board
- `20e6031` Unit E: docs, UAT, and renderer toggle test

## Deferred

Stored lane order and lane-level sweep arming remain deferred (already listed in the plan's deferred section).
