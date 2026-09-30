# UAT report

_Generated 2026-09-29T22:12:22.430Z by `npm run uat`._

## pane-history

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-pane-history.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Clicking a card opens its pane and pushes a panel route | pass | ✓ pane shows thr_uat_queue; ✓ active card is thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| Switching cards pushes, so each opened pane is one history entry | pass | ✓ pane shows thr_rpc_auth; ✓ url ends with /board/t/thr_rpc_auth |
| Back reopens the previous card's pane — the card you lost track of | pass | ✓ pane shows thr_uat_queue; ✓ active card is thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| Back from the first opened card closes the pane at the panel root | pass | ✓ pane closed; ✓ active card is (none); ✓ url ends with ?groupBy=status |
| The bb back-arrow case — out to another surface, back, pane restored | pass | ✓ pane shows thr_uat_queue; ✓ active card is thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| Escape closes the pane by pushing the root — back after a close reopens | pass | ✓ pane closed; ✓ active card is (none); ✓ url ends with /board |
| Back after a close reopens the last pane — close is not lost work | pass | ✓ pane shows thr_uat_queue; ✓ url ends with /board/t/thr_uat_queue |
| A deep link to the panel's thread subPath opens the board with that pane | pass | ✓ pane shows thr_rpc_auth; ✓ active card is thr_rpc_auth |
| A restored card below the fold is scrolled into view | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ active card visible |
| Relocating the active card (drop to Done) re-scrolls to its new lane | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ active card visible |
| A malformed deep link degrades to the plain board | pass | ✓ pane closed; ✓ active card is (none) |
