// @vitest-environment jsdom
// The errored card's context menu wiring (issue #405, on the #157
// acknowledgment): the real app.tsx mounted against the fake SDK, because
// the entry's gating and its two writes live in app state —
// `canClearError` (the app supplies it) and the two handlers.
//
//    Retry       → sdk.threads.retry (the host's real re-submission
//                  primitive, never a re-sent message); a host refusal
//                  surfaces on the board's notice banner, reason verbatim.
//    Ignore error → the byte-identical error_ack_set acknowledgment that
//                  "Clear error" always performed, renamed to what it does.
//
// Both entries offer only on a card whose current state is errored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRetryCalls,
  fakeRpcCalls,
  registeredNavPanel,
  resetFakeRetryCalls,
  resetFakeRpcCalls,
  seedFakeThreads,
  stubRetryFailure,
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
      id: "thr_errored",
      projectId: "proj_a",
      providerId: "pi",
      status: "error",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Errored thread",
      lastReadAt: now - HOUR,
      createdAt: 0,
    },
    {
      id: "thr_healthy",
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
      displayTitle: "Healthy thread",
      lastReadAt: now - HOUR,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  resetFakeRetryCalls();
  resetFakeRpcCalls();
});

afterEach(() => {
  cleanup();
  stubRetryFailure(null);
  vi.unstubAllGlobals();
});

function openCardMenu(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  fireEvent.contextMenu(card);
  const menu = screen.queryByRole("menu");
  if (menu === null) throw new Error(`no menu opened for ${threadId}`);
  return menu;
}

function menuItems(menu: HTMLElement): string[] {
  return [...menu.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent?.trim() ?? "",
  );
}

describe("an errored card's context menu (issue #405)", () => {
  it("offers Retry and Ignore error — and a healthy card offers neither", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-thread-card="thr_errored"]'),
      ).toBeTruthy(),
    );

    const erroredMenu = openCardMenu("thr_errored");
    expect(menuItems(erroredMenu)).toContain("Retry");
    expect(menuItems(erroredMenu)).toContain("Ignore error");

    // Dismiss, then the healthy card's menu offers neither entry.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    const healthyMenu = openCardMenu("thr_healthy");
    expect(menuItems(healthyMenu)).not.toContain("Retry");
    expect(menuItems(healthyMenu)).not.toContain("Ignore error");
  });

  it("Retry re-submits through the host's retry primitive, and never acks the error", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-thread-card="thr_errored"]'),
      ).toBeTruthy(),
    );
    openCardMenu("thr_errored");
    fireEvent.click(screen.getByRole("menuitem", { name: "Retry" }));

    await waitFor(() => expect(fakeRetryCalls()).toEqual([{ args: { threadId: "thr_errored" } }]));
    // The retry is the error's action; the ack is only "Ignore error"'s.
    expect(fakeRpcCalls()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ method: "error_ack_set" })]),
    );
  });

  it("a refused retry surfaces bb's reason on the board's notice banner", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    stubRetryFailure("thread is stopping");
    render(<Component subPath="" />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-thread-card="thr_errored"]'),
      ).toBeTruthy(),
    );
    openCardMenu("thr_errored");
    fireEvent.click(screen.getByRole("menuitem", { name: "Retry" }));

    await waitFor(() =>
      expect(
        document.querySelector('[data-testid="browser-reveal-notice"]')?.textContent,
      ).toContain("thread is stopping"),
    );
  });
  it("Ignore error acks over error_ack_set, byte-identical to the old Clear error write", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    await waitFor(() =>
      expect(
        document.querySelector('[data-thread-card="thr_errored"]'),
      ).toBeTruthy(),
    );
    openCardMenu("thr_errored");
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore error" }));

    await waitFor(() =>
      expect(fakeRpcCalls()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "error_ack_set",
            args: { threadId: "thr_errored", acked: true },
          }),
        ]),
      ),
    );
    // Optimistic local ack: the card settles out of Needs you in the same
    // commit (dot, accent, lane) — including on the as-assembled board, where
    // the R4 family override reads the ack (the bug the red test started at).
    await waitFor(() =>
      expect(
        document.querySelector(
          'section[data-column-id="attention"] [data-thread-card="thr_errored"]',
        ),
      ).toBeNull(),
    );
  });
});
