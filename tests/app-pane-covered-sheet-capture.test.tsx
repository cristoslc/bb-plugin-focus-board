// @vitest-environment jsdom
// Stage 2 of the pane-open/close mobile commission (issue #406, the
// attribution doc docs/perf/pane-mobile-attribution-2026-11-06.md): on the
// covered sheet (a compact viewport), the board behind the thread pane is
// invisible, so the attention freeze's writes and the chip snapshot's
// operator-moment refetch protect nothing the operator can read — and they
// are the measured cost drivers (the covered-sheet board rebuild + a
// snapshot wave per open and per close).
//
// The three laws under test:
// - the covered sheet skips the pane attention capture: opening a pane on a
//   phone pins nothing; when the churn would move the card, the data's
//   order wins (the same behavior a closed pane has);
// - the chip snapshot's pane term skips the covered sheet too: opening and
//   closing the pane behind the sheet refetches nothing (the poll, focus
//   catch-up, and the card-state terms keep the dots alive);
// - the skip is per-open-time, never a latch: the next open that is NOT
//   covered arms the freeze again (and a fine pointer behaves exactly as
//   today), so a viewport that widens — or the panel-scoped sheet's absence
//   — still gets the placement hold.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

// Count ThreadCard renders without changing behavior (the
// app-hover-no-rerender precedents): a non-memoized wrapper invoked per
// board-driven card render, so its count is the board's wake, not the memo's.
const cardRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../components/thread-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/thread-card")>();
  const Real = actual.ThreadCard;
  return {
    ...actual,
    ThreadCard: (props: Parameters<typeof Real>[0]) => {
      cardRenders.count += 1;
      return <Real {...props} />;
    },
  };
});

