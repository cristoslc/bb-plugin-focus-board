import { describe, expect, it } from "vitest";
import {
  GROUP_BY_OPTIONS,
  buildColumns,
  columnFor,
  filterThreads,
  matchesFilter,
  threadState,
} from "../components/grouping";
import { thread } from "./thread-fixture";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const NOW = 10 * DAY;

describe("threadState", () => {
  it("treats running statuses as working", () => {
    for (const status of ["active", "starting", "stopping", "pending"] as const) {
      expect(threadState(thread({ status }))).toBe("working");
    }
  });

  it("prefers attention over unread", () => {
    expect(
      threadState(thread({ hasPendingInteraction: true, isUnread: true })),
    ).toBe("attention");
    expect(threadState(thread({ indicator: "unread-error" }))).toBe("attention");
  });

  it("prefers attention over working when a turn waits on the user", () => {
    for (const status of ["active", "starting", "stopping", "pending"] as const) {
      expect(
        threadState(thread({ status, hasPendingInteraction: true })),
      ).toBe("attention");
    }
  });

  it("maps unread and idle", () => {
    expect(threadState(thread({ isUnread: true }))).toBe("unread");
    expect(threadState(thread({}))).toBe("idle");
  });
});

describe("filterThreads", () => {
  const threads = [
    thread({ id: "a", projectId: "p1", providerId: "prov1", isUnread: true }),
    thread({ id: "b", projectId: "p2", providerId: "prov2" }),
  ];
  const empty = () => new Set<string>();

  it("passes everything when no filter is set", () => {
    expect(filterThreads(threads, { projects: empty(), providers: empty(), states: empty() })).toHaveLength(2);
  });

  it("filters by multiple projects", () => {
    const result = filterThreads(
      threads,
      { projects: new Set(["p2"]), providers: empty(), states: empty() },
    );
    expect(result.map((t) => t.id)).toEqual(["b"]);
  });

  it("intersects project, provider, and state selections", () => {
    const result = filterThreads(
      threads,
      {
        projects: new Set(["p2"]),
        providers: new Set(["prov1"]),
        states: empty(),
      },
    );
    expect(result).toHaveLength(0);
  });

  it("filters by state", () => {
    const result = filterThreads(
      threads,
      { projects: empty(), providers: empty(), states: new Set(["unread"]) },
    );
    expect(result.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("matchesFilter", () => {
  const t = thread({ id: "thr_abc", displayTitle: "Fix the login bug" });
  it("matches titles case-insensitively", () => {
    expect(matchesFilter(t, "LOGIN")).toBe(true);
    expect(matchesFilter(t, "nope")).toBe(false);
  });
  it("matches ids", () => {
    expect(matchesFilter(t, "abc")).toBe(true);
  });
});

describe("columnFor", () => {
  const context = {
    projects: [{ id: "proj_a", name: "Alpha", isPersonal: false, href: "", settingsHref: "" }],
    providers: [{ id: "pi", displayName: "Pi" }],
  };

  it("routes idle threads to age buckets by updatedAt", () => {
    const fresh = columnFor(thread({ updatedAt: NOW - 5 * 1000 }), "status", context, NOW);
    const old = columnFor(thread({ updatedAt: NOW - 8 * DAY }), "status", context, NOW);
    expect(fresh.id).toBe("idle-recent");
    expect(old.id).toBe("idle-awhile");
  });

  it("keeps working threads out of the idle buckets", () => {
    const result = columnFor(thread({ status: "active" }), "status", context, NOW);
    expect(result.id).toBe("working");
  });

  it("labels project columns from context", () => {
    const result = columnFor(thread({ projectId: "proj_a" }), "project", context, NOW);
    expect(result).toEqual({ id: "proj_a", label: "Alpha" });
  });

  it("recency grouping buckets every thread by age", () => {
    expect(columnFor(thread({ updatedAt: NOW - 2 * HOUR }), "recency", context, NOW).id).toBe("today");
    expect(columnFor(thread({ updatedAt: NOW - 2 * DAY }), "recency", context, NOW).id).toBe("earlier");
  });
});

describe("GROUP_BY_OPTIONS", () => {
  it("labels the attention-priority grouping Attention, not State", () => {
    // The grouping orders by claim on your attention; "State" is the filter's
    // word for what a thread is. The persisted value stays "status".
    expect(GROUP_BY_OPTIONS.find((option) => option.value === "status")?.label).toBe(
      "Attention",
    );
  });
});

describe("machine grouping", () => {
  const context = { projects: [], providers: [] };

  it("names columns after the thread's host, resolved from the payload", () => {
    expect(columnFor(thread({ host: { id: "host_1", name: "Desktop" } }), "machine", context)).toEqual({
      id: "host_1",
      label: "Desktop",
    });
  });

  it("parks threads without a known host under No machine", () => {
    expect(columnFor(thread({}), "machine", context)).toEqual({ id: "none", label: "No machine" });
  });

  it("builds one column per machine", () => {
    const columns = buildColumns(
      [
        thread({ id: "a", host: { id: "host_1", name: "Desktop" }, updatedAt: DAY }),
        thread({ id: "b", host: { id: "host_1", name: "Desktop" }, updatedAt: 2 * DAY }),
        thread({ id: "c", host: { id: "host_2", name: "Laptop" }, updatedAt: 3 * DAY }),
        thread({ id: "d", updatedAt: 4 * DAY }),
      ],
      "machine",
      context,
    );
    expect(columns.map((column) => [column.label, column.threads.length])).toEqual([
      ["Desktop", 2],
      ["Laptop", 1],
      ["No machine", 1],
    ]);
  });
});

describe("buildColumns", () => {
  const context = {
    projects: [],
    providers: [],
  };

  it("hides empty columns and shows populated ones", () => {
    const columns = buildColumns(
      [thread({ id: "1", status: "active" })],
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["working"]);
  });

  it("puts pinned threads in a far-left column and done in a far-right one", () => {
    const columns = buildColumns(
      [
        thread({ id: "p", isPinned: true, status: "idle", updatedAt: NOW - 2 * HOUR }),
        thread({ id: "w", status: "active" }),
        thread({ id: "d" }),
      ],
      "status",
      context,
      new Map(),
      new Set(["d"]),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["pinned", "working", "done"]);
  });

  it("orders state lanes by attention priority with newest idle buckets leftmost", () => {
    const columns = buildColumns(
      [
        thread({ id: "w", status: "active" }),
        thread({ id: "a", hasPendingInteraction: true }),
        thread({ id: "u", isUnread: true }),
        thread({ id: "recent", updatedAt: NOW - 5 * 1000 }),
        thread({ id: "today", updatedAt: NOW - 2 * HOUR }),
        thread({ id: "earlier", updatedAt: NOW - 2 * DAY }),
        thread({ id: "awhile", updatedAt: NOW - 8 * DAY }),
      ],
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual([
      "attention",
      "unread",
      "working",
      "idle-recent",
      "idle-today",
      "idle-earlier",
      "idle-awhile",
    ]);
  });

  it("orders recency columns newest-leftmost", () => {
    const columns = buildColumns(
      [
        thread({ id: "awhile", updatedAt: NOW - 8 * DAY }),
        thread({ id: "earlier", updatedAt: NOW - 2 * DAY }),
        thread({ id: "today", updatedAt: NOW - 2 * HOUR }),
        thread({ id: "recent", updatedAt: NOW - 5 * 1000 }),
      ],
      "recency",
      context,
      new Map(),
      new Set(),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["recent", "today", "earlier", "awhile"]);
  });

  it("freezes a selected thread's column across state changes", () => {
    const frozen = new Map([["1", { id: "unread", label: "Unread" }]]);
    const columns = buildColumns(
      [thread({ id: "1", status: "active" })],
      "status",
      context,
      frozen,
      new Set(),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["unread"]);
  });

  it("keeps done threads dimmed-flagged but still grouped by done", () => {
    const columns = buildColumns(
      [thread({ id: "1", isPinned: true })],
      "status",
      context,
      new Map(),
      new Set(["1"]),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["done"]);
  });

  describe("Done column default sort", () => {
    it("sorts unranked done cards by doneAt, newest done first (not updatedAt)", () => {
      const columns = buildColumns(
        [
          // updatedAt deliberately contradicts doneAt: done order, not the
          // board's recency order, is what the column shows by default.
          thread({ id: "old-done-new-updated", updatedAt: NOW - HOUR }),
          thread({ id: "new-done", updatedAt: NOW - 3 * DAY }),
          thread({ id: "mid-done", updatedAt: NOW - 2 * DAY }),
        ],
        "status",
        context,
        new Map(),
        new Set(["old-done-new-updated", "new-done", "mid-done"]),
        NOW,
        {},
        new Map([
          ["old-done-new-updated", NOW - 5 * DAY],
          ["new-done", NOW - 1000],
          ["mid-done", NOW - 2 * DAY],
        ]),
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual([
        "new-done",
        "mid-done",
        "old-done-new-updated",
      ]);
    });

    it("sorts a done card with no recorded doneAt below recorded ones, in derived order", () => {
      const columns = buildColumns(
        [
          thread({ id: "unknown", updatedAt: NOW - HOUR }),
          thread({ id: "recorded", updatedAt: NOW - 8 * DAY }),
        ],
        "status",
        context,
        new Map(),
        new Set(["unknown", "recorded"]),
        NOW,
        {},
        new Map([["recorded", NOW - 2 * DAY]]),
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual(["recorded", "unknown"]);
    });

    it("applies a stored drag order on top of the doneAt default sort", () => {
      const columns = buildColumns(
        [
          thread({ id: "a", updatedAt: NOW - HOUR }),
          thread({ id: "b", updatedAt: NOW - 2 * HOUR }),
          thread({ id: "c", updatedAt: NOW - 3 * HOUR }),
        ],
        "status",
        context,
        new Map(),
        new Set(["a", "b", "c"]),
        NOW,
        { done: ["c", "b", "a"] },
        new Map([
          ["a", NOW - HOUR],
          ["b", NOW - 2 * HOUR],
          ["c", NOW - 3 * HOUR],
        ]),
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual(["c", "b", "a"]);
    });

    it("falls back to the board's derived order when no done times are known", () => {
      const columns = buildColumns(
        [
          thread({ id: "early", updatedAt: NOW - 3 * HOUR }),
          thread({ id: "late", updatedAt: NOW - HOUR }),
        ],
        "status",
        context,
        new Map(),
        new Set(["early", "late"]),
        NOW,
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual(["late", "early"]);
    });
  });
});