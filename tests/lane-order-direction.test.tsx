// @vitest-environment jsdom
// Per-lane sort direction (the ruling's amendment: sorting carries real
// actions, and ascending vs descending applies even where recency is the
// only dimension). The direction is a per-lane preference (newest first is
// the default; oldest-first is stored per columnRankKey), honored by column
// building AND by the nested families so a parent's rows never lie about
// their lane's order.
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  assembleBoard,
} from "../components/nesting";
import { buildColumns, derivedCompareForDirection } from "../components/grouping";
import {
  LANE_ORDER_DIRECTIONS_KEY,
  LaneOrderDirection,
  laneOrderDirectionsStoredValue,
  parseLaneOrderDirections,
} from "../components/preferences";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const HOUR = 3_600_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

function unread(id: string, hoursAgo: number, isPinned = false): PluginSidebarThread {
  return thread({ id, isUnread: true, isPinned, updatedAt: NOW - hoursAgo * HOUR });
}

const three = [unread("thr_old", 9), unread("thr_mid", 5), unread("thr_new", 1)];

function columnIds(columnId: string, columns: ReturnType<typeof buildColumns>): string[] {
  const column = columns.find((c) => c.id === columnId);
  if (column === undefined) throw new Error(`no column ${columnId}`);
  return column.threads.map((t) => t.id);
}

describe("derivedCompareForDirection", () => {
  it("pins still lead, then the direction runs the recency compare", () => {
    const pinnedOld = unread("thr_p_old", 9, true);
    const pinnedNew = unread("thr_p_new", 1, true);
    const cards = [pinnedOld, unread("thr_new", 1), unread("thr_old", 9), pinnedNew];
    const asc = [...cards].sort(derivedCompareForDirection("oldest-first"));
    expect(asc.map((t) => t.id)).toEqual(["thr_p_old", "thr_p_new", "thr_old", "thr_new"]);
    const desc = [...cards].sort(derivedCompareForDirection(undefined));
    expect(desc.map((t) => t.id)).toEqual(["thr_p_new", "thr_p_old", "thr_new", "thr_old"]);
  });
});

describe("buildColumns honors the per-lane direction", () => {
  it("an oldest-first lane reads oldest first while other lanes stay newest-first", () => {
    const columns = buildColumns(
      three,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      {},
      new Map(),
      new Map(),
      new Set(),
      { "status:unread": "oldest-first" },
    );
    expect(columnIds("unread", columns)).toEqual(["thr_old", "thr_mid", "thr_new"]);
  });

  it("a rank store still leads: ranked cards keep the hand order, the tail follows the direction", () => {
    const columns = buildColumns(
      three,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { "status:unread": ["thr_new"] },
      new Map(),
      new Map(),
      new Set(),
      { "status:unread": "oldest-first" },
    );
    expect(columnIds("unread", columns)).toEqual(["thr_new", "thr_old", "thr_mid"]);
  });

  it("the direction keys off the rank key, so the Pinned lane can point its own way", () => {
    const pinned = [unread("thr_p_old", 9, true), unread("thr_p_new", 1, true)];
    const columns = buildColumns(
      pinned,
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      {},
      new Map(),
      new Map(),
      new Set(),
      { pinned: "oldest-first" },
    );
    expect(columnIds("pinned", columns)).toEqual(["thr_p_old", "thr_p_new"]);
  });

  it("the Done lane's direction reads oldest-first when its key says so", () => {
    const done = [thread({ id: "thr_d_old", updatedAt: NOW - 9 * HOUR }), thread({ id: "thr_d_new", updatedAt: NOW - 1 * HOUR })];
    const columns = buildColumns(
      done,
      "status",
      context,
      new Map(),
      new Set(done.map((t) => t.id)),
      NOW,
      {},
      new Map(),
      new Map(),
      new Set(),
      { done: "oldest-first" },
    );
    expect(columnIds("done", columns)).toEqual(["thr_d_old", "thr_d_new"]);
  });
});

describe("assembleBoard honors the direction for nested families", () => {
  it("rows nested under a parent in an oldest-first lane read oldest first", () => {
    const parent = thread({ id: "thr_par", isUnread: true, updatedAt: NOW - 6 * HOUR });
    const childOld = thread({
      id: "thr_c_old",
      isUnread: true,
      parentThreadId: "thr_par",
      updatedAt: NOW - 9 * HOUR,
    });
    const childNew = thread({
      id: "thr_c_new",
      isUnread: true,
      parentThreadId: "thr_par",
      updatedAt: NOW - 2 * HOUR,
    });
    const assembly = assembleBoard([parent, childOld, childNew], "status", context, new Map(), new Set(), NOW, {
      nestingEnabled: true,
      laneOrderDirections: { "status:unread": "oldest-first" },
    });
    const rows = assembly.nestedChildrenByParent.get("thr_par") ?? [];
    expect(rows.map((t) => t.id)).toEqual(["thr_c_old", "thr_c_new"]);
  });
});

describe("the lane order direction preference", () => {
  it("round-trips a direction map and defaults clean on stale data", () => {
    const stored = laneOrderDirectionsStoredValue({
      "status:unread": "oldest-first",
      pinned: "oldest-first",
    });
    expect(JSON.parse(stored)).toEqual({
      "status:unread": "oldest-first",
      pinned: "oldest-first",
    });
    expect(parseLaneOrderDirections(stored)).toEqual({
      "status:unread": "oldest-first",
      pinned: "oldest-first",
    });
    expect(parseLaneOrderDirections(null)).toEqual({});
    expect(parseLaneOrderDirections("not json")).toEqual({});
    expect(parseLaneOrderDirections(JSON.stringify({ "status:unread": "upside-down" }))).toEqual({});
    expect(parseLaneOrderDirections(JSON.stringify(["a", "b"]))).toEqual({});
    // Non-string values and unknown directions never become preferences.
    expect(parseLaneOrderDirections(JSON.stringify({ done: 7 }))).toEqual({});
  });

  it("the storage key names the preference", () => {
    expect(LANE_ORDER_DIRECTIONS_KEY).toBe("focus-board:laneOrderDirections");
  });

  it("an empty map stores as an empty object, never nothing", () => {
    expect(laneOrderDirectionsStoredValue({} as Record<string, LaneOrderDirection>)).toBe("{}");
  });
});
