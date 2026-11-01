# UAT report

_Generated 2026-11-01T03:47:52.416Z by `npm run uat`._

## attended-lane

Source: `tests/manual/uat-attended-lane.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A card open in the pane re-lanes to Working when its row turns active | FAIL | ✓ board invariants; ✓ pane shows thr_rpc_auth; ✓ no refusal banner; × unread order (want [thr_uat_queue,thr_review_pr] got [thr_rpc_auth,thr_uat_queue,thr_review_pr]); × working order (want [thr_column_sort,thr_drag_done,thr_rpc_auth,thr_sweep_parent] got [thr_column_sort,thr_drag_done,thr_sweep_parent]) |
| A card open in the pane surfaces in Needs you when it starts waiting on the operator | FAIL | ✓ board invariants; ✓ pane shows thr_review_pr; ✓ no refusal banner; × attention order (want [thr_permissions,thr_deploy_fail,thr_review_pr] got [thr_permissions,thr_deploy_fail]); × unread order (want [thr_rpc_auth,thr_uat_queue] got [thr_rpc_auth,thr_uat_queue,thr_review_pr]) |
| Closing the pane leaves the card in the lane its state picks | FAIL | ✓ board invariants; ✓ no refusal banner; ✓ working order; × unread order (want [thr_uat_queue,thr_review_pr] got [thr_rpc_auth,thr_uat_queue,thr_review_pr]) |
