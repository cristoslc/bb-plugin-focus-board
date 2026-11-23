// @vitest-environment jsdom
// The thread pane header's shape at each width, as the native chrome row
// taught it (2026-11-20) and the header unification kept (2026-11-23):
//
// - the full-screen affordance has no standalone button at either width (the
//   open dropdown carries "Maximize pane" on desktop, and the phone's ⋯
//   overflow carries "Full Screen");
// - on a phone the read toggle is a one-tap primary with an attached caret,
//   a split control whose caret drops the overflow; on a desktop pane the row
//   carries no labeled read control and the overflow is a standalone ⋯, the
//   shape bb's own header has;
// - pin (and its archived-row absence) stays in that overflow, as on bb's own
//   page. The board's own three actions (Done, Snooze, New child thread) are
//   NOT here: they live in the Focus Board control beside the overflow, pinned
//   by tests/thread-pane-header-board-menu.test.tsx.
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
  useSettings: () => ({ values: undefined, isLoading: false }),
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
  onOpenSnoozePicker,
}: {
  compact: boolean;
  pinned?: boolean;
  archived?: boolean;
  onTogglePinned?: () => void;
  onNewChildThread?: () => void;
  onOpenSnoozePicker?: () => void;
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
        onOpenSnoozePicker,
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

  it("the compact caret opens the overflow carrying the read-state items plus Full Screen", () => {
    renderPane({ compact: true });
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Full Screen" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Mark Unread" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
  });

  it("offers Full Screen in the overflow and maximizes on click", () => {
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

  it("carries no labeled read control in the row — mark-read lives in the ⋯ overflow", () => {
    // Native parity: bb's own header reaches Mark unread through the ⋯
    // menu (the native pane's overflow, screenshot 07), so the row never
    // renders a labeled primary that starves the title.
    renderPane({ compact: false });
    expect(screen.queryByRole("button", { name: /^Mark thread (read|unread)$/ })).toBeNull();
    openActionsMenu();
    expect(screen.getByRole("menuitem", { name: "Mark Unread" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark Unread" }));
    expect(screen.queryByRole("menuitem", { name: "Mark Unread" })).toBeNull();
  });

  it("carries a standalone Maximize pane ghost, as the native header does", () => {
    renderPane({ compact: false });
    fireEvent.click(screen.getByRole("button", { name: "Maximize pane" }));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it("the ⋯ trigger is a standalone ellipsis, not the attached-caret split", () => {
    renderPane({ compact: false });
    const trigger = screen.getByRole("button", { name: "More thread actions" });
    expect(trigger.querySelector('[data-icon="MoreHorizontal"]')).not.toBeNull();
    expect(trigger.closest('[class*="items-stretch"]')).toBeNull();
  });

  it("the board's three actions have no second home in the overflow", () => {
    renderPane({ compact: false, onNewChildThread: noop, onOpenSnoozePicker: noop });
    openActionsMenu();
    const menu = screen.getByRole("menu", { name: "More thread actions" });
    const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map(
      (item) => item.textContent,
    );
    expect(labels).toEqual(["Pin", "Mark Unread", "Archive"]);
    expect(screen.queryByRole("menuitem", { name: /^Mark (Not )?Done$/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /snooze…$/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "New child thread…" })).toBeNull();
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

describe("the pane header keeps no chat icon", () => {
  // The slot left of the title used to carry the done checkbox; it now carries
  // nothing (Done moved into the Focus Board control's menu), and it must not
  // drift back into a chat-status glyph either.
  it.each([false, true])("shows no chat icon (compact: %s)", (compact) => {
    renderPane({ compact });
    const header = screen
      .getByRole("complementary", { name: "Thread: Test thread" })
      .querySelector("header");
    expect(header?.querySelector('svg[data-icon="MessageSquare"]')).toBeNull();
    expect(header?.querySelector('svg[data-icon="Loading"]')).toBeNull();
  });
});
