# UAT report

_Generated 2026-11-17T20:53:01.651Z by `npm run uat`._

## tap-latency

Source: `tests/manual/uat-tap-latency.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| On a throttled phone with 478 cards, a tap hands the thread to bb's own pane | pass | ✓ native open thr_uat_queue with split; ✓ pane closed; ✓ no refusal banner |
| Tapping Back to board closes the pane inside the latency budget | pass | ✓ pane closed; ✓ gesture_budget click_aria ≤600ms |
| With the board visible beside the pane, the tap's attention freeze paints inside the latency budget | pass | ✓ native open thr_uat_queue with split; ✓ gesture_budget click ≤1500ms |
