import { useEffect } from "react";
import { boardOwnsKeystroke } from "@/lib/shortcut-ownership";

// A configured key (default "C") opens the board's New Thread composer, but
// only from the overview board: with a pane open the caller drops `enabled`
// (the composer stays behind its button and menus then) — typing in a pane
// must never be swallowed. Everything else that legitimately owns the key is
// opt-out (lib/shortcut-ownership.ts carries the rules and the reasoning):
//   - editable targets (typing "c" in any input or rich-text editor must
//     insert a letter),
//   - another pane's surface (a plugin app in bb shares the document, so the
//     board only claims keystrokes that happen inside its own panel root),
//   - a native thread pane focused beside the board with nothing inside the
//     board holding focus,
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
  threadPaneFocused,
}: {
  /** False while the thread pane is open — the composer hands off then. */
  enabled: boolean;
  /** The effective configured key, lowercased (components/preferences.ts). */
  hotkey: string;
  /** The activation: the app's `openNewThread` composer opener. */
  onActivate: () => void;
  /** True while the host's split layout has a native thread pane focused
   *  beside the board (app.tsx's focused-pane read). */
  threadPaneFocused: boolean;
}): void {
  useEffect(() => {
    if (!enabled || hotkey === "") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== hotkey || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!boardOwnsKeystroke(event, { threadPaneFocused })) return;
      event.preventDefault();
      onActivate();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, hotkey, onActivate, threadPaneFocused]);
}
