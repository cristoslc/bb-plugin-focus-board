# UAT report

_Generated 2026-11-05T17:48:54.144Z by `npm run uat`._

## family-state-server-persistence

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_8anu7u4dxz-1/bb-plugin-focus-board/tests/manual/uat-family-state.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Folding a family writes family_state_set with the fold, and never localStorage | pass | ✓ control present: "Expand subthreads"; ✓ family_state_set last called with {"key":"collapsedFamilies","id":"thr_gutter_family","on":true}; ✓ no family_state_merge call |
| The idle-children eye writes family_state_set with the hide | pass | ✓ control present: "Show idle child threads"; ✓ family_state_set last called with {"key":"hideIdleChildren","id":"thr_gutter_family","on":true} |
| A seeded server row renders folded and hidden on mount, with no localStorage | pass | ✓ control present: "Expand subthreads"; ✓ control present: "Show idle child threads"; ✓ no nested row (thr_gutter_family_c0) |
| Unfolding writes family_state_set with on false | pass | ✓ control present: "Collapse subthreads"; ✓ family_state_set last called with {"key":"collapsedFamilies","id":"thr_gutter_family","on":false} |
