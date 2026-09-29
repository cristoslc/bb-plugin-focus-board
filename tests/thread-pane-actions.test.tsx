// @vitest-environment jsdom
// The thread pane header on a phone (compact viewport): the full-screen
// button is hidden there, so the "More thread actions" menu must carry a
// Full Screen item to reach the main view; on desktop the button is visible
// and the menu does not duplicate it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // The pane's embedded chat is only imported for render; the actions menu
  // under test does not involve it.
  ThreadChat: (): ReactNode => null,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
}));

vi.mock("../components/pending-interaction-card", () => ({
  PendingInteractionCard: (): ReactNode => null,
}));

vi.mock("../components/decided-questions-card", () => ({
  DecidedQuestionsCard: (): ReactNode => null,
}));

const noop = () => {};
const onMaximize = vi.fn();

beforeEach(() => {
  onMaximize.mockClear();
});

afterEach(cleanup);

function renderPane({ compact }: { compact: boolean }) {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: compact },
      createElement(ThreadPane, {
        thread: {
          id: "thr_test",
          displayTitle: "Test thread",
          status: "idle",
          isUnread: false,
        },
        isArchived: false,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize,
        onClose: noop,
      }),
    ),
  );
}

const more = () => screen.queryByRole("button", { name: "More thread actions" });

function openActionsMenu() {
  fireEvent.click(screen.getByRole("button", { name: "More thread actions" }));
}

describe("compact viewport thread pane header", () => {
  it("has no standalone full-screen button", () => {
    renderPane({ compact: true });
    expect(screen.queryByLabelText("Open thread full screen")).toBeNull();
  });

  it("offers Full Screen in the actions menu and maximizes on click", () => {
    renderPane({ compact: true });
    openActionsMenu();
    const item = screen.getByRole("menuitem", { name: "Full Screen" });
    fireEvent.click(item);
    expect(onMaximize).toHaveBeenCalledTimes(1);
    // The menu closes on selection, leaving no stale overlay.
    expect(screen.queryByRole("menuitem", { name: "Full Screen" })).toBeNull();
  });
});

describe("desktop thread pane header", () => {
  it("keeps the full-screen button but not a duplicate menu item", () => {
    renderPane({ compact: false });
    expect(screen.getByLabelText("Open thread full screen")).toBeTruthy();
    expect(more()).toBeTruthy();
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Full Screen" })).toBeNull();
  });
});