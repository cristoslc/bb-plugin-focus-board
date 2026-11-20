// @vitest-environment jsdom
// The mark-unread gesture against a read card whose attention is frozen
// (the pane is open on it): the freeze holds the card's captured lane, and
// the gesture must land its own move — the card belongs in the Unread lane
// the moment the write lands, with the recapture pass re-pinning the
// settled placement while the attention holds. What must NOT happen is the
// gesture's strip being re-pinned back to the pre-gesture lane before the
// write lands (the attention freeze then holds the card in its idle lane,
// reported 2026-10-13).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
  seedFakeThreads,
  landWrites,
  pendingWriteCount,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  return [
    {
      id: "thr_unread",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: true,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Unread thread",
      lastReadAt: null,
      createdAt: 0,
    },
    {
      id: "thr_read",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Read thread",
      lastReadAt: now - HOUR,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function columnCardIds(columnId: string): string[] {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (section === null) return [];
  return [...section.querySelectorAll("[data-thread-card]")]
    .filter((el) => el.parentElement?.closest("[data-thread-card]") === null)
    .map((el) => (el instanceof HTMLElement ? el.getAttribute("data-thread-card") : ""));
}

/** The card's title anchor — the click that opens the thread pane. */
function cardAnchor(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  const anchor = card.querySelector("a");
  if (anchor === null) throw new Error(`missing title anchor on ${threadId}`);
  return anchor as HTMLElement;
}

describe("Mark Unread on a read card with its attention frozen (pane open)", () => {
  it("the card lands in the Unread lane when the write lands — never in an idle lane", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    // The pane enters by its deep link (the native-pane move): the subPath
    // mount adopts the attention freeze the same way a click-open did.
    const view = render(<Component subPath="t/thr_read" />);
    const rerenderSubPath = (subPath: string) => {
      view.rerender(<Component subPath={subPath} />);
    };

    // Baselines: the read card sits in Idle · Today; the unread one in Unread.
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_read"));
    await waitFor(() => expect(columnCardIds("unread")).toContain("thr_unread"));

    // The pane is open on the read card: its attention freeze holds the
    // rendered placement — the Idle · Today lane and slot it sits in. The
    // gesture's control: Mark Read/Unread lives in the header's ⋯ overflow
    // menu (the native header restyle moved it out of the row).
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());

    // The gesture: open the ⋯ overflow and run Mark Unread, with the pane
    // (and so the freeze) still open.
    fireEvent.click(screen.getByRole("button", { name: "More thread actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark Unread" }));
    // Host-bridge timing: the write lands in a later commit than the click.
    expect(pendingWriteCount()).toBe(1);
    await act(async () => {
      landWrites();
    });

    // While attention holds, the settled placement re-pins — in the Unread
    // lane, never in the idle lane the capture held before the gesture.
    await waitFor(() => expect(columnCardIds("unread")).toContain("thr_read"));
    expect(columnCardIds("idle-today")).not.toContain("thr_read");

    // The placement rules agree when attention releases (pane close). The
    // close asks the panel route; the fake declines pushes, so the settle
    // — the subPath flip the real host's push lands — is driven directly.
    fireEvent.click(screen.getByLabelText("Close thread pane")!);
    rerenderSubPath("");
    expect(columnCardIds("unread")).toContain("thr_read");
    expect(columnCardIds("idle-today")).not.toContain("thr_read");
  });
});