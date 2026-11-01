# UAT report

_Generated 2026-11-01T09:06:45.520Z by `npm run uat`._

## chip-placement

Source: `/Users/cristos/Documents/code/bb-plugin-focus-board/tests/manual/uat-chip-placement.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A short issue sits first row left, the PR first row right, the tag bottom-right | pass | ✓ chip placement contract (issue #104) |
| Two short issue ids share the left half and the PR keeps the right | pass | ✓ chip placement contract (issue #104) |
| A long id list reflows inside the midpoint cap, PR still right | pass | ✓ chip placement contract (issue #104) |
| One long external ticket claims the whole row and bumps the PR down, still right | pass | ✓ chip placement contract (issue #104) |
| A very long id scales its text to stay on one line | pass | ✓ chip placement contract (issue #104) |
| With a PR present the tags sit below it, right-anchored, at no more than 75% | pass | ✓ chip placement contract (issue #104) |
| With no PR the tag rides the first row's right end | pass | ✓ chip placement contract (issue #104) |
| The same placement holds with the light token set | pass | ✓ chip placement contract (issue #104) |
