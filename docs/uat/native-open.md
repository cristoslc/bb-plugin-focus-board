# UAT report

_Generated 2026-11-18T00:08:38.059Z by `npm run uat`._

## native-open

Source: `tests/manual/uat-native-open.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Clicking a card opens the thread in the board's own pane, never a host split | pass | ✓ native panes []; ✓ pane shows thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| A second card click replaces the thread in the board's pane, one pane only | pass | ✓ native panes []; ✓ pane shows thr_rpc_auth; ✓ url ends with /board/t/thr_rpc_auth; ✓ route stayed on a thread |
| A third card click still leaves one thread pane showing the last thread | pass | ✓ native panes []; ✓ pane shows thr_review_pr |
| The card menu's "Open thread" entry opens the same pane | pass | ✓ native panes []; ✓ pane shows thr_rpc_auth |
| Clicking a nested child row opens that child in the board's pane | pass | ✓ native panes []; ✓ pane shows thr_gutter_family_c0 |
