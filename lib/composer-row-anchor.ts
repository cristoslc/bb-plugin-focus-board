// The New project button's anchor onto the host composer's pickers row (the
// New Thread dialog's "No project ⌄ … Default ⌄ … Full Access ⌄" line).
//
// The constraint this works inside (verified against the installed bb
// 0.48.1 bundles): the pickers row is bb's own DOM inside the embedded
// composer — the plugin-facing `experimental_NewThreadComposer` wrapper
// drops bb's `createProject` capability (upstream request
// get-bb/bb#7015), so the row cannot host a plugin-rendered control, and
// no composer-customization region reaches it either. The dialog therefore
// renders the button itself and positions it ON the row's line: the row's
// content starts one `padding-left` in from the wrapper's left edge, so a
// button whose RIGHT edge sits exactly at the row's content start occupies
// the empty band left of the first picker without covering any of its
// click area.
//
// Why measurement rather than a negative-margin tuck: the pixel span
// between the composer's bottom edge and the row (the dialog grid gap and
// the row's own margin) and the row's padding differ between the desktop
// dialog and the compact drawer (`px-3.5` → `max-md:px-1`), and all of it
// can move with any bb update. Reading the live row's geometry derives the
// numbers per render, theme- and viewport-independent, and a
// ResizeObserver re-derives them as the prompt area grows or the composer's
// banner slot fills.
//
// The hook attribute `data-new-thread-footer` is bb's own stable DOM hook,
// rendered unconditionally by the shared compose component in both the main
// view's path and the plugin-facing host path (verified in bb 0.48.1's
// NewThreadComposer bundle: the footer div is built outside any conditional,
// directly under the `data-app-composer` root). When the row cannot be
// found or measured — the tests' stub composers, or a future bb that
// renames the hook — the measure returns null and the caller keeps the
// stacked shape the button shipped in (PR #361): the fallback is a tested,
// always-working shape, never a silent guess at offsets.

/** bb's own hook for the composer's pickers row. Queried STRICTLY INSIDE
 *  the modal's composer wrapper — never against the document. */
export const COMPOSER_FOOTER_ROW_SELECTOR = '[data-new-thread-footer=""]';

/** The New project option button's own box (`size-7` icon button). Kept
 *  beside the classes that render it in the modal; the placement math reads
 *  these, so a restyle updates both together. */
export const NEW_PROJECT_BUTTON_WIDTH = 28;
export const NEW_PROJECT_BUTTON_HEIGHT = 28;

/** The footer row's box, relative to the composer wrapper. `contentLeft` is
 *  the row's border-box left plus its computed padding-left — the line the
 *  row's first control begins its click area at. */
export interface FooterRowGeometry {
  top: number;
  contentLeft: number;
  height: number;
}

/** Where an absolutely-positioned control goes, relative to the composer
 *  wrapper's padding edge (the same reference the row's offsets use). */
export interface FooterRowPlacement {
  top: number;
  left: number;
}

/**
 * The placement math, pure: the control is vertically centered on the row's
 * own line and its right edge lands on the row's content start.
 */
export function composeFooterRowPlacement(
  row: FooterRowGeometry,
  buttonWidth: number,
  buttonHeight: number,
): FooterRowPlacement {
  return {
    top: row.top + (row.height - buttonHeight) / 2,
    left: row.contentLeft - buttonWidth,
  };
}

/**
 * Measure the footer row inside `wrapper` and return the floating placement
 * for the New project button, or null when the row is absent or impossible
 * to measure (no layout — jsdom-style environments resolve all boxes to
 * zero). Null is the stacked-shape contract, not an error state: the caller
 * renders the button in flow exactly as shipped before this anchor existed.
 */
export function measureFooterRowAnchor(
  wrapper: HTMLElement,
  buttonWidth: number,
  buttonHeight: number,
): FooterRowPlacement | null {
  const row = wrapper.querySelector<HTMLElement>(COMPOSER_FOOTER_ROW_SELECTOR);
  if (row === null) return null;
  const parsedPadding = Number.parseFloat(window.getComputedStyle(row).paddingLeft);
  const rowPaddingLeft = Number.isNaN(parsedPadding) ? 0 : parsedPadding;
  if (row.offsetParent === wrapper) {
    // The primary branch: layout-space offsets relative to the wrapper
    // (the wrapper is the row's offset parent — it is `relative` and every
    // element between is static today). Immune to the dialog's entry
    // animation, whose zoom transform makes getBoundingClientRect pairs
    // disagree with layout while it runs.
    return composeFooterRowPlacement(
      {
        top: row.offsetTop,
        contentLeft: row.offsetLeft + rowPaddingLeft,
        height: row.offsetHeight,
      },
      buttonWidth,
      buttonHeight,
    );
  }
  // A positioned element now sits between wrapper and row (a future bb
  // markup change): fall back to rect pairs relative to the wrapper.
  const wrapBox = wrapper.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  if (wrapBox.width === 0 || rowBox.width === 0) return null;
  return composeFooterRowPlacement(
    {
      top: rowBox.top - wrapBox.top,
      contentLeft: rowBox.left - wrapBox.left + rowPaddingLeft,
      height: rowBox.height,
    },
    buttonWidth,
    buttonHeight,
  );
}
