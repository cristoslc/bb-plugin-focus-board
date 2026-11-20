# UAT report

_Generated 2026-11-07T03:21:15.865Z by `npm run uat`._

## attention-pulse

Source: `tests/manual/uat-attention-pulse.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A phone viewport animates the attention pulses it can see and parks the rest | pass | ✓ at least 1 attention pulse(s) parked off screen; ✓ on-screen pulses animate (9/9); ✓ off-screen pulses hold still (0 of 33 still animating) |
| Widening to desktop re-runs the gate and still parks what it cannot see | pass | ✓ at least 1 attention pulse(s) parked off screen; ✓ on-screen pulses animate (12/12); ✓ off-screen pulses hold still (0 of 30 still animating) |
