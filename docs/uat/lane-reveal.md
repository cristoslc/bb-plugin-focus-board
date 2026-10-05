# UAT report

_Generated 2026-10-05T18:25:38.042Z by `npm run uat`._

## lane-reveal

Source: `tests/manual/uat-lane-reveal.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Pinning from the right-click menu brings the offscreen Pinned lane into view | pass | ✓ pinned order; ✓ pinned order; ✓ card thr_review_pr in the columns board's view |
| Pinning a parent with nested children brings the Pinned lane into view | pass | ✓ pinned order; ✓ pinned order; ✓ card thr_parent_lane in the columns board's view |
| Marking a card Done from its right-click menu brings the Done lane into view | pass | ✓ done order; ✓ called done_set; ✓ done order; ✓ card thr_rpc_auth in the columns board's view |
| Unpinning from the right-click menu brings the card's new lane into view | pass | ✓ pinned order; ✓ pinned order; ✓ working order; ✓ card thr_ship_release in the columns board's view |
