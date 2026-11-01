# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## three-tier-grandchildren

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-grandchildren.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The grandchild renders under its parent row, indented right of it | pass | ✓ nested row under the family card (thr_gutter_family_c0); ✓ sub-row under its parent row (thr_gutter_family_c0_gc0 under thr_gutter_family_c0) |
| The child row and the grandchild sub-row both chip their ticket refs | pass | ✓ text visible: "Three-tier family fixture"; ✓ nested row chips its ticket #193 (thr_gutter_family_c0); ✓ nested row chips its ticket #191 (thr_gutter_family_c0_gc0) |
| The card's right gutter holds with the sub-row tier expanded | pass | ✓ thr_gutter_family respects the right gutter (≥4px on every surface) |
| Folding the family hides the child rows and the sub-row tier with them | pass | ✓ no nested row (thr_gutter_family_c0); ✓ no sub-row (thr_gutter_family_c0_gc0) |
| Unfolding restores both tiers, indent, chips, and gutter unchanged | pass | ✓ nested row under the family card (thr_gutter_family_c0); ✓ sub-row under its parent row (thr_gutter_family_c0_gc0 under thr_gutter_family_c0); ✓ thr_gutter_family respects the right gutter (≥4px on every surface); ✓ nested row chips its ticket #191 (thr_gutter_family_c0_gc0) |
| Releasing the grandchild sub-row on a column floor un-parents it entirely | pass | ✓ thread_reparent {"threadId":"thr_gutter_family_c0_gc0","parentThreadId":null}; ✓ no sub-row (thr_gutter_family_c0_gc0) |
| Releasing the grandchild sub-row on the column title un-parents it too | pass | ✓ thread_reparent {"threadId":"thr_gutter_family_c0_gc0","parentThreadId":null}; ✓ no sub-row (thr_gutter_family_c0_gc0) |
| Hovering the dragged grandchild over the floor rings the family amber | pass |  |
