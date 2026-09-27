/**
 * Search-bar rules for the toolbar's filter dropdowns. A long option list
 * (projects, providers) scrolls forever without one, so any dropdown past
 * `DROPDOWN_SEARCH_MIN_OPTIONS` rows grows a search field — the same
 * affordance bb's own model picker gives its long lists.
 */

/** Dropdowns with MORE than this many options get a search bar. */
export const DROPDOWN_SEARCH_MIN_OPTIONS = 5;

export interface DropdownOption {
  value: string;
  label: string;
}

/** Whether this option list is long enough to deserve a search bar. */
export function shouldShowDropdownSearch(
  options: readonly DropdownOption[],
): boolean {
  return options.length > DROPDOWN_SEARCH_MIN_OPTIONS;
}

/**
 * Case-insensitive substring match on the visible label, trimmed. A blank
 * query is "no query" and returns every option in its original order — the
 * list never re-sorts as you type, so rows stay where the operator last
 * saw them.
 */
export function filterDropdownOptions<
  T extends { readonly label: string },
>(options: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter((option) => option.label.toLowerCase().includes(needle));
}
