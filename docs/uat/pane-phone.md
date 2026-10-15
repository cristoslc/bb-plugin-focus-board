# UAT report

_Generated 2026-10-15T11:59:36.257Z by `npm run uat`._

## pane-phone

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_zhgchh2yd9-1/bb-plugin-focus-board/tests/manual/uat-pane-phone.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a phone viewport the pane opens over the board (the full-screen sheet) | pass | ✓ pane shows thr_uat_queue |
| The compact header's actions menu carries Full Screen (the standalone button is dropped on compact) | pass | ✓ text visible: "Full Screen" |
| Choosing Full Screen runs the maximize path; the mock's navigation is a no-op so the pane stays | pass | ✓ pane shows thr_uat_queue; ✓ no refusal banner |
