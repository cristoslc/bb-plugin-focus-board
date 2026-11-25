# UAT report

_Generated 2026-11-25T08:53:55.530Z by `npm run uat`._

## pane-history

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-pane-history.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A deep link to the panel's thread subPath opens the board with that pane | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ url ends with /board/t/thr_review_pr |
| Opening a listed thread from the pane's reference chip pushes, so each opened pane is one history entry | pass | ✓ pane shows thr_glyph_glue; ✓ url ends with /board/t/thr_glyph_glue |
| Back reopens the previous pane — the card you lost track of | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ url ends with /board/t/thr_review_pr |
| The bb back-arrow case — out to another surface, back, pane restored | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ url ends with /board/t/thr_review_pr |
| Escape closes the pane by pushing the root — back after a close reopens | pass | ✓ pane closed; ✓ active card is (none); ✓ url ends with /board |
| Back after a close reopens the last pane — close is not lost work | pass | ✓ pane shows thr_review_pr; ✓ url ends with /board/t/thr_review_pr |
| A restored card below the fold is scrolled into view | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ active card visible |
| Relocating the active card (drop to Done) re-scrolls to its new lane | pass | ✓ pane shows thr_review_pr; ✓ active card is thr_review_pr; ✓ active card visible |
| A malformed deep link degrades to the plain board | pass | ✓ pane closed; ✓ active card is (none) |
