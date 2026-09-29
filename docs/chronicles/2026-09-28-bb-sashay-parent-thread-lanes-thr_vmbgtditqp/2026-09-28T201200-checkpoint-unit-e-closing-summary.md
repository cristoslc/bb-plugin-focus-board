---
type: checkpoint
timestamp: 2026-09-28T201200
responding-to: operator steering on Unit E
---

## Unit E: closing summary

Shipped on branch `bb/sashay-parent-thread-lanes-thr_vmbgtditqp`:

- Recency is now the default lane order in parent-thread mode. A lane's recency is the most recent `updatedAt` across the parent and all non-archived members; done children count, archived members do not. Most-recent lane renders leftmost; ties break by the representative's derived order, so a pinned parent still floats leftmost. The Standalone lane always trails.
- Optional project grouping (D5a) is available through a "Recency" / "By project" segmented toggle in the lane board. When enabled, family lanes section by the parent's `projectId`, sections order by their most recent lane, and Standalone remains a trailing ungrouped section.
- The attention-derived lane walk (`walkLiveFamilyRank`, `standaloneLaneRank`, `standaloneRepresentative`) was removed; the row ladder and in-cell ordering are unchanged.
- Persistence follows the existing pattern: `focus-board:parentLaneOrder` in `components/preferences.ts`.

Verification passed:
- `npx tsc --noEmit`
- `npm test` — 466 tests
- `npm run build`
- `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run uat -- tests/manual/uat-parent-lanes.yaml` — all steps passed

Deferred: stored lane order (already in the plan's deferred list); lane-level sweep arming remains deferred.

**Commits in this unit:**
- `3e27191` Unit E: recency lane order + optional project grouping for parent-thread board
- `20e6031` Unit E: docs, UAT, and renderer toggle test
