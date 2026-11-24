// @vitest-environment jsdom
// The card click's pane contract, fourth revision (2026-11-24): "always take
// the pane back" (operator ruling dec_okjt7e62rg2x).
//
// The board's record used to be a PAIR — `{paneId, threadId}` — and a pane
// whose thread had changed stopped matching it, so the click read "no pane of
// the board's to use" and bought a fresh split (third revision, below). The
// operator measured what that cost: on today's build the window grew 2 → 3 → 4
// → 5 over three "navigate the pane to a page, click a card" cycles
// (docs/screenshots/probe-card-click-after-right-panel/, phase G).
//
// The ruling: the pane is the board's BY ID, whatever it shows. A recorded
// pane still in the layout is used: the click focuses it and navigates the
// clicked thread into it. The thread half of the record is advisory. A fresh
// split is asked for only when the recorded pane is GONE.
//
// Third revision (2026-11-17), kept because its lesson still holds: bb's
// `useSidebarSplitLayout()` answers null for a one-pane layout, so a freshly
// opened board cannot name a single pane. A native split is only ever asked for
// to FOCUS or REPLACE a pane the board can name; the one-pane ask has its own
// dance (lib/native-one-pane-dance.ts). Live evidence:
// docs/plans/2026-11-17-one-board-pane.md section 8.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeNativeOpens,
  fakePanelPushes,
  fakeSplitPanes,
  fakeThreadNavigations,
  registeredNavPanel,
  resetFakeNativeOpens,
  resetFakePanelPushes,
  resetFakeThreadNavigations,
  seedFakeLinks,
  seedFakeThreads,
  setFakeRouteThread,
  setFakeSettings,
  setFakeSplitLayout,
  setFakeSplitsOff,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** bb's compact predicate is a media query; the board reads the same one
 *  (`components/ui/hooks/use-compact-viewport.tsx`). */
function stubCompactViewport(compact: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: compact && query === "(max-width: 767px)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  stubCompactViewport(false);
  setFakeSettings(null);
  resetFakePanelPushes();
  window.localStorage.clear();
  seedFakeLinks({});
  seedFakeThreads(fixtureThreads());
  resetFakeNativeOpens();
  setFakeRouteThread(null);
  resetFakeThreadNavigations();
  setFakeSplitsOff(false);
  setFakeSplitLayout(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The stand-in pane containers are plain DOM, not React trees: `cleanup`
  // removes what RTL mounted and leaves them, and a stale container would let a
  // later test's press land in a previous layout.
  document.body.innerHTML = "";
});

function threadFixture(id: string, title: string, updatedAt: number) {
  const now = Date.now();
  return {
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle: title,
    lastReadAt: now,
    createdAt: 0,
  };
}

function fixtureThreads() {
  const now = Date.now();
  return [
    threadFixture("thr_focus", "Focused thread", now - 75 * 60_000),
    threadFixture("thr_older", "Older thread", now - 3 * HOUR),
    threadFixture("thr_backlog", "Backlog thread", now - 5 * HOUR),
    threadFixture("thr_other", "Someone else's thread", now - 2 * HOUR),
  ];
}

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

function mountBoard() {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  return render(<Component subPath="" />);
}

/** The thread panes beside the board, in layout order. */
function threadPanes(): string[] {
  return fakeSplitPanes()
    .filter((pane) => pane.threadId !== null)
    .map((pane) => pane.threadId as string);
}

function focusedPaneId(): string | null {
  return fakeSplitPanes().find((pane) => pane.isFocused)?.paneId ?? null;
}

/** The board's own in-panel pane, by the thread title it shows. */
function inBoardPaneTitle(): string | null {
  const pane = document.querySelector('aside[aria-label^="Thread:"]');
  if (pane === null) return null;
  return (pane.getAttribute("aria-label") ?? "").replace(/^Thread: /, "");
}

/** Seed the record the board writes when it owns a native pane, plus the
 *  layout that holds it. */
function seedOwnedPane(threadId: string, paneId = "pane-2"): void {
  window.localStorage.setItem(
    "focus-board:boardNativeThreadPane",
    JSON.stringify({ paneId, threadId }),
  );
  act(() => {
    setFakeSplitLayout([
      { paneId: "pane-1", threadId: null, isFocused: true },
      { paneId, threadId, isFocused: false },
    ]);
  });
}

