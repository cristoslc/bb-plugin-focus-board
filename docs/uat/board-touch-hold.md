# UAT report

_Generated 2026-10-31T15:21:20.611Z by `npm run uat`._

## board-touch-hold

Source: `tests/manual/uat-board-touch-hold.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On the touch board no card is a native drag source, and the pickup is the only drag path | pass | ✓ lane direction: vertical; ✓ card thr_ship_release is not a native drag source; ✓ the viewport presents a coarse pointer and no hover; ✓ no card is a native drag source, so a finger's pan cannot lift one; ✓ the card's anchor is not draggable; ✓ the card's text is not touch-selectable, so a long press pans; ✓ the board allows both pan axes; ✓ the lane list allows both pan axes |
| A hold picks a Pinned card up and the slide drops it, ranked, into Unread | pass | ✓ the hold picked up {"armed":true,"card":"thr_ship_release"}; ✓ the board x scrolled exactly 0px; ✓ the browser started no native drag; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_ship_release","beforeId":"thr_rpc_auth","toEnd":false}; ✓ pinned order; ✓ no refusal banner |
| On the rows read a hold-slide carries the same card down into Unread | pass | ✓ the hold picked up {"armed":true,"card":"thr_ship_release"}; ✓ the board y scrolled exactly 0px; ✓ the browser started no native drag; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_ship_release","beforeId":"thr_rpc_auth","toEnd":false}; ✓ pinned order; ✓ no refusal banner |
| Holding a folded feature-group card picks the unit up and drops it ranked | pass | ✓ the hold picked up {"armed":true,"box":"grp_chat_imagegent"}; ✓ rank_move {"columnKey":"status:working","threadId":"thr_column_sort","toEnd":true}; ✓ no refusal banner |
| Holding a nested child row and sliding it onto its sibling writes the family's own order | pass | ✓ the hold picked up {"armed":true,"card":"thr_sweep_w0"}; ✓ rank_move {"columnKey":"child:thr_sweep_parent","threadId":"thr_sweep_w0","beforeId":"thr_sweep_w2","toEnd":false}; ✓ no refusal banner |
