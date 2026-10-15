# UAT report

_Generated 2026-10-15T12:36:00.934Z by `npm run uat`._

## pane-reference-chips

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_8dujndeecq-1/bb-plugin-focus-board/tests/manual/uat-pane-reference-chips.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Agent-written reference tokens paint as labeled chips, not dead text | pass | ✓ text hidden: "@project:proj_api"; ✓ text hidden: "@thread:thr_glyph_glue#msg=12" |
| Clicking a thread chip opens that thread in the board's pane | pass | ✓ pane shows thr_glyph_glue; ✓ url ends with /board/t/thr_glyph_glue |
| Bare @thr_ / @proj_ id tokens paint as chips, a numeric marker stays raw | pass | ✓ text hidden: "@proj_api"; ✓ text hidden: "@thr_glyph_glue#msg=3"; ✓ text visible: "@21@" |
