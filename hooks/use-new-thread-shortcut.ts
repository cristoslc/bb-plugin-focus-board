import { useEffect } from "react";

/** Guards the New Thread shortcut against surfaces that own the key while
 *  they are up: an open dialog (radix portals carry focus inside them, and
 *  the board's modals all render through one) and open dropdown/popper
 *  menus. The same ownership rules the `/` search-focus shortcut applies
 *  (hooks/use-search-focus.ts). */
const CLAIMING_ANCESTOR_SELECTOR =
  '[role="dialog"], [data-radix-popper-content-wrapper]';

// A configured key (default "C") opens the board's New Thread composer, but
// only from the overview board: with a pane open the caller drops `enabled`
// (the composer stays behind its button and menus then) — typing in a pane
// must never be swallowed. Everything else that legitimately owns the key
// is opt-out:
//   - editable targets (typing "c" in any input must insert a letter),
//   - dialogs and open dropdown menus,
//   - modifier chords ("⌘C" copies, "ctrl+C" copies, and friends keep
//     their platform meanings),
//   - an event another handler already claimed (`defaultPrevented` — e.g.
//     the pane's capturing Escape handler pattern upstream).
// The empty-string hotkey is the off state (the caller may pass it) — no
// real KeyboardEvent has an empty `key`, so it never matches.
export function useNewThreadComposerShortcut({
  enabled,
  hotkey,
  onActivate,
}: {
  /** False while the thread pane is open — the composer hands off then. */
  enabled: boolean;
  /** The effective configured key, lowercased (components/preferences.ts). */
  hotkey: string;
  /** The activation: the app's `openNewThread` composer opener. */
  onActivate: () => void;
}): void {
  useEffect(() => {
    if (!enabled || hotkey === "") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== hotkey || event.defaultPrevented) return;
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
      event.preventDefault();
      onActivate();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, hotkey, onActivate]);
}