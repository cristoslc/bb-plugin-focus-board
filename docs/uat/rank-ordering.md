_Generated 2026-09-27T04:44:26.647Z by `npm run uat`._

# UAT report

## rank-ordering

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_7xijhcyibk-1/bb-plugin-thread-board/tests/manual/uat-rank.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A first-time user with no stored order can drag, and the drop writes one | pass | ✓ unread has 3 reorder slots; ✓ unread hand-ordered=false; ✓ unread order; ✓ stored order {"status:unread":["thr_review_pr"]}; ✓ unread hand-ordered=true |
| With every lane draggable, dropping on Done still marks done | pass | ✓ called done_set |
| A lane with no stored order reads newest-first | pass | ✓ unread order; ✓ unread hand-ordered=false |
| The Unread lane reads in its stored order instead of recency | pass | ✓ unread order; ✓ unread hand-ordered=true |
| Dropping on a card's top half lands in front of it | pass | ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_review_pr","beforeId":"thr_rpc_auth","toEnd":false}; ✓ stored order {"status:unread":["thr_review_pr","thr_rpc_auth","thr_uat_queue"]} |
| Dropping on a card's bottom half lands past it, not on it | pass | ✓ unread order; ✓ stored order {"status:unread":["thr_rpc_auth","thr_review_pr","thr_uat_queue"]} |
| Dropping below the last card appends | pass | ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_rpc_auth","beforeId":null,"toEnd":true} |
| Dropping a card on itself writes nothing | pass | ✓ stored order {"status:unread":["thr_rpc_auth","thr_uat_queue","thr_review_pr"]}; ✓ no rank_move call |
| A rank drag into a different ranked lane writes nothing | pass | ✓ stored order {"status:unread":["thr_rpc_auth"],"pinned":["thr_roadmap","thr_ship_release"]}; ✓ no rank_move call |
| The Pinned lane is ranked under every grouping | pass | ✓ pinned order; ✓ pinned hand-ordered=true |
| Alt+ArrowDown moves a card down one slot | pass | ✓ unread order; ✓ stored order {"status:unread":["thr_uat_queue","thr_rpc_auth","thr_review_pr"]} |
| Alt+ArrowUp on the second card lands it at the very top | pass | ✓ unread order |
| The insertion line appears on the hovered half | pass | ✓ insertion line visible; ✓ no insertion line |
| A completed move is announced for screen readers | pass | ✓ move announced |
