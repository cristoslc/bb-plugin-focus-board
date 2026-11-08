# UAT report

_Generated 2026-11-08T05:11:00.168Z by `npm run uat`._

## view-choices

Source: `tests/manual/uat-view-choices.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The open View menu names both choices — Lane direction and Nest child threads | pass | ✓ menu pairs visible inside the open View menu; ✓ text visible: "Lane direction"; ✓ text visible: "Nest child threads"; ✓ text visible: "Vertical"; ✓ text visible: "Horizontal" |
| Tapping Horizontal reads the board as rows at once, no reload | pass | ✓ lane direction: horizontal; ✓ unread order; ✓ no refusal banner |
| Tapping Vertical brings the column board straight back | pass | ✓ lane direction: vertical |
| The Nest child threads pair reads On, the family row is under its card | pass | ✓ nested row under the family card (thr_proj_live) |
| Tapping Off flattens the board — the child stands as its own card | pass | ✓ no nested row (thr_proj_live); ✓ text visible: "Dry-run the cutover checklist" |
| Tapping On brings the family rows back | pass | ✓ nested row under the family card (thr_proj_live) |
