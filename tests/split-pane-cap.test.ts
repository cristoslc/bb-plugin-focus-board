// The native-pane move's pane-cap guard (lib/split-pane-cap.ts).
//
// The host's rule, read from bb (apps/app/src/lib/split-layout/ops.ts): at
// MAX_PANES the placement decision is "center", which replaces the FOCUSED
// pane. A card click happens inside the board, so the board is focused — at
// the ceiling the host's own opener would replace the board with the thread
// and strand the operator's surface. The probe that measured it,
// scripts/screenshot/probe-native-split-cap.mjs, drove bb's sidebar "Open in
// split" at the ceiling and watched the board pane vanish
// (docs/screenshots/probe-native-split-pane/evidence-cap.json).
//
// These cases pin the guard's boundary: below the ceiling never evicts, the
// ceiling evicts only while a non-thread pane holds focus.
import { describe, expect, it } from "vitest";
import {
  BB_MAX_SPLIT_PANES,
  nativeOpenWouldEvictBoard,
  type SplitPaneLayoutView,
} from "../lib/split-pane-cap";

function layout(
  count: number,
  focusedIndex: number,
  focusedThreadId: string | null = "thr_x",
): SplitPaneLayoutView {
  return {
    panes: Array.from({ length: count }, (_, index) => ({
      paneId: `pane-${index + 1}`,
      threadId: index === focusedIndex ? focusedThreadId : "thr_other",
      isFocused: index === focusedIndex,
    })),
  };
}

describe("nativeOpenWouldEvictBoard", () => {
  it("pins bb's ceiling at 8 panes", () => {
    expect(BB_MAX_SPLIT_PANES).toBe(8);
  });

  it("below the ceiling the host evicts a thread pane, never the board", () => {
    expect(nativeOpenWouldEvictBoard(layout(7, 0, null))).toBe(false);
  });

  it("at the ceiling with the board focused, the opener would replace the board", () => {
    expect(nativeOpenWouldEvictBoard(layout(BB_MAX_SPLIT_PANES, 0, null))).toBe(true);
  });

  it("at the ceiling with a thread pane focused, the board keeps its slot", () => {
    expect(nativeOpenWouldEvictBoard(layout(BB_MAX_SPLIT_PANES, 0, "thr_x"))).toBe(false);
  });

  it("the last pane focused counts like any other", () => {
    expect(
      nativeOpenWouldEvictBoard(layout(BB_MAX_SPLIT_PANES, BB_MAX_SPLIT_PANES - 1, null)),
    ).toBe(true);
  });

  it("no layout (single pane, splits off, older host) is never an eviction", () => {
    expect(nativeOpenWouldEvictBoard(null)).toBe(false);
  });

  it("a layout with no focused pane is not treated as an eviction", () => {
    const unfocused: SplitPaneLayoutView = {
      panes: Array.from({ length: BB_MAX_SPLIT_PANES }, (_, index) => ({
        paneId: `pane-${index + 1}`,
        threadId: "thr_other",
        isFocused: false,
      })),
    };
    expect(nativeOpenWouldEvictBoard(unfocused)).toBe(false);
  });
});
