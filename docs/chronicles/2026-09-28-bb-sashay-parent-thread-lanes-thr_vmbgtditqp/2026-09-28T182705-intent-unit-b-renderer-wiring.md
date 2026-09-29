---
type: intent
timestamp: 2026-09-28T182705
responding-to: docs/chronicles/2026-09-28-bb-sashay-parent-thread-lanes-thr_vmbgtditqp/2026-09-28T182201-checkpoint-unit-a-model-green.md
---

## Intent: Unit B — lane board renderer and app wiring

**Responding to:** Unit A checkpoint (pure model green)

Per operator request, Unit B wires the parent-lane model into the UI:
- Build `components/parent-lane-board.tsx`: left rail of row labels, one vertical
  lane per family, cells per row reusing `ThreadCard`, archived riders under the
  header, lanes scroll horizontally.
- Branch `app.tsx` on `groupBy === "parent"`: call `buildParentLanes` instead of
  `assembleBoard`, render `ParentLaneBoard`, and keep the nesting toggle inert
  (D11) and sweep arming absent (D12) in this mode.
- Add renderer-level tests for the lane grid, header clicks, card clicks, and
  the Standalone lane.
- Verify with `npm test`, `npx tsc --noEmit`, and `npm run build`.

Success looks like: selecting "Parent thread" from the Group dropdown renders
family lanes with children in their state rows, headers open the parent pane,
cards open the child pane, and the build remains green.

**Commits in this unit:** none yet
