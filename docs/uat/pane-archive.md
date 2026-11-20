# UAT report

_Generated 2026-11-20T14:04:09.340Z by `npm run uat`._

## pane-archive

Source: `tests/manual/uat-pane-archive.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The pane opens on the thread (deep-linked; card clicks open bb's own pane now) | pass | ✓ pane shows thr_review_pr; ✓ text visible: "Review PR #14" |
| Archive in the pane's actions menu removes the card from the board; the pane stays open on the archived thread | pass | ✓ pane open; ✓ text visible: "Review PR #14"; ✓ unread order |
| An archived row's menu keeps its Unarchive (its only way out) and drops the Pin entry | pass | ✓ text visible: "Unarchive" |
