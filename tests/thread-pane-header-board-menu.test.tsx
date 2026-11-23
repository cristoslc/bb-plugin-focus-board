// @vitest-environment jsdom
// The operator's ask of 2026-11-23: the board's in-panel thread pane header
// should read as bb's own split-pane header "basically identical", with Focus
// Board's own control in the slot bb gives it.
//
// bb's thread page header carries that control through
// `experimental_threadHeaderAction` (components/thread-header-actions.tsx);
// the pane drew its own inline done checkbox instead, in the board cards'
// checkbox grammar. The pane now renders the SAME control component
// (components/focus-board-thread-menu.tsx), on the state it already holds, and
// the checkbox is gone:
//
// - the trigger is the plugin's mark plus a caret, the shared 28px ghost box,
//   on both surfaces and at both widths;
// - its menu carries the same three rows as the native control's — Mark Done,
//   Snooze…, New child thread… — and the done state is the first row's check
//   (role="menuitemradio" with aria-checked), never a glyph on the trigger;
// - the pane's ⋯ overflow keeps only what bb's own page owns there (pin, mark
//   read/unread, archive), so no action has two homes in one header;
// - on the phone the control sits right after the title, as in bb's compact
//   header, the one-tap read toggle stays, and Done stays reachable through
//   the control's menu.
//
// The live halves (both headers measured at real widths in both themes) are
// scripts/screenshot/probe-pane-header-parity.mjs's evidence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const noop = () => {};

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (): ReactNode => null,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  // The workspace-open control renders from `workspace_open_targets`; the
  // ordering test below measures the header with it present.
  useRpc: () => ({
    call: async (method: string) =>
      method === "workspace_open_targets"
        ? {
            status: "available",
            reason: null,
            root: "/repo",
            targets: [
              {
                id: "vscode",
                label: "VS Code",
                kind: "editor",
                icon: null,
                capabilities: {
                  openDirectory: true,
                  openFile: true,
                  openFileAtLine: true,
                  openFileAtColumn: true,
                },
              },
            ],
          }
        : { existence: {} },
  }),
  useBbNavigate: () => ({ toThread: noop }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

afterEach(cleanup);

function renderPane({
  compact = false,
  done = false,
  snoozeWakeAt = null,
  onToggleDone = noop,
  onOpenSnoozePicker,
  onNewChildThread,
}: {
  compact?: boolean;
  done?: boolean;
  snoozeWakeAt?: number | null;
  onToggleDone?: (done: boolean) => void;
  onOpenSnoozePicker?: () => void;
  onNewChildThread?: () => void;
} = {}) {
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
          isPinned: false,
        },
        isArchived: false,
        isDone: done,
        onToggleDone,
        onToggleArchived: noop,
        onTogglePinned: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize: noop,
        onClose: noop,
        escStopsRunningThread: false,
        snoozeWakeAt,
        onOpenSnoozePicker,
        onNewChildThread,
      }),
    ),
  );
}

const header = () =>
  screen.getByRole("complementary", { name: "Thread: Test thread" }).querySelector("header");

/** The shared control's trigger, by its one accessible name. */
function boardMenuTrigger(): HTMLElement {
  return screen.getByRole("button", { name: "Focus Board thread menu" });
}

function openBoardMenu(): HTMLElement {
  fireEvent.click(boardMenuTrigger());
  return screen.getByRole("menu", { name: "Focus Board thread menu" });
}

/** Every row of a menu, in DOM order (action rows and the state row alike). */
function menuLabels(menu: HTMLElement): string[] {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
  ).map((row) => row.textContent ?? "");
}

