# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## dot-drag-family

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-dot-drag.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Collapsing the nine-child family paints the whole child tier as dots | pass | ✓ strip dots of thr_big_family |
| Dragging the freshest dot onto the last dot moves it to the bottom, through the child-rank write | pass | ✓ rank_move {"columnKey":"child:thr_big_family","threadId":"thr_big_c8","toEnd":true}; ✓ strip dots of thr_big_family |
| A dot dragged out of its strip lights the family card (the in-place morph) | pass |  |
| Releasing the dragged dot on another column's floor un-parents it entirely | pass | ✓ thread_reparent {"threadId":"thr_big_c3","parentThreadId":null}; ✓ strip dots of thr_big_family |
| A sub-dot dragged out un-parents the deep member the same way | pass | ✓ thread_reparent {"threadId":"thr_gutter_family_c0_gc0","parentThreadId":null}; ✓ no sub-row (thr_gutter_family_c0_gc0) |
| After the gestures, a dot still opens its thread on click | pass | ✓ pane shows thr_big_c0 |
| Dropping the stranger card onto the family's dot field children it | pass | ✓ thread_reparent {"threadId":"thr_rpc_auth","parentThreadId":"thr_gutter_family"}; ✓ strip dots of thr_gutter_family |
| Dropping the family's own root onto its dot field refuses loudly | pass | ✓ failure reported on screen |
