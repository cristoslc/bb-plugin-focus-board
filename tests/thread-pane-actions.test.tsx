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
import { snoozeMenuActions } from "../lib/snooze";

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

function renderPane({
  compact,
  pinned = false,
  archived = false,
  onTogglePinned = noop,
}: {
  compact: boolean;
  pinned?: boolean;
  archived?: boolean;
  onTogglePinned?: () => void;
}) {
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
          isPinned: pinned,
        },
        isArchived: archived,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onTogglePinned,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize,
        onClose: noop,
        escStopsRunningThread: false,
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

describe("snooze entries in the actions menu", () => {
  function renderPaneWithSnooze(
    items: Parameters<typeof ThreadPane>[0]["snoozeMenuItems"],
  ) {
    return render(
      createElement(
        CompactViewportOverrideProvider,
        { isCompactViewport: false },
        createElement(ThreadPane, {
          thread: {
            id: "thr_test",
            displayTitle: "Test thread",
            status: "idle",
            isUnread: false,
            isPinned: false,
          },
          isArchived: false,
          isDone: false,
          onToggleDone: noop,
          onToggleArchived: noop,
          onTogglePinned: noop,
          onToggleUnread: noop,
          snoozeMenuItems: items,
          onRename: async () => {},
          onMaximize,
          onClose: noop,
          escStopsRunningThread: false,
        }),
      ),
    );
  }

  it("an open-thread pane gets ONE Snooze… entry that opens the picker", () => {
    const openPicker = vi.fn();
    renderPaneWithSnooze(
      snoozeMenuActions({
        snoozed: false,
        clearSnooze: vi.fn(),
        openPicker,
      }),
    );
    openActionsMenu();
    const item = screen.getByRole("menuitem", { name: "Snooze…" });
    expect(screen.getAllByRole("menuitem")).toHaveLength(4); // Pin, Done, Snooze…, Archive
    fireEvent.click(item);
    expect(openPicker).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Snooze…" })).toBeNull();
  });

  it("a snoozed thread's pane offers Edit snooze… that opens the picker", () => {
    const openPicker = vi.fn();
    renderPaneWithSnooze(
      snoozeMenuActions({
        snoozed: true,
        clearSnooze: vi.fn(),
        openPicker,
      }),
    );
    openActionsMenu();
    const item = screen.getByRole("menuitem", { name: "Edit snooze…" });
    expect(screen.getAllByRole("menuitem")).toHaveLength(4); // Pin, Done, Edit snooze…, Archive
    expect(screen.queryByRole("menuitem", { name: "Snooze…" })).toBeNull();
    fireEvent.click(item);
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it("the snooze entry renders under its divider, between Done and Archive", () => {
    renderPaneWithSnooze(
      snoozeMenuActions({
        snoozed: false,
        clearSnooze: vi.fn(),
        openPicker: vi.fn(),
      }),
    );
    openActionsMenu();
    const menu = screen.getByRole("menu");
    const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map(
      (item) => item.textContent,
    );
    expect(labels).toEqual(["Pin", "Mark Done", "Snooze…", "Archive"]);
    const head = Array.from(menu.querySelectorAll("[role='menuitem']")).find(
      (item) => item.textContent === "Snooze…",
    );
    if (head === undefined) throw new Error("missing snooze entry");
    expect(head.className).toContain("border-t");
    expect(head.className).toContain("mt-1");
  });

  it("without the prop the menu carries no snooze entry (back-compat)", () => {
    renderPane({ compact: false });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Snooze…" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Mark Done" })).toBeTruthy();
  });
});

describe("pin entry in the actions menu", () => {
  it("an unpinned thread's pane pins from the actions menu", () => {
    const onTogglePinned = vi.fn();
    renderPane({ compact: false, onTogglePinned });
    openActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(onTogglePinned).toHaveBeenCalledTimes(1);
    // The menu closes on selection, leaving no stale overlay.
    expect(screen.queryByRole("menuitem", { name: "Pin" })).toBeNull();
  });

  it("a pinned thread's pane unpins from the actions menu", () => {
    const onTogglePinned = vi.fn();
    renderPane({ compact: false, pinned: true, onTogglePinned });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Pin" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin" }));
    expect(onTogglePinned).toHaveBeenCalledTimes(1);
  });

  it("an archived thread's pane leaves pinning to the unarchive", () => {
    renderPane({ compact: false, archived: true });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "Pin" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Unpin" })).toBeNull();
  });
});