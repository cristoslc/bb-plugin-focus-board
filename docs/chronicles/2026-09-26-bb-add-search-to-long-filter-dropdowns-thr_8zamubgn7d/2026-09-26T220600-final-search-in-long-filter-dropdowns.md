---
type: final
timestamp: 2026-09-26T220600
responding-to: 2026-09-26T203000-intent-search-in-long-filter-dropdowns.md
---

## Final: search bars in long filter dropdowns (#8)

The change is in and reviewed. Operator asked for search bars on filter
dropdowns with more than about five options, consistent with bb's model
picker.

What landed:

- `components/dropdown-search.ts` — the rule as pure, tested functions:
  `DROPDOWN_SEARCH_THRESHOLD = 5`, `shouldShowDropdownSearch`,
  `filterDropdownOptions` (trimmed, case-insensitive label substring,
  order preserved).
- `components/board-toolbar.tsx` — `MultiSelectDropdown`, the single
  control behind Project, Provider, State, and Group, renders a sticky
  search field when its list is long: autofocus on open, rows filter as
  you type, a no-match row when a typed query comes up empty, Escape
  clears the query then closes, reopening starts blank, and closing hands
  focus back to the trigger.
- `tests/dropdown-search.test.ts` — 8 tests: threshold boundary (5 vs 6),
  blank and whitespace queries, case-insensitive substring, trimmed query,
  no match, empty list.
- Coverage matrix row plus a CHANGELOG entry under Unreleased.

Review round (one pass, subagent on the `code-review` skill) found no
blocking issues and six should-fix items, all fixed in the follow-up
commit: the no-match row fired on a genuinely empty list, the auto-focused
input dropped focus to the body on close, the no-match `<li>` was an
invalid `role="listbox"` child, the search input was not wired to the
listbox it filters, a comment claimed State was in the "keeps plain rows"
set when Group was the one crossing the line, and the coverage matrix
claimed `auto` coverage for UI behavior with no DOM harness behind it.

Deferred work

- Visual pass on the search field, sticky header, no-match row, and Escape
  ladder is manual — the board renders in a browser-less bb panel with no
  DOM harness, so it rides with the operator's look at the panel. Recorded
  as `manual` in the coverage matrix row.
- Group (6 rows) now opens with a search field under the "more than five"
  rule. If the operator prefers that list plain,
  `DROPDOWN_SEARCH_THRESHOLD = 6` is the whole change.

Diagrams: no diagram changes applicable — a presentational change inside one
existing component, no bounded-context, architecture, or data-model shift.

Merge: squash into `main`, then release 0.3.2 (CHANGELOG Unreleased →
dated heading, version bump, `v0.3.2` tag), then update the bb install
(sourced from the local path checkout) and reload the plugin.
