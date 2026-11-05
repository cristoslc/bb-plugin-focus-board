import { describe, expect, it } from "vitest";
import {
  GROUP_BY_OPTIONS,
  STATE_FILTER_OPTIONS,
  buildColumns,
  columnFor,
  filterProjectsWithoutLane,
  filterThreads,
  isStateFilterValue,
  matchesFilter,
  parseStoredStateFilter,
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

  it("treats an errored turn as attention, not idle", () => {
    // A hard-failed turn carries no live process: without the error arm it
    // fell through to plain idle and its dot read gray everywhere.
    expect(threadState(thread({ status: "error" }))).toBe("attention");
    // Attention outranks unread (as with every other needs-you signal).
    expect(threadState(thread({ status: "error", isUnread: true }))).toBe("attention");
    expect(threadState(thread({ status: "error", hasPendingInteraction: true }))).toBe("attention");
  });

  it("treats a failed queued send as attention, not idle", () => {
    expect(threadState(thread({ queuedWork: "failed" }))).toBe("attention");
    // The host-resolved indicator of the same failed-send condition.
    expect(threadState(thread({ indicator: "queued-failed" }))).toBe("attention");
  });

  it("maps unread and idle", () => {
    expect(threadState(thread({ isUnread: true }))).toBe("unread");
    expect(threadState(thread({}))).toBe("idle");
  });

  it("treats an idle turn with background work in flight as working", () => {
    // The provider ends its turn as soon as it launches detached work, so
    // bb reports "idle" while a background agent, command, or workflow runs.
    const quiet = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };
    for (const busy of [{ backgroundAgents: 1 }, { backgroundCommands: 2 }, { workflows: 1 }]) {
      const activity = { ...quiet, ...busy };
      expect(threadState(thread({ activity }))).toBe("working");
      // Still running, so it outranks unread...
      expect(threadState(thread({ activity, isUnread: true }))).toBe("working");
      // ...but a wait on the operator still outranks working.
      expect(threadState(thread({ activity, hasPendingInteraction: true }))).toBe("attention");
    }
    // Plan mode and goals are not detached work: the thread stays idle.
    expect(threadState(thread({ activity: { ...quiet, planMode: 1, goals: 1 } }))).toBe("idle");
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

  it("an idle-bucket value passes only the idle threads in that bucket", () => {
    const idle = [
      thread({ id: "recent", updatedAt: NOW - 5 * 60 * 1000 }),
      thread({ id: "today", updatedAt: NOW - 2 * HOUR }),
      thread({ id: "earlier", updatedAt: NOW - 2 * DAY }),
      thread({ id: "awhile", updatedAt: NOW - 10 * DAY }),
    ];
    const result = filterThreads(
      idle,
      { projects: empty(), providers: empty(), states: new Set(["idle-today"]) },
      undefined,
      NOW,
    );
    expect(result.map((t) => t.id)).toEqual(["today"]);
  });

  it("idle buckets compose with the plain states in one selection", () => {
    const mixed = [
      thread({ id: "recent", updatedAt: NOW - 5 * 60 * 1000 }),
      thread({ id: "today", updatedAt: NOW - 2 * HOUR }),
      thread({ id: "reader", isUnread: true }),
    ];
    const result = filterThreads(
      mixed,
      { projects: empty(), providers: empty(), states: new Set(["idle-recent", "unread"]) },
      undefined,
      NOW,
    );
    expect(result.map((t) => t.id).sort()).toEqual(["reader", "recent"]);
  });

  it("the legacy bare Idle value still passes every idle thread", () => {
    const idle = [
      thread({ id: "recent", updatedAt: NOW - 5 * 60 * 1000 }),
      thread({ id: "awhile", updatedAt: NOW - 10 * DAY }),
    ];
    const result = filterThreads(
      idle,
      { projects: empty(), providers: empty(), states: new Set(["idle"]) },
      undefined,
      NOW,
    );
    expect(result).toHaveLength(2);
  });

  it("a checked idle bucket is exactly that Attention lane", () => {
    const idle = [
      thread({ id: "recent", updatedAt: NOW - 5 * 60 * 1000 }),
      thread({ id: "today", updatedAt: NOW - 2 * HOUR }),
    ];
    const kept = filterThreads(
      idle,
      { projects: empty(), providers: empty(), states: new Set(["idle-today"]) },
      undefined,
      NOW,
    );
    const columns = buildColumns(
      kept,
      "status",
      { projects: [], providers: [] },
      new Map(),
      new Set(),
      NOW,
    );
    expect(columns.map((c) => c.id)).toEqual(["working", "idle-today"]);
  });
});