/** A click that lands on the board's own pane. */
async function clickCardInBoard(threadId: string): Promise<void> {
  fireEvent.click(cardAnchor(threadId));
  await waitFor(() => expect(fakePanelPushes().at(-1)).toMatchObject({ subPath: `t/${threadId}` }));
}

/** A click that ends in a native pane (a replace, or the fresh pane a stale
 *  record asks for): it settles when a pane holds the thread. */
async function clickCardNative(threadId: string): Promise<void> {
  fireEvent.click(cardAnchor(threadId));
  await waitFor(() => expect(threadPanes()).toContain(threadId));
}

/**
 * The host's pane containers, as bb renders them: one `[data-split-pane-id]`
 * element per pane, whose own pointer handler focuses that pane. bb's pane
 * chrome does exactly this (`onPointerDown` → `onFocusPane(paneId)`, measured
 * live by scripts/screenshot/probe-pane-focus-lever.mjs), and the click's
 * replace rule focuses a pane through it when the pane shows no thread.
 *
 * `focuses` decides which panes this stand-in host actually focuses: a pane
 * container that does not is the failed-focus shape the click must survive.
 */
function mountHostPaneContainers(options: { focuses?: boolean } = {}): void {
  const focuses = options.focuses ?? true;
  for (const pane of fakeSplitPanes()) {
    const element = document.createElement("div");
    element.setAttribute("data-split-pane-id", pane.paneId);
    if (focuses) {
      element.addEventListener("pointerdown", () => {
        setFakeSplitLayout(
          fakeSplitPanes().map((current) => ({
            ...current,
            isFocused: current.paneId === pane.paneId,
          })),
        );
      });
    }
    document.body.append(element);
  }
}

describe("a click in a window the host will not split", () => {
  // Splits off (bb's own setting) leaves the window with no layout to split,
  // so the opener plainly navigates. The click still asks — it is the only
  // call that CAN split a one-pane window, and the window it asks from is
  // indistinguishable from one that would (both read null through
  // `useSidebarSplitLayout`) — and the ask's deadline keeps the thread on the
  // board when the answer is "no split". lib/native-one-pane-dance.ts carries
  // the measurement; the split half is tests/app-card-click-one-pane-split.
  beforeEach(() => {
    act(() => {
      setFakeSplitsOff(true);
    });
  });

  it("asks once, then opens the board's own pane", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    // The ask is the ruling's step one, made even where the host cannot honour
    // it…
    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]);
    // …and the step that keeps the thread: the board's own pane, the surface
    // that already shows the board and the thread together.
    await waitFor(() =>
      expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_focus" }),
    );
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Focused thread"));
    expect(threadPanes()).toEqual([]);
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
  });

  it("a second click moves the board's pane to the new thread, one pane, never stacked", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCardInBoard("thr_focus");
    await clickCardInBoard("thr_older");
    await clickCardInBoard("thr_backlog");

    // One ask: the board's own pane is open from the first click on, and a
    // click with that pane up is a replacement in it.
    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]);
    expect(threadPanes()).toEqual([]);
    expect(inBoardPaneTitle()).toBe("Backlog thread");
    expect(document.querySelectorAll('aside[aria-label^="Thread:"]')).toHaveLength(1);
  });

  it("the card menu's Open thread entry takes the same path", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    const card = document.querySelector('[data-thread-card="thr_older"]');
    if (card === null) throw new Error("missing card thr_older");
    fireEvent.contextMenu(card);
    const menu = await waitFor(() => {
      const found = document.querySelector('[role="menu"]');
      if (found === null) throw new Error("menu did not open");
      return found;
    });
    const open = [...menu.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Open thread",
    );
    if (open === undefined) throw new Error("missing Open thread entry");
    fireEvent.click(open);

    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_older", split: true }]);
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Older thread"));
  });

  it("a double click on one card leaves one pane", async () => {
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    fireEvent.click(cardAnchor("thr_focus"));
    // One dance, so one ask: the second click finds the first still in flight
    // and waits for the same answer instead of stacking a second.
    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]);
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Focused thread"));
    expect(document.querySelectorAll('aside[aria-label^="Thread:"]')).toHaveLength(1);
    expect(threadPanes()).toEqual([]);
  });
});

