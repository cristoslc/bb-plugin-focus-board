# UAT report

_Generated 2026-11-20T00:02:37.061Z by `npm run uat`._

## tap-latency

Source: `tests/manual/uat-tap-latency.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a throttled phone with 478 cards, a tap enters the board's own pane | pass | ✓ native panes []; ✓ pane shows thr_uat_queue; ✓ no refusal banner |
| Tapping Back to board closes the pane inside the latency budget | pass | ✓ pane closed; ✓ gesture_budget click_aria ≤600ms |
| With the board visible beside the pane, the tap's attention freeze paints inside the latency budget | pass | ✓ native panes []; ✓ pane shows thr_uat_queue; ✓ gesture_budget click ≤1500ms |
