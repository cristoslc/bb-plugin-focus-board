import { useEffect, type RefObject } from "react";
import {
  boardOwnsKeystroke,
  type SplitPaneLayoutView,
} from "@/lib/shortcut-ownership";

// A configured key (default "C") opens the board's New Thread composer, but
// only while the board's own pane holds host focus and the keystroke happens
// in the board's own surface: with a pane open, another pane focused, or focus
// sitting on a surface that is not the board's, the letter belongs to whoever
// owns it. The rules and the reasoning live in lib/shortcut-ownership.ts:
//   - the board's pane must be the focused pane in the host's split layout
//     (a null layout is a single pane, which is the board),
//   - an editable target (input, textarea, select, rich-text editor) inserts a
//     letter instead,
//   - dialogs and open dropdown menus own their keys,
//   - modifier chords ("⌘C" copies, "ctrl+C" copies, and friends keep their
//     platform meanings),
//   - an event another handler already claimed (`defaultPrevented` — e.g. the
//     pane's capturing Escape handler pattern upstream).
// The empty-string hotkey is the off state (the caller may pass it) — no real
// KeyboardEvent has an empty `key`, so it never matches.
export function useNewThreadComposerShortcut({
  enabled,
  hotkey,
  onActivate,
  panelRef,
  splitLayoutRef,
}: {
  /** False while the in-board thread pane is open — the composer hands off
   *  then. */
  enabled: boolean;
  /** The effective configured key, lowercased (components/preferences.ts). */
  hotkey: string;
  /** The activation: the app's `openNewThread` composer opener. */
  onActivate: () => void;
  /** The board's panel root, as app.tsx holds it. */
  panelRef: RefObject<Element | null>;
  /** The host's split layout as the latest render saw it (app.tsx's
   *  splitLayoutRef), read at keystroke time. */
  splitLayoutRef: RefObject<SplitPaneLayoutView | null>;
}): void {
  useEffect(() => {
    if (!enabled || hotkey === "") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== hotkey || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        !boardOwnsKeystroke(event, {
          panel: panelRef.current,
          layout: splitLayoutRef.current,
        })
      ) {
        return;
      }
      event.preventDefault();
      onActivate();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, hotkey, onActivate, panelRef, splitLayoutRef]);
}