describe("STATE_FILTER_OPTIONS", () => {
  it("splits Idle into one checkbox per idle lane, board lane labels included, Pinned leading", () => {
    expect(STATE_FILTER_OPTIONS.map((option) => option.label)).toEqual([
      "Pinned",
      "Working",
      "Needs you",
      "Unread",
      "Idle · Recent",
      "Idle · Today",
      "Idle · Earlier",
      "Idle · A while ago",
    ]);
  });

  it("every option value survives the stored-filter round trip", () => {
    const values = STATE_FILTER_OPTIONS.map((option) => option.value);
    for (const value of values) expect(isStateFilterValue(value)).toBe(true);
    expect(parseStoredStateFilter(values)).toEqual(values);
  });
});

describe("state filter: Pinned", () => {
  const empty = () => new Set<string>();
  const threads = [
    thread({ id: "pinned-idle", isPinned: true, updatedAt: NOW - 2 * HOUR }),
    thread({ id: "idle", updatedAt: NOW - 2 * HOUR }),
    thread({ id: "pinned-working", isPinned: true, status: "active" }),
    thread({ id: "working", status: "active" }),
  ];

  it("passes a pinned thread whatever its state when Pinned is checked", () => {
    const kept = filterThreads(
      threads,
      {
        projects: empty(),
        providers: empty(),
        states: new Set(["pinned"]),
      },
      undefined,
      NOW,
    );
    expect(kept.map((keptThread) => keptThread.id)).toEqual(["pinned-idle", "pinned-working"]);
  });

  it("misses unpinned threads when Pinned is the only checked value", () => {
    const kept = filterThreads(
      threads,
      {
        projects: empty(),
        providers: empty(),
        states: new Set(["pinned", "idle-today"]),
      },
      undefined,
      NOW,
    );
    expect(kept.map((keptThread) => keptThread.id)).toEqual([
      "pinned-idle",
      "idle",
      "pinned-working",
    ]);
  });
});