describe("a pane the board owns", () => {
  it("replaces that pane's thread instead of opening a second one", async () => {
    seedOwnedPane("thr_older");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(fakeSplitPanes()).toHaveLength(2);
    expect(focusedPaneId()).toBe(fakeSplitPanes()[1]?.paneId);
  });

  it("a third click still leaves one thread pane", async () => {
    seedOwnedPane("thr_focus");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_older"]));
    fireEvent.click(cardAnchor("thr_backlog"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_backlog"]));
    fireEvent.click(cardAnchor("thr_other"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_other"]));
    expect(fakeSplitPanes()).toHaveLength(2);
  });

  it("focuses the pane when the clicked thread is already in it", async () => {
    seedOwnedPane("thr_focus");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() =>
      expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]),
    );
    expect(threadPanes()).toEqual(["thr_focus"]);
    expect(fakeSplitPanes()).toHaveLength(2);
  });

  it("writes the record as the pane and the thread, nothing else", async () => {
    seedOwnedPane("thr_older");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(
      JSON.parse(
        window.localStorage.getItem("focus-board:boardNativeThreadPane") ?? "null",
      ),
    ).toEqual({ paneId: "pane-2", threadId: "thr_focus" });
  });

  it("a second click on another card replaces, never stacks", async () => {
    // The click never asks the host to open the CLICKED thread: that ask is
    // the host's "new pane on the right", so only the pane's current thread is
    // ever opened (to focus it) and the clicked one is navigated into it.
    seedOwnedPane("thr_older");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    fireEvent.click(cardAnchor("thr_backlog"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_backlog"]));
    expect(fakeSplitPanes()).toHaveLength(2);
    // One pane, so the second click replaced rather than opening beside it:
    // the focus step names the thread the pane still shows, not the clicked
    // one (which is in no pane and would have been opened as a new split).
    expect(fakeNativeOpens().map((open) => open.threadId)).not.toContain("thr_backlog");
  });

  it("ignores a record with no pane id, the shape the old rule could write", async () => {
    // `paneId: null` meant "claim whichever pane shows this thread that was
    // not there at click time"; that rule is gone, and an old record on disk
    // must read as no record: the pane showing that thread is the operator's
    // and is never adopted, so the click asks for a fresh one beside the board.
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: null, threadId: "thr_older", priorPaneIds: ["pane-1"] }),
    );
    act(() => {
      // The board is focused by the press that starts the click (measured:
      // lib/native-pane-ownership.ts), so it is the pane the ask splits beside.
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_older", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCardNative("thr_focus");
    expect(threadPanes()).toEqual(["thr_focus", "thr_older"]);
    expect(inBoardPaneTitle()).toBeNull();
  });

  it("still replaces in the pane when the record's thread left the board's list", async () => {
    // The thread half is advisory: a thread the board no longer lists says
    // nothing about the pane, which the layout still holds by id.
    seedOwnedPane("thr_missing");
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(fakeSplitPanes()).toHaveLength(2);
    expect(inBoardPaneTitle()).toBeNull();
  });

  it("replaces in a pane the operator re-threaded, and opens no second pane", async () => {
    // The 2026-11-21 report and the 2026-11-24 ruling in one shape: the
    // operator navigated the board's pane to another thread. The pane is still
    // the board's by id, so the click focuses it and puts the clicked thread
    // there. The cost the operator accepted: what they were reading goes.
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      // The board focused, as it is at click time (see above).
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    await clickCardNative("thr_focus");
    expect(threadPanes()).toEqual(["thr_focus"]);
    expect(fakeSplitPanes()).toHaveLength(2);
    expect(inBoardPaneTitle()).toBeNull();
    expect(fakePanelPushes()).toEqual([]);
    // The focus step names the thread the pane showed, never the clicked one:
    // asking for the clicked thread is the host's "new pane on the right".
    expect(fakeNativeOpens().map((open) => open.threadId)).not.toContain("thr_focus");
  });

  it("a dragged pane is still the board's: position does not decide ownership", async () => {
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-2", threadId: "thr_older", isFocused: false },
        { paneId: "pane-1", threadId: null, isFocused: true },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(fakeSplitPanes()).toHaveLength(2);
  });
});

describe("a recorded pane the operator navigated", () => {
  // The reproduction behind these tests (operator report 2026-11-21: "clicking
  // on a card then opens the legacy focus board thread pane instead of
  // swapping the native one") and the ruling that followed (2026-11-24,
  // dec_okjt7e62rg2x): the pane is the board's BY ID, whatever it shows. A
  // pane the operator navigates from inside itself — a sidebar row, a mention,
  // a child row, a rail page like Decisions — is still the board's, so the
  // click focuses it and puts the clicked thread there. The cost the operator
  // accepted is exactly what these tests assert: what the pane was showing is
  // replaced.
  /** The page-route shape: the rail's Decisions entry, reported by the host
   *  with `threadId: null` (measured: probe-card-click-after-right-panel,
   *  phase F). */
  function seedPagePaneHere(): void {
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: null, isFocused: false },
      ]);
    });
  }

  it("replaces the page in the pane the operator navigated to it", async () => {
    seedPagePaneHere();
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));
    // The host's own pane containers, whose pointer handler focuses the pane:
    // the click's focus lever for a pane that shows no thread.
    mountHostPaneContainers();

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    expect(fakeSplitPanes()).toHaveLength(2);
    expect(focusedPaneId()).toBe("pane-2");
    // No fresh split was asked for: the clicked thread is navigated into the
    // pane the board already named.
    expect(fakeNativeOpens()).toEqual([]);
    expect(fakeThreadNavigations()).toEqual(["thr_focus"]);
    expect(inBoardPaneTitle()).toBeNull();
    expect(fakePanelPushes()).toEqual([]);
    expect(document.querySelector('[data-focus-board-panel]')).not.toBeNull();
  });

  it("keeps owning the pane, so a second click replaces there too", async () => {
    seedPagePaneHere();
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));
    mountHostPaneContainers();

    fireEvent.click(cardAnchor("thr_focus"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus"]));
    // The next card press focuses the board first (the host does that on
    // pointerdown, measured: probe-card-click-focus-trace.mjs), so the pane is
    // not focused when the second click runs.
    act(() => {
      setFakeSplitLayout(
        fakeSplitPanes().map((pane) => ({ ...pane, isFocused: pane.paneId === "pane-1" })),
      );
    });
    fireEvent.click(cardAnchor("thr_backlog"));
    await waitFor(() => expect(threadPanes()).toEqual(["thr_backlog"]));
    expect(fakeSplitPanes()).toHaveLength(2);
    // The page pane's replacement became a thread pane, so the second click is
    // the ordinary focus-and-navigate shape: the thread the pane shows is
    // opened to focus it, and the clicked one is navigated in.
    expect(fakeNativeOpens().at(-1)).toEqual({ threadId: "thr_focus", split: true });
    expect(fakeThreadNavigations()).toEqual(["thr_focus", "thr_backlog"]);
  });
  /** The unresolved shape, seeded: the record names a pane the window no
   *  longer holds (the operator closed it). A pane id absent from the layout is
   *  the ONLY record that does not resolve under the 2026-11-24 ruling. */
  function seedGonePaneHere(): void {
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-3", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ]);
    });
  }

  it("asks for a fresh native pane when the recorded pane is gone", async () => {
    seedGonePaneHere();
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    // The ask names the CLICKED thread: a thread in no pane, so the host splits
    // beside the board, and the pane that appeared is adopted.
    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_focus", split: true }]);
    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus", "thr_other"]));
    expect(fakeSplitPanes()).toHaveLength(3);
    const created = fakeSplitPanes().find((pane) => pane.threadId === "thr_focus");
    expect(
      JSON.parse(
        window.localStorage.getItem("focus-board:boardNativeThreadPane") ?? "null",
      ),
    ).toEqual({ paneId: created?.paneId, threadId: "thr_focus" });
    expect(inBoardPaneTitle()).toBeNull();
    expect(fakePanelPushes()).toEqual([]);
  });

  it("focuses the recorded pane when the operator navigated it back to the clicked thread", async () => {
    // The pane shows the clicked thread again, so nothing moves: the host's
    // opener focuses the pane that already holds it, and the record's advisory
    // thread follows what the pane holds now.
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_other"));

    fireEvent.click(cardAnchor("thr_other"));

    expect(fakeNativeOpens()).toEqual([{ threadId: "thr_other", split: true }]);
    await waitFor(() => expect(focusedPaneId()).toBe("pane-2"));
    expect(fakeSplitPanes()).toHaveLength(2);
    expect(fakeThreadNavigations()).toEqual([]);
    expect(inBoardPaneTitle()).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem("focus-board:boardNativeThreadPane") ?? "null",
      ),
    ).toEqual({ paneId: "pane-2", threadId: "thr_other" });
  });

  it("splits beside the board when the board has no record and a pane is already open", async () => {
    // Two panes, no record at all: the operator opened the pane from bb's own
    // sidebar. The click reads no pane of the board's either way, and the
    // window can hold one, so the thread opens natively instead of in-board.
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus", "thr_other"]));
    expect(inBoardPaneTitle()).toBeNull();
    expect(fakePanelPushes()).toEqual([]);
  });

  it("a double click on one card leaves one fresh pane, and the board owns it", async () => {
    // The second press arrives before the first ask has settled: the ask is
    // superseded rather than stacked (lib/native-fresh-pane.ts keeps one), and
    // the pane the host created is still adopted, so the next click replaces.
    seedGonePaneHere();
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));
    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() => expect(threadPanes()).toEqual(["thr_focus", "thr_other"]));
    expect(fakeSplitPanes()).toHaveLength(3);
    const created = fakeSplitPanes().find((pane) => pane.threadId === "thr_focus");
    expect(
      JSON.parse(
        window.localStorage.getItem("focus-board:boardNativeThreadPane") ?? "null",
      ),
    ).toEqual({ paneId: created?.paneId, threadId: "thr_focus" });
  });

  it("stays in the board when its own pane is already open", async () => {
    // The board's own pane is up (the operator is reading a thread in it) and
    // the record names a pane that is gone: a fresh native pane would put three
    // surfaces on screen, so the click replaces in the pane that is already
    // there.
    seedGonePaneHere();
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="t/thr_older" />);
    await waitFor(() => expect(inBoardPaneTitle()).toBe("Older thread"));

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() =>
      expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_focus" }),
    );
    expect(fakeNativeOpens()).toEqual([]);
    expect(fakeSplitPanes()).toHaveLength(2);
  });
});

