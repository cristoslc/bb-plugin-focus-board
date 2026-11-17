// @vitest-environment jsdom
// The native-pane move's additive half (docs/plans/2026-11-17-native-
// thread-pane.md §6.2 step 2): the Focus Board control the plugin
// registers into bb's own thread-page header
// (`experimental_threadHeaderAction`), carrying the board's Done, Snooze
// and New-child actions onto every host-rendered thread page.
//
// What is pinned here (the jsdom half; the live host half is the split
// probe's evidence, docs/screenshots/probe-native-split-pane/):
// - the registration: importing the app registers the slot with the
//   expected id, title, and a component;
// - the control renders ONE trigger that opens a popover with the three
//   board-owned actions, and nothing else (rename/read/pin/archive stay on
//   the native page);
// - Done: the same `done_set` RPC the board writes through, optimistic in
//   the popover, and any toggle lifts a snooze first — the pane header's
//   own semantics;
// - Snooze: the SnoozeDialog both set and edit run through, `snooze_set`
//   on a preset confirm, `snooze_clear` on the edit-mode remove;
// - New child: the board's modal opens with the parent preset;
// - the realtime channels (`done-changed`, `snooze-changed`) refresh the
//   control's view, so a flip on the board reaches the native page and
//   back.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRpcCalls,
  fireRealtime,
  registeredThreadHeaderAction,
  resetFakeRpcCalls,
  seedFakeThreadMetadata,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const NOW = Date.now();

afterEach(() => {
  cleanup();
  resetFakeRpcCalls();
});

beforeEach(() => {
  seedFakeThreads([
    {
      id: "thr_x",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: NOW - 60_000,
      displayTitle: "The header thread",
      lastReadAt: NOW,
      createdAt: 0,
    },
  ]);
  seedFakeThreadMetadata("thr_x", {});
});

function mountControl(): void {
  const Component = registeredThreadHeaderAction.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no thread header action registered");
  render(<Component threadId="thr_x" projectId="proj_a" isCompactViewport={false} />);
}

/** The picker's quick-pick buttons carry data-snooze-preset={kind}. */
function presetButton(dialog: HTMLElement, kind: string): HTMLElement {
  const button = dialog.querySelector(`[data-snooze-preset="${kind}"]`);
  if (button === null) throw new Error(`missing snooze preset ${kind}`);
  return button as HTMLElement;
}

/** The edit-mode footer's remove button (data-snooze-remove). */
function removeButton(dialog: HTMLElement): HTMLElement {
  const button = dialog.querySelector("[data-snooze-remove]");
  if (button === null) throw new Error("missing snooze remove button");
  return button as HTMLElement;
}

/** The one inline trigger (the host's 48px chrome row constraint). */
function trigger(): HTMLElement {
  return screen.getByRole("button", { name: "Focus Board thread actions" });
}

async function openPopover(): Promise<void> {
  fireEvent.click(trigger());
  await screen.findByRole("menu");
}

function menuLabels(): string[] {
  return screen
    .getAllByRole("menuitem")
    .map((entry) => entry.textContent ?? "");
}

describe("the thread-header action registration", () => {
  it("registers the slot with the board's id and title", () => {
    expect(registeredThreadHeaderAction.id).toBe("thread-actions");
    expect(registeredThreadHeaderAction.title).toBe("Focus Board thread actions");
    expect(registeredThreadHeaderAction.component).toBeTypeOf("function");
  });
});

describe("the control on a native thread page", () => {
  it("renders one trigger whose popover carries exactly the three board-owned actions", async () => {
    mountControl();
    await openPopover();
    expect(menuLabels()).toEqual(["Mark Done", "Snooze…", "New child thread…"]);
  });

  it("marks done through the board's own RPC", async () => {
    mountControl();
    await openPopover();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark Done" }));
    await waitFor(() => {
      const call = fakeRpcCalls().find((entry) => entry.method === "done_set");
      expect(call).toMatchObject({ args: { threadId: "thr_x", done: true } });
    });
  });

  it("lifts a snooze on a done toggle, the pane header's own rule", async () => {
    seedFakeThreadMetadata("thr_x", {
      snooze: { wakeAt: new Date(NOW + 3_600_000).toISOString(), setAt: new Date(NOW).toISOString() },
    });
    mountControl();
    await openPopover();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark Done" }));
    await waitFor(() => {
      const methods = fakeRpcCalls().map((entry) => entry.method);
      expect(methods.indexOf("snooze_clear")).toBeGreaterThanOrEqual(0);
      expect(methods.indexOf("done_set")).toBeGreaterThan(methods.indexOf("snooze_clear"));
    });
  });

  it("snoozes through the picker: a preset confirm writes snooze_set with a future wake", async () => {
    mountControl();
    await openPopover();
    fireEvent.click(screen.getByRole("menuitem", { name: "Snooze…" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Snooze thread");
    fireEvent.click(presetButton(dialog, "1h"));
    await waitFor(() => {
      const call = fakeRpcCalls().find((entry) => entry.method === "snooze_set");
      const wakeAt = (call?.args as { wakeAt?: string } | undefined)?.wakeAt;
      expect(wakeAt).toBeDefined();
      expect(Date.parse(wakeAt!)).toBeGreaterThan(Date.now());
    });
  });

  it("edits an existing snooze: remove clears it", async () => {
    seedFakeThreadMetadata("thr_x", {
      snooze: { wakeAt: new Date(NOW + 3_600_000).toISOString(), setAt: new Date(NOW).toISOString() },
    });
    mountControl();
    await openPopover();
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit snooze…" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Edit snooze");
    fireEvent.click(removeButton(dialog));
    await waitFor(() => {
      expect(fakeRpcCalls().some((entry) => entry.method === "snooze_clear")).toBe(true);
    });
  });

  it("opens the board's new-child modal preset to this thread", async () => {
    mountControl();
    await openPopover();
    fireEvent.click(screen.getByRole("menuitem", { name: "New child thread…" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("New child thread");
    // The parent preset names the thread this control's pane shows.
    expect(within(dialog).getByText("The header thread")).toBeTruthy();
  });

  it("refreshes its view from the realtime channels: a board-side done flip reaches the control", async () => {
    mountControl();
    await openPopover();
    expect(menuLabels()).toContain("Mark Done");

    act(() => {
      seedFakeThreadMetadata("thr_x", {
        done: { doneAt: new Date(NOW).toISOString() },
      });
      fireRealtime("done-changed", { threadId: "thr_x" });
    });
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "Mark Not Done" })).toBeTruthy();
    });
  });
});
