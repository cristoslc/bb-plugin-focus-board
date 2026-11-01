// @vitest-environment jsdom
// A live status flip (idle → active, the host's realtime `status-changed`
// patch landing as a new sidebar row) must re-lane the card even while its
// attention is frozen: the operator who asked "why is this working thread in
// Unread?" was looking at the card's pane. Reported 2026-10-31
// (thr_cyyyqxsvix, "chat-relay orchestrator").
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { registeredNavPanel, seedFakeThreads } from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads(status: string) {
  const now = Date.now();
  return [
    {
      id: "thr_busy",
      projectId: "proj_a",
      providerId: "pi",
      status,
      isUnread: true,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Busy thread",
      lastReadAt: null,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads("idle"));
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

function cardAnchor(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  const anchor = card.querySelector("a");
  if (anchor === null) throw new Error(`missing title anchor on ${threadId}`);
  return anchor as HTMLElement;
}

describe("a live idle → active flip while the card's attention is frozen", () => {
  it("with no pane open, the card moves from Unread to Working", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(columnCardIds("unread")).toContain("thr_busy"));

    seedFakeThreads(fixtureThreads("active"));

    await waitFor(() => expect(columnCardIds("working")).toContain("thr_busy"));
    expect(columnCardIds("unread")).not.toContain("thr_busy");
  });

  it("with the pane open on it, the card moves from Unread to Working", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(columnCardIds("unread")).toContain("thr_busy"));

    // Open the pane: the attention freeze captures the rendered placement.
    fireEvent.click(cardAnchor("thr_busy"));
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());
    expect(columnCardIds("unread")).toContain("thr_busy");

    // The host's status-changed patch lands as a fresh sidebar row.
    seedFakeThreads(fixtureThreads("active"));

    await waitFor(() => expect(columnCardIds("working")).toContain("thr_busy"));
    expect(columnCardIds("unread")).not.toContain("thr_busy");
  });

  it("re-lanes when the pane closes after the flip (no leaked pin)", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() => expect(columnCardIds("unread")).toContain("thr_busy"));
    fireEvent.click(cardAnchor("thr_busy"));
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());

    seedFakeThreads(fixtureThreads("active"));
    await waitFor(() => expect(columnCardIds("unread")).toContain("thr_busy"));

    fireEvent.click(screen.getByLabelText("Close thread pane")!);
    await waitFor(() => expect(columnCardIds("working")).toContain("thr_busy"));
    expect(columnCardIds("unread")).not.toContain("thr_busy");
  });
});
