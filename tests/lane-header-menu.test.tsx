// @vitest-environment jsdom
// The per-lane header menu (ruling dl-20261105T165850-324f). The old
// sort-order marker is gone — its information moved into the menu — so an
// ordered lane no longer shows the SortingOneNine glyph, and the lane's
// sweep affordance on the header is eligibility-plus-count: the pill only
// rides a lane that has eligible cards (or an armed/run state), while manual
// sweeping entered through the menu itself. Clicking a lane header opens the
// menu with the lane's sort state, the remove-custom-order write, and the
// sweep entry, guarded against opening mid-touch-drag.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import type { RankStore } from "../lib/rank";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: PluginSidebarThread[],
  overrides: Partial<BoardProps> = {},
) {
  const doneIds = new Set(
    threads.filter((candidate) => candidate.id.startsWith("thr_d")).map((candidate) => candidate.id),
  );
  const rankStore = (overrides.rankStore ?? {}) as RankStore;
  const props = {
    columns: buildColumns(
      threads,
      "status",
      context,
      new Map(),
      doneIds,
      NOW,
      rankStore,
    ),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds,
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    childCountByParent: new Map<string, number>(),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return { props, ...render(<Board {...props} />) };
}

function unreadThread(id: string, hoursAgo: number): PluginSidebarThread {
  return thread({ id, isUnread: true, updatedAt: NOW - hoursAgo * 3_600_000 });
}

function doneThread(id: string, hoursAgo: number): PluginSidebarThread {
  return thread({ id, updatedAt: NOW - hoursAgo * 3_600_000 });
}

const twoUnread = [unreadThread("thr_u1", 1), unreadThread("thr_u2", 2)];

function laneHeader(columnId: string): HTMLElement {
  const section = document.querySelector<HTMLElement>(`section[data-column-id="${columnId}"]`);
  if (section === null) throw new Error(`no lane ${columnId}`);
  const header = section.querySelector<HTMLElement>(":scope > header");
  if (header === null) throw new Error(`no header in ${columnId}`);
  return header;
}

function laneMenuTrigger(columnId: string): HTMLElement {
  const header = laneHeader(columnId);
  const trigger = header.querySelector<HTMLElement>("button[data-lane-menu-trigger]");
  if (trigger === null) throw new Error(`no lane menu trigger in ${columnId}`);
  return trigger;
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

describe("lane header: sort-order marker retired", () => {
  it("no lane carries the marker, ordered or not", () => {
    const rankStore: RankStore = { "status:unread": ["thr_u2"] };
    renderBoard(twoUnread, { rankStore, onRankMove: vi.fn() });
    expect(
      document.querySelectorAll('[aria-label="Ordered by you, not by recency"]').length,
    ).toBe(0);
    // The ordered state itself is still on record for the menu (and any
    // harness reading it) — only the glyph is gone.
    const unread = document.querySelector('section[data-column-id="unread"]');
    expect(unread?.getAttribute("data-column-ordered")).toBe("true");
  });
});

describe("lane header: the per-lane menu", () => {
  it("every lane carries the card idiom's 3-dot trigger, left of its label", () => {
    renderBoard(twoUnread);
    for (const columnId of ["unread", "working"]) {
      const section = document.querySelector(`section[data-column-id="${columnId}"]`);
      const trigger = section?.querySelector("header button[data-lane-menu-trigger]");
      expect(trigger).not.toBeNull();
      expect(trigger?.getAttribute("aria-label")).toBe(
        columnId === "unread" ? "Unread lane actions" : "Working lane actions",
      );
      // Left of the label: the trigger's next element sibling is the heading.
      expect(trigger?.nextElementSibling?.tagName).toBe("H3");
    }
  });

  it("opens on the trigger's click and shows the lane's sort state", () => {
    const rankStore: RankStore = { "status:unread": ["thr_u2"] };
    renderBoard(twoUnread, { rankStore, onRankMove: vi.fn() });
    fireEvent.click(laneMenuTrigger("unread"));
    const menu = screen.getByRole("menu", { name: "Lane actions" });
    const sortRow = menu.querySelector("[data-lane-sort-state]");
    expect(sortRow?.getAttribute("data-lane-sort-state")).toBe("yours");
    expect(sortRow?.textContent).toContain("your order");
  });

  it("a bare click on the header itself opens nothing — the 3-dot trigger owns the affordance", () => {
    renderBoard(twoUnread);
    fireEvent.click(laneHeader("unread"));
    expect(screen.queryByRole("menu", { name: "Lane actions" })).toBeNull();
  });

  it("an unranked lane's menu shows recency and its direction", () => {
    renderBoard(twoUnread);
    fireEvent.click(laneMenuTrigger("unread"));
    const menu = screen.getByRole("menu", { name: "Lane actions" });
    const sortRow = menu.querySelector("[data-lane-sort-state]");
    expect(sortRow?.getAttribute("data-lane-sort-state")).toBe("recency");
    expect(sortRow?.textContent).toContain("newest first");
  });

  it("the sort section carries the direction pair, the active one checked", () => {
    renderBoard(twoUnread, { onLaneOrderDirection: vi.fn() });
    fireEvent.click(laneMenuTrigger("unread"));
    const newest = screen.getByRole("menuitemradio", { name: "Newest first" });
    const oldest = screen.getByRole("menuitemradio", { name: "Oldest first" });
    expect(newest.getAttribute("aria-checked")).toBe("true");
    expect(oldest.getAttribute("aria-checked")).toBe("false");
  });

  it("picking a direction without a wired write renders no dead pair", () => {
    renderBoard(twoUnread);
    fireEvent.click(laneMenuTrigger("unread"));
    expect(screen.queryByRole("menuitemradio", { name: "Newest first" })).toBeNull();
    expect(screen.queryByRole("menuitemradio", { name: "Oldest first" })).toBeNull();
  });

  it("picking Oldest first writes the lane's direction and closes", () => {
    const onLaneOrderDirection = vi.fn();
    renderBoard(twoUnread, { onLaneOrderDirection });
    fireEvent.click(laneMenuTrigger("unread"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }));
    expect(onLaneOrderDirection).toHaveBeenCalledWith("status:unread", "oldest-first");
    expect(screen.queryByRole("menu", { name: "Lane actions" })).toBeNull();
  });

  it("a lane sorted oldest-first has the toggle checked on the other side", () => {
    renderBoard(twoUnread, {
      laneOrderDirections: { "status:unread": "oldest-first" },
      onLaneOrderDirection: vi.fn(),
    });
    fireEvent.click(laneMenuTrigger("unread"));
    const newest = screen.getByRole("menuitemradio", { name: "Newest first" });
    const oldest = screen.getByRole("menuitemradio", { name: "Oldest first" });
    expect(newest.getAttribute("aria-checked")).toBe("false");
    expect(oldest.getAttribute("aria-checked")).toBe("true");
  });

  it("Remove custom order performs the clear write and closes the menu", () => {
    const onRankClear = vi.fn();
    const rankStore: RankStore = { "status:unread": ["thr_u2"] };
    renderBoard(twoUnread, {
      rankStore,
      onRankMove: vi.fn(),
      onRankClear,
    });
    fireEvent.click(laneMenuTrigger("unread"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove custom order" }));
    expect(onRankClear).toHaveBeenCalledWith("status:unread", ["thr_u2", "thr_u1"]);
    expect(screen.queryByRole("menu", { name: "Lane actions" })).toBeNull();
  });

  it("an unranked lane offers no remove entry", () => {
    renderBoard(twoUnread, { onRankClear: vi.fn() });
    fireEvent.click(laneMenuTrigger("unread"));
    expect(screen.queryByRole("menuitem", { name: "Remove custom order" })).toBeNull();
  });

  it("a click while a touch drag is armed never opens the menu", () => {
    renderBoard(twoUnread);
    const armed = document.createElement("div");
    armed.setAttribute("data-touch-drag-armed", "thr_u1");
    document.body.append(armed);
    try {
      fireEvent.click(laneMenuTrigger("unread"));
      expect(screen.queryByRole("menu", { name: "Lane actions" })).toBeNull();
    } finally {
      armed.remove();
    }
  });
});

describe("lane header: the sweep pill is eligibility plus count", () => {
  const sweepWiring = {
    sweepCandidatesFor: (columnId: string) => (columnId === "unread" ? ["thr_u1"] : []),
    onSweepArm: vi.fn(),
    onSweepConfirm: vi.fn(),
  };

  it("a lane with eligible cards keeps the pill and its count", () => {
    renderBoard(twoUnread, {
      ...sweepWiring,
      sweepCandidatesFor: () => ["thr_u1", "thr_u2"],
    });
    const pill = laneHeader("unread").querySelector("[data-sweep-button]");
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain("2");
  });

  it("a sweepable lane with nothing eligible shows no pill at all", () => {
    renderBoard(twoUnread, {
      ...sweepWiring,
      sweepCandidatesFor: () => [],
    });
    expect(laneHeader("unread").querySelector("[data-sweep-button]")).toBeNull();
  });

  it("an armed mode keeps the pill even when its live selection is empty", () => {
    renderBoard(twoUnread, {
      ...sweepWiring,
      sweepCandidatesFor: () => [],
      armedSweep: { columnId: "unread", threadIds: [] },
    });
    const pill = laneHeader("unread").querySelector("[data-sweep-button]");
    expect(pill).not.toBeNull();
    expect((pill as HTMLButtonElement).disabled).toBe(true);
  });

  it("the menu's sweep entry arms the lane — the write the old icon made", () => {
    const onSweepArm = vi.fn();
    renderBoard(twoUnread, {
      ...sweepWiring,
      sweepCandidatesFor: () => [],
      onSweepArm,
    });
    fireEvent.click(laneMenuTrigger("unread"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sweep this lane…" }));
    expect(onSweepArm).toHaveBeenCalledWith("unread");
  });

  it("a lane that cannot sweep offers no sweep entry", () => {
    renderBoard([...twoUnread, doneThread("thr_n1", 1)], {
      onSweepArm: vi.fn(),
    });
    fireEvent.click(laneHeader("working"));
    expect(screen.queryByRole("menuitem", { name: "Sweep this lane…" })).toBeNull();
  });
});
