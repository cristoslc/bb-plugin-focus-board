// @vitest-environment jsdom
// Which lanes PROPOSE a sweep on the real app, and which lanes only offer the
// manual door. The component suites (tests/sweep-button.test.tsx,
// tests/lane-header-menu.test.tsx) inject `sweepCandidatesFor`, so they pin
// the pill's rendering law but not the eligibility the app actually computes.
// This suite drives the app's own law end to end: `done_list` plus the sweep
// config through the fake host, then the Board's header. It runs on the shape
// the operator reported (an Idle · Earlier lane and a Done lane, both without
// a pill):
//
// 1. Done is a PRESELECTING arm: a done thread past `doneArchiveMs` puts the
//    broom and its count on the lane. That is the case a wiring regression
//    would silently break, since a dead prop and an empty eligible set look
//    identical on screen.
// 2. Eligibility still excludes the three threads a Done sweep may not take:
//    a kept one, a live-child parent, and anything under the threshold.
// 3. Idle · Earlier PROPOSES (operator ruling 2026-11-24): a thread three
//    days idle (past the same 2-day threshold) puts the pill on that lane, and
//    arming it from the lane menu starts with that thread selected. The two
//    fresher idle buckets stay manual-only from the 2026-10-03 decision.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeDone,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** The default `sweep_config_get` answer: 2 days per arm, so the fixtures'
 *  three-to-six-day stamps are past it and the two-minute one is under. */

function sidebarThread(overrides: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now();
  return {
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null,
    hasPendingInteraction: false,
    lastReadAt: now - 3 * DAY,
    createdAt: 0,
    displayTitle: String(overrides.id ?? "thread"),
    updatedAt: now - 3 * DAY,
    ...overrides,
  };
}

function doneAgo(ms: number, keep = false): { doneAt: string; keep?: boolean } {
  const record: { doneAt: string; keep?: boolean } = {
    doneAt: new Date(Date.now() - ms).toISOString(),
  };
  if (keep) record.keep = true;
  return record;
}

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

function lane(columnId: string): HTMLElement {
  const section = document.querySelector<HTMLElement>(`section[data-column-id="${columnId}"]`);
  if (section === null) throw new Error(`no lane ${columnId}`);
  return section;
}

function lanePill(columnId: string): HTMLButtonElement | null {
  return lane(columnId).querySelector<HTMLButtonElement>("[data-sweep-button]");
}

function laneMenuTrigger(columnId: string): HTMLElement {
  const trigger = lane(columnId).querySelector<HTMLElement>("button[data-lane-menu-trigger]");
  if (trigger === null) throw new Error(`no lane menu trigger in ${columnId}`);
  return trigger;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  resetFakeRpcCalls();
  seedFakeDone();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Done lane proposes its aged-out threads", () => {
  it("a done thread past the threshold puts the pill and its count on the lane", async () => {
    seedFakeThreads([
      sidebarThread({ id: "thr_done_aged", updatedAt: Date.now() - 3 * DAY }),
    ]);
    seedFakeDone(["thr_done_aged"], { thr_done_aged: doneAgo(3 * DAY) });
    mountBoard();
    await waitFor(() => {
      expect(lanePill("done")).not.toBeNull();
    });
    expect(lanePill("done")?.textContent).toBe("1");
  });

  it("a kept thread, a live-child parent, and a fresh one all stay out of the count", async () => {
    seedFakeThreads([
      sidebarThread({ id: "thr_done_aged", updatedAt: Date.now() - 3 * DAY }),
      // Kept past the threshold: the operator's own exemption.
      sidebarThread({ id: "thr_done_kept", updatedAt: Date.now() - 5 * DAY }),
      // A done parent whose child is still live: the sweep-family contract.
      sidebarThread({ id: "thr_done_parent", updatedAt: Date.now() - 6 * DAY }),
      sidebarThread({
        id: "thr_live_child",
        parentThreadId: "thr_done_parent",
        updatedAt: Date.now() - HOUR,
      }),
      // Under the threshold: nothing to propose yet.
      sidebarThread({ id: "thr_done_fresh", updatedAt: Date.now() - 2 * 60_000 }),
    ]);
    seedFakeDone(
      ["thr_done_aged", "thr_done_kept", "thr_done_parent", "thr_done_fresh"],
      {
        thr_done_aged: doneAgo(3 * DAY),
        thr_done_kept: doneAgo(5 * DAY, true),
        thr_done_parent: doneAgo(6 * DAY),
        thr_done_fresh: doneAgo(2 * 60_000),
      },
    );
    mountBoard();
    await waitFor(() => {
      expect(lanePill("done")).not.toBeNull();
    });
    expect(lanePill("done")?.textContent).toBe("1");
  });

  it("a Done lane whose only past-threshold thread is kept shows no pill", async () => {
    // The operator's live shape: the one Done thread beyond 2 days carried a
    // keep flag, so the lane proposes nothing and its header rests bare.
    seedFakeThreads([
      sidebarThread({ id: "thr_done_kept", updatedAt: Date.now() - 3 * DAY }),
      sidebarThread({ id: "thr_done_fresh", updatedAt: Date.now() - 2 * 60_000 }),
    ]);
    seedFakeDone(["thr_done_kept", "thr_done_fresh"], {
      thr_done_kept: doneAgo(3 * DAY, true),
      thr_done_fresh: doneAgo(2 * 60_000),
    });
    mountBoard();
    await waitFor(() => {
      expect(lane("done")).not.toBeNull();
    });
    expect(lanePill("done")).toBeNull();
  });
});

