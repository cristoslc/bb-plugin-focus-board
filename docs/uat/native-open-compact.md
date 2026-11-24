# UAT report

_Generated 2026-11-24T05:25:29.586Z by `npm run uat`._

## native-open-compact

Source: `tests/manual/uat-native-open-compact.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a compact viewport a card click opens the board's own pane, not the host's | pass | ✓ native panes []; ✓ pane shows thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| The card menu's "Open thread" entry takes the same in-board path | pass | ✓ native panes []; ✓ pane shows thr_rpc_auth; ✓ url ends with /board/t/thr_rpc_auth |
