// The card click's native pane: which pane Focus Board opened, and how the
// click gets a thread into it.
//
// ## What the host gives a plugin, measured on the installed host
//
// - `experimental_useSidebarThreadActions().open(threadId, { split: true })` is
//   the placement API. Its rule (`openThreadInSplit` in the renderer): plainly
//   navigate when the window is compact or has no split layout at all; focus
//   the pane that already shows the thread; otherwise create a new right-hand
//   pane (or, at the eight-pane cap, replace the focused pane). It has no "put
//   this thread in that pane".
// - Every host navigation lands route content in the pane that already holds
//   it, and otherwise REPLACES THE FOCUSED PANE (`replacePaneContent`, the
//   same rule in 0.48, 0.49 and 0.50). So a replacement is: focus the pane,
//   then navigate into it.
// - Focus follows the pointer: pressing inside a pane focuses it. A card click
//   therefore reaches its own handler with the BOARD focused, which
//   `scripts/screenshot/probe-card-click-focus-trace.mjs` records per step: the
//   thread pane is focused before the press, mousedown and click both see the
//   board's pane focused. That is why the click is careful about focus before it
//   navigates.
// - A pane showing NO thread has no thread to open, so the opener cannot focus
//   it. The lever that does is a press on the pane's own container; the
//   measurement, the shape that works, and the shapes that do not live in
//   `lib/native-pane-focus.ts` and
//   `docs/screenshots/probe-pane-focus-lever/`.
//
// ## The click, in three questions
//
// 1. Is there a split? A one-pane window reports none through
//    `useSidebarSplitLayout` (null below two panes), but the WINDOW still
//    carries a one-pane layout: measured on 0.50.1, the host's opener splits
//    it and the board keeps its pane. So the one-pane question is not "is
//    there a split" but "will this host split", which only the ask answers —
//    `lib/native-one-pane-dance.ts` carries that measurement, the ask, and
//    the repair for the host that plainly navigates instead.
// 2. Is one of those panes Focus Board's? The record below answers, and the
//    live layout has to still hold a pane with that id.
// 3. Use it: focus that pane, then navigate the clicked thread into it.
//
// ## Ownership is the pane id (operator ruling, 2026-11-24)
//
// The operator ruled "always take the pane back" (dec_okjt7e62rg2x, corpus
// entry dl-20261124T050924-68ea): the pane is the board's by id, whatever it
// shows. A recorded `paneId` that is present in the live layout is the board's
// pane, including when the pane shows no thread at all (a route page like
// Decisions) or a thread the operator navigated to.
//
// The `threadId` half of the record is ADVISORY. It names the thread the board
// last put in the pane, which the click uses for one thing: when the pane shows
// a thread, opening THAT thread is how the host focuses the pane. It decides
// nothing about ownership, so a thread the board no longer lists, or a pane the
// operator rethreaded, does not cost the board its pane.
//
// The ruling's cost, which the operator accepted: clicking a card while reading
// something else in that pane replaces what is there. Its gain: the pane count
// stops growing. Measured before the ruling on today's build: 2 → 3 → 4 → 5
// panes over three "navigate the pane to a page, click a card" cycles
// (docs/screenshots/probe-card-click-after-right-panel/, phase G).
//
// ## The record, and why it is persisted
//
// `{ paneId, threadId }`: the pane bb created for Focus Board, and the thread
// Focus Board last put in it. It lives in plugin-scoped localStorage rather
// than React state because bb re-creates the plugin panel's subtree when the
// window's layout changes, so anything a click keeps only in state can be gone
// before the host answers (docs/plans/2026-11-17-one-board-pane.md section 5).
// The record is written before the host is asked for anything, and the click's
// remaining state is only the wait for the focus to land.
//
// A record whose pane is GONE is ignored, and ignoring it is always safe: the
// click re-plans from what the host renders rather than guessing a pane
// (`lib/native-fresh-pane.ts` carries that rule, its live trace, and the report
// it answers: asking for a fresh split is the one ask that can cost a pane).
//
// ## The residual risk the ruling accepts, and the one guard it keeps
//
// Pane ids are recycled (`pane-N`, lowest free number wins), and the host
// exposes nothing that survives a pane's death: the SDK's
// `PluginSidebarSplitLayout` carries a pane id, a rect, a thread and a focus
// flag and nothing else, no pane-creation event reaches a plugin, and the pane
// container the click presses is addressed by that same id (read from
// `@get-bb/plugin-sdk` 0.6.19's bundled typings and the installed host's
// bundle). So a recorded pane that was destroyed and re-created under the same
// number cannot be told from the one the board opened, and the board will claim
// it. That is a known residual risk of resting ownership on the id, not a bug
// to fix here.
//
// One shape is NOT left to the risk: the board reads its own pane id off its
// panel root (`lib/shortcut-ownership.ts` `boardPaneId`) and refuses a record
// that names it. Focusing that pane is a no-op while the board is focused, and
// the landing navigation would replace the BOARD — the one outcome the click
// must never ship.
//
// Pure module: no host, no SDK, no React, no DOM.

import type { SplitPaneLayoutView } from "./split-pane-cap";

/** The pane bb created for Focus Board, and the thread it last put there. */
export interface BoardNativePane {
  /** The host's pane id. Ownership rests on this half. */
  readonly paneId: string;
  /** Advisory: the thread the board last put in the pane. It names the focus
   *  lever while the pane shows a thread, and decides nothing. */
  readonly threadId: string;
}

/** The record against the live layout. */
export interface ResolvedBoardNativePane {
  readonly paneId: string;
  /** The record's advisory thread, unchanged. */
  readonly threadId: string;
  /** The thread the pane shows NOW, or null when it shows no thread (a route
   *  page, a plugin panel): the focus step's input. */
  readonly shownThreadId: string | null;
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
 * takes the safe path (a fresh pane beside the board, never a guessed pane):
 * not JSON, not an object, a blank or non-string thread, a blank or non-string
 * pane id. A record with no pane id at all is one an earlier version of this
 * rule wrote while it could claim a pane it could not name; that shape is gone,
 * and such a record now reads as no record rather than throwing or guessing a
 * pane.
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
 * The record against the live layout, or null when the board's pane is gone,
 * or when the record names the board's own pane.
 *
 * `boardPaneId` is the pane the board's own panel sits in, when the host names
 * it (`lib/shortcut-ownership.ts` `boardPaneId`, read off the panel root). It is
 * the one pane a record may never resolve to: navigating into it would replace
 * the board.
 *
 * A null layout (one pane, a compact viewport, splits off) answers null: there
 * is no thread pane beside the board to own.
 */
export function resolveBoardNativePane(
  layout: SplitPaneLayoutView | null,
  record: BoardNativePane | null,
  boardPaneId: string | null = null,
): ResolvedBoardNativePane | null {
  if (layout === null || record === null) return null;
  if (boardPaneId !== null && record.paneId === boardPaneId) return null;
  const pane = layout.panes.find(
    (candidate) => candidate.paneId === record.paneId,
  );
  if (pane === undefined) return null;
  return {
    paneId: pane.paneId,
    threadId: record.threadId,
    shownThreadId: pane.threadId,
    isFocused: pane.isFocused,
  };
}
