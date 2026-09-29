_Generated 2026-09-29T00:13:46.335Z by `npm run uat`._

# UAT report

## parent-lanes

Source: `tests/manual/uat-parent-lanes.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Parent-thread grouping shows the family lane and the Standalone lane | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Standalone"; ✓ text visible: "Child thread lane fixture" |
| Clicking a lane header opens the parent thread's pane | pass | ✓ pane open; ✓ text visible: "Parent thread lane fixture"; ✓ url ends with /board/t/thr_parent_lane |
| Clicking a child card opens its thread pane | pass | ✓ pane shows thr_child_lane; ✓ active card is thr_child_lane; ✓ url ends with /board/t/thr_child_lane |
| A deep-linked child in the rightmost lane is scrolled into view | pass | ✓ pane shows thr_child_lane; ✓ active card is thr_child_lane; ✓ active card visible |
| A search that matches only standalone threads drops every family | pass | ✓ text visible: "Standalone"; ✓ text visible: "Queue the UAT pass for the rank lane" |
| The lane-order toggle defaults to Recency in parent-thread mode | pass | ✓ text visible: "Recency"; ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Standalone" |
| Switching lane order to By project groups family lanes under their project | pass | ✓ text visible: "By project"; ✓ text visible: "Standalone" |
| Toggling lane order to By project then back to Recency keeps the board usable | pass | ✓ text visible: "By project"; ✓ text visible: "Standalone" |
| Returning to Recency order removes project sections | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Standalone" |
| Switching back to Attention grouping renders normal columns | pass | ✓ unread order |
