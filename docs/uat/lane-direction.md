# UAT report

_Generated 2026-10-15T03:01:24.059Z by `npm run uat`._

## lane-direction

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_zhgchh2yd9-1/bb-plugin-focus-board/tests/manual/uat-lane-direction.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A board with no stored choice renders the vertical column layout | pass | ✓ lane direction: vertical; ✓ unread order |
| The horizontal read renders lanes as rows with the same lanes and cards | pass | ✓ lane direction: horizontal; ✓ text visible: "Unread"; ✓ unread order; ✓ unread has 3 reorder slots |
| A same-row drop ranks along the left-to-right flow | pass | ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_review_pr"]}; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_review_pr","beforeId":"thr_rpc_auth","toEnd":false} |
| The insertion line draws on the hovered card's left/right edges | pass | ✓ insertion line visible; ✓ drop permitted during hover; ✓ insertion line visible; ✓ drop permitted during hover |
| Alt+ArrowLeft / Alt+ArrowRight step a card along the row | pass | ✓ unread order |
| Alt+ArrowUp is not a horizontal-board reorder key | pass | ✓ unread order |
| Picking Horizontal in the Appearance tab re-lays the open board at once | pass | ✓ lane direction: horizontal |
| Picking Vertical flips the live board straight back | pass | ✓ lane direction: vertical |
