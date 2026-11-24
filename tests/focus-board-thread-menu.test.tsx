// @vitest-environment jsdom
// The shared thread-header control's own contract (components/focus-board-
// thread-menu.tsx), mounted on its own rather than through either surface, so
// the rules that belong to BOTH headers are pinned once.
//
// The operator's ask of 2026-11-24: marking a thread done from a thread-panel
// header also closes that panel. Marking done moves the card to the top of the
// Done lane, so closing lands them on the board with the card they just acted
// on in plain sight. The close itself belongs to a surface (the in-panel pane
// closes; bb's own split pane has no close lever in the plugin SDK), so the
// control carries it as an optional continuation and keeps the rules here:
//
// - the row hands the surface the state it is moving to, so neither surface
//   re-derives the flip;
// - only the Done transition runs the continuation: "Mark Not Done" is the
//   undo, and hiding the thread it just un-did would hide the result;
// - the continuation waits for the surface's write to settle, and a rejected
//   write never runs it: a pane that closed on a failed write would leave the
//   operator on a board where nothing moved.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  FocusBoardThreadMenu,
  type ThreadMenuState,
} from "../components/focus-board-thread-menu";

afterEach(cleanup);

/** A write the test settles by hand, so "before" and "after" are observable. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function state(overrides: Partial<ThreadMenuState> = {}): ThreadMenuState {
  return { done: false, snoozeWakeAt: null, title: "Test thread", ...overrides };
}

function renderMenu({
  threadState,
  onToggleDone,
  onMarkedDone,
}: {
  threadState?: ThreadMenuState;
  onToggleDone: (done: boolean) => Promise<void> | void;
  onMarkedDone?: () => void;
}) {
  return render(
    <FocusBoardThreadMenu
      state={threadState ?? state()}
      isCompactViewport={false}
      onToggleDone={onToggleDone}
      onMarkedDone={onMarkedDone}
    />,
  );
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Focus Board thread menu" }));
  return screen.getByRole("menu", { name: "Focus Board thread menu" });
}

describe("the shared thread-header control's done row", () => {
  it("hands the surface the state it is moving to, not a bare toggle", () => {
    const onToggleDone = vi.fn();
    renderMenu({ onToggleDone });
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    expect(onToggleDone).toHaveBeenCalledWith(true);
    cleanup();

    const back = vi.fn();
    renderMenu({ threadState: state({ done: true }), onToggleDone: back });
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Not Done" }));
    expect(back).toHaveBeenCalledWith(false);
  });

  it("runs the continuation only after the surface's write settles", async () => {
    const write = deferred();
    const onMarkedDone = vi.fn();
    renderMenu({ onToggleDone: () => write.promise, onMarkedDone });

    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    // The write is in flight: the pane is still there. Closing on the click
    // would close on a write that has not landed yet, and a rejection after
    // that would leave the operator on a board where nothing moved.
    expect(onMarkedDone).not.toHaveBeenCalled();

    write.resolve();
    await waitFor(() => {
      expect(onMarkedDone).toHaveBeenCalledTimes(1);
    });
  });

  it("never runs the continuation for Mark Not Done, even once the write lands", async () => {
    const write = deferred();
    const onMarkedDone = vi.fn();
    renderMenu({
      threadState: state({ done: true }),
      onToggleDone: () => write.promise,
      onMarkedDone,
    });

    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Not Done" }));
    write.resolve();
    // Let every microtask the write could queue run before judging.
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Focus Board thread menu" })).toBeNull();
    });
    expect(onMarkedDone).not.toHaveBeenCalled();
  });

  it("never runs the continuation for a rejected write", async () => {
    const write = deferred();
    const onMarkedDone = vi.fn();
    renderMenu({ onToggleDone: () => write.promise, onMarkedDone });

    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    write.reject(new Error("done_set failed"));
    // The rejection is handled here (not left unhandled) and the pane stays.
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "Focus Board thread menu" })).toBeNull();
    });
    expect(onMarkedDone).not.toHaveBeenCalled();
  });

  it("works on a surface with no continuation: the write still runs, nothing closes", () => {
    const onToggleDone = vi.fn();
    renderMenu({ onToggleDone, onMarkedDone: undefined });
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    expect(onToggleDone).toHaveBeenCalledWith(true);
  });

  it("a surface with no write to hand back still continues after the row runs", async () => {
    // The pane's own handler in app.tsx returns the `done_set` promise; the
    // native control has no close to wait for. A synchronous surface (no
    // promise) must not stall the continuation forever either.
    const onMarkedDone = vi.fn();
    renderMenu({ onToggleDone: () => {}, onMarkedDone });
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    await waitFor(() => {
      expect(onMarkedDone).toHaveBeenCalledTimes(1);
    });
  });
});
