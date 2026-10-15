# UAT report

_Generated 2026-10-15T16:55:29.091Z by `npm run uat`._

## three-tier-grandchildren

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_3jfspvnikn-1/bb-plugin-focus-board/tests/manual/uat-grandchildren.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The grandchild renders under its parent row, indented right of it | pass | ✓ nested row under the family card (thr_gutter_family_c0); ✓ sub-row under its parent row (thr_gutter_family_c0_gc0 under thr_gutter_family_c0) |
| The child row and the grandchild sub-row both chip their ticket refs | pass | ✓ text visible: "Three-tier family fixture"; ✓ nested row chips its ticket #193 (thr_gutter_family_c0); ✓ nested row chips its ticket #191 (thr_gutter_family_c0_gc0) |
| The card's right gutter holds with the sub-row tier expanded | pass | ✓ thr_gutter_family respects the right gutter (≥4px on every surface) |
| Folding the family hides the child rows and the sub-row tier with them | pass | ✓ no nested row (thr_gutter_family_c0); ✓ no sub-row (thr_gutter_family_c0_gc0) |
| Unfolding restores both tiers, indent, chips, and gutter unchanged | pass | ✓ nested row under the family card (thr_gutter_family_c0); ✓ sub-row under its parent row (thr_gutter_family_c0_gc0 under thr_gutter_family_c0); ✓ thr_gutter_family respects the right gutter (≥4px on every surface); ✓ nested row chips its ticket #191 (thr_gutter_family_c0_gc0) |
