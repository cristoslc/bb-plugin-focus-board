# UAT report

_Generated 2026-11-05T17:30:14.627Z by `npm run uat`._

## attended-lane

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_8anu7u4dxz-1/bb-plugin-focus-board/tests/manual/uat-attended-lane.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A card open in the pane re-lanes to Working when its row turns active | pass | ✓ board invariants; ✓ pane shows thr_rpc_auth; ✓ no refusal banner; ✓ unread order; ✓ working order |
| A card open in the pane surfaces in Needs you when it starts waiting on the operator | pass | ✓ board invariants; ✓ pane shows thr_review_pr; ✓ no refusal banner; ✓ attention order; ✓ unread order |
| Closing the pane leaves the card in the lane its state picks | pass | ✓ board invariants; ✓ no refusal banner; ✓ working order; ✓ unread order |