describe("a focus that does not land", () => {
  // The one outcome this rule must never ship: navigating while the board's
  // pane is still the focused one, which makes bb replace the BOARD. The click
  // therefore treats its focus step as a request and waits for the layout to
  // show the focus moved (app.tsx's landing effect); these two tests pin the
  // two ways the wait ends without it.

  it("opens the board's own pane when the target pane has no container to press", async () => {
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: null, isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));
    // No `[data-split-pane-id]` elements at all: the click cannot press the
    // pane, so it knows the focus step failed and does not ask the host to
    // navigate into a pane that is not focused.

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(() =>
      expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_focus" }),
    );
    expect(fakeThreadNavigations()).toEqual([]);
    expect(focusedPaneId()).toBe("pane-1");
    expect(threadPanes()).toEqual([]);
    // The record is dropped: the next click re-plans from what the host holds.
    expect(window.localStorage.getItem("focus-board:boardNativeThreadPane")).toBeNull();
  });

  it("opens the board's own pane when the press does not move the focus", async () => {
    // A pane container that exists but focuses nothing, the shape a host
    // change would produce: the deadline is the only thing that ends the wait,
    // and it ends in the board's own pane, never in a navigation.
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-1", threadId: null, isFocused: true },
        { paneId: "pane-2", threadId: null, isFocused: false },
      ]);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));
    mountHostPaneContainers({ focuses: false });

    fireEvent.click(cardAnchor("thr_focus"));

    await waitFor(
      () =>
        expect(fakePanelPushes().at(-1)).toMatchObject({
          path: "board",
          subPath: "t/thr_focus",
        }),
      { timeout: 3_000 },
    );
    expect(fakeThreadNavigations()).toEqual([]);
    expect(focusedPaneId()).toBe("pane-1");
    expect(threadPanes()).toEqual([]);
  });
});