describe("parseStoredStateFilter", () => {
  it("expands the legacy bare Idle value into all four idle buckets", () => {
    expect(parseStoredStateFilter(["idle"])).toEqual([
      "idle-awhile",
      "idle-earlier",
      "idle-today",
      "idle-recent",
    ]);
  });

  it("keeps known values and drops unknown ones", () => {
    expect(parseStoredStateFilter(["working", "idle-today", "bogus"])).toEqual([
      "working",
      "idle-today",
    ]);
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

  it("matches the name of the feature group the thread belongs to", () => {
    const groupNameFor = (t: { id: string }): string =>
      t.id === "thr_abc" ? "Search epic" : "";
    expect(matchesFilter(t, "epic", undefined, undefined, groupNameFor)).toBe(true);
    expect(matchesFilter(t, "Search Epic", undefined, undefined, groupNameFor)).toBe(true);
    expect(matchesFilter(t, "nope", undefined, undefined, groupNameFor)).toBe(false);
  });

  it("an unassigned thread matches no group name (empty resolver value)", () => {
    expect(matchesFilter(t, "epic", undefined, undefined, () => "")).toBe(false);
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

describe("matchesFilter — every id on the thread is searchable", () => {
  // "Paste the id you have" search: the toolbar box should find the card
  // from ANY id a thread carries, not just the thread's own thr_ id.
  const full = thread({
    id: "thr_family",
    projectId: "proj_alpha",
    providerId: "prov_pi",
    sectionId: "sec_later",
    parentThreadId: "thr_root",
    lifecycleOwnerThreadId: "thr_owner",
    sourceThreadId: "thr_origin",
    environment: {
      id: "env_checkout",
      name: "checkout",
      branchName: null,
      path: null,
      isWorktree: true,
      providerId: "envprov_worktree",
      workspaceDisplayKind: null,
    },
    host: { id: "host_thor", name: "thor" },
  });

  it.each([
    ["the thread id", "thr_family"],
    ["the project id", "proj_alpha"],
    ["the provider id", "prov_pi"],
    ["the environment id", "env_checkout"],
    ["the environment provider id", "envprov_worktree"],
    ["the host id", "host_thor"],
    ["the parent thread id", "thr_root"],
    ["the lifecycle-owner thread id", "thr_owner"],
    ["the forked-from thread id", "thr_origin"],
    ["the section id", "sec_later"],
  ])("matches %s", (_label, q) => {
    expect(matchesFilter(full, q)).toBe(true);
  });

  it("stays false for an id that belongs to none of the fields", () => {
    expect(matchesFilter(full, "proj_zzzz")).toBe(false);
  });

  it("survives null ids (no environment, no host, no lineage)", () => {
    const bare = thread({ id: "thr_bare", projectId: "proj_a" });
    expect(matchesFilter(bare, "thr_bare")).toBe(true);
    expect(matchesFilter(bare, "proj_a")).toBe(true);
    expect(matchesFilter(bare, "env_")).toBe(false);
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

  it("routes an assigned thread to its feature group's column", () => {
    const withGroups = {
      ...context,
      groupsByThread: new Map([["t1", "grp_auth"]]),
      groupNames: new Map([["grp_auth", "Auth rework"]]),
    };
    expect(columnFor(thread({ id: "t1" }), "group", withGroups, NOW)).toEqual({
      id: "grp_auth",
      label: "Auth rework",
    });
  });

  it("parks unassigned threads under No group", () => {
    const withGroups = {
      ...context,
      groupsByThread: new Map<string, string>(),
      groupNames: new Map([["grp_auth", "Auth rework"]]),
    };
    expect(columnFor(thread({ id: "t9" }), "group", withGroups, NOW)).toEqual({
      id: "none",
      label: "No group",
    });
  });

  it("falls back to Unknown group when the registry record is gone", () => {
    const withGroups = {
      ...context,
      groupsByThread: new Map([["t1", "grp_ghost"]]),
      groupNames: new Map<string, string>(),
    };
    expect(columnFor(thread({ id: "t1" }), "group", withGroups, NOW)).toEqual({
      id: "grp_ghost",
      label: "Unknown group",
    });
  });

  it("builds one column per group, unassigned threads under No group", () => {
    const withGroups = {
      ...context,
      groupsByThread: new Map([
        ["a", "grp_auth"],
        ["b", "grp_auth"],
        ["c", "grp_search"],
      ]),
      groupNames: new Map([
        ["grp_auth", "Auth rework"],
        ["grp_search", "Search v2"],
      ]),
    };
    const columns = buildColumns(
      [
        thread({ id: "a", updatedAt: DAY }),
        thread({ id: "b", updatedAt: 2 * DAY }),
        thread({ id: "c", updatedAt: 3 * DAY }),
        thread({ id: "d", updatedAt: 4 * DAY }),
      ],
      "group",
      withGroups,
    );
    expect(columns.map((column) => [column.label, column.threads.length])).toEqual([
      ["Auth rework", 2],
      ["No group", 1],
      ["Search v2", 1],
    ]);
  });

  it("recency grouping buckets every thread by age", () => {
    expect(columnFor(thread({ updatedAt: NOW - 2 * HOUR }), "recency", context, NOW).id).toBe("today");
    expect(columnFor(thread({ updatedAt: NOW - 2 * DAY }), "recency", context, NOW).id).toBe("earlier");
  });
});

describe("GROUP_BY_OPTIONS", () => {
  it("labels the attention-priority grouping Focus, not Attention or State", () => {
    // The stored value stays "status": the grouping orders by claim on your
    // attention as before. "Focus" is the board's name now (the operator's
    // rename); "Attention" keeps its job naming the thread state, and "State"
    // stays the filter's word for what a thread is.
    expect(GROUP_BY_OPTIONS.find((option) => option.value === "status")?.label).toBe("Focus");
  });

  it("labels the feature-group grouping Group", () => {
    expect(GROUP_BY_OPTIONS.find((option) => option.value === "group")?.label).toBe("Group");
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

describe("filterProjectsWithoutLane (the board's hide-a-lane gesture)", () => {
  it("from no selection (all projects), hiding becomes the other known projects", () => {
    const next = filterProjectsWithoutLane(new Set(), ["p_a", "p_b", "p_c"], "p_b");
    if (next.kind !== "hidden") throw new Error(`expected hidden, got ${next.kind}`);
    expect(next.next).toEqual(new Set(["p_a", "p_c"]));
  });

  it("from a multi-project selection, the lane's project leaves the set", () => {
    const next = filterProjectsWithoutLane(new Set(["p_a", "p_b"]), ["p_a", "p_b", "p_c"], "p_b");
    if (next.kind !== "hidden") throw new Error(`expected hidden, got ${next.kind}`);
    expect(next.next).toEqual(new Set(["p_a"]));
  });

  it("hiding the only SELECTED lane adds every other known project instead (the empty set cannot mean 'none')", () => {
    // The empty set shows ALL projects, so unchecking the only checked
    // project in the menu would re-show everything. The gesture writes the
    // menu state the intent means: every other project checked, this one out.
    const next = filterProjectsWithoutLane(new Set(["p_b"]), ["p_a", "p_b"], "p_b");
    if (next.kind !== "hidden") throw new Error(`expected hidden, got ${next.kind}`);
    expect(next.next).toEqual(new Set(["p_a"]));
  });

  it("hiding the board's ONLY project is refused — an empty result would show everything, the opposite", () => {
    const refused = filterProjectsWithoutLane(new Set(), ["p_b"], "p_b");
    expect(refused).toEqual({ kind: "refused", reason: "sole-lane" });
    const refusedSelected = filterProjectsWithoutLane(new Set(["p_b"]), ["p_b"], "p_b");
    expect(refusedSelected).toEqual({ kind: "refused", reason: "sole-lane" });
  });

  it("hiding a project whose lane already sits outside the selection is refused — nothing to write", () => {
    // Reachable through box overrides: a project column may stand on the
    // Project board while the filter excludes its project.
    const refused = filterProjectsWithoutLane(new Set(["p_a"]), ["p_a", "p_b"], "p_b");
    expect(refused).toEqual({ kind: "refused", reason: "outside-filter" });
  });
});