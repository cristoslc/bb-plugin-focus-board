import { useEffect, type RefObject } from "react";
import { boardOwnsKeystroke } from "@/lib/shortcut-ownership";

// Plain "/" on the board is the "search" gesture: with no pane open, the
// toolbar's search field is the natural landing spot, so focus it instead
// of letting the keystroke fall through dead (or into a page-level find).
// Everything that legitimately owns "/" is opt-out (lib/shortcut-ownership.ts
// carries the rules and the reasoning):
//   - an open pane (the caller drops `enabled` while `openThread` exists —
//     the chat pane's own input is where "/" belongs then),
//   - editable targets (typing "/" in any input or rich-text editor must
//     insert a slash),
//   - another pane's surface (a plugin app in bb shares the document, so the
//     board only claims keystrokes that happen inside its own panel root),
//   - a native thread pane focused beside the board with nothing inside the
//     board holding focus,
//   - dialogs and open dropdown menus,
//   - modifier chords ("⌘/", "ctrl/" and friends keep their platform
//     meanings),
//   - an event another handler already claimed (`defaultPrevented` — e.g.
//     the pane's capturing Escape handler pattern upstream).
export function useSearchFocusOnSlash({
  enabled,
  searchInputRef,
  threadPaneFocused,
}: {
  /** False while the thread pane is open — "/" belongs to the pane then. */
  enabled: boolean;
  /** The toolbar's board-search input; null when the toolbar is absent. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** True while the host's split layout has a native thread pane focused
   *  beside the board (app.tsx's focused-pane read). */
  threadPaneFocused: boolean;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!boardOwnsKeystroke(event, { threadPaneFocused })) return;
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
  }, [enabled, searchInputRef, threadPaneFocused]);
}
