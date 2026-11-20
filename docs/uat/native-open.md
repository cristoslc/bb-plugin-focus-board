# UAT report

_Generated 2026-11-20T05:01:52.608Z by `npm run uat`._

## native-open

Source: `tests/manual/uat-native-open.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A card click in a one-pane window opens the thread beside the board | pass | ✓ native open thr_uat_queue with split; ✓ native panes ["thr_uat_queue"]; ✓ native pane count 2; ✓ pane closed; ✓ card thr_review_pr in the columns board's view; ✓ active card is thr_uat_queue |
| A second card click replaces the thread in the pane, still two panes | pass | ✓ native panes ["thr_rpc_auth"]; ✓ native pane count 2; ✓ pane closed; ✓ route stayed on a thread |
| With splits off the click still asks, then keeps the thread in the board's own pane | pass | ✓ native open thr_uat_queue with split; ✓ native panes []; ✓ native pane count 1; ✓ pane shows thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| The card menu's "Open thread" entry takes the same path | pass | ✓ native panes []; ✓ pane shows thr_rpc_auth |
| Clicking a nested child row opens that child beside the board | pass | ✓ native panes ["thr_gutter_family_c0"]; ✓ native pane count 2; ✓ pane closed |
