# UAT report

_Generated 2026-10-15T16:55:29.091Z by `npm run uat`._

## group-zoom

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_3jfspvnikn-1/bb-plugin-focus-board/tests/manual/uat-group-zoom.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The board opens unfiltered — the boxed members and an ungrouped thread all visible | pass | ✓ text visible: "Refactor grouping.ts column sort keys"; ✓ text visible: "Write E2E test for drag-to-done"; ✓ text visible: "Research: bb plugin RPC auth tokens"; ✓ text visible: "chat-imagegent" |
| Right-clicking the box and choosing Zoom to group lands on the Group view, restricted to that group | pass | ✓ grp_chat_imagegent order; ✓ text visible: "Refactor grouping.ts column sort keys"; ✓ text visible: "Write E2E test for drag-to-done"; ✓ text hidden: "Research: bb plugin RPC auth tokens" |
| On the Group view, the stored group restrict re-opens the board filtered (the refresh-restore path) | pass | ✓ grp_chat_imagegent order; ✓ text hidden: "Research: bb plugin RPC auth tokens" |
