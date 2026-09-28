---
type: checkpoint
timestamp: 2026-09-28T182745
responding-to: docs/plans/bb-sashay-parent-thread-lanes-thr_vmbgtditqp.md Unit B
---

## Checkpoint: Unit B green — renderer wired and app branches on "Parent thread"

**Responding to:** Unit B of the parent-thread-lanes plan (renderer + app wiring)

Per operator request, Unit B is complete.

What shipped in this unit:
- `components/parent-lane-board.tsx`: left rail of row labels, one vertical lane
  per family plus the Standalone lane, cells per row reusing `ThreadCard`,
  archived riders rendered under the family header, horizontal scrolling lanes.
  The header is clickable and opens the parent pane; cards open the child pane.
- `app.tsx` now branches on `groupBy === "parent"`: it calls
  `buildParentLanes(...)` instead of `assembleBoard(...)`, renders
  `ParentLaneBoard`, and suppresses the frozen-column logic (D14: lane
  membership is stable). The nesting toggle is left inert (D11) and sweep
  arming UI is not passed to the lane renderer (D12).
- Extracted `menuActionsFor` to component-scope `useCallback` so both board
  modes share the same right-click menu actions.
- Renderer tests in `tests/parent-lane-board.test.tsx` cover lane headers, header
  click, card click, child-count chip, archived riders, row rail, and the empty
  Standalone lane.

Verification:
- `npm test` passes (458 tests, 8 new renderer tests).
- `npx tsc --noEmit` passes.
- `npm run build` passes.

**Commits in this unit:** a004c32
