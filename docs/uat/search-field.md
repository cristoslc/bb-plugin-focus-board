# UAT report

_Generated 2026-10-15T16:55:29.091Z by `npm run uat`._

## search-field

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_3jfspvnikn-1/bb-plugin-focus-board/tests/manual/uat-search.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The plain board shows the cards and a search box with no search button | pass | ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text visible: "Ship 0.1.1: column ordering fix + release notes"; ✓ control absent: "Search"; ✓ control absent: "Clear search" |
| A typed title query narrows the board and the search button appears in the field | pass | ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text hidden: "Ship 0.1.1: column ordering fix + release notes"; ✓ text hidden: "Deploy failed: missing DATABASE_URL secret"; ✓ control present: "Clear search"; ✓ control present: "Search" |
| Clicking the search button re-confirms the query and the field keeps focus | pass | ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text hidden: "Ship 0.1.1: column ordering fix + release notes"; ✓ control present: "Search"; ✓ control present: "Clear search" |
| Letting the field's focus go hides the search button and keeps the query | pass | ✓ control absent: "Search"; ✓ control present: "Clear search"; ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text hidden: "Ship 0.1.1: column ordering fix + release notes" |
| The clear x empties the query, the board spreads back out, and no button rides the refocused empty field | pass | ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text visible: "Ship 0.1.1: column ordering fix + release notes"; ✓ control absent: "Search"; ✓ control absent: "Clear search" |
| A no-match query empties the board while the button still rides the focused field | pass | ✓ text hidden: "Plan Q4 plugin roadmap"; ✓ text hidden: "Ship 0.1.1: column ordering fix + release notes"; ✓ control present: "Search"; ✓ control present: "Clear search" |
| Searching by thread id reaches the same card as the title | pass | ✓ text visible: "Plan Q4 plugin roadmap"; ✓ text hidden: "Ship 0.1.1: column ordering fix + release notes"; ✓ text hidden: "Deploy failed: missing DATABASE_URL secret" |
