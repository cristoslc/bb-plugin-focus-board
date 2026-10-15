# UAT report

_Generated 2026-10-15T11:59:36.257Z by `npm run uat`._

## host-push-races

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_zhgchh2yd9-1/bb-plugin-focus-board/tests/manual/uat-race.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A push that relocates the hovered card leaves no lie behind | pass | ✓ board invariants; ✓ no refusal banner; ✓ unread order; ✓ no rank_move call |
| A push that lifts a family across lanes keeps the board consistent | pass | ✓ board invariants; ✓ no refusal banner; ✓ working order; ✓ attention order |
| A push clearing the pending flag and marking unread reseats the card | pass | ✓ board invariants; ✓ no refusal banner; ✓ unread order |
| The drag pipeline survives a push raced under an armed hover | pass | ✓ board invariants; ✓ drop permitted during drag; ✓ no refusal banner; ✓ unread order |
