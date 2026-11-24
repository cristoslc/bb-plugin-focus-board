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
// - the trigger: the plugin's own mark plus a caret, a menu name rather than
//   a checkbox one, and no done state painted on it (the menu states it);
// - the control renders ONE trigger that opens a popover with the three
//   board-owned actions, and nothing else (rename/read/pin/archive stay on
//   the native page);
// - Done: the same `done_set` RPC the board writes through, optimistic in
//   the popover, the row checked while the thread is done, and any toggle
//   lifts a snooze first — the pane header's own semantics;
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
  fakePanelPushes,
  fakeRpcCalls,
  fakeThreadNavigations,
  fireRealtime,
  registeredThreadHeaderAction,
  resetFakePanelPushes,
  resetFakeRpcCalls,
  resetFakeThreadNavigations,
  seedFakeThreadMetadata,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const NOW = Date.now();

afterEach(() => {
  cleanup();
  hostHeader?.remove();
  hostHeader = null;
  resetFakeRpcCalls();
  resetFakeThreadNavigations();
  resetFakePanelPushes();
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

/**
 * The host's own placement of the slot: inside a labelled group span, in the
 * thread page's header row. On macOS the desktop build gives that row
 * `transform: translateY(...)` (bb 0.50.1's `app-page-header-content-row`), and
 * a transformed ancestor is the containing block of every `position: fixed`
 * descendant. The row is modelled here so a popover that stays inside it can
 * be caught: its viewport coordinates would resolve against the row instead,
 * which parks the menu off screen (reported 2026-11-20).
 */
let hostHeader: HTMLElement | null = null;

function mountControlInHostHeader(): { row: HTMLElement } {
  const Component = registeredThreadHeaderAction.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no thread header action registered");
  const header = document.createElement("header");
  header.innerHTML = [
    '<div data-testid="app-page-header-content-row" style="transform: translateY(-2px)">',
    '<div class="flex items-center gap-1"><span role="group"></span></div>',
    "</div>",
  ].join("");
  document.body.append(header);
  hostHeader = header;
  const row = header.querySelector('[data-testid="app-page-header-content-row"]');
  const slot = header.querySelector('span[role="group"]');
  if (row === null || slot === null) throw new Error("host header fixture: missing row or slot");
  render(<Component threadId="thr_x" projectId="proj_a" isCompactViewport={false} />, {
    container: slot,
  });
  return { row };
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
  return screen.getByRole("button", { name: "Focus Board thread menu" });
}

async function openPopover(): Promise<void> {
  fireEvent.click(trigger());
  await screen.findByRole("menu");
}

/**
 * The menu's rows, in DOM order. Two roles because the base renders an action
 * row as `menuitem` and a state row (the done toggle's checked form) as
 * `menuitemradio`; a count of "the three entries" has to see both.
 */
function menuEntries(): HTMLElement[] {
  const menu = screen.getByRole("menu");
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'),
  );
}

function menuLabels(): string[] {
  return menuEntries().map((entry) => entry.textContent ?? "");
}

/** The done row, by whichever label its current state carries. */
function doneRow(): HTMLElement {
  return screen.getByRole("menuitemradio", { name: /^Mark (Not )?Done$/ });
}

describe("the thread-header action registration", () => {
  it("registers the slot with the board's id and title", () => {
    expect(registeredThreadHeaderAction.id).toBe("thread-actions");
    expect(registeredThreadHeaderAction.title).toBe("Focus Board thread actions");
    expect(registeredThreadHeaderAction.component).toBeTypeOf("function");
  });
});

describe("the control where the host puts it", () => {
  it("keeps its popover out of the translated header row, and Done still runs from there", async () => {
    const { row } = mountControlInHostHeader();
    await openPopover();
    const menu = screen.getByRole("menu");
    // The row's transform re-anchors `position: fixed` (bb 0.50.1, macOS
    // desktop), so a menu left inside it opens at row-x + its viewport left,
    // off screen. Out of the row means the coordinates stay viewport ones.
    expect(row.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    fireEvent.click(doneRow());
    await waitFor(() => {
      const call = fakeRpcCalls().find((entry) => entry.method === "done_set");
      expect(call).toMatchObject({ args: { threadId: "thr_x", done: true } });
    });
  });
});

describe("the control on a native thread page", () => {
  it("the trigger is the plugin's mark plus a caret, and reads as a menu", () => {
    mountControl();
    const control = trigger();
    // The operator's report (2026-11-20): a checkbox says "toggle this", but
    // the click opens a menu. The mark names the plugin; the caret names the
    // menu.
    expect(control.querySelector('[data-icon="FocusBoard"]')).not.toBeNull();
    expect(control.querySelector('[data-icon="ChevronDown"]')).not.toBeNull();
    expect(control.querySelector('[data-icon="Checkbox"]')).toBeNull();
    expect(control.querySelector('[data-icon="CheckboxChecked"]')).toBeNull();
    // A menu trigger's contract, kept from the checkbox build.
    expect(control.getAttribute("aria-haspopup")).toBe("menu");
    expect(control.getAttribute("aria-expanded")).toBe("false");
    // The name describes the menu, and carries no done state: the trigger
    // paints none, so naming one would tell a screen reader a state the
    // sighted reader cannot see.
    expect(control.getAttribute("aria-label")).toBe("Focus Board thread menu");
    expect(control.getAttribute("aria-label")).not.toMatch(/done/i);
  });

  it("still reads as the same 28px ghost box the pane chrome uses", () => {
    mountControl();
    const control = trigger();
    // The host's chrome row is 28px tall; the box class is the pane's own, so
    // the control keeps sitting in that ladder (36px on a coarse pointer).
    expect(control.className).toContain("h-[28px]");
    expect(control.className).toContain("w-[28px]");
    expect(control.className).toContain("max-md:pointer-coarse:h-[36px]");
  });

  it("renders one trigger whose popover carries exactly the three board-owned actions", async () => {
    mountControl();
    await openPopover();
    expect(menuLabels()).toEqual(["Mark Done", "Snooze…", "New child thread…"]);
  });

  it("marks done through the board's own RPC", async () => {
    mountControl();
    await openPopover();
    fireEvent.click(doneRow());
    await waitFor(() => {
      const call = fakeRpcCalls().find((entry) => entry.method === "done_set");
      expect(call).toMatchObject({ args: { threadId: "thr_x", done: true } });
    });
  });

  // bb's own thread page has no close lever a plugin may reach: the SDK's
  // `experimental_useSidebarThreadActions` offers open/openNewThread/setPinned/
  // setRead/rename/archive/requestDelete, `threads.paneAction` accepts only
  // spotlight/maximize/restore/toggle, and `useSidebarSplitLayout()` is a read.
  // `pane.close` exists as a host keybinding name and nothing more. So the
  // pane's new close-after-Mark-Done stops at the board's own pane, and this
  // surface keeps writing the mark and nothing else. Pinned so a future host
  // lever arrives as a deliberate addition rather than a stray side effect.
  it("closes nothing on bb's own thread page: the mark is the whole gesture", async () => {
    mountControl();
    await openPopover();
    fireEvent.click(doneRow());
    await waitFor(() => {
      expect(fakeRpcCalls().some((entry) => entry.method === "done_set")).toBe(true);
    });
    // No route change, no panel push, no host pane call: nothing in the plugin
    // moved the operator off the page they were reading.
    expect(fakeThreadNavigations()).toEqual([]);
    expect(fakePanelPushes()).toEqual([]);
  });

  it("draws the done state as the menu row's check, not on the trigger", async () => {
    seedFakeThreadMetadata("thr_x", { done: { doneAt: new Date(NOW).toISOString() } });
    mountControl();
    await openPopover();
    // Done lives where it is acted on: the row is a checked radio and draws
    // the popover base's state mark (the trailing Check, which the row styles
    // `ml-auto`; the row's leading glyph is the action's own icon).
    const row = screen.getByRole("menuitemradio", { name: "Mark Not Done" });
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector('[data-icon="Check"].ml-auto')).not.toBeNull();
    // The trigger is the mark and its caret either way: no state glyph.
    const control = trigger();
    expect(control.querySelector('[data-icon="CheckboxChecked"]')).toBeNull();
    expect(control.querySelector('[data-icon="Checkbox"]')).toBeNull();
  });

  it("leaves the done row unchecked, with no state mark, when the thread is not done", async () => {
    mountControl();
    await openPopover();
    const row = screen.getByRole("menuitemradio", { name: "Mark Done" });
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(row.querySelector('[data-icon="Check"].ml-auto')).toBeNull();
  });

  it("lifts a snooze on a done toggle, the pane header's own rule", async () => {
    seedFakeThreadMetadata("thr_x", {
      snooze: { wakeAt: new Date(NOW + 3_600_000).toISOString(), setAt: new Date(NOW).toISOString() },
    });
    mountControl();
    await openPopover();
    fireEvent.click(doneRow());
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
      // The row flips label AND state: a board-side flip lands as a checked
      // "Mark Not Done".
      const row = screen.getByRole("menuitemradio", { name: "Mark Not Done" });
      expect(row.getAttribute("aria-checked")).toBe("true");
    });
  });
});
