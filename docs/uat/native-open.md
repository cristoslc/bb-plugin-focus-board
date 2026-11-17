# UAT report

_Generated 2026-11-17T21:48:05.171Z by `npm run uat`._

## native-open

Source: `tests/manual/uat-native-open.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Clicking a card opens the thread in bb's native pane beside the board | pass | ✓ native open thr_uat_queue with split; ✓ pane closed; ✓ native panes ["thr_uat_queue"] |
| A second card click replaces that pane's thread instead of opening a second pane | pass | ✓ native panes ["thr_rpc_auth"]; ✓ pane closed |
| A third card click still leaves one thread pane beside the board | pass | ✓ native panes ["thr_review_pr"]; ✓ pane closed |
| The card menu's "Open thread" entry opens the same native pane | pass | ✓ native open thr_rpc_auth with split; ✓ pane closed |
| Clicking a nested child row opens that child in the native pane | pass | ✓ native open thr_gutter_family_c0 with split; ✓ pane closed |
