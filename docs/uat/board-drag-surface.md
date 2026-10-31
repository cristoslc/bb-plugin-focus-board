# UAT report

_Generated 2026-10-31T15:21:43.531Z by `npm run uat`._

## board-drag-surface

Source: `tests/manual/uat-board-drag-surface.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| At a desktop pointer a card is still an armed drag source and drags between its neighbours | pass | ✓ drop permitted during drag; ✓ lane direction: vertical; ✓ card thr_review_pr is a native drag source; ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_review_pr","beforeId":"thr_rpc_auth","toEnd":false}; ✓ no refusal banner |
| A horizontal wheel delivered on a card scrolls the board and drags nothing | pass | ✓ board x offset = 0; ✓ board x offset 200≤524≤; ✓ no rank_move call; ✓ pinned order |
| A horizontal wheel delivered in the gap between two cards scrolls the board | pass | ✓ board x offset = 0; ✓ board x offset 200≤524≤; ✓ no rank_move call; ✓ pinned order |
| On the horizontal read a cursor drag ranks along the row's left-to-right flow | pass | ✓ drop permitted during drag; ✓ lane direction: horizontal; ✓ card thr_review_pr is a native drag source; ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_review_pr","beforeId":"thr_rpc_auth","toEnd":false}; ✓ no refusal banner |
| The insertion line draws on the hovered row card's left and right edges | pass | ✓ insertion line visible; ✓ drop permitted during hover; ✓ insertion line visible; ✓ drop permitted during hover |
| A vertical wheel on a row's card scrolls the rows board, not the row it sits in | pass | ✓ board y offset = 0; ✓ board y offset 200≤600≤; ✓ no rank_move call; ✓ pinned order |
| A horizontal wheel over a row card that already fits scrolls nothing and drags nothing | pass | ✓ lane pinned x offset = 0; ✓ lane pinned x offset = 0; ✓ board y offset = 0; ✓ no rank_move call; ✓ pinned order |
