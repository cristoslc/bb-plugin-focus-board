import { useEffect, type RefObject } from "react";
import {
  boardOwnsKeystroke,
  type SplitPaneLayoutView,
} from "@/lib/shortcut-ownership";

// Plain "/" on the board is the "search" gesture: while the board's own pane
// holds host focus and no in-board pane is open, the toolbar's search field is
// the natural landing spot, so focus it instead of letting the keystroke fall
// through dead (or into a page-level find). Everything that legitimately owns
// "/" is opt-out (lib/shortcut-ownership.ts carries the rules and the
// reasoning):
//   - another pane focused in the host layout, or a board panel the host does
//     not name as a pane (the board cannot prove it holds the keyboard),
//   - an open in-board pane (the caller drops `enabled` while `openThread`
//     exists — the chat pane's own input is where "/" belongs then),
//   - editable targets (typing "/" in any input or rich-text editor must
//     insert a slash),
//   - dialogs and open dropdown menus,
//   - modifier chords ("⌘/", "ctrl/" and friends keep their platform
//     meanings),
//   - an event another handler already claimed (`defaultPrevented` — e.g. the
//     pane's capturing Escape handler pattern upstream).
export function useSearchFocusOnSlash({
  enabled,
  searchInputRef,
  panelRef,
  splitLayoutRef,
}: {
  /** False while the in-board thread pane is open — "/" belongs to the pane
   *  then. */
  enabled: boolean;
  /** The toolbar's board-search input; null when the toolbar is absent. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** The board's panel root, as app.tsx holds it. */
  panelRef: RefObject<Element | null>;
  /** The host's split layout as the latest render saw it (app.tsx's
   *  splitLayoutRef), read at keystroke time. */
  splitLayoutRef: RefObject<SplitPaneLayoutView | null>;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        !boardOwnsKeystroke(event, {
          panel: panelRef.current,
          layout: splitLayoutRef.current,
        })
      ) {
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
  }, [enabled, searchInputRef, panelRef, splitLayoutRef]);
}
