# UAT report

_Generated 2026-11-21T08:43:56.133Z by `npm run uat`._

## native-open

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-native-open.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A card click in a one-pane window opens the thread beside the board | pass | ✓ native open thr_uat_queue with split; ✓ native panes ["thr_uat_queue"]; ✓ native pane count 2; ✓ pane closed; ✓ card thr_review_pr in the columns board's view; ✓ active card is thr_uat_queue |
| A second card click replaces the thread in the pane, still two panes | pass | ✓ native panes ["thr_rpc_auth"]; ✓ native pane count 2; ✓ pane closed; ✓ route stayed on a thread |
| A card clicked from a scrolled board stays inside the board after the native pane opens | pass | ✓ native panes ["thr_icon_lazy"]; ✓ native pane count 2; ✓ card thr_icon_lazy in the columns board's view |
| The same click with the board-panel answer keeps the card inside the narrowed board | pass | ✓ native panes []; ✓ native pane count 1; ✓ pane shows thr_icon_lazy; ✓ card thr_icon_lazy in the columns board's view |
| With splits off the click still asks, then keeps the thread in the board's own pane | pass | ✓ native open thr_uat_queue with split; ✓ native panes []; ✓ native pane count 1; ✓ pane shows thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| The card menu's "Open thread" entry takes the same path | pass | ✓ native panes []; ✓ pane shows thr_rpc_auth |
| Clicking a nested child row opens that child beside the board | pass | ✓ native panes ["thr_gutter_family_c0"]; ✓ native pane count 2; ✓ pane closed |
| A fresh install is asked where a card opens its thread, and the shipping answer is marked | pass | ✓ text visible: "Where should threads open?"; ✓ text visible: "Beside the board"; ✓ text visible: "In the board panel"; ✓ text visible: "Default" |
| Choosing the board panel closes the question and every click stays in the board | pass | ✓ text hidden: "Where should threads open?"; ✓ native panes []; ✓ native pane count 1; ✓ pane shows thr_uat_queue |
| A thread created from the board's New Thread modal opens beside the board | pass | ✓ native open thr_uat_spawned with split; ✓ native panes ["thr_uat_spawned"]; ✓ native pane count 2; ✓ pane closed |
| With the board-panel answer, a created thread opens in the board's own pane | pass | ✓ native panes []; ✓ native pane count 1; ✓ pane shows thr_uat_spawned; ✓ url ends with /board/t/thr_uat_spawned |
