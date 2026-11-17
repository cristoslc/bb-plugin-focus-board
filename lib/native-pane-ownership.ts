// The card click's native placement rule: which pane, if any, one click
// replaces.
//
// bb's opener (`openThreadInSplit`, apps/app/src/lib/split-layout) gives every
// thread that is not already open a NEW right-hand pane beside the focused one,
// so a board whose cards open native panes would grow one pane per click until
// bb's eight-pane ceiling. The operator's rule (2026-11-17, after a four-pane
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
// in the renderer bundle). So a replacement is: focus the board's own pane with
// the host's opener (its documented rule focuses a pane that already shows the
// thread), then navigate to the clicked thread, which is in no pane and so
// lands in the focused one. Nothing is unmounted in between, so there is no
// empty half and no gap to see.
//
// ## The 2026-11-17 regression this rule shipped with, and what it changed
//
// The first version of this module recognised the board's pane by
// `{ paneId, threadId }` only, wrote the record AFTER the open was confirmed
// from a re-render, and confirmed a replacement's focus step by watching for a
// layout object whose identity differed from the click's snapshot. Three live
// failures came out of that, each measured with
// scripts/screenshot/probe-native-one-click-trace.mjs:
//
//   1. bb re-creates the plugin panel's subtree when it splits for the first
//      time (the board's DOM marker is gone by +100ms), so the click's React
//      state — including the record it was about to write — is destroyed
//      before the confirmation can run. The record never existed, and the next
//      click opened a second pane.
//   2. A focus step built on `toThread(paneThread)` does nothing when the app
//      is already on that route: react-router pushes no entry, no
//      reconciliation runs, the layout keeps its identity, and the click
//      stalls with no pane opened and no error.
//   3. A record naming a thread the host can no longer resolve sent
//      `toThread` down its own fallback route instead of opening anything,
//      which reads as "switches to home".
//
// So the record is now written AT CLICK TIME (before the host is asked for
// anything), a null pane id means "claim whichever pane shows this thread that
// was not there when the click happened", the focus step is the host's opener
// (id-based, never a route-equality assumption), and a replacement that is not
// confirmed inside its window falls back to the opener. There is no `focused`
// shortcut and no identity comparison anywhere.
//
// ## Recognition rule
//
// A pane is the board's while the record names it and the live layout agrees:
//
//   - `paneId` set: that pane must still exist AND still show `threadId`;
//   - `paneId` null: some pane shows `threadId` and was not one of the panes
//     present when the board opened it (`priorPaneIds`), so a pane the
//     operator opened from bb's own sidebar is never adopted.
//
// Either way the record is dropped, and the click opens a pane instead of
// navigating anywhere, when the pane is gone, its thread changed, or the
// thread is no longer in the board's live list (the host could not resolve it).
//
// Consequences, stated so they are not surprises:
//
//   - The operator DRAGS the board's pane: bb's `movePane` keeps the paneId, so
//     the pane is still the board's and the next click replaces it where the
//     operator put it.
//   - The operator opens a THREAD in that pane themselves: the pane shows a
//     thread the board never put there, the record stops matching, and the next
//     click opens its own pane instead of discarding what the operator opened.
//   - The pane is closed, or bb renumbers it: the record stops matching and the
//     next click opens a fresh pane that the board then owns.
//
// Pure module: no host, no SDK, no React, no DOM.

import type { SplitPaneLayoutView } from "./split-pane-cap";

/** The pane the board opened, and the thread the board last put in it. */
export interface BoardNativePane {
  /** The host's pane id, or null while the board knows only the thread it put
   *  there (the host picks the id, so a click cannot know it in advance). */
  readonly paneId: string | null;
  readonly threadId: string;
  /** The pane ids that existed when the board opened `threadId`. A pane in
   *  this list was the operator's, never the board's. */
  readonly priorPaneIds: readonly string[];
}

/** The record against the live layout: a real pane, its thread, its focus. */
export interface ResolvedBoardNativePane {
  readonly paneId: string;
  readonly threadId: string;
  readonly isFocused: boolean;
}

/**
 * bb's compact-viewport predicate, the one its opener gates splits on.
 *
 * Installed 0.49.0 renderer: `var pk = \`(max-width: 767px)\`` plus `mk()`,
 * which answers `matchMedia(pk).matches` unless a React context overrides it
 * (`index-UJHlXnMg.js` in the app bundle, asset offsets ~312790 and ~317659).
 * The split open itself is `jQ` (offset ~675506):
 *
 * ```js
 * if (isCompact || store.get(splitLayoutAtom) === null) { navigate(route); return; }
 * ```
 *
 * and the plugin-facing `experimental_useSidebarThreadActions().open` passes
 * `isCompact` from that same hook (plugin-frontend bundle, offset ~287951). So
 * "splits are off" means exactly: a viewport at or under 767px wide, or no
 * split layout yet. Where it is off, `split: true` is a PLAIN NAVIGATION: the
 * board's own pane is replaced by the thread page and the board is gone, which
 * the operator reads as "taken to home".
 *
 * The board can read the first half for itself, because this repo already
 * vendors the same hook (`components/ui/hooks/use-compact-viewport.tsx`, same
 * `(max-width: 767px)` query). The second half — the host's layout atom — is
 * not readable through the SDK (`useSidebarSplitLayout` answers null for a
 * one-pane layout too, so null cannot tell "compact" from "no split yet"), so
 * a click that is not compact still asks for the split and repairs itself if
 * the host plainly navigated anyway.
 */
export function nativeSplitUnavailable({
  compactViewport,
}: {
  /** `useIsCompactViewport()`, the host's own predicate. */
  readonly compactViewport: boolean;
}): boolean {
  return compactViewport;
}

/** What one card click should do. */
export type NativeCardPlacement =
  /** The clicked thread is already in the board's pane: the host's opener
   *  focuses that pane and nothing moves. */
  | { readonly kind: "focus"; readonly paneId: string }
  /** Focus `paneId` — the host focuses a pane that already shows `threadId`,
   *  the thread it holds NOW — then navigate to the clicked thread, which the
   *  host lands in that pane. */
  | {
      readonly kind: "replace";
      readonly paneId: string;
      readonly threadId: string;
    }
  /** Hand the thread to the host's opener: a pane beside the board, a focus,
   *  or the ceiling's replace, by bb's own rules. */
  | { readonly kind: "open" }
  /** The host would plainly navigate (its compact predicate is on), taking the
   *  board with it: open the board's own in-panel pane instead. */
  | { readonly kind: "in-board" };

/** The plugin-scoped localStorage key for the board's pane record. */
export function nativePaneStorageKey(pluginId: string): string {
  return `${pluginId}:boardNativeThreadPane`;
}

/** The stored record, or "" for none (the key is then removed). */
export function boardNativePaneStoredValue(
  pane: BoardNativePane | null,
): string {
  if (pane === null) return "";
  return JSON.stringify({
    paneId: pane.paneId,
    threadId: pane.threadId,
    priorPaneIds: [...pane.priorPaneIds],
  });
}

/**
 * A stored record parses back as a record, or as null.
 *
 * Anything malformed — not JSON, not an object, a blank or non-string thread,
 * a pane id that is neither a string nor null — answers null, which reads as
 * "the board owns no pane" and takes the safe path (the host's opener). A
 * record written by the first version of this rule carries no
 * `priorPaneIds`; it parses with an empty list, which is right for its
 * concrete pane id.
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
  const { paneId, threadId, priorPaneIds } = parsed as {
    paneId?: unknown;
    threadId?: unknown;
    priorPaneIds?: unknown;
  };
  if (typeof threadId !== "string" || threadId === "") return null;
  if (paneId !== null && (typeof paneId !== "string" || paneId === "")) {
    return null;
  }
  if (priorPaneIds !== undefined && !Array.isArray(priorPaneIds)) return null;
  const prior = Array.isArray(priorPaneIds)
    ? priorPaneIds.filter((id): id is string => typeof id === "string")
    : [];
  return { paneId, threadId, priorPaneIds: prior };
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
  const pane =
    record.paneId !== null
      ? layout.panes.find((candidate) => candidate.paneId === record.paneId)
      : layout.panes.find(
          (candidate) =>
            candidate.threadId === record.threadId &&
            !record.priorPaneIds.includes(candidate.paneId),
        );
  if (pane === undefined || pane.threadId !== record.threadId) return null;
  return {
    paneId: pane.paneId,
    threadId: record.threadId,
    isFocused: pane.isFocused,
  };
}

/**
 * What a card click does, given the layout, the board's record, the clicked
 * thread, and the threads the board still lists.
 *
 * `liveThreadIds` is the board's own sidebar list. A record naming a thread
 * that has left it is stale, because the host's navigation cannot resolve that
 * thread either; the click opens a pane instead of navigating into nothing.
 */
export function planNativeCardPlacement(
  layout: SplitPaneLayoutView | null,
  record: BoardNativePane | null,
  threadId: string,
  liveThreadIds: readonly string[],
  environment: { readonly compactViewport: boolean } = { compactViewport: false },
): NativeCardPlacement {
  // First, before any pane reasoning: where the host will not split, a split
  // request is a plain navigation that replaces the board. The board's own
  // pane is the only surface that keeps it.
  if (nativeSplitUnavailable(environment)) return { kind: "in-board" };
  const owned = resolveBoardNativePane(layout, record);
  if (owned === null) return { kind: "open" };
  if (owned.threadId === threadId) return { kind: "focus", paneId: owned.paneId };
  if (!liveThreadIds.includes(owned.threadId)) return { kind: "open" };
  return { kind: "replace", paneId: owned.paneId, threadId: owned.threadId };
}
