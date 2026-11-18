// The card click's native pane: which pane Focus Board opened, and how the
// click gets a thread into it.
//
// ## What the host gives a plugin, measured on the installed 0.49.0
//
// - `experimental_useSidebarThreadActions().open(threadId, { split: true })` is
//   the placement API. Its rule (`jQ` in the renderer): plainly navigate when
//   the window is compact or has no split layout yet; focus the pane that
//   already shows the thread; otherwise create a new right-hand pane (or, at
//   the eight-pane cap, replace the focused pane). It has no "put this thread
//   in that pane".
// - Every host navigation lands route content in the pane that already holds
//   it, and otherwise REPLACES THE FOCUSED PANE (`LP` → `replacePaneContent`,
//   the same in 0.48 and 0.49). So a replacement is: focus the pane, then
//   navigate into it.
// - Focus follows the pointer: pressing inside a pane focuses it (the pane
//   div's `onPointerDown` → `store.set(splitLayoutAtom, focusPane(...))`). A
//   card click therefore reaches its own handler with the BOARD focused, which
//   `scripts/screenshot/probe-card-click-focus-trace.mjs` records per step:
//   the thread pane is focused before the press, mousedown and click both see
//   the board's pane focused. That is why the click focuses Focus Board's pane
//   before it navigates, and why the focus step cannot be dropped.
//
// ## The click, in three questions
//
// 1. Is there a split? A one-pane window reports none (`useSidebarSplitLayout`
//    answers null below two panes), and with no split layout bb's opener
//    plainly navigates, which replaces the board's pane with the thread page.
//    A split cannot be created from there either: every pane-creating call in
//    the renderer sits behind that same "no layout → navigate" gate, and the
//    pane content union is thread | new-thread | plugin-panel | plugin-detail,
//    so nothing else (a terminal, a browser, a fixed tab) can occupy a pane
//    slot. No split therefore means the board's own in-panel pane.
// 2. Is one of those panes Focus Board's? The record below says so, and the
//    live layout has to still agree, so a pane the operator opened from bb's
//    own sidebar, or rethreaded themselves, is never adopted.
// 3. Use it: the clicked thread is already there (focus, nothing moves), or
//    the pane's current thread is opened to focus that pane and the clicked
//    thread is navigated into it.
//
// ## The record, and why it is persisted
//
// `{ paneId, threadId }`: the pane bb created for Focus Board, and the thread
// Focus Board last put in it. Both halves are load-bearing. The pane id alone
// would let a recycled id (`pane-N`, lowest free number wins) claim a pane the
// operator opened; the thread alone would forget the pane the moment the board
// replaced its thread, so clicking back and forth would open a second pane on
// the way back.
//
// It lives in plugin-scoped localStorage rather than React state because bb
// re-creates the plugin panel's subtree when the window's layout changes, so
// anything a click keeps only in state can be gone before the host answers
// (docs/plans/2026-11-17-one-board-pane.md section 5). The record is written
// before the host is asked for anything, and the click's remaining state is
// only the wait for the focus to land.
//
// A record that no longer matches the live layout — pane closed, pane showing
// another thread, thread gone from the board's list — is ignored, and ignoring
// it is always safe: the click opens the board's own pane, which is what a
// click does before Focus Board has a pane of its own.
//
// Pure module: no host, no SDK, no React, no DOM.

import type { SplitPaneLayoutView } from "./split-pane-cap";

/** The pane bb created for Focus Board, and the thread it last put there. */
export interface BoardNativePane {
  /** The host's pane id. */
  readonly paneId: string;
  readonly threadId: string;
}

/** The record against the live layout. */
export interface ResolvedBoardNativePane {
  readonly paneId: string;
  readonly threadId: string;
  readonly isFocused: boolean;
}

/** The plugin-scoped localStorage key for the board's pane record. */
export function nativePaneStorageKey(pluginId: string): string {
  return `${pluginId}:boardNativeThreadPane`;
}

/** The stored record, or "" for none (the key is then removed). */
export function boardNativePaneStoredValue(
  pane: BoardNativePane | null,
): string {
  if (pane === null) return "";
  return JSON.stringify({ paneId: pane.paneId, threadId: pane.threadId });
}

/**
 * A stored record parses back as a record, or as null.
 *
 * Anything malformed answers null, which reads as "the board owns no pane" and
 * takes the safe path (the board's own in-panel pane): not JSON, not an object,
 * a blank or non-string thread, a blank or non-string pane id. A record with no
 * pane id at all is one an earlier version of this rule wrote while it could
 * claim a pane it could not name; that shape is gone, and such a record now
 * reads as no record rather than throwing or guessing a pane.
 */
export function parseBoardNativePaneStored(
  raw: string | null,
): BoardNativePane | null {
  if (raw === null || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { paneId, threadId } = parsed as { paneId?: unknown; threadId?: unknown };
  if (typeof threadId !== "string" || threadId === "") return null;
  if (typeof paneId !== "string" || paneId === "") return null;
  return { paneId, threadId };
}

/**
 * The record against the live layout, or null when it no longer matches.
 *
 * A null layout (one pane, a compact viewport, splits off) answers null: there
 * is no thread pane beside the board to own.
 */
export function resolveBoardNativePane(
  layout: SplitPaneLayoutView | null,
  record: BoardNativePane | null,
): ResolvedBoardNativePane | null {
  if (layout === null || record === null) return null;
  const pane = layout.panes.find(
    (candidate) =>
      candidate.paneId === record.paneId &&
      candidate.threadId === record.threadId,
  );
  if (pane === undefined) return null;
  return {
    paneId: pane.paneId,
    threadId: record.threadId,
    isFocused: pane.isFocused,
  };
}
