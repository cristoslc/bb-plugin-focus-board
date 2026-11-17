// Which surface owns a single-key shortcut's keystroke.
//
// The board's shortcuts ("/" focuses board search, a configurable letter opens
// the New Thread composer) listen on `document`, because the board is the
// whole panel and its gestures fire while nothing inside it holds focus. A
// `document` listener hears every keystroke the whole bb window produces, so
// ownership has to be decided per event, not per mount:
//
//   1. An editable surface owns it. Inputs, textareas and selects were the
//      original guards; bb's composers and message editors are rich text
//      (`contenteditable`, ARIA textboxes), which are not any of those, and
//      the letter the operator typed there was swallowed into a modal. The
//      `contenteditable` walk skips `contenteditable="false"` islands because
//      an editing host's own text still belongs to the host around them.
//   2. A dialog or an open dropdown owns it — radix portals focus inside
//      them and every board modal renders through one.
//   3. The board's own panel root owns it when the keystroke happens inside
//      it. A plugin app mounted in bb shares the document with every other
//      pane, so DOM containment is the only exact answer to "which pane is
//      typing": the host's split layout reports a plugin pane as a non-thread
//      pane (`threadId === null`), the same shape as the board's own pane, so
//      it cannot name the board. The panel root can.
//   4. Nothing has focus at all (the event lands on `document.body` or the
//      document itself): no surface is receiving text, so the board takes the
//      key — unless the host's split layout says a native thread pane is
//      focused, because then the keyboard is parked beside the board and the
//      board is not what the operator is looking at. The layout read is
//      `threadPaneFocused` (app.tsx derives it from the focused pane's
//      thread, the same read the click path uses), and a null layout means a
//      single pane, which is the board.
//   5. Anything else — another pane's non-editable chrome, a foreign window's
//      surface, an unknown target — belongs to nobody the board can name, and
//      the board leaves it alone.
//
// One residual ambiguity is deliberate: a *non-thread* pane focused while
// document focus sits on `body` (another plugin app, a settings pane) reads
// like the board's own pane in the host layout, so the board's key can still
// claim there. Nothing is typing in that state, so the keystroke only lands
// on a surface that would otherwise ignore it.
//
// Pure module: no host, no SDK, no React.

import { HOST_PANEL_ATTR } from "@/components/host-link-glue";

/** The board's own panel root (app.tsx sets the attribute). */
const BOARD_PANEL_SELECTOR = `[${HOST_PANEL_ATTR}]`;

/** Surfaces that own every key while they are up. */
const CLAIMING_ANCESTOR_SELECTOR =
  '[role="dialog"], [data-radix-popper-content-wrapper]';

/** Surfaces that insert text. `contenteditable="false"` is not one of them:
 *  it is an inert island inside an editing host, and the host still owns the
 *  keystroke. */
const EDITABLE_ANCESTOR_SELECTOR =
  '[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]';

/** Does this target insert text (so its keystroke is a letter, not a
 *  gesture)? */
export function editableTargetOwnsKey(target: EventTarget | null): boolean {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return (
    target instanceof Element && target.closest(EDITABLE_ANCESTOR_SELECTOR) !== null
  );
}

/**
 * Does the board own this keystroke?
 *
 * `threadPaneFocused` is the host layout's answer to "is a native thread pane
 * focused beside the board" (app.tsx derives it from the focused pane's
 * thread). It only decides the no-focus case: with any element focused, the
 * event target already names the owning surface exactly.
 */
export function boardOwnsKeystroke(
  event: KeyboardEvent,
  { threadPaneFocused }: { threadPaneFocused: boolean },
): boolean {
  const target = event.target;
  if (editableTargetOwnsKey(target)) return false;
  // A keystroke with no element behind it (dispatched at the document, or at
  // a window): no surface is typing, so the layout decides.
  if (!(target instanceof Element)) return !threadPaneFocused;
  if (target.closest(CLAIMING_ANCESTOR_SELECTOR) !== null) return false;
  if (target.closest(BOARD_PANEL_SELECTOR) !== null) return true;
  // Nothing focused: the browser aims the key at the body (or the root).
  if (target === document.body || target === document.documentElement) {
    return !threadPaneFocused;
  }
  return false;
}
