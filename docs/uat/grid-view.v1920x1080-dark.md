# UAT report

_Generated 2026-11-08T05:32:04.342Z by `npm run uat`._

## grid-view (v1920x1080-dark)

Source: `tests/manual/uat-grid-view.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| No grouping renders a card grid with no lanes and no lane headers | pass | ✓ the grid holds 24 cards; ✓ the grid wraps into at least 2 columns; ✓ the grid carries 0 lane containers; ✓ the grid carries 0 lane headers; ✓ text hidden: "Threads"; ✓ grid order |
| The View menu offers Sort by and Order, and no lane direction | pass | ✓ menu pairs visible inside the open View menu; ✓ text visible: "Sort by"; ✓ text visible: "Order"; ✓ text visible: "Alphabetical"; ✓ text hidden: "Lane direction" |
| Tapping Alphabetical re-orders the same cards by title | pass | ✓ grid order; ✓ the grid holds 24 cards; ✓ the grid carries 0 lane containers; ✓ no refusal banner |
| The Order pair relabels for titles and Z to A reverses the grid | pass | ✓ grid order |
| The Created key reads createdAt — the newest thread leads, not the busiest | pass | ✓ grid order; ✓ text visible: "Newest first" |
| A card in the grid opens the pane on a click, exactly as a lane card does | pass | ✓ pane shows thr_column_sort |
| Typing in search narrows the grid to the matching cards | pass | ✓ the grid holds 1 cards; ✓ the grid carries 0 lane containers; ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text hidden: "Ship 0.1.1: column ordering fix + release notes" |
