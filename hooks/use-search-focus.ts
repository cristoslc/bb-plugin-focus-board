import { useEffect, type RefObject } from "react";

/** Guards the `/` shortcut against surfaces that own the key while they
 *  are up: an open dialog (radix portals carry focus inside them, and the
 *  board's modals all render through one) and open dropdown/popper menus. */
const CLAIMING_ANCESTOR_SELECTOR = '[role="dialog"], [data-radix-popper-content-wrapper]';

// Plain "/" on the board is the "search" gesture: with no pane open, the
// toolbar's search field is the natural landing spot, so focus it instead
// of letting the keystroke fall through dead (or into a page-level find).
// Everything that legitimately owns "/" is opt-out:
//   - an open pane (the caller drops `enabled` while `openThread` exists —
//     the chat pane's own input is where "/" belongs then),
//   - editable targets (typing "/" in any input must insert a slash),
//   - dialogs and open dropdown menus,
//   - modifier chords ("⌘/", "ctrl/" and friends keep their platform
//     meanings),
//   - an event another handler already claimed (`defaultPrevented` — e.g.
//     the pane's capturing Escape handler pattern upstream).
export function useSearchFocusOnSlash({
  enabled,
  searchInputRef,
}: {
  /** False while the thread pane is open — "/" belongs to the pane then. */
  enabled: boolean;
  /** The toolbar's board-search input; null when the toolbar is absent. */
  searchInputRef: RefObject<HTMLInputElement | null>;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (target instanceof Element && target.closest(CLAIMING_ANCESTOR_SELECTOR)) {
        return;
      }
      const searchInput = searchInputRef.current;
      if (searchInput === null) return;
      event.preventDefault();
      searchInput.focus();
      // Move the caret to the end so typing continues after a previous
      // query instead of extending a selection left in place.
      const end = searchInput.value.length;
      searchInput.setSelectionRange(end, end);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, searchInputRef]);
}