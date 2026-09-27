/**
 * Search-bar rules for the toolbar's filter dropdowns. A long option list
 * (projects, providers) scrolls forever without one, so any dropdown past
 * `DROPDOWN_SEARCH_THRESHOLD` rows grows a search field — the same
 * affordance bb's own model picker gives its long lists.
 */

/** A dropdown with MORE than this many options gets a search bar. */
export const DROPDOWN_SEARCH_THRESHOLD = 5;

export interface DropdownOption {
  value: string;
  label: string;
}

/** Whether this option list is long enough to deserve a search bar. */
export function shouldShowDropdownSearch(
  options: readonly DropdownOption[],
): boolean {
  return options.length > DROPDOWN_SEARCH_THRESHOLD;
}

/**
 * Case-insensitive substring match on the visible label, trimmed. A blank
 * query is "no query" and returns every option in its original order — the
 * list never re-sorts as you type, so rows stay where the operator last
 * saw them. The copy keeps the caller's array out of reach.
 */
export function filterDropdownOptions(
  options: readonly DropdownOption[],
  query: string,
): DropdownOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}
