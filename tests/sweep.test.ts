import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { DAY_MS, HOUR_MS } from "../lib/duration";
import {
  DEFAULT_DONE_ARCHIVE_MS,
  DEFAULT_IDLE_ARCHIVE_MS,
  armSweep,
  confirmSweep,
  sweepCandidatesForDoneColumn,
  sweepCandidatesForIdleColumn,
  sweepColumnKind,
  sweepDestination,
  toggleSweepSelection,
} from "../lib/sweep";

function thread(overrides: Partial<PluginSidebarThread> & { id: string }): PluginSidebarThread {
  return {
    projectId: "proj_a",
    title: "Test thread",
    titleFallback: null,
    displayTitle: "Test thread",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "pi",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: "/projects/p/threads/t",
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
    ...overrides,
  } as PluginSidebarThread;
}

const NOW = 100 * DAY_MS;

describe("sweepCandidatesForDoneColumn", () => {
  it("is empty for a fresh done thread", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(["a"]),
      { doneMarkedAt: () => NOW - HOUR_MS, kept: () => false },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("includes a done thread aged past the threshold", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(["a"]),
      { doneMarkedAt: () => NOW - 8 * DAY_MS, kept: () => false },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["a"]);
  });

  it("includes a thread at exactly the threshold (age >= N days)", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(["a"]),
      { doneMarkedAt: () => NOW - 7 * DAY_MS, kept: () => false },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["a"]);
  });

  it("excludes a done thread one tick under the threshold", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(["a"]),
      { doneMarkedAt: () => NOW - 7 * DAY_MS + 1, kept: () => false },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("never includes a kept (overridden) thread", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" }), thread({ id: "b" })],
      new Set(["a", "b"]),
      {
        doneMarkedAt: (id) => (id === "a" ? NOW - 30 * DAY_MS : NOW - 30 * DAY_MS),
        kept: (id) => id === "a",
      },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["b"]);
  });

  it("never includes an undated done thread (no known stamp)", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(["a"]),
      { doneMarkedAt: () => null, kept: () => false },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("ignores threads that are not done", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(),
      { doneMarkedAt: () => NOW - 30 * DAY_MS, kept: () => false },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("defaults doneArchiveMs to 2 days when omitted", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "a" })],
      new Set(["a"]),
      { doneMarkedAt: () => NOW - 8 * DAY_MS, kept: () => false },
      {},
      NOW,
    );
    expect(candidates).toEqual(["a"]);
  });

  it("orders candidates newest-done first", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "old" }), thread({ id: "newer" })],
      new Set(["old", "newer"]),
      {
        doneMarkedAt: (id) => (id === "old" ? NOW - 30 * DAY_MS : NOW - 9 * DAY_MS),
        kept: () => false,
      },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["newer", "old"]);
  });
});

describe("sweepCandidatesForIdleColumn", () => {
  it("includes a long-idle thread past the idle threshold", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", updatedAt: NOW - 31 * DAY_MS })],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["a"]);
  });

  it("is empty for a thread under the idle threshold", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", updatedAt: NOW - 29 * DAY_MS })],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("includes a thread at exactly the threshold", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", updatedAt: NOW - 30 * DAY_MS })],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["a"]);
  });

  it("excludes non-idle states — only quiet threads sweep", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [
        thread({ id: "working", status: "active", updatedAt: NOW - 60 * DAY_MS }),
        thread({
          id: "attention",
          hasPendingInteraction: true,
          updatedAt: NOW - 60 * DAY_MS,
        }),
        thread({ id: "unread", isUnread: true, updatedAt: NOW - 60 * DAY_MS }),
      ],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("never claims a done thread — that is the Done arm's job", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", updatedAt: NOW - 60 * DAY_MS })],
      new Set(["a"]),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("excludes pinned threads — pins are an explicit keep", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", isPinned: true, updatedAt: NOW - 60 * DAY_MS })],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("excludes kept (overridden) threads", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", updatedAt: NOW - 60 * DAY_MS })],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS, kept: (id) => id === "a" },
      NOW,
    );
    expect(candidates).toEqual([]);
  });

  it("defaults idleArchiveMs to 2 days when omitted", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [thread({ id: "a", updatedAt: NOW - 31 * DAY_MS })],
      new Set(),
      {},
      NOW,
    );
    expect(candidates).toEqual(["a"]);
  });

  it("orders candidates newest-activity first", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [
        thread({ id: "older", updatedAt: NOW - 60 * DAY_MS }),
        thread({ id: "newer", updatedAt: NOW - 35 * DAY_MS }),
      ],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
    );
    expect(candidates).toEqual(["newer", "older"]);
  });
});

