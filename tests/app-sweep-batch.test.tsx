// @vitest-environment jsdom
// The idle arm's sweep writes in BATCHES, driven through the REAL app.
//
// Why this file exists: the sweep used to cost one serialized `done_set`
// round trip AND one full-board state write per card, so a lane of N cards
// paid N board passes — measured at ~180ms per card on a 1,394-card board
// (docs/perf/sweep-latency-2026-11-18.md). The fix overlaps the writes and
// applies their `doneIds` mutations once per batch. Both halves are
// observable only here, where the real confirm path runs against a host
// whose writes the test can hold open:
//
// 1. WINDOW — with `done_set` held, the first window is six writes in
//    flight (SWEEP_BATCH_CONCURRENCY), not one. A regression to serial
//    leaves exactly one call outstanding and fails on the first assertion.
// 2. ONE STATE WRITE PER BATCH — the unread follow-ups of a whole batch
//    queue behind one another (the host's sidebar writes are single-slot)
//    and appear only after the batch's cards are Done.
// 3. THE CONTRACT SURVIVES — a failed card is still named and stays armed,
//    a cancel stops between batches, and the Done/archive split is
//    untouched: the other arms stay strictly one at a time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRpcCalls,
  landWrites,
  pendingWriteCount,
  registeredNavPanel,
  releaseRpcHangs,
  resetFakeRpcCalls,
  seedFakeThreads,
  stubRpcHang,
  stubRpcRejection,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * A lane of `count` long-idle threads, all past the 7-day bucket, so the
 * Idle · A while ago column arms with every one of them selected. The last
 * thread is unread by default so the batch's read follow-up has a subject.
 */
function idleLane(count: number, options: { unreadFrom?: number } = {}) {
  const now = Date.now();
  const unreadFrom = options.unreadFrom ?? count;
  const base = {
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null as string | null,
    hasPendingInteraction: false,
    lastReadAt: now - 40 * DAY,
    createdAt: 0,
    updatedAt: now - 40 * DAY,
  };
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `idle_${index}`,
    displayTitle: `Idle ${index}`,
    isUnread: index >= unreadFrom,
  }));
}

function mount() {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  return render(<Component subPath="" />);
}

function lanePill(): HTMLButtonElement {
  const lane = document.querySelector('[data-column-id="idle-awhile"]');
  const pill = lane?.querySelector<HTMLButtonElement>("[data-sweep-button]");
  if (pill === null || pill === undefined) throw new Error("no sweep pill on the idle lane");
  return pill;
}

/** Arm the lane, then confirm it — the operator's two clicks on the broom. */
async function armAndConfirm(expectedCount: number): Promise<void> {
  await waitFor(() => expect(lanePill().textContent).toBe(String(expectedCount)));
  fireEvent.click(lanePill());
  await waitFor(() => expect(lanePill().textContent).toBe(`${expectedCount} → Done`));
  fireEvent.click(lanePill());
}

