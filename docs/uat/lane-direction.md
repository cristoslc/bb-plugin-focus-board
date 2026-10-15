# UAT report

_Generated 2026-10-15T03:48:44.938Z by `npm run uat`._

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
| Dropping an Unread card on the Done row marks it done | pass | ✓ done order; ✓ called done_set; ✓ done order; ✓ no refusal banner |
| Dropping an Unread card on the Pinned row pins it without a rank write | pass | ✓ pinned order; ✓ no rank_move call; ✓ no refusal banner |
| Releasing a card on its row's trailing floor appends it | pass | ✓ unread order; ✓ rank_move {"columnKey":"status:unread","threadId":"thr_rpc_auth","beforeId":null,"toEnd":true} |
| Dropping onto a card's middle nests across the row's width | pass | ✓ nest ring visible on the hovered card; ✓ drop permitted during nest hover; ✓ drop permitted during drag; ✓ called thread_reparent; ✓ unread has 2 reorder slots; ✓ nested row under the family card (thr_rpc_auth) |
| Dragging a boxed card moves the whole family box along the row | pass | ✓ drop permitted during drag; ✓ working order; ✓ stored order {"status:working":["thr_sweep_parent","thr_column_sort","thr_drag_done"]} |
| A drag whose payload lost its id refuses without an error banner | pass | ✓ pinned order; ✓ no refusal banner |
| A menu relocation brings an offscreen destination row into view | pass | ✓ pinned order; ✓ pinned order; ✓ card thr_review_pr in the columns board's view |
