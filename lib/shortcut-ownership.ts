// Which surface owns a single-key shortcut's keystroke.
//
// The board's shortcuts ("/" focuses board search, a configurable letter opens
// the New Thread composer) listen on `document`, because the board is the whole
// panel and its gestures fire while nothing inside it holds focus. A
// `document` listener hears every keystroke the whole bb window produces, so
// arming and ownership are decided per event:
//
// ARMED (both halves are load bearing — the operator's ruling, 2026-11-17):
//
//   1. The board's own pane is the focused pane in the host's split layout.
//      A `useSidebarSplitLayout()` read cannot name the board by content: it
//      reports `threadId: null` for every non-thread pane, so the board's pane
//      and any other plugin pane look alike. bb's pane containers carry the
//      pane id the layout reports (`data-split-pane-id`, observed on the
//      installed 0.49.0 build by
//      `scripts/screenshot/probe-native-split-pane.mjs`: the board's pane was
//      `pane-1`, matching the persisted layout), so the board's pane is named
//      by walking from its panel root to the nearest pane container and
//      comparing with the focused pane's id.
//      A null layout means the host reports no split (a single pane, a compact
//      viewport, splits off), which is the board: it is the only panel there.
//      A layout that names no focused pane, or a panel outside every pane
//      container, means the board cannot prove it holds focus, and it stands
//      down rather than guess: the failure this rule exists to stop is a
//      letter stolen from a surface the operator is actually using.
//   2. The keystroke happens in the board's own surface: inside the panel root,
//      in the host's pane container that holds the panel, or on the document
//      body while the board's pane holds host focus. Three cases, one fact:
//      no other surface is aiming the key.
//      - The pane container is the load-bearing one: bb gives it
//        `tabindex="-1"` and focuses it on pointerdown (observed on the
//        installed 0.50.1 build by
//        `scripts/screenshot/probe-board-shortcut-focus.mjs`), so after the
//        operator clicks anywhere on the board the next keystroke's target is
//        that container, which sits ABOVE the panel root. Refusing it left "/"
//        dead in a split and alive in a one-pane window, where the container
//        carries no tabindex and the key lands on the body (issue: "/" did
//        nothing with a pane open, 2026-11-23).
//      - The body case is the deliberate reading of "focused": with the board's
//        pane focused and nothing clicked yet, no element anywhere owns the
//        keyboard, so requiring an element inside the panel would leave the
//        hotkey dead until the operator clicked the board.
//      The pane half is what makes both of those the board's; the panel half
//      still refuses every other surface, and the container half stops at the
//      board's own pane: a keystroke aimed at the container of the pane beside
//      it belongs to that pane, which is refused by the arming half anyway.
//
// The listener cannot outlive the board being on screen: a plugin panel leaves
// the document when the route leaves it (observed live by
// `scripts/screenshot/probe-board-mount-lifetime.mjs`), so the single-pane
// case cannot fire from a board nobody can see.
//
// OWNERSHIP, once armed (a separate hole from arming):
//
//   3. An editable surface owns the key. Inputs, textareas and selects were
//      the original guards; bb's composers and message editors are rich text
//      (`contenteditable`, ARIA textboxes), which are not any of those, and the
//      letter typed there was swallowed into a modal. The `contenteditable`
//      walk skips `contenteditable="false"` islands because an editing host's
//      own text still belongs to the host around them.
//   4. A dialog or an open dropdown owns it, unchanged from the start: radix
//      portals focus inside them and every board modal renders through one.
//
// Pure module: no host, no SDK, no React.

import { HOST_PANEL_ATTR } from "@/components/host-link-glue";

/** bb's pane container attribute: the pane id the split layout reports under
 *  the same name (a host contract, observed by the native-pane probes, and
 *  re-read on the installed 0.50.1 build by
 *  `scripts/screenshot/probe-board-shortcut-focus.mjs`). Exported because the
 *  card click's focus lever addresses the same containers
 *  (`lib/native-pane-focus.ts`). */
export const HOST_SPLIT_PANE_ATTR = "data-split-pane-id";

/** The board's own panel root (app.tsx sets the attribute). */
const BOARD_PANEL_SELECTOR = `[${HOST_PANEL_ATTR}]`;