import "../app";
import {
  fakeRpcCalls,
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeLinks,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * The viewport the page reports. `COMPACT_VIEWPORT_QUERY` is the pane's
 * own device-class read (components/ui/hooks/use-compact-viewport.tsx:10);
 * true is the covered sheet, false is the side-by-side control. The stub
 * keeps a REAL change-listener registry per query and `setCovered` announces
 * the flip the way a browser's `matchMedia` change event does: the app
 * re-renders on the flip and the next gesture reads the new width, which is
 * exactly how the real page renders it.
 */

const queryNotifies = new Set<() => void>();
let covered = false;

/** Flip the viewport and announce it, like a browser's matchMedia change. */
function setCovered(value: boolean): void {
  covered = value;
  for (const notify of queryNotifies) notify();
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  queryNotifies.clear();
  covered = false;
  vi.stubGlobal(
    "matchMedia",
    (query: string) => {
      const listeners = new Set<() => void>();
      queryNotifies.add(() => {
        for (const cb of listeners) cb();
      });
      return {
        get matches() {
          return covered && query.includes("767px");
        },
        media: query,
        onchange: null,
        addEventListener: (type: string, cb: () => void) => {
          if (type === "change") listeners.add(cb);
        },
        removeEventListener: (type: string, cb: () => void) => {
          if (type === "change") listeners.delete(cb);
        },
        addListener: (cb: () => void) => listeners.add(cb),
        removeListener: (cb: () => void) => listeners.delete(cb),
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    },
  );
  window.localStorage.clear();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fixtureThreads() {
  const now = Date.now();
  return [
    {
      id: "thr_focus",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 75 * 60_000,
      displayTitle: "Focused thread",
      lastReadAt: now,
      createdAt: 0,
    },
    {
      id: "thr_older",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 3 * HOUR,
      displayTitle: "Older thread",
      lastReadAt: now,
      createdAt: 0,
    },
    {
      id: "thr_backlog",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 5 * HOUR,
      displayTitle: "Backlog thread",
      lastReadAt: now,
      createdAt: 0,
    },
  ];
}

/** The churn: thr_backlog becomes the most recently touched thread, so the
 *  unfrozen board sorts it above thr_focus. The capture would hold
 *  thr_focus's slot instead. All three stay inside the `idle-today` bucket
 *  (>1h old), so the churn is a slot move, never a lane move. */
function seedChurn() {
  const now = Date.now();
  seedFakeThreads([
    {
      id: "thr_focus",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 75 * 60_000,
      displayTitle: "Focused thread",
      lastReadAt: now,
      createdAt: 0,
    },
    {
      id: "thr_older",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 3 * HOUR,
      displayTitle: "Older thread",
      lastReadAt: now,
      createdAt: 0,
    },
    {
      id: "thr_backlog",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 70 * 60_000,
      displayTitle: "Backlog thread",
      lastReadAt: now,
      createdAt: 0,
    },
  ]);
}

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

function mountBoard(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

/** Wait until the mount wave's own chip fetch has been seen, then one idle
 *  window: the first snapshot fetch is scheduled at the mount effect's run
 *  and its idle fallback may fire some hundreds of ms later (jsdom batches
 *  the mount wave), so anything the test's gestures then trigger is an
 *  operator-moment fetch, not this wave. */
async function mountFetchDone(): Promise<void> {
  await waitFor(() => {
    return fakeRpcCalls().some((call) => call.method === "tracker_status");
  }, { timeout: 10_000 });
  await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
}

describe("the pane's covered-sheet skip (issue #406 stage 2)", () => {
  it("opening a pane on a phone renders zero board cards, and closing does too", async () => {
    setCovered(true);
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    cardRenders.count = 0;

    // The covered open: the board is invisible behind the sheet, so the open
    // wakes nothing in the board subtree. (Red while the covered open still
    // re-rendered the board on its activeThreadId churn + the capture
    // writes; red again for any wiring that re-couples the pane's state to
    // a board prop.)
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Back to board")).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(cardRenders.count).toBe(0);

    // The covered close: the same law on the way back out.
    cardRenders.count = 0;
    fireEvent.click(screen.getByLabelText("Back to board"));
    await waitFor(() => expect(screen.queryByLabelText("Back to board")).toBeNull());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(cardRenders.count).toBe(0);
  });

  it("a fine pointer's open still renders the board (the active card's surface is visible)", async () => {
    setCovered(false);
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));
    await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    cardRenders.count = 0;

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(cardRenders.count).toBeGreaterThan(0);
  });

  it("opening a pane on a phone pins nothing: churn moves the card behind the sheet", async () => {
    setCovered(true);
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    // Open the pane on thr_focus. Behind the covered sheet the capture is
    // withheld, so the churn below runs the live placement rules.
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Back to board")).toBeTruthy());

    act(() => {
      seedChurn();
    });
    // The unfrozen board: the churned thread leads; the attended card moved.
    expect(columnCardIds("idle-today")).toEqual(["thr_backlog", "thr_focus", "thr_older"]);
  });

  it("a fine pointer still freezes: churn holds the attended card's slot", async () => {
    setCovered(false);
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());

    act(() => {
      seedChurn();
    });
    // The freeze: thr_focus's captured slot 0 is held, so the churned card
    // (natural order: backlog, focus, older) cannot take the lead.
    expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_backlog", "thr_older"]);
  });

  it("the skip is per-open, not a latch: the next uncovered open arms the freeze again", async () => {
    setCovered(true);
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    // Covered open: no capture.
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Back to board")).toBeTruthy());
    act(() => {
      seedChurn();
    });
    expect(columnCardIds("idle-today")).toEqual(["thr_backlog", "thr_focus", "thr_older"]);

    // The viewport uncovers (the same window, a wider width): a real
    // browser announces this with a matchMedia change event, the subscription
    // notifies, and the app re-renders at the next opportunity (act). The
    // NEXT open then reads the live condition and arms the freeze again: on
    // thr_older's open, its slot (index 2 in the churned order) is captured.
    act(() => {
      setCovered(false);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());

    // Churn again, with a new card between the pinned card's slot and the
    // tail: a new thr_new (now - 10min) sorts ahead of thr_focus (30min) and
    // thr_older (2h). The natural order is backlog, new, focus, older — but
    // the frozen thr_older holds its captured slot 2, so thr_focus (whose
    // natural slot is 2 now) sits at index 3 instead.
    const now = Date.now();
    act(() => {
      seedFakeThreads([
        {
          id: "thr_focus",
          projectId: "proj_a",
          providerId: "pi",
          status: "idle",
          isUnread: false,
          isPinned: false,
          isArchived: false,
          isHidden: false,
          parentThreadId: null,
          hasPendingInteraction: false,
          updatedAt: now - 75 * 60_000,
          displayTitle: "Focused thread",
          lastReadAt: now,
          createdAt: 0,
        },
        {
          id: "thr_older",
          projectId: "proj_a",
          providerId: "pi",
          status: "idle",
          isUnread: false,
          isPinned: false,
          isArchived: false,
          isHidden: false,
          parentThreadId: null,
          hasPendingInteraction: false,
          updatedAt: now - 3 * HOUR,
          displayTitle: "Older thread",
          lastReadAt: now,
          createdAt: 0,
        },
        {
          id: "thr_backlog",
          projectId: "proj_a",
          providerId: "pi",
          status: "idle",
          isUnread: false,
          isPinned: false,
          isArchived: false,
          isHidden: false,
          parentThreadId: null,
          hasPendingInteraction: false,
          updatedAt: now - 80 * 60_000,
          displayTitle: "Backlog thread",
          lastReadAt: now,
          createdAt: 0,
        },
        {
          id: "thr_new",
          projectId: "proj_a",
          providerId: "pi",
          status: "idle",
          isUnread: false,
          isPinned: false,
          isArchived: false,
          isHidden: false,
          parentThreadId: null,
          hasPendingInteraction: false,
          updatedAt: now - 65 * 60_000,
          displayTitle: "New thread",
          lastReadAt: now,
          createdAt: 0,
        },
      ]);
    });
    // The freeze re-armed on the uncovered open: thr_older holds its captured
    // slot 2 while the natural order (newest first: new, focus, backlog,
    // older) would run it last.
    expect(columnCardIds("idle-today")).toEqual(["thr_new", "thr_focus", "thr_older", "thr_backlog"]);
  });

  it("the chip snapshot does not refetch on pane open or close behind the covered sheet", async () => {
    setCovered(true);
    // One GitHub link gives the visible-ref key a real entry
    // (linkedRefKeys, lib/link-metadata.ts:302), which is what makes the
    // snapshot's fetches and the fingerprint's pane term observable through
    // the tracker_status call count.
    seedFakeLinks({
      thr_focus: [
        {
          tracker: "github",
          repo: "cristoslc/bb-plugin-focus-board",
          issue: 406,
          kind: "issue",
          href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/406",
          createdAt: new Date(Date.now() - HOUR).toISOString(),
          source: "agent",
        },
      ],
    });
    const mountFetchDone = async (): Promise<void> => {
      // The first snapshot fetch is scheduled at the mount effect's run and
      // its idle fallback may fire some hundreds of ms later (jsdom batches
      // the mount wave), so the test waits until the mount wave's own
      // tracker_status has been SEEN before resetting the log; anything the
      // click then triggers is a pane-open fetch, not this wave.
      await waitFor(() => {
        if (fakeRpcCalls().some((call) => call.method === "tracker_status")) return true;
        return false;
      }, { timeout: 10_000 });
      await act(async () => { await new Promise((r) => setTimeout(r, 600)); });
    };
    mountBoard();
    await mountFetchDone();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    // Open the pane: no pane term, no open-time refetch. The 500ms waits
    // cover the idle seam's fallback (400ms), so a fetch that WOULD fire
    // has landed by the time the count is read.
    resetFakeRpcCalls();
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Back to board")).toBeTruthy());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    const afterOpen = fakeRpcCalls().filter((call) => call.method === "tracker_status");
    expect(afterOpen).toHaveLength(0);

    // Close the pane: the same law on the way back.
    resetFakeRpcCalls();
    fireEvent.click(screen.getByLabelText("Back to board"));
    await waitFor(() => expect(screen.queryByLabelText("Back to board")).toBeNull());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    const afterClose = fakeRpcCalls().filter((call) => call.method === "tracker_status");
    expect(afterClose).toHaveLength(0);
  });

  it("the chip snapshot still refetches on pane open with the board visible (uncovered)", async () => {
    setCovered(false);
    seedFakeLinks({
      thr_focus: [
        {
          tracker: "github",
          repo: "cristoslc/bb-plugin-focus-board",
          issue: 406,
          kind: "issue",
          href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/406",
          createdAt: new Date(Date.now() - HOUR).toISOString(),
          source: "agent",
        },
      ],
    });
    mountBoard();
    await mountFetchDone();
    await waitFor(() => expect(columnCardIds("idle-today")).toEqual(["thr_focus", "thr_older", "thr_backlog"]));

    resetFakeRpcCalls();
    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(screen.getByLabelText("Close thread pane")).toBeTruthy());
    // The same idle window, so an open-time refetch (if one fired) is in.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    const calls = fakeRpcCalls().filter((call) => call.method === "tracker_status");
    expect(calls.length).toBeGreaterThan(0);
  });
});
