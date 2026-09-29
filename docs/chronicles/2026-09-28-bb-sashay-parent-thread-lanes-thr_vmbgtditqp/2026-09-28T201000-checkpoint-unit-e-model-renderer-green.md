---
type: checkpoint
timestamp: 2026-09-28T201000
responding-to: Unit E: implementation start
---

## Unit E: model + renderer green

Implemented and verified:

- `components/parent-lanes.ts`: replaced attention-derived lane ordering with family recency (`laneRecency` over parent + non-archived members, done children included); removed `walkLiveFamilyRank`, `standaloneLaneRank`, `standaloneRepresentative`, and `stateRank`; Standalone lane now trails family lanes. Added `ParentLaneSection` and `sectionParentLanes` for optional project grouping (sections order by most-recent lane, lanes within a section keep recency order, Standalone trailing).
- `components/preferences.ts`: added `PARENT_LANE_ORDER_KEY`, `ParentLaneOrder` type, and `parseParentLaneOrderStored` following the existing group-by pattern.
- `app.tsx`: persisted parent-lane order state, wired `parentLaneOrder` + `onParentLaneOrderChange` into `ParentLaneBoard`.
- `components/parent-lane-board.tsx`: added a small "Recency" / "By project" segmented toggle in the row rail; renders flat lanes in recency mode and grouped sections in project mode; extracted `Lane`, `Section`, `SectionHeader`, and `LaneOrderToggle` helpers.
- Tests: `tests/parent-lanes.test.ts` red-first (6 lane-order tests + 4 section tests); `tests/parent-lane-board.test.tsx` updated for new props.

Verification: `npx tsc --noEmit` and `npm test` both pass (465 tests).

**Commits in this unit:**
- `3e27191` Unit E: recency lane order + optional project grouping for parent-thread board
- `20e6031` Unit E: docs, UAT, and renderer toggle test
