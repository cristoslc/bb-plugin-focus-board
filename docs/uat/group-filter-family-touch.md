# UAT report

_Generated 2026-11-11T22:12:09.955Z by `npm run uat`._

## group-filter-family-touch

Source: `tests/manual/uat-group-filter-family-touch.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| At 390px the filtered family card paints both children, the cross-group one included | pass | ✓ nested row under the family card (thr_gf_same); ✓ nested row under the family card (thr_gf_cross); ✓ text visible: "Keep the Beta child under its parent" |
| A real finger pan scrolls the lane and leaves the family card whole, with no native drag | pass | ✓ nested row under the family card (thr_gf_same); ✓ nested row under the family card (thr_gf_cross); ✓ the browser started no native drag |
