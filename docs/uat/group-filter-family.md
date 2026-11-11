# UAT report

_Generated 2026-11-11T22:11:46.559Z by `npm run uat`._

## group-filter-family

Source: `tests/manual/uat-group-filter-family.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Filtering to Alpha renders the parent card with BOTH children, the Beta child included | pass | ✓ grp_gf_alpha order; ✓ nested row under the family card (thr_gf_same); ✓ nested row under the family card (thr_gf_cross); ✓ text visible: "Sweep the group filter's keep pass"; ✓ text visible: "Keep the Beta child under its parent" |
| Alpha alone is filtered, so the Beta lane and its frame never render | pass | ✓ text hidden: "Stand alone in the Beta lane"; ✓ text hidden: "Beta rework"; ✓ nested row under the family card (thr_gf_cross) |
| With Alpha and Beta both selected, the child keeps its row and never gains a Beta card | pass | ✓ grp_gf_alpha order; ✓ grp_gf_beta order; ✓ nested row under the family card (thr_gf_cross) |
| A phone touch viewport pans the filtered board and the family card still carries both rows | pass | ✓ nested row under the family card (thr_gf_same); ✓ nested row under the family card (thr_gf_cross); ✓ the browser started no native drag |
