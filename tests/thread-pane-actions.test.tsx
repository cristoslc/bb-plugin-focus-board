// @vitest-environment jsdom
// The thread pane header on a phone (compact viewport): the full-screen
// button is hidden there, so the "More thread actions" menu must carry a
// Full Screen item to reach the main view; on desktop there is no
// standalone full-screen button either — the action lives in the open
// dropdown as "Maximize pane", and the menu does not duplicate it.
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
  useSettings: () => ({ values: undefined, isLoading: false }),
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
  onNewChildThread,
}: {
  compact: boolean;
  pinned?: boolean;
  archived?: boolean;
  onTogglePinned?: () => void;
  onNewChildThread?: () => void;
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
        onNewChildThread,
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

  it("the actions trigger reads as an attached caret, not a standalone ellipsis", () => {
    renderPane({ compact: true });
    const trigger = screen.getByRole("button", { name: "More thread actions" });
    // Same split grammar as the "Open in" menu: the caret drops the menu,
    // an ellipsis is only the pre-#14 standalone shape.
    expect(trigger.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
    expect(trigger.querySelector('[data-icon="More"]')).toBeNull();
  });

  it("the caret trigger is attached to the read-state toggle as a split control", () => {
    renderPane({ compact: true });
    const trigger = screen.getByRole("button", { name: "More thread actions" });
    const wrapper = trigger.parentElement;
    // The dropdown anchors to the split wrapper the same way the standalone
    // wrapper did; without a relative ancestor it drifts to the pane's
    // top-right corner instead of dropping under the caret.
    expect(wrapper?.className).toContain("relative");
    expect(wrapper?.className).toContain("rounded-md");
    // Hairline divider between the halves, as in the open-menu split.
    expect(wrapper?.querySelectorAll(".bg-border")).toHaveLength(1);
    // Icon-only read-state toggle as the primary, open on the caret side.
    const primary = wrapper?.querySelector('button[aria-label^="Mark thread"]');
    expect(primary).toBeTruthy();
    expect(primary?.className).toContain("rounded-r-none");
    expect(trigger.className).toContain("rounded-l-none");
  });

  it("the compact caret opens the same menu carrying the read-state items plus Full Screen", () => {
    renderPane({ compact: true });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Full Screen" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Mark Done" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
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
  it("has no standalone full-screen button — the action moved to the open dropdown", () => {
    renderPane({ compact: false });
    expect(screen.queryByLabelText("Open thread full screen")).toBeNull();
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
    expect(screen.getAllByRole("menuitem")).toHaveLength(4); // Done, Pin, Snooze…, Archive
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
    expect(labels).toEqual(["Mark Done", "Pin", "Snooze…", "Archive"]);
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

describe("new child thread entry in the actions menu", () => {
  const onNewChildThread = vi.fn();
  beforeEach(() => {
    onNewChildThread.mockClear();
  });

  it("leads the menu and opens the child composer on click", () => {
    renderPane({ compact: false, onNewChildThread });
    openActionsMenu();
    // The creation entry leads the state toggles: it is categorically apart
    // from Mark Done / Pin / Archive.
    const menu = screen.getByRole("menu");
    const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map(
      (item) => item.textContent,
    );
    expect(labels[0]).toBe("New child thread…");
    fireEvent.click(screen.getByRole("menuitem", { name: "New child thread…" }));
    expect(onNewChildThread).toHaveBeenCalledTimes(1);
    // The menu closes on selection, leaving no stale overlay.
    expect(screen.queryByRole("menuitem", { name: "New child thread…" })).toBeNull();
  });

  it("an archived thread's pane still offers the child spawn", () => {
    renderPane({ compact: false, archived: true, onNewChildThread });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "New child thread…" })).toBeTruthy();
  });

  it("without the prop the menu carries no child entry (back-compat)", () => {
    renderPane({ compact: false });
    openActionsMenu();
    expect(screen.queryByRole("menuitem", { name: "New child thread…" })).toBeNull();
  });
});