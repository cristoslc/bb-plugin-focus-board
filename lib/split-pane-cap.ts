// The pane cap's board-eviction guard for the native-pane move.
//
// bb's split placement replaces the FOCUSED pane once the layout is at its
// ceiling (`MAX_PANES = 8`, apps/app/src/lib/split-layout/ops.ts in bb;
// openThreadInSplit's `decideThreadDrop({ atMaxPanes })` answers "center",
// and the center decision is `replacePaneContent(layout, focusedPaneId, …)`).
// A card click makes the board the focused pane by definition — the click
// happened inside it — so at the ceiling the host's own opener would replace
// the board with the thread it just opened, deleting the surface the operator
// was reading.
//
// The probe that found this (scripts/screenshot/probe-native-split-cap.mjs,
// evidence in docs/screenshots/probe-native-split-pane/evidence-cap.json)
// drove bb's own sidebar "Open in split" at the ceiling with the board pane
// focused: the board pane vanished from the layout and the thread took its
// slot. The click's fallback below keeps the board: at the ceiling, when the
// focused pane is not a thread pane (the board, or any plugin panel), the
// click opens the board's own in-panel pane instead — which this slice still
// ships, and which renders inside the board pane the operator is already in.
//
// Below the ceiling the host's placement is harmless (a thread pane is
// evicted, the board keeps its slot), so those clicks stay native.
//
// Pure module: no host, no SDK, no React.

/** bb's split-layout ceiling (bb's own MAX_PANES). */
export const BB_MAX_SPLIT_PANES = 8;

/** The slice of the host's split layout this guard reads. */
export interface SplitPaneLayoutView {
  readonly panes: readonly {
    readonly paneId: string;
    /** The thread this pane shows, or null for a non-thread pane. */
    readonly threadId: string | null;
    readonly isFocused: boolean;
  }[];
}

/**
 * Would the host's native opener replace the board itself?
 *
 * True exactly when the layout is at bb's ceiling AND the focused pane is not
 * a thread pane — the state every card click starts in, since clicking a card
 * focuses the board. A null layout (single pane, no split, or a host that
 * reports none) answers false: nothing to replace.
 */
export function nativeOpenWouldEvictBoard(layout: SplitPaneLayoutView | null): boolean {
  if (layout === null) return false;
  if (layout.panes.length < BB_MAX_SPLIT_PANES) return false;
  const focused = layout.panes.find((pane) => pane.isFocused);
  return focused !== undefined && focused.threadId === null;
}
