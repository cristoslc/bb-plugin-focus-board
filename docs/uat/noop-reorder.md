# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## noop-reorder

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-noop-reorder.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A card dropped into its own slot refuses out loud, and the invariant does not call it a break | pass | ✓ board invariants; ✓ drop permitted during drag; ✓ failure reported on screen; ✓ stored order {"status:unread":["thr_rpc_auth","thr_uat_queue","thr_review_pr"]}; ✓ no rank_move call |
