import { describe, expect, it } from "vitest";
import {
  GROUP_BY_OPTIONS,
  buildColumns,
  columnFor,
  filterThreads,
  matchesFilter,
  threadState,
} from "../components/grouping";
import type { TicketRef } from "../lib/tickets";
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

  it("matches the project name the card's footer shows", () => {
    const projectNameFor = (projectId: string) => (projectId === "proj_a" ? "Alpha" : "Beta");
    expect(matchesFilter(thread({ projectId: "proj_a" }), "alpha", projectNameFor)).toBe(true);
    expect(matchesFilter(thread({ projectId: "proj_b" }), "alpha", projectNameFor)).toBe(false);
    expect(matchesFilter(thread({ projectId: "proj_b" }), "beta", projectNameFor)).toBe(true);
  });

  it("falls back to Personal for projects outside a supplied resolver", () => {
    const projectNameFor = () => "Personal";
    expect(matchesFilter(t, "personal", projectNameFor)).toBe(true);
    expect(matchesFilter(t, "alpha", projectNameFor)).toBe(false);
  });

  it("matches the branch on the card's project line", () => {
    const branched = thread({
      environment: {
        id: "env_1",
        name: "checkout",
        branchName: "feat/walnut-rank",
        path: null,
        isWorktree: true,
        providerId: null,
        workspaceDisplayKind: null,
      },
    });
    expect(matchesFilter(branched, "WALNUT")).toBe(true);
    expect(matchesFilter(branched, "nope")).toBe(false);
  });

  it("falls back to the host name when the card shows no branch", () => {
    const hosted = thread({ host: { id: "h1", name: "work-laptop" } });
    expect(matchesFilter(hosted, "laptop")).toBe(true);
  });
});

describe("matchesFilter — ticket-chip refs are searchable", () => {
  // A card whose issue/PR chip (#38) comes from somewhere the four base
  // fields never render: the board's link store or a URL-form text ref.
  const plain = thread({ id: "thr_plain", displayTitle: "Ship the login fix" });

  const ghRef: TicketRef = {
    raw: "#38",
    tracker: "github",
    number: 38,
    href: "https://github.com/o/r/issues/38",
  };

  it("matches a store-linked chip number with and without the hash", () => {
    expect(matchesFilter(plain, "#38", undefined, () => [ghRef])).toBe(true);
    expect(matchesFilter(plain, "38", undefined, () => [ghRef])).toBe(true);
    expect(matchesFilter(plain, "#39", undefined, () => [ghRef])).toBe(false);
  });

  it("matches a URL-form text ref by its number (the raw text lacks the #)", () => {
    const urlRef: TicketRef = {
      raw: "https://github.com/o/r/pull/123",
      tracker: "github",
      kind: "pull",
      number: 123,
      href: "https://github.com/o/r/pull/123",
    };
    expect(matchesFilter(plain, "#123", undefined, () => [urlRef])).toBe(true);
  });

  it("matches an external item's chip label", () => {
    const extRef: TicketRef = {
      raw: "PROJ-142",
      hostname: "jira.example.com",
      tracker: "external",
      href: "https://jira.example.com/browse/PROJ-142",
    };
    expect(matchesFilter(plain, "proj-142", undefined, () => [extRef])).toBe(true);
  });

  it("does not consult refs when the callback is unwired", () => {
    expect(matchesFilter(plain, "#38")).toBe(false);
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

  it("keeps the Working column on the attention board even when nothing runs", () => {
    // "Working" is a fixture of the attention board, not a lane that appears
    // only while a card runs in it: an all-idle board still carries the lane,
    // empty, where the UI reads "No work in progress".
    const columns = buildColumns(
      [thread({ id: "i", updatedAt: NOW - 5 * 1000 })],
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["working", "idle-recent"]);
    const working = columns.find((c) => c.id === "working");
    expect(working?.threads).toEqual([]);
    expect(working?.label).toBe("Working");
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
    expect(columns.map((c) => c.id)).toEqual(["unread", "working"]);
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
    expect(columns.map((c) => c.id)).toEqual(["working", "done"]);
  });

  describe("Done column default sort", () => {
    it("sorts unranked done cards by activity recency, most recently active first", () => {
      const columns = buildColumns(
        [
          // updatedAt deliberately contradicts doneAt: a fresh done stamp
          // (the idle sweep's mark on a long-idle thread) must not vault a
          // quiet card above recently active ones — most recently active at
          // the top is the column's order.
          thread({ id: "sweep-stamped", updatedAt: NOW - 30 * DAY }),
          thread({ id: "quiet", updatedAt: NOW - 2 * DAY }),
          thread({ id: "no-stamp", updatedAt: NOW - 2 * HOUR }),
          thread({ id: "active", updatedAt: NOW - HOUR }),
        ],
        "status",
        context,
        new Map(),
        new Set(["sweep-stamped", "quiet", "no-stamp", "active"]),
        NOW,
        {},
        new Map([
          // Fresh sweep stamps contradict activity recency on purpose.
          ["sweep-stamped", NOW - 1000],
          ["active", NOW - 5 * DAY],
          ["quiet", NOW - 2 * DAY],
        ]),
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual([
        "active",
        "no-stamp",
        "quiet",
        "sweep-stamped",
      ]);
    });

    it("applies a stored drag order on top of the activity default sort", () => {
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
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual(["c", "b", "a"]);
    });

    it("floats a pinned done card above unpinned ones, then by activity", () => {
      const columns = buildColumns(
        [
          thread({ id: "pinned-old", isPinned: true, updatedAt: NOW - 3 * DAY }),
          thread({ id: "recent", updatedAt: NOW - HOUR }),
        ],
        "status",
        context,
        new Map(),
        new Set(["pinned-old", "recent"]),
        NOW,
      );
      const done = columns.find((c) => c.id === "done");
      expect(done?.threads.map((t) => t.id)).toEqual(["pinned-old", "recent"]);
    });
  });
});