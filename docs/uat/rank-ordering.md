# UAT report

_Generated 2026-10-05T18:55:29.267Z by `npm run uat`._

## rank-ordering

Source: `tests/manual/uat-rank.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A first-time user with no stored order can drag, and the drop writes one | pass | ✓ unread has 3 reorder slots; ✓ unread hand-ordered=false; ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_review_pr"]}; ✓ unread hand-ordered=true |
| The first drop BELOW another card re-sorts, instead of leaving the card on top | pass | ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_uat_queue","thr_rpc_auth"]}; ✓ unread hand-ordered=true |
| With every lane draggable, dropping on Done still marks done | pass | ✓ called done_set |
| A lane with no cross-column drop handler still authorises its own reorder | pass | ✓ pinned has 2 reorder slots; ✓ drop permitted during drag; ✓ pinned order; ✓ stored order {"pinned":["thr_roadmap"]} |
| A drop whose payload has no card id falls back to the dragstart ref | pass | ✓ pinned has 2 reorder slots; ✓ pinned order; ✓ stored order {"pinned":["thr_roadmap"]}; ✓ no refusal banner |
| A lane with no stored order reads newest-first | pass | ✓ unread order; ✓ unread hand-ordered=false |
| The Unread lane reads in its stored order instead of recency | pass | ✓ unread order; ✓ unread hand-ordered=true |
| Dropping on a card's top half lands in front of it | pass | ✓ drop permitted during drag; ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_review_pr","beforeId":"thr_rpc_auth","toEnd":false}; ✓ stored order {"status:unread":["thr_review_pr","thr_rpc_auth","thr_uat_queue"]} |
| Dropping on a card's bottom half lands past it, not on it | pass | ✓ drop permitted during drag; ✓ unread order; ✓ stored order {"status:unread":["thr_rpc_auth","thr_review_pr","thr_uat_queue"]} |
| Dropping below the last card appends | pass | ✓ drop permitted during drag; ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_rpc_auth","beforeId":null,"toEnd":true} |
| Dropping a card on itself writes nothing | pass | ✓ drop permitted during drag; ✓ stored order {"status:unread":["thr_rpc_auth","thr_uat_queue","thr_review_pr"]}; ✓ no rank_move call |
| A rank drag into a plain lane's order is refused, not silently swallowed | pass | ✓ cross-lane drop refused; ✓ stored order {"status:unread":["thr_rpc_auth"]}; ✓ no rank_move call |
| Dropping an Unread card on the Pinned lane pins it | pass | ✓ pinned order; ✓ stored order {"pinned":["thr_roadmap"]}; ✓ no rank_move call; ✓ no refusal banner |
| The Pinned lane is ranked under every grouping | pass | ✓ pinned order; ✓ pinned hand-ordered=true |
| Alt+ArrowDown moves a card down one slot | pass | ✓ unread order; ✓ stored order {"status:unread":["thr_uat_queue","thr_rpc_auth","thr_review_pr"]} |
| Alt+ArrowUp on the second card lands it at the very top | pass | ✓ unread order |
| The insertion line appears on the hovered half | pass | ✓ insertion line visible; ✓ drop permitted during hover; ✓ no insertion line |
| A completed move is announced for screen readers | pass | ✓ move announced |