describe("sweep-family contract", () => {
  /** `parent` has one live (non-archived) child; `parentQuiet` does not. */
  const liveChildParents = new Set(["parent"]);

  it("a parent with a live child is never eligible in the idle arm, regardless of age", () => {
    expect(
      sweepCandidatesForIdleColumn(
        [thread({ id: "parent", updatedAt: NOW - 90 * DAY_MS })],
        new Set(),
        { idleArchiveMs: 30 * DAY_MS },
        NOW,
        liveChildParents,
      ),
    ).toEqual([]);
  });

  it("a parent with a live child is never eligible in the done arm, regardless of age or keep", () => {
    const candidates = sweepCandidatesForDoneColumn(
      [thread({ id: "parent" })],
      new Set(["parent"]),
      { doneMarkedAt: () => NOW - 90 * DAY_MS, kept: () => true },
      { doneArchiveMs: 7 * DAY_MS },
      NOW,
      liveChildParents,
    );
    expect(candidates).toEqual([]);
  });

  it("the child is eligible independently of its parent", () => {
    const candidates = sweepCandidatesForIdleColumn(
      [
        thread({ id: "parent", updatedAt: NOW - 90 * DAY_MS }),
        thread({
          id: "child",
          parentThreadId: "parent",
          updatedAt: NOW - 90 * DAY_MS,
        }),
      ],
      new Set(),
      { idleArchiveMs: 30 * DAY_MS },
      NOW,
      liveChildParents,
    );
    expect(candidates).toEqual(["child"]);
  });
});

describe("arm-then-confirm semantics", () => {
  const doneSource = {
    doneMarkedAt: (id: string) => (id === "a" ? NOW - 30 * DAY_MS : null),
    kept: () => false,
  };

  it("captures a frozen list at arm time; late arrivals do not join", () => {
    const threads = [thread({ id: "a", updatedAt: NOW - 30 * DAY_MS })];
    const armed = armSweep("done", sweepCandidatesForDoneColumn(threads, new Set(["a"]), doneSource, { doneArchiveMs: 7 * DAY_MS }, NOW));
    expect(armed.threadIds).toEqual(["a"]);

    // A late arrival becomes eligible after arming.
    const doneSourceLate = {
      doneMarkedAt: (id: string) => (id === "a" || id === "late" ? NOW - 30 * DAY_MS : null),
      kept: () => false,
    };
    const late = [...threads, thread({ id: "late", updatedAt: NOW - 30 * DAY_MS })];
    const lateCandidates = sweepCandidatesForDoneColumn(late, new Set(["a", "late"]), doneSourceLate, { doneArchiveMs: 7 * DAY_MS }, NOW);
    expect(lateCandidates).toContain("late");

    // But the armed list is frozen: it still holds only the captured card.
    expect(armed.threadIds).toEqual(["a"]);
  });

  it("confirm returns exactly the captured list and nothing else", () => {
    const armed = armSweep("done", ["a", "b"]);
    const confirmed = confirmSweep(armed, true);
    expect(confirmed).toEqual(["a", "b"]);
  });

  it("confirm from an armed idle sweep does not leak into the done list", () => {
    const armed = armSweep("idle-awhile", ["a"]);
    const confirmed = confirmSweep(armed, true);
    expect(confirmed).toEqual(["a"]);
  });

  it("disarm clears the armed state; confirm after disarm archives nothing", () => {
    const armed = armSweep("done", ["a"]);
    const disarmed = confirmSweep(armed, false);
    expect(disarmed).toEqual([]);
  });
});

describe("manual sweep selection (click to toggle while armed)", () => {
  it("adds an unselected thread to the selection", () => {
    const armed = armSweep("done", ["a"]);
    const next = toggleSweepSelection(armed, "b");
    expect(next.threadIds).toEqual(["a", "b"]);
    expect(next.columnId).toBe("done");
  });

  it("removes a selected thread from the selection", () => {
    const armed = armSweep("done", ["a", "b"]);
    const next = toggleSweepSelection(armed, "a");
    expect(next.threadIds).toEqual(["b"]);
  });

  it("does not mutate the armed state it was given", () => {
    const armed = armSweep("done", ["a"]);
    toggleSweepSelection(armed, "b");
    toggleSweepSelection(armed, "a");
    expect(armed.threadIds).toEqual(["a"]);
  });

  it("toggling the same thread twice returns to the start", () => {
    const armed = armSweep("done", ["a"]);
    expect(toggleSweepSelection(toggleSweepSelection(armed, "b"), "b").threadIds).toEqual(["a"]);
  });
});

describe("column classification", () => {
  it("names the sweepable columns; done vs idle-bucket; null for others", () => {
    expect(sweepColumnKind("done")).toBe("done");
    expect(sweepColumnKind("idle-awhile")).toBe("idle-bucket");
    expect(sweepColumnKind("awhile")).toBe("idle-bucket");
    expect(sweepColumnKind("working")).toBeNull();
    expect(sweepColumnKind("idle-earlier")).toBeNull();
    expect(sweepColumnKind("earlier")).toBeNull();
    expect(sweepColumnKind("pinned")).toBeNull();
  });

  it("sends each arm to its own destination: Done-age archives, long-idle marks Done", () => {
    expect(sweepDestination("done")).toBe("archive");
    expect(sweepDestination("idle-awhile")).toBe("done");
    expect(sweepDestination("awhile")).toBe("done");
    expect(sweepDestination("working")).toBeNull();
    expect(sweepDestination("idle-earlier")).toBeNull();
  });
});

describe("threshold defaults", () => {
  it("uses 2 days for both arms", () => {
    expect(DEFAULT_DONE_ARCHIVE_MS).toBe(2 * DAY_MS);
    expect(DEFAULT_IDLE_ARCHIVE_MS).toBe(2 * DAY_MS);
  });
});