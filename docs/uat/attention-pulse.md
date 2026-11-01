# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## attention-pulse

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-attention-pulse.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A phone viewport animates the attention pulses it can see and parks the rest | pass | ✓ at least 1 attention pulse(s) parked off screen; ✓ on-screen pulses animate (10/10); ✓ off-screen pulses hold still (0 of 32 still animating) |
| Widening to desktop re-runs the gate and still parks what it cannot see | pass | ✓ at least 1 attention pulse(s) parked off screen; ✓ on-screen pulses animate (12/12); ✓ off-screen pulses hold still (0 of 30 still animating) |
