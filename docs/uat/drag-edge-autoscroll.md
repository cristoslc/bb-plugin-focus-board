# UAT report

_Generated 2026-11-05T17:30:14.627Z by `npm run uat`._

## drag-edge-autoscroll

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_8anu7u4dxz-1/bb-plugin-focus-board/tests/manual/uat-drag-autoscroll.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A cursor drag parked at the board's right edge pans the board and drops in the revealed Done lane | pass | ✓ card thr_pane_padding outside the columns board's view; ✓ board x offset = 0; ✓ edge pan revealed the drop target; ✓ board x offset 1200≤1420≤; ✓ called done_set; ✓ done order; ✓ stored order {"done":["thr_review_pr"]} |
| Parking the pointer at the board's edge with no drag in flight pans nothing | pass | ✓ board x offset = 0 |
| With the board scrolled to its far end, a drag parked at the left edge pans back to the Unread lane | pass | ✓ edge pan revealed the drop target; ✓ board x offset ≤520≤1100; ✓ stored order {"status:unread":["thr_rpc_auth","thr_icon_lazy"]} |
| A cursor drag parked at the rows board's bottom edge pans it vertically and drops in the revealed Unread row | pass | ✓ card thr_rpc_auth outside the columns board's view; ✓ board y offset = 0; ✓ edge pan revealed the drop target; ✓ board y offset 300≤540≤; ✓ unread order; ✓ stored order {"status:unread":["thr_roadmap"]} |
| Parking the pointer at the rows board's bottom edge with no drag in flight pans nothing | pass | ✓ board y offset = 0 |
| A cursor drag parked at a row's right edge pans that row's card flow, and the drop lands in it | pass | ✓ card thr_gutter_family outside the columns board's view; ✓ lane idle-awhile x offset = 0; ✓ board x offset = 0; ✓ edge pan revealed the drop target; ✓ lane idle-awhile x offset 100≤390≤; ✓ board x offset = 0; ✓ stored order {"status:idle-awhile":["thr_parent_lane","thr_proj_family","thr_big_family","thr_grouping_spike"]} |