describe("the pane header's Focus Board control", () => {
  it.each([false, true])(
    "draws the plugin's mark plus a caret, in the chrome row's 28px ghost box (compact: %s)",
    (compact) => {
      renderPane({ compact });
      const trigger = boardMenuTrigger();
      expect(trigger.querySelector('[data-icon="FocusBoard"]')).not.toBeNull();
      expect(trigger.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
      // A menu trigger, not a toggle: the name describes the menu and carries
      // no done state (the trigger paints none, the first row states it).
      expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-label")).not.toMatch(/done/i);
      // The same box the native control wears (components/pane-chrome.ts),
      // so the two headers cannot size the control apart.
      expect(trigger.className).toContain("h-[28px]");
      expect(trigger.className).toContain("w-[28px]");
      expect(trigger.className).toContain("gap-0.5");
      // The coarse-pointer ladder's 36px box, in whichever spelling the
      // utility merge kept (the compact branch folds h/w into `size-9`).
      expect(trigger.className).toMatch(
        /max-md:pointer-coarse:(h-\[36px\]|size-9)/,
      );
    },
  );

  it("leaves no checkbox glyph in the header: the pane's inline done checkbox is gone", () => {
    for (const compact of [false, true]) {
      cleanup();
      renderPane({ compact });
      const root = header();
      expect(root).not.toBeNull();
      expect(root?.querySelector('[data-icon="Checkbox"]')).toBeNull();
      expect(root?.querySelector('[data-icon="CheckboxChecked"]')).toBeNull();
      expect(root?.querySelector("[data-pane-done-checkbox]")).toBeNull();
      expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Mark not done" })).toBeNull();
    }
  });

  it("carries the same three rows as the native control, in the same order", () => {
    renderPane({ onOpenSnoozePicker: noop, onNewChildThread: noop });
    const menu = openBoardMenu();
    // The native control's own list, pinned there by
    // tests/thread-header-actions.test.tsx; the two lists must not diverge.
    expect(menuLabels(menu)).toEqual(["Mark Done", "Snooze…", "New child thread…"]);
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(1);
  });

  it("runs each row on the pane's own callbacks", () => {
    const onToggleDone = vi.fn();
    const onOpenSnoozePicker = vi.fn();
    const onNewChildThread = vi.fn();
    renderPane({ onToggleDone, onOpenSnoozePicker, onNewChildThread });

    openBoardMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    expect(onToggleDone).toHaveBeenCalledWith(true);
    // Selecting a row closes the menu, as every menu in the board does.
    expect(screen.queryByRole("menu", { name: "Focus Board thread menu" })).toBeNull();

    openBoardMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Snooze…" }));
    expect(onOpenSnoozePicker).toHaveBeenCalledTimes(1);

    openBoardMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "New child thread…" }));
    expect(onNewChildThread).toHaveBeenCalledTimes(1);
  });

  it("shows the done state as the menu row's check, and the not-done row as unchecked", () => {
    renderPane({ done: true, onOpenSnoozePicker: noop });
    const menu = openBoardMenu();
    const row = screen.getByRole("menuitemradio", { name: "Mark Not Done" });
    expect(row.getAttribute("aria-checked")).toBe("true");
    // The popover base's state mark trails the row (ml-auto); the row's own
    // leading glyph is the action's icon.
    expect(row.querySelector('[data-icon="Check"].ml-auto')).not.toBeNull();
    cleanup();

    renderPane({ done: false, onOpenSnoozePicker: noop });
    const unchecked = openBoardMenu();
    expect(unchecked.querySelectorAll('[role="menuitemradio"]')).toHaveLength(1);
    const notDone = screen.getByRole("menuitemradio", { name: "Mark Done" });
    expect(notDone.getAttribute("aria-checked")).toBe("false");
    expect(notDone.querySelector('[data-icon="Check"].ml-auto')).toBeNull();
  });

  it("a done toggle from the row reaches the pane's handler with the flipped value", () => {
    const onToggleDone = vi.fn();
    renderPane({ done: true, onToggleDone });
    openBoardMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Not Done" }));
    expect(onToggleDone).toHaveBeenCalledWith(false);
  });

  it("names the snooze row by the thread's own state: Edit snooze… while snoozed", () => {
    renderPane({
      snoozeWakeAt: Date.now() + 3_600_000,
      onOpenSnoozePicker: noop,
      onNewChildThread: noop,
    });
    const menu = openBoardMenu();
    expect(menuLabels(menu)).toEqual(["Mark Done", "Edit snooze…", "New child thread…"]);
    expect(menu.querySelector('[role="menuitem"][class*="border-t"]')).not.toBeNull();
  });

  it("offers no row for a flow the pane was not given, rather than a dead one", () => {
    renderPane();
    const menu = openBoardMenu();
    expect(menuLabels(menu)).toEqual(["Mark Done"]);
  });

  it("sits between the ⋯ overflow and the workspace control, the native header's order", async () => {
    renderPane({ onOpenSnoozePicker: noop });
    const trigger = boardMenuTrigger();
    const overflow = screen.getByRole("button", { name: "More thread actions" });
    await screen.findByRole("button", { name: "Open workspace in VS Code" });
    const workspace = screen.getByRole("button", { name: "Open workspace in VS Code" });
    // Title → ⋯ → Focus Board control → workspace → maximize → close, which
    // is bb's own header order with the workspace control kept.
    expect(
      overflow.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      trigger.compareDocumentPosition(workspace) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("the ⋯ overflow keeps only bb's own actions: Done, Snooze and New child have one home", () => {
    renderPane({ onOpenSnoozePicker: noop, onNewChildThread: noop });
    fireEvent.click(screen.getByRole("button", { name: "More thread actions" }));
    const menu = screen.getByRole("menu", { name: "More thread actions" });
    expect(menuLabels(menu)).toEqual(["Pin", "Mark Unread", "Archive"]);
  });
});

describe("the pane header's Focus Board control at compact width", () => {
  it("follows the ⋯ overflow with the read toggle keeping its one-tap primary", () => {
    renderPane({ compact: true, onOpenSnoozePicker: noop });
    const trigger = boardMenuTrigger();
    const title = header()?.querySelector('button[title="Rename thread"]');
    expect(title).toBeTruthy();
    // Title, then the control cluster, in bb's own phone order: the ⋯ (here
    // the read split's attached caret) precedes Focus Board's control.
    const read = screen.getByRole("button", { name: "Mark thread unread" });
    const overflow = screen.getByRole("button", { name: "More thread actions" });
    expect(read.closest('[class*="items-stretch"]')).not.toBeNull();
    expect(
      (title as Node).compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      overflow.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps Done reachable: the mark's menu opens on the phone and runs the toggle", () => {
    const onToggleDone = vi.fn();
    renderPane({ compact: true, onToggleDone, onOpenSnoozePicker: noop, onNewChildThread: noop });
    const menu = openBoardMenu();
    expect(menuLabels(menu)).toEqual(["Mark Done", "Snooze…", "New child thread…"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
    expect(onToggleDone).toHaveBeenCalledWith(true);
  });
});
