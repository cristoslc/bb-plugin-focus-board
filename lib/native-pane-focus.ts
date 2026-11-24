// Focusing a split pane that shows no thread.
//
// The card click's replace rule is "focus the pane, then navigate into it",
// because bb lands a navigation in the FOCUSED pane. For a pane showing another
// thread there is a lever the click already uses — `open(thatThread, { split:
// true })` focuses the pane holding it — but a pane showing no thread at all
// (the rail's Decisions page, or any route the operator navigated the pane to)
// has no thread to open. bb's plugin SDK has no command surface either: its
// keybinding vocabulary names `pane.focus.1`…`pane.focus.8`, `pane.focus.next`
// and the arrow moves, but nothing in `@get-bb/plugin-sdk` lets a plugin invoke
// one, and the layout hook is read-only.
//
// What works is a press on the pane's own container. bb focuses a pane in that
// element's pointer handler (`onPointerDown` → `onFocusPane(paneId)` in the
// workspace route's pane chrome), and the handler is DELEGATED: it lives above
// the container, so the event has to bubble. Measured on the installed host by
// `scripts/screenshot/probe-pane-focus-lever.mjs`, with the board's pane
// focused first, in its own browser context:
//
// | Dispatch at `[data-split-pane-id]` | Result |
// |---|---|
// | `pointerdown`, bubbling, at the container | focus moves; `data-focused` follows |
// | `pointerdown`, no bubbles | nothing |
// | `mousedown` | nothing |
// | `pointerdown` at a descendant | focus moves (the same delegate) |
//
// Both a pane showing a thread (phase 1) and a pane showing a page (phase 2)
// moved, so the lever does not care what the pane holds. The host's handler also
// keeps the URL in step with the focused pane, so a press on a page pane first
// makes the app route that page; the click's landing navigation replaces it a
// frame later (phase 3).
//
// This module is the press only. It answers whether it pressed, never whether
// the focus moved: the caller verifies that against the layout, because a press
// that changed nothing must not be followed by a navigation — bb would replace
// the still-focused pane, which is the board itself.

// The host's pane container attribute lives with the other DOM pane read the
// board does (`lib/shortcut-ownership.ts`): one contract, one definition.
import { HOST_SPLIT_PANE_ATTR } from "./shortcut-ownership";

/** What a focus attempt did. */
export type PanePressResult = "pressed" | "no-pane-element";

/** The pane container the host renders for `paneId`, or null. Compared as
 *  attribute values rather than through a selector, so a pane id can never be
 *  read as selector syntax. */
export function paneContainer(doc: Document, paneId: string): Element | null {
  if (paneId.trim() === "") return null;
  const candidates = doc.querySelectorAll(`[${HOST_SPLIT_PANE_ATTR}]`);
  for (let index = 0; index < candidates.length; index += 1) {
    const element = candidates.item(index);
    if (element !== null && element.getAttribute(HOST_SPLIT_PANE_ATTR) === paneId) {
      return element;
    }
  }
  return null;
}

/**
 * Press the named pane's container, the way a real pointer press reaches it.
 *
 * The event is a bubbling `pointerdown` with `button: 0` and the primary
 * pointer, dispatched at the container element: the shape phase 1 and phase 2 of
 * the lever probe proved focuses a thread pane and a page pane alike.
 */
export function pressPaneContainer(
  doc: Document,
  paneId: string,
): PanePressResult {
  const container = paneContainer(doc, paneId);
  if (container === null) return "no-pane-element";
  const rect = container.getBoundingClientRect();
  container.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: Math.round(rect.x + 20),
      clientY: Math.round(rect.y + 20),
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    }),
  );
  return "pressed";
}