describe("where the host will not split", () => {
  it("opens the board's own pane instead of asking for a split that replaces the board", async () => {
    stubCompactViewport(true);
    act(() => {
      setFakeSplitsOff(true);
    });
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));

    expect(fakeNativeOpens()).toEqual([]);
    await waitFor(() =>
      expect(fakePanelPushes().at(-1)).toMatchObject({ path: "board", subPath: "t/thr_older" }),
    );
    expect(inBoardPaneTitle()).toBe("Older thread");
    expect(threadPanes()).toEqual([]);
  });
});

describe("the developer trace", () => {
  it("logs one line naming the branch when the setting is on", async () => {
    setFakeSettings({ nativeOpenDebug: true });
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));
    expect(debug).toHaveBeenCalledWith(
      "[focus-board:native-open]",
      expect.objectContaining({
        threadId: "thr_older",
        branch: "one-pane: asking the opener for the split",
      }),
    );
    debug.mockRestore();
  });

  it("stays silent when the setting is off", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    mountBoard();
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_older"));

    fireEvent.click(cardAnchor("thr_older"));
    expect(
      debug.mock.calls.filter((call) => call[0] === "[focus-board:native-open]"),
    ).toEqual([]);
    debug.mockRestore();
  });
});

describe("a record that names the board's own pane", () => {
  it("refuses it and asks for a fresh pane rather than navigating into the board", async () => {
    // bb names panes `pane-N` and reuses the lowest free number, so a recorded
    // id can come to name the pane the board itself sits in — after a drag of
    // the board, or after the pane it named was destroyed and re-created. The
    // click's focus step would then press the BOARD's container (a no-op, the
    // board is focused anyway) and the landing navigation would replace the
    // board itself. The record must not resolve there.
    window.localStorage.setItem(
      "focus-board:boardNativeThreadPane",
      JSON.stringify({ paneId: "pane-2", threadId: "thr_older" }),
    );
    act(() => {
      setFakeSplitLayout([
        { paneId: "pane-3", threadId: "thr_other", isFocused: false },
        { paneId: "pane-2", threadId: null, isFocused: true },
      ]);
    });
    const hostPane = document.createElement("div");
    hostPane.setAttribute("data-split-pane-id", "pane-2");
    document.body.append(hostPane);
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />, { container: hostPane });
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    // The fresh pane is inserted beside the focused pane (the board), so the
    // layout's order is not the point: the set of thread panes is.
    await waitFor(() =>
      expect([...threadPanes()].sort()).toEqual(["thr_focus", "thr_other"]),
    );
    expect(fakeSplitPanes()).toHaveLength(3);
    expect(hostPane.contains(document.querySelector("[data-focus-board-panel]"))).toBe(true);
    expect(fakeThreadNavigations()).toEqual([]);
  });
});

describe("one click, one surface", () => {
  it("does not open the board's pane when a replacement lands", async () => {
    // bb re-creates the plugin panel's subtree whenever the window's layout
    // changes, and its opener navigates the route to the thread it placed.
    // #467's 500ms repair read that pair as "the board was replaced" and
    // pushed the board's route back with a subPath, so one click produced the
    // native pane AND the board's in-panel pane. Measured live on a938fc7.
    seedOwnedPane("thr_older");
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    const view = render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("idle-today")).toContain("thr_focus"));

    fireEvent.click(cardAnchor("thr_focus"));

    // What the host does next, inside the click's own repair window: the
    // route becomes the thread's and the panel's subtree is gone while it is
    // re-created.
    window.history.pushState({}, "", "/projects/proj_a/threads/thr_focus");
    view.unmount();
    expect(document.querySelector("[data-focus-board-panel]")).toBeNull();

    // Past the old repair window.
    await new Promise((resolve) => setTimeout(resolve, 650));

    // One surface: the pane the replacement landed in.
    expect(fakePanelPushes()).toEqual([]);
    window.history.pushState({}, "", "/");
  });
});
