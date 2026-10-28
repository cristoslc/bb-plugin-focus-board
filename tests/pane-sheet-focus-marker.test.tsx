// @vitest-environment jsdom
// The focus recede behind the compact pane's sheet (issue #310).
//
// Opening the thread pane puts `data-focus-solid` on the card it holds, which
// arms the spotlight's focus arm (components/card-spotlight.ts) and changes the
// computed opacity of EVERY card on the board: at 474 cards that was 63ms in
// one UpdateLayoutTree over 507 elements and 43ms of paint, paid again on close
// to undo it.
//
// On a phone the pane is an opaque full-window sheet, so not one receded card
// can be seen while it is up. The marker must therefore never be set there, and
// it must stay armed exactly as it does everywhere the board is visible beside
// the pane. A squeezed panel's panel-scoped sheet is a separate case with its
// own measurements (see components/pane-sheet-coverage.tsx): it keeps today's
// behaviour, and the desktop case below is what pins that.
//
// "Never set" is the point, not "set and then cleared": a marker that arms and
// clears inside the sheet's lifetime pays the whole restyle and hands the close
// a fade-back to undo, which is the cost this guards against.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { CARD_SURFACE_SOLID, ThreadCard } from "../components/thread-card";
import {
  CompactViewportOverrideProvider,
} from "../components/ui/hooks/use-compact-viewport";
import { PaneSheetCoverageProvider } from "../components/pane-sheet-coverage";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_focus", displayTitle: "Focus card", updatedAt: 1 });

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_focus"]');
  if (root === null) throw new Error("card root not found");
  return root as HTMLElement;
}

function marksTheCard(): boolean {
  return cardRoot().hasAttribute("data-focus-solid");
}

interface ShellProps {
  isCompactViewport: boolean;
  /** The thread the open pane holds, or null for a closed pane. */
  activeThreadId: string | null;
}

/** The app shell's shape: a viewport override over the coverage provider over
 *  the board's card. */
function shell({
  isCompactViewport,
  activeThreadId,
}: ShellProps): ReactElement {
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <PaneSheetCoverageProvider>
        <ThreadCard
          thread={base}
          stateDot={null}
          isActive={activeThreadId === base.id}
          isDone={false}
          projectName="Proj"
          menuActions={[]}
          onOpen={() => {}}
          activeThreadId={activeThreadId}
        />
      </PaneSheetCoverageProvider>
    </CompactViewportOverrideProvider>
  );
}

afterEach(cleanup);

describe("the focus recede under the compact pane's sheet", () => {
  it("a phone's full-window sheet never arms the marker, not even in the open commit", () => {
    const view = render(shell({ isCompactViewport: true, activeThreadId: null }));
    // Closed: nothing to arm, as before.
    expect(marksTheCard()).toBe(false);
    // The open commit itself: the marker must not appear even for one render,
    // so the close has nothing to undo.
    view.rerender(shell({ isCompactViewport: true, activeThreadId: base.id }));
    expect(marksTheCard()).toBe(false);
    // The held card keeps the solid surface it always had: only the
    // board-wide recede is withheld, nothing about the card itself changes.
    expect(cardRoot().className.split(" ")).toContain(CARD_SURFACE_SOLID);
  });

  it("closing the sheet leaves the marker off, so the board has nothing to undo", () => {
    const view = render(shell({ isCompactViewport: true, activeThreadId: base.id }));
    expect(marksTheCard()).toBe(false);
    // The close commit: the card stops being the pane's, and no marker was
    // ever there to clear (no fade-back to pay for).
    view.rerender(shell({ isCompactViewport: true, activeThreadId: null }));
    expect(marksTheCard()).toBe(false);
  });

  it("a desktop window with the board beside the pane still arms it", () => {
    const view = render(shell({ isCompactViewport: false, activeThreadId: null }));
    view.rerender(shell({ isCompactViewport: false, activeThreadId: base.id }));
    // The recede is the point on a wide surface: the board is visible beside
    // the pane, so the marker arms exactly as it does today. This is also the
    // squeezed-panel case: a narrow panel is not the compact media query, so
    // its sheet keeps today's behaviour until it is measured on its own.
    expect(marksTheCard()).toBe(true);
  });

  it("a wide viewport arms it on the same commit the compact one withholds it", () => {
    // The inverse of the first case, from the same starting DOM: the only
    // difference between the two boards is the viewport.
    const view = render(shell({ isCompactViewport: false, activeThreadId: base.id }));
    expect(marksTheCard()).toBe(true);
    view.rerender(shell({ isCompactViewport: true, activeThreadId: base.id }));
    expect(marksTheCard()).toBe(false);
  });
});