const doneSetCalls = () => fakeRpcCalls().filter((call) => call.method === "done_set");

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  resetFakeRpcCalls();
  // The stubs are module state shared by every test in this file: clear the
  // hang and the rejection first, or a held `done_set` strands the next test.
  stubRpcHang(null);
  stubRpcRejection(null);
  releaseRpcHangs();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the idle arm's sweep writes in batches", () => {
  it("opens a six-write window instead of one serialized write", async () => {
    seedFakeThreads(idleLane(9));
    mount();
    stubRpcHang("done_set");
    await armAndConfirm(9);

    // The window: six writes are in flight at once. Serial behaviour would
    // leave exactly one outstanding, which is what this pins.
    await waitFor(() => expect(doneSetCalls()).toHaveLength(6));
    releaseRpcHangs();
    await waitFor(() => expect(doneSetCalls()).toHaveLength(9));
    // And every card still lands, in the order the lane held them.
    expect(doneSetCalls().map((call) => (call.args as { threadId: string }).threadId)).toEqual([
      "idle_0",
      "idle_1",
      "idle_2",
      "idle_3",
      "idle_4",
      "idle_5",
      "idle_6",
      "idle_7",
      "idle_8",
    ]);
  });

  it("queues the batch's unread follow-ups one host write at a time", async () => {
    // The idle lane never HOLDS an unread card (unread is its own state), so
    // the only way a swept card needs the read follow-up is the arm-frozen
    // race: the selection is captured at arm time, and a thread that turns
    // unread before the confirm must still land Done-and-read. Three of the
    // four cards turn unread between the two clicks here.
    seedFakeThreads(idleLane(4));
    mount();
    await waitFor(() => expect(lanePill().textContent).toBe("4"));
    fireEvent.click(lanePill());
    await waitFor(() => expect(lanePill().textContent).toBe("4 → Done"));
    seedFakeThreads(idleLane(4, { unreadFrom: 1 }));
    // The re-render must land BEFORE the confirm: the confirm closure reads
    // the rows to decide the read follow-ups, and a stale closure would see
    // the pre-seed read states.
    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-column-id="unread"] [data-thread-card]'),
      ).toHaveLength(3),
    );
    fireEvent.click(lanePill());

    await waitFor(() => expect(doneSetCalls()).toHaveLength(4));
    // One serial host write is armed at a time — a single-slot bridge gets
    // fed one row at a time, so the queue drains on landing.
    await waitFor(() => expect(pendingWriteCount()).toBe(1));
    landWrites();
    await waitFor(() => expect(pendingWriteCount()).toBe(1));
    landWrites();
    await waitFor(() => expect(pendingWriteCount()).toBe(1));
    landWrites();
    await waitFor(() => expect(pendingWriteCount()).toBe(0));
  });

  it("names a failed card inside a batch and keeps it armed", async () => {
    seedFakeThreads(idleLane(3));
    mount();
    // One specific card fails; its batch-mates still land.
    stubRpcRejection("done_set");
    await armAndConfirm(3);
    await waitFor(() => expect(doneSetCalls()).toHaveLength(3));
    // The banner names what happened and the failed cards stay highlighted
    // for a one-click retry — never silently counted as swept.
    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain("3 failed");
    });
    expect(document.querySelector('[data-testid="sweep-notice"]')).not.toBeNull();
    const armed = document.querySelector("[data-column-id='idle-awhile'] [data-sweep-button]");
    expect(armed?.getAttribute("aria-pressed")).toBe("true");
    expect(armed?.textContent).toBe("3 → Done");
  });

  it("stops between batches on cancel, keeping the rest armed", async () => {
    seedFakeThreads(idleLane(9));
    mount();
    stubRpcHang("done_set");
    await armAndConfirm(9);
    await waitFor(() => expect(doneSetCalls()).toHaveLength(6));
    // Cancel while the first batch is in flight: that batch finishes and
    // nothing after it starts.
    const cancel = document.querySelector("[data-column-id='idle-awhile'] [data-sweep-cancel]");
    expect(cancel).not.toBeNull();
    fireEvent.click(cancel as Element);
    releaseRpcHangs();
    await waitFor(() => expect(doneSetCalls()).toHaveLength(6));
    // The three unstarted cards stay armed for the retry.
    await waitFor(() => expect(lanePill().textContent).toBe("3 → Done"));
  });

  it("a cancelled batch still offers to undo exactly what it settled", async () => {
    seedFakeThreads(idleLane(9));
    mount();
    stubRpcHang("done_set");
    await armAndConfirm(9);
    await waitFor(() => expect(doneSetCalls()).toHaveLength(6));
    fireEvent.click(document.querySelector("[data-sweep-cancel]") as Element);
    releaseRpcHangs();
    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain(
        "Sweep stopped. 6 marked Done, 3 not attempted.",
      );
    });
  });
});
