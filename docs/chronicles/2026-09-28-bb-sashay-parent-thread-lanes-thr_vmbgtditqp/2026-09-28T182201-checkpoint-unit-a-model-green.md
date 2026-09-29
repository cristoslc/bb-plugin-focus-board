---
type: checkpoint
timestamp: 2026-09-28T182201
responding-to: docs/plans/bb-sashay-parent-thread-lanes-thr_vmbgtditqp.md Unit A
---

## Checkpoint: Unit A green — parent-lane pure model

**Responding to:** Unit A of the parent-thread-lanes plan (pure model + tests, red then green)

Per operator request, Unit A is complete. I wrote `tests/parent-lanes.test.ts` first against the planned pure-model contract, ran it red, then implemented `components/parent-lanes.ts` until green.

What shipped in this unit:
- `components/parent-lanes.ts` with `buildParentLanes(threads, doneIds, now, doneTimes?)`, returning ordered family lanes plus the Standalone catch-all lane.
- Fixed row ladder from `STATUS_COLUMN_ORDER` + Done at the bottom, with row labels mirroring the Attention columns.
- Lane order by most-attention-requiring live family member (D5), tiebreak by parent derived order so pinned parents float left (D13).
- Cell order: urgent children first, then derived order; stored ranks ignored (D6).
- Done row sorts by `doneRecencyCompare` when `doneTimes` are supplied (D9).
- Archived children returned as `archivedChildren` riders under the family header (D7), never in row cells.
- `GroupBy` extended with `"parent"`, `GROUP_BY_OPTIONS` adds "Parent thread", and `parseGroupStored` in `components/preferences.ts` round-trips the new value.

Verification:
- `npm test` passes (450 tests, including 32 new parent-lane tests).
- `npx tsc --noEmit` passes.

**Commits in this unit:** 9cc31fd