/** The host's pane container the board's panel sits in, or null when the host
 *  does not name one. */
function boardPaneContainer(panel: Element): Element | null {
  return panel.closest(`[${HOST_SPLIT_PANE_ATTR}]`);
}

/**
 * The id of the pane the board's own panel sits in, or null when the host does
 * not name one (or no panel is mounted).
 *
 * The card click reads it to refuse a pane record that has come to name the
 * board's own pane: navigating into that pane would replace the board
 * (`lib/native-pane-ownership.ts`).
 */
export function boardPaneId(panel: Element | null): string | null {
  if (panel === null) return null;
  return boardPaneContainer(panel)?.getAttribute(HOST_SPLIT_PANE_ATTR) ?? null;
}

/** Surfaces that own every key while they are up. */
const CLAIMING_ANCESTOR_SELECTOR =
  '[role="dialog"], [data-radix-popper-content-wrapper]';

/** Surfaces that insert text. `contenteditable="false"` is not one of them:
 *  it is an inert island inside an editing host, and the host still owns the
 *  keystroke. */
const EDITABLE_ANCESTOR_SELECTOR =
  '[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"]';

/** The slice of the host's split layout this rule reads. */
export interface SplitPaneLayoutView {
  readonly panes: readonly {
    /** The host's pane id, also carried by the pane's container element. */
    readonly paneId: string;
    /** The thread this pane shows, or null for a non-thread pane. */
    readonly threadId: string | null;
    readonly isFocused: boolean;
  }[];
}

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
 * Is the board's own pane the focused pane in the host's split layout?
 *
 * `panel` is the board's panel root (`[data-focus-board-panel]`); the pane it
 * sits in is the pane the board occupies. Null means the board is not mounted,
 * which is never a surface that owns a keystroke.
 */
export function boardPaneIsFocused(
  layout: SplitPaneLayoutView | null,
  panel: Element | null,
): boolean {
  if (panel === null) return false;
  // No split reported: one pane, and this listener belongs to it.
  if (layout === null) return true;
  const focused = layout.panes.find((pane) => pane.isFocused);
  // A layout mid-update names no focused pane; the board cannot prove focus.
  if (focused === undefined) return false;
  const paneId = boardPaneContainer(panel)?.getAttribute(HOST_SPLIT_PANE_ATTR) ?? null;
  // A host that does not name its pane containers cannot be asked which pane
  // holds focus, so the board stands down instead of guessing.
  if (paneId === null) return false;
  return paneId === focused.paneId;
}

/**
 * Does the board own this keystroke?
 *
 * `panel` and `layout` are read at event time (app.tsx passes its refs), so a
 * pane-focus change needs no listener re-subscription.
 */
export function boardOwnsKeystroke(
  event: KeyboardEvent,
  {
    panel,
    layout,
  }: { panel: Element | null; layout: SplitPaneLayoutView | null },
): boolean {
  const target = event.target;
  // Ownership first: a typed letter belongs to the surface being typed in,
  // even on a board that is armed.
  if (editableTargetOwnsKey(target)) return false;
  if (target instanceof Element && target.closest(CLAIMING_ANCESTOR_SELECTOR) !== null) {
    return false;
  }
  // Arming: the board's pane must hold host focus.
  if (!boardPaneIsFocused(layout, panel)) return false;
  // A keystroke with no element behind it (dispatched at the document, or at a
  // window) has no owner below the board: with the board's pane focused it is
  // the board's.
  if (!(target instanceof Element)) return true;
  if (target.closest(BOARD_PANEL_SELECTOR) !== null) return true;
  // bb focuses its pane container on pointerdown, so a click inside the board
  // aims the next keystroke at the container ABOVE the panel root. That is the
  // pane the arming half just proved is the board's, host chrome included, and
  // nothing in it accepts text (editable targets were refused above).
  const paneContainer = panel === null ? null : boardPaneContainer(panel);
  if (paneContainer !== null && paneContainer.contains(target)) return true;
  // Nothing focused: the browser aims the key at the body (or the root).
  if (target === document.body || target === document.documentElement) return true;
  return false;
}
