# UAT report

_Generated 2026-10-15T11:59:36.257Z by `npm run uat`._

## board-views (v1920x1080-dark)

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_zhgchh2yd9-1/bb-plugin-focus-board/tests/manual/uat-board-views.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The Attention (status) board groups cards by state and idle age | pass | ✓ text visible: "Unread"; ✓ unread order; ✓ working order; ✓ unread has 3 reorder slots |
| The Last activity board buckets every thread by age, newest lane left | pass | ✓ text visible: "Recent"; ✓ text visible: "Today"; ✓ text visible: "Earlier"; ✓ text visible: "A while ago"; ✓ recent order; ✓ today order |
| The Project view splits the board into one lane per project | pass | ✓ text visible: "API Gateway"; ✓ text visible: "Web App"; ✓ proj_api order |
| The Provider view splits the board into one lane per provider | pass | ✓ text visible: "Claude Code"; ✓ text visible: "Codex"; ✓ claude-code order |
| The Machine view groups by the host name and has no machine-less lane | pass | ✓ text visible: "MacBook Pro"; ✓ text hidden: "No machine" |
| The Group view lanes by feature-group assignment with a No group bucket | pass | ✓ text visible: "chat-imagegent"; ✓ text visible: "No group"; ✓ grp_chat_imagegent order |
| The Threads (no grouping) view renders a single flat lane | pass | ✓ text visible: "Threads" |
| The Parent-thread view renders the family lanes (loose threads excluded) | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Child thread lane fixture" |
| The horizontal Attention board derives the same state and age lanes | pass | ✓ lane direction: horizontal; ✓ unread order; ✓ working order |
| The horizontal Last activity board keeps its age buckets and orders | pass | ✓ text visible: "Today"; ✓ text visible: "A while ago"; ✓ recent order; ✓ today order |
| The horizontal Project view splits the same project lanes | pass | ✓ text visible: "API Gateway"; ✓ proj_api order |
| The horizontal Provider view splits the same provider lanes | pass | ✓ claude-code order |
| The horizontal Machine view groups by the same host lane | pass | ✓ text visible: "MacBook Pro"; ✓ text hidden: "No machine" |
| The horizontal Group view keeps the assignment lanes and the No group bucket | pass | ✓ text visible: "No group"; ✓ grp_chat_imagegent order |
| The horizontal Threads view renders the same single flat lane | pass | ✓ text visible: "Threads" |
