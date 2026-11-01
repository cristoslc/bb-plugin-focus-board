# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## two-window-host-row

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-two-windows.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The first window mounts the demo board | pass | ✓ thr_demo_work in working |
| The second window mounts an expanded board of its own | pass | ✓ thr_demo_work in working; ✓ nested row under the family card (thr_demo_work_c0) |
| A fold written in one window folds the family in the other | pass | ✓ strip dots of thr_demo_work |
| The second window folds live, with no navigation of its own | pass | ✓ no nested row (thr_demo_work_c0); ✓ strip dots of thr_demo_work |
| A done mark in one window lands in the other window's Done lane | pass | ✓ called done_set |
| The second window keeps its own done mark AND the new one | pass | ✓ thr_rpc_auth in done |
| A drop in one window's Unread lane reorders the other window's lane | pass | ✓ drop permitted during drag; ✓ unread order |
| The second window reads the same stored order | pass | ✓ unread order |