describe("the Earlier bucket proposes, the fresher two stay manual", () => {
  it("Earlier proposes its past-threshold thread (operator ruling 2026-11-24)", async () => {
    seedFakeThreads([
      sidebarThread({ id: "thr_idle_earlier", updatedAt: Date.now() - 3 * DAY }),
    ]);
    mountBoard();
    await waitFor(() => {
      expect(document.querySelector('section[data-column-id="idle-earlier"]')).not.toBeNull();
    });
    // The bucket holds the threads that actually aged out, so it is the arm
    // whose pill the operator needs: eligibility plus count, per the pill law.
    // Unarmed, the pill reads its count alone; arming adds the destination.
    expect(lanePill("idle-earlier")?.textContent).toBe("1");
    expect(lanePill("idle-earlier")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("the two freshest buckets still propose nothing", async () => {
    seedFakeThreads([
      sidebarThread({ id: "thr_idle_today", updatedAt: Date.now() - 3 * 60 * 60_000 }),
      sidebarThread({ id: "thr_idle_recent", updatedAt: Date.now() - 20 * 60_000 }),
    ]);
    mountBoard();
    await waitFor(() => {
      expect(document.querySelector('section[data-column-id="idle-today"]')).not.toBeNull();
    });
    expect(lanePill("idle-today")).toBeNull();
    expect(lanePill("idle-recent")).toBeNull();
    // Not wired off: each lane's own menu still carries the manual door.
    fireEvent.click(laneMenuTrigger("idle-today"));
    expect(screen.getByRole("menuitem", { name: "Sweep this lane…" })).not.toBeNull();
  });

  it("arming Earlier from its menu starts with its candidates selected", async () => {
    seedFakeThreads([
      sidebarThread({ id: "thr_idle_earlier", updatedAt: Date.now() - 3 * DAY }),
    ]);
    mountBoard();
    await waitFor(() => {
      expect(document.querySelector('section[data-column-id="idle-earlier"]')).not.toBeNull();
    });
    fireEvent.click(laneMenuTrigger("idle-earlier"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sweep this lane…" }));
    await waitFor(() => {
      expect(lanePill("idle-earlier")?.textContent).toBe("1 → Done");
    });
    expect(lanePill("idle-earlier")?.getAttribute("aria-pressed")).toBe("true");
    // A preselected arm can confirm: the proposal is the operator's own door.
    expect(lanePill("idle-earlier")?.disabled).toBe(false);
  });
});
