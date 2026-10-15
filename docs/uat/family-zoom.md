# UAT report

_Generated 2026-10-15T12:36:00.934Z by `npm run uat`._

## family-zoom

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_8dujndeecq-1/bb-plugin-focus-board/tests/manual/uat-family-zoom.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The board boots (absorbs vite's dev-server dep-optimization reload) | pass | ✓ text visible: "Parent thread lane fixture" |
| Choosing Zoom to family on a family parent shows only that family | pass | ✓ nested row under the family card (thr_child_lane); ✓ text visible: "Sweep the done archive"; ✓ text visible: "Child thread lane fixture"; ✓ no nested row (thr_child_lane); ✓ text hidden: "Sweep the done archive"; ✓ text visible: "Parent thread" |
| Zoom launched from a nested child row scopes the family's owner | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Child thread lane fixture"; ✓ text hidden: "Sweep the done archive" |
| The toolbar family chip names the family and clears the scope | pass | ✓ text visible: "Child thread lane fixture"; ✓ text visible: "Sweep the done archive" |
