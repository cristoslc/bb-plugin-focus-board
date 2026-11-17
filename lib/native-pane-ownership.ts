// The card click's native placement rule: which pane, if any, one click
// replaces.
//
// bb's opener (`openThreadInSplit`, apps/app/src/lib/split-layout) gives every
// thread that is not already open a NEW right-hand pane beside the focused one,
// so a board whose cards open native panes grows one pane per click until bb's
// eight-pane ceiling. The operator's rule (2026-11-17, after a four-pane
// window: board, then one thread pane per card click) is one board-opened
// thread pane that later clicks replace in place.
//
// What the host actually lets a plugin do, measured on the installed 0.49.0:
// nothing that replaces or closes a pane. The declared surface is
// `PluginSidebarThreadActions.open(threadId, { split })` and
// `useBbNavigate().toThread(threadId)` (`@get-bb/plugin-sdk` 0.6.19,
// `bb-plugin-sdk.d.ts`), and the runtime object the app hands a plugin
// (`globalThis.__bbPluginRuntime.pluginSdkApp` in the installed
// plugin-frontend bundle) is exactly that surface: `replacePaneContent` and
// `removePane` stay inside bb's own split-layout ops, with no plugin hook in
// front of them. So "replace this pane" is not askable directly.
//
// The supported route is the host's own navigation reconciliation. A route's
// content lands in the pane that already holds it, focusing that pane, and
// otherwise REPLACES THE FOCUSED pane (`SplitThreadArea`'s
// `reconcileLayoutForContent` → `replacePaneContent(layout,
// layout.focusedPaneId, content)`; the same logic ships in 0.49.0 as `LP`/`IN`
// in the renderer bundle). That gives the replacement in two navigations and
// no close: navigate to the thread the board's pane already shows (the host
// focuses that pane, content untouched, board still on screen), then navigate
// to the clicked thread (it is in no pane, so the focused pane — the board's
// own thread pane, never the board — takes it). Nothing is unmounted in
// between, so there is no empty half and no gap to see.
//
// Recognition rule: a pane is the board's while the board's RECORD names it —
// the paneId the host created for a card click plus the thread the board last
// put there — and the record still matches the live layout. Both halves are
// needed:
//
//   - paneId alone would let a recycled id (bb names panes `pane-N` and reuses
//     the lowest free number) claim a pane the operator opened;
//   - threadId alone would forget the pane the moment the board replaced its
//     thread, so clicking back and forth between two cards would open a
//     second pane on the way back.
//
// Consequences, stated so they are not surprises:
//
//   - The operator DRAGS the board's pane (to the left of the board, or into
//     another row). bb's `movePane` keeps the paneId, so the pane is still the
//     board's and the next click replaces it where the operator put it. Moving
//     a pane is arranging, not taking it over.
//   - The operator opens a THREAD in that pane themselves (sidebar click, a
//     mention, a link). The pane now shows a thread the board never put
//     there, the record no longer matches, and the board forgets it: the next
//     card click opens its own pane instead of discarding what the operator
//     opened. The board never closes a pane either — the layout keeps whatever
//     the operator arranged.
//   - The pane is closed. The record stops matching, ownership lapses, and the
//     next click opens a fresh pane that the board then owns.
//   - The record is per browser (bb's own split layout persists, so a reload
//     must not cost the operator a second pane). A record that no longer
//     matches — a recycled id, a re-threaded pane, a layout from an older
//     build — is ignored, and ignoring it is always safe: the click falls back
//     to the opener, which is what the click did before this rule existed.
//
// Pure module: no host, no SDK, no React, no DOM.

import type { SplitPaneLayoutView } from "./split-pane-cap";

/** The pane the board opened, and the thread the board last put in it. */
export interface BoardNativePane {
  readonly paneId: string;
  readonly threadId: string;
}

/** What one card click should do, given the layout and the board's record. */
export type NativeCardPlacement =
  /** Focus the pane `paneId` (the host focuses a pane that already shows the
   *  route's content) and then navigate to the clicked thread, which lands in
   *  that pane. `threadId` is the thread the pane shows NOW — the focus step
   *  navigates to it. `focused` is true when that pane already has the focus,
   *  so the click can navigate straight through. */
  | {
      readonly kind: "replace";
      readonly paneId: string;
      readonly threadId: string;
      readonly focused: boolean;
    }
  /** Hand the thread to the host's opener, which splits a pane beside the
   *  board — or focuses, or replaces at the ceiling, by bb's own rules. */
  | { readonly kind: "open" };

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
 * Anything malformed — not JSON, not an object, a blank or non-string half —
 * answers null, which reads as "the board owns no pane" and takes the safe
 * fallback (the host's opener). A stale record is never repaired into a
 * guess: guessing here decides whose pane gets replaced.
 */
export function parseBoardNativePaneStored(
  raw: string | null,
): BoardNativePane | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { paneId, threadId } = parsed as {
    paneId?: unknown;
    threadId?: unknown;
  };
  if (typeof paneId !== "string" || paneId === "") return null;
  if (typeof threadId !== "string" || threadId === "") return null;
  return { paneId, threadId };
}

/**
 * The board's pane as the live layout shows it, or null when the record no
 * longer matches.
 *
 * A null layout (one pane, a compact viewport, splits off) answers null: there
 * is no thread pane beside the board to own.
 */
export function boardNativePaneInLayout(
  layout: SplitPaneLayoutView | null,
  record: BoardNativePane | null,
): BoardNativePane | null {
  if (layout === null || record === null) return null;
  const pane = layout.panes.find((candidate) => candidate.paneId === record.paneId);
  if (pane === undefined || pane.threadId !== record.threadId) return null;
  return record;
}

/**
 * What a card click does, given the layout and the board's record.
 *
 * A null layout keeps the click on the host's opener: a single-pane or
 * compact window has no pane of the board's to replace, and the host's opener
 * is where splits degrade to plain navigation.
 */
export function planNativeCardPlacement(
  layout: SplitPaneLayoutView | null,
  record: BoardNativePane | null,
  threadId: string,
): NativeCardPlacement {
  const owned = boardNativePaneInLayout(layout, record);
  if (owned === null) return { kind: "open" };
  // The clicked thread is already in the board's pane: the host's opener
  // focuses a pane that shows the thread, and nothing moves.
  if (owned.threadId === threadId) return { kind: "open" };
  const focusedPane = layout?.panes.find((pane) => pane.isFocused);
  return {
    kind: "replace",
    paneId: owned.paneId,
    threadId: owned.threadId,
    focused: focusedPane !== undefined && focusedPane.paneId === owned.paneId,
  };
}

/**
 * The pane the host just created for `threadId`, or null when it created none.
 *
 * Ownership is claimed from the layout rather than assumed: the host picks the
 * pane id, so the board learns its pane by watching which pane started showing
 * the thread it asked for. A pane that already showed that thread before the
 * click was the operator's, and is never adopted.
 */
export function newlyOpenedPane(
  layout: SplitPaneLayoutView | null,
  threadId: string,
  priorPaneIds: readonly string[],
): BoardNativePane | null {
  if (layout === null) return null;
  const pane = layout.panes.find(
    (candidate) =>
      candidate.threadId === threadId && !priorPaneIds.includes(candidate.paneId),
  );
  return pane === undefined ? null : { paneId: pane.paneId, threadId };
}
