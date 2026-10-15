# UAT report

_Generated 2026-10-15T03:48:44.938Z by `npm run uat`._

## views-tablet

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_zhgchh2yd9-1/bb-plugin-focus-board/tests/manual/uat-views-tablet.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The Attention board renders its lanes at 768×1024 | pass | ✓ lane direction: vertical; ✓ text visible: "Unread"; ✓ unread order |
| The Project view splits lanes at tablet width | pass | ✓ text visible: "API Gateway"; ✓ proj_api order |
| A drag on the horizontal lane read ranks along the row at tablet width | pass | ✓ lane direction: horizontal; ✓ drop permitted during drag; ✓ unread order |
| A cross-lane state drop lands in the Done row at tablet width | pass | ✓ called done_set; ✓ no refusal banner |
| The Parent-thread view renders its family lanes at tablet width | pass | ✓ text visible: "Parent thread lane fixture"; ✓ text visible: "Child thread lane fixture" |
