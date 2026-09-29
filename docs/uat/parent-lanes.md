_Generated 2026-09-29T01:19:39.953Z by `npm run uat`._

# UAT report

## parent-lanes

Source: `tests/manual/uat-parent-lanes.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Parent-thread grouping shows family lanes and excludes loose threads | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Child thread lane fixture"; ✓ text hidden: "Standalone" |
| Clicking a lane header opens the parent thread's pane | pass | ✓ pane open; ✓ text visible: "Parent thread lane fixture"; ✓ url ends with /board/t/thr_parent_lane |
| Clicking a child card opens its thread pane | pass | ✓ pane shows thr_child_lane; ✓ active card is thr_child_lane; ✓ url ends with /board/t/thr_child_lane |
| A deep-linked child in the rightmost lane is scrolled into view | pass | ✓ pane shows thr_child_lane; ✓ active card is thr_child_lane; ✓ active card visible |
| A search that matches only loose threads drops every family and shows the empty state | pass | ✓ text hidden: "Standalone"; ✓ text hidden: "Queue the UAT pass for the rank lane"; ✓ text visible: "No thread families to show yet" |
| The lane-order toggle defaults to Recency in parent-thread mode | pass | ✓ text visible: "Recency"; ✓ text visible: "Parent thread lane fixture"; ✓ text hidden: "Standalone" |
| Switching lane order to By project groups family lanes under their project | pass | ✓ text visible: "By project"; ✓ text visible: "Parent thread lane fixture" |
| Toggling lane order to By project then back to Recency keeps the board usable | pass | ✓ text visible: "By project"; ✓ text visible: "Parent thread lane fixture" |
| Returning to Recency order removes project sections | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text hidden: "Standalone" |
| Switching back to Attention grouping renders normal columns | pass | ✓ unread order |
