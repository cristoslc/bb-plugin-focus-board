// Publish one fact to the board: does the open thread pane cover it?
// (issue #310)
//
// Opening the pane puts `data-focus-solid` on the card it holds
// (components/thread-card.tsx), which arms the card spotlight's focus arm
// (components/card-spotlight.ts) and changes the computed opacity of EVERY
// card on the board. At 474 cards that was 63ms in one UpdateLayoutTree over
// 507 elements plus 43ms of paint, paid again on close to undo it. Behind the
// compact viewport's pane the board is an opaque full-window sheet, so neither
// the dim nor its undo can be seen; the marker is simply never set there.
//
// One hook read for the whole board rather than one per card: `ThreadCard` is
// mounted hundreds of times, and this is the same viewport answer for all of
// them. A provider also keeps the card render off a media-query subscription
// of its own.
//
// The panel-scoped sheet is NOT covered here on purpose, and the numbers are in
// #310's follow-up: a squeezed panel's `absolute inset-0` sheet does hide the
// board (measured: the sheet's box contains the board's, opaque, z-30), but at
// 474 cards the pointer that opened the pane arms the hover recede in the same
// open, so withholding the focus marker there bought nothing and measured
// 40-50ms SLOWER to the pane's first frame (193-215ms armed against 243-250ms
// withheld, with a 140ms long task appearing where the armed run had none).
// Changing that path needs its own measurement, not this one's.
import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";

/** Default false, so a card rendered outside the app shell (a unit test, a
 *  future surface) keeps today's behaviour: the recede is armed and visible. */
const PaneSheetCoverageContext = createContext<boolean>(false);

/**
 * Publish whether the compact viewport's opaque pane sheet covers the board.
 * The value is the viewport media query itself, so it is known before the pane
 * opens: a marker keyed to the pane's own mount would arm and then clear inside
 * the sheet's lifetime, which is the flash this exists to remove.
 */
export function PaneSheetCoverageProvider({ children }: { children: ReactNode }) {
  const coversBoard = useIsCompactViewport();
  return createElement(PaneSheetCoverageContext.Provider, { value: coversBoard }, children);
}

/**
 * True while the pane covers the board as an opaque full-window sheet. Board
 * cards read it to withhold the focus recede, which is invisible behind the
 * sheet and costs a whole-board restyle and repaint to arm.
 */
export function usePaneCoversBoard(): boolean {
  return useContext(PaneSheetCoverageContext);
}
