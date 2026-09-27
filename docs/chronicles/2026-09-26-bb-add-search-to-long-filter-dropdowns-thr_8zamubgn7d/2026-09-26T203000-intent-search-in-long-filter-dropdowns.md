---
type: intent
timestamp: 2026-09-26T203000
thread: thr_8zamubgn7d
---

## Intent: search bars in long filter dropdowns

Operator request: every filter dropdown with more than about five options
should get a search bar, consistent with bb's other interfaces (the model
picker being the reference).

Intent: put the rule in one pure, tested place and let the shared toolbar
dropdown obey it —

1. `components/dropdown-search.ts` (new): `DROPDOWN_SEARCH_MIN_OPTIONS = 5`
   plus `shouldShowDropdownSearch(options)` and `filterDropdownOptions(
   options, query)`. Substring match on the visible label, trimmed and
   case-insensitive, order preserved so rows never jump while typing.
2. `components/board-toolbar.tsx`: `MultiSelectDropdown` — the one control
   behind Project, Provider, State, and Group — grows a sticky search field
   at the top of the menu when its list is long. Autofocus on open, Escape
   clears the query and then closes, reopening starts blank, a "No … matches"
   row stands in for an empty list. Short lists (State) are untouched.
3. Escape only claimed while the menu is open, so a closed dropdown's Escape
   still reaches bb. The New project field stops propagation on its own
   Escape so the menu does not clear the search behind it.

Success: `npm test` green (7 new tests, 240 total), `npm run typecheck`
clean, `npm run build` emits `dist/app.js`. No DOM harness exists for the
embedded panel, so the visual pass is the operator's at handoff.

Known call-out for the operator: Group has exactly six options, so it
crosses the five-row line and now opens with a search field too. One-line
knob (`DROPDOWN_SEARCH_MIN_OPTIONS = 6`) if that list should stay plain.

**Commits in this unit:** the feature commit carrying this entry.
