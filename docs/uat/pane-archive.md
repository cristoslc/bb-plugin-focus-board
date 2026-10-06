# UAT report

_Generated 2026-10-06T02:58:50.116Z by `npm run uat`._

## pane-archive

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-pane-archive.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Clicking a card opens its pane | pass | ✓ pane shows thr_review_pr; ✓ text visible: "Review PR #14" |
| Archive in the pane's actions menu removes the card from the board; the pane stays open on the archived thread | pass | ✓ pane open; ✓ text visible: "Review PR #14"; ✓ unread order |
| An archived row's menu keeps its Unarchive (its only way out) and drops the Pin entry | pass | ✓ text visible: "Unarchive" |
