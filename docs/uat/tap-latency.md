# UAT report

_Generated 2026-11-07T04:01:38.774Z by `npm run uat`._

## tap-latency

Source: `tests/manual/uat-tap-latency.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a throttled phone with 478 cards, a tap opens the pane inside the latency budget | pass | ✓ pane shows thr_uat_queue; ✓ gesture_budget click ≤600ms |
| Tapping Back to board closes the pane inside the latency budget | pass | ✓ pane closed; ✓ gesture_budget click_aria ≤600ms |
