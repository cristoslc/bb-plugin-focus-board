import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  PARENT_LANE_ROW_ORDER,
  buildParentLanes,
  parentLaneRowLabel,
  type ParentLane,
} from "../components/parent-lanes";
import { STATUS_COLUMN_ORDER, THREAD_STATE_LABELS } from "../components/grouping";
import { grandchildCountFor } from "../components/nesting";
import { parseGroupStored } from "../components/preferences";
import { thread } from "./thread-fixture";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

function laneIds(lanes: readonly ParentLane[]): string[] {
  return lanes.map((lane) => lane.id);
}

function laneOf(lanes: readonly ParentLane[], id: string): ParentLane | undefined {
  return lanes.find((lane) => lane.id === id);
}

function rowIdsOf(lane: ParentLane): string[] {
  return lane.rows.map((row) => row.id);
}

function rowOf(lane: ParentLane, id: string): PluginSidebarThread[] | undefined {
  return lane.rows.find((row) => row.id === id)?.threads;
}

function idsOf(threads: readonly PluginSidebarThread[] | undefined): string[] {
  return (threads ?? []).map((t) => t.id);
}

describe("PARENT_LANE_ROW_ORDER and labels", () => {
  it("transposes STATUS_COLUMN_ORDER with Done appended at the bottom", () => {
    expect(PARENT_LANE_ROW_ORDER).toEqual([
      ...STATUS_COLUMN_ORDER,
      "done",
    ]);
  });

  it("labels every row id, mirroring the Attention column labels", () => {
    expect(parentLaneRowLabel("attention")).toBe(THREAD_STATE_LABELS.attention);
    expect(parentLaneRowLabel("unread")).toBe(THREAD_STATE_LABELS.unread);
    expect(parentLaneRowLabel("working")).toBe(THREAD_STATE_LABELS.working);
    expect(parentLaneRowLabel("idle-recent")).toBe("Idle · Recent");
    expect(parentLaneRowLabel("idle-today")).toBe("Idle · Today");
    expect(parentLaneRowLabel("idle-earlier")).toBe("Idle · Earlier");
    expect(parentLaneRowLabel("idle-awhile")).toBe("Idle · A while ago");
    expect(parentLaneRowLabel("done")).toBe("Done");
  });
});

describe("buildParentLanes — lane building", () => {
  it("creates one lane per parent with visible children", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const lanes = buildParentLanes([parent, child], new Set(), NOW);
    expect(laneIds(lanes)).toEqual(["p", "standalone"]);
    expect(laneOf(lanes, "p")?.childCount).toBe(1);
    expect(laneOf(lanes, "p")?.headerThread?.id).toBe("p");
  });

  it("a board with no families renders a single Standalone lane with the row ladder", () => {
    const a = thread({ id: "a" });
    const b = thread({ id: "b", updatedAt: NOW - HOUR });
    const lanes = buildParentLanes([a, b], new Set(), NOW);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe("standalone");
    expect(lanes[0].parent).toBeNull();
    expect(idsOf(rowOf(lanes[0], "idle-awhile"))).toContain("a");
    expect(idsOf(rowOf(lanes[0], "idle-today"))).toContain("b");
  });


  it("puts orphans (deleted parent) in Standalone", () => {
    const orphan = thread({ id: "o", parentThreadId: "gone" });
    const lanes = buildParentLanes([orphan], new Set(), NOW);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe("standalone");
    expect(idsOf(rowOf(lanes[0], "idle-awhile"))).toContain("o");
  });

  it("tolerates cycles: cycle members become standalone roots", () => {
    const a = thread({ id: "a", parentThreadId: "b" });
    const b = thread({ id: "b", parentThreadId: "a" });
    const lanes = buildParentLanes([a, b], new Set(), NOW);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe("standalone");
    const ids = idsOf(lanes[0].rows.flatMap((row) => row.threads));
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });

  it("an archived-only family still shows a lane header with archived riders", () => {
    const parent = thread({ id: "p" });
    const archived = thread({ id: "a", parentThreadId: "p", isArchived: true });
    const lanes = buildParentLanes([parent, archived], new Set(), NOW);
    expect(laneIds(lanes)).toEqual(["p", "standalone"]);
    const lane = laneOf(lanes, "p")!;
    expect(lane.childCount).toBe(1);
    expect(idsOf(lane.archivedChildren)).toEqual(["a"]);
    expect(lane.rows.every((row) => row.threads.length === 0)).toBe(true);
  });
});

describe("buildParentLanes — row placement", () => {
  it("places children in the row of their own state, including idle buckets", () => {
    const parent = thread({ id: "p" });
    const attention = thread({ id: "att", parentThreadId: "p", hasPendingInteraction: true });
    const working = thread({ id: "work", parentThreadId: "p", status: "active" });
    const recent = thread({ id: "recent", parentThreadId: "p", updatedAt: NOW - 30 * 60 * 1000 });
    const today = thread({ id: "today", parentThreadId: "p", updatedAt: NOW - 3 * HOUR });
    const earlier = thread({ id: "earlier", parentThreadId: "p", updatedAt: NOW - 2 * DAY });
    const awhile = thread({ id: "awhile", parentThreadId: "p", updatedAt: NOW - 8 * DAY });
    const lanes = buildParentLanes(
      [parent, attention, working, recent, today, earlier, awhile],
      new Set(),
      NOW,
    );
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "attention"))).toEqual(["att"]);
    expect(idsOf(rowOf(lane, "working"))).toEqual(["work"]);
    expect(idsOf(rowOf(lane, "idle-recent"))).toEqual(["recent"]);
    expect(idsOf(rowOf(lane, "idle-today"))).toEqual(["today"]);
    expect(idsOf(rowOf(lane, "idle-earlier"))).toEqual(["earlier"]);
    expect(idsOf(rowOf(lane, "idle-awhile"))).toEqual(["awhile"]);
  });

  it("places Done children in the bottom Done row", () => {
    const parent = thread({ id: "p" });
    const live = thread({ id: "live", parentThreadId: "p", isUnread: true });
    const done = thread({ id: "done_child", parentThreadId: "p" });
    const doneIds = new Set(["done_child"]);
    const lanes = buildParentLanes([parent, live, done], doneIds, NOW);
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "unread"))).toEqual(["live"]);
    expect(idsOf(rowOf(lane, "done"))).toEqual(["done_child"]);
  });

  it("moves a card between rows when its state changes", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const unread = { ...child, isUnread: true };
    const idleLane = buildParentLanes([parent, child], new Set(), NOW);
    const unreadLane = buildParentLanes([parent, unread], new Set(), NOW);
    expect(idsOf(rowOf(laneOf(idleLane, "p")!, "idle-today"))).toEqual(["c"]);
    expect(idsOf(rowOf(laneOf(unreadLane, "p")!, "unread"))).toEqual(["c"]);
    expect(rowOf(laneOf(unreadLane, "p")!, "idle-today")?.length).toBe(0);
  });
});

describe("buildParentLanes — lane order", () => {
  it("orders lanes by the family's most attention-requiring live member", () => {
    const idleParent = thread({ id: "idle_p" });
    const idleChild = thread({ id: "idle_c", parentThreadId: "idle_p", updatedAt: NOW - HOUR });
    const attentionParent = thread({ id: "att_p" });
    const attentionChild = thread({ id: "att_c", parentThreadId: "att_p", hasPendingInteraction: true });
    const lanes = buildParentLanes(
      [idleParent, idleChild, attentionParent, attentionChild],
      new Set(),
      NOW,
    );
    expect(laneIds(lanes).slice(0, 2)).toEqual(["att_p", "idle_p"]);
  });

  it("ties between all-idle families break by derived order", () => {
    const p1 = thread({ id: "p1", updatedAt: NOW - HOUR });
    const c1 = thread({ id: "c1", parentThreadId: "p1", updatedAt: NOW - 2 * HOUR });
    const p2 = thread({ id: "p2", updatedAt: NOW - 3 * HOUR });
    const c2 = thread({ id: "c2", parentThreadId: "p2", updatedAt: NOW - 4 * HOUR });
    const lanes = buildParentLanes([p1, c1, p2, c2], new Set(), NOW);
    expect(laneIds(lanes).slice(0, 2)).toEqual(["p1", "p2"]);
  });

  it("a pinned parent floats its lane leftmost on a tie", () => {
    const pinnedParent = thread({ id: "pinned", isPinned: true, updatedAt: NOW - HOUR });
    const pinnedChild = thread({ id: "pc", parentThreadId: "pinned", updatedAt: NOW - 2 * HOUR });
    const plainParent = thread({ id: "plain", updatedAt: NOW - 3 * HOUR });
    const plainChild = thread({ id: "oc", parentThreadId: "plain", updatedAt: NOW - 4 * HOUR });
    const lanes = buildParentLanes(
      [pinnedParent, pinnedChild, plainParent, plainChild],
      new Set(),
      NOW,
    );
    expect(laneIds(lanes)[0]).toBe("pinned");
  });

  it("excludes archived and done members from the lane lift", () => {
    const parent = thread({ id: "p" });
    const archived = thread({ id: "a", parentThreadId: "p", hasPendingInteraction: true, isArchived: true });
    const done = thread({ id: "d", parentThreadId: "p", hasPendingInteraction: true });
    const liveIdle = thread({ id: "i", parentThreadId: "p", updatedAt: NOW - HOUR });
    const lanes = buildParentLanes(
      [parent, archived, done, liveIdle],
      new Set(["d"]),
      NOW,
    );
    const lane = laneOf(lanes, "p")!;
    expect(rowIdsOf(lane)).toContain("idle-today");
    expect(idsOf(rowOf(lane, "idle-today"))).toEqual(["i"]);
  });
});

describe("buildParentLanes — cell order", () => {
  it("floats urgent (attention) children to the top of a row", () => {
    const parent = thread({ id: "p" });
    const urgent = thread({ id: "urgent", parentThreadId: "p", hasPendingInteraction: true });
    const unread = thread({ id: "unread", parentThreadId: "p", isUnread: true });
    const idle = thread({ id: "idle", parentThreadId: "p", updatedAt: NOW - HOUR });
    const lanes = buildParentLanes([parent, urgent, unread, idle], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "attention"))).toEqual(["urgent"]);
    expect(idsOf(rowOf(lane, "unread"))).toEqual(["unread"]);
  });

  it("sorts non-urgent children by the derived order (pinned first, newest first)", () => {
    const parent = thread({ id: "p" });
    const older = thread({ id: "older", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const newer = thread({ id: "newer", parentThreadId: "p", updatedAt: NOW - HOUR });
    const pinned = thread({ id: "pinned", parentThreadId: "p", isPinned: true, updatedAt: NOW - 3 * HOUR });
    const lanes = buildParentLanes([parent, older, newer, pinned], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "idle-today"))).toEqual(["pinned", "newer", "older"]);
  });

  it("ignores stored column ranks; order stays urgent-then-derived", () => {
    const parent = thread({ id: "p" });
    const a = thread({ id: "a", parentThreadId: "p", updatedAt: NOW - HOUR });
    const b = thread({ id: "b", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const lanes = buildParentLanes([parent, a, b], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "idle-today"))).toEqual(["a", "b"]);
  });
});

describe("buildParentLanes — header facts", () => {
  it("child-count chip counts every child, archived included", () => {
    const parent = thread({ id: "p" });
    const live = thread({ id: "live", parentThreadId: "p" });
    const archived = thread({ id: "arch", parentThreadId: "p", isArchived: true });
    const lanes = buildParentLanes([parent, live, archived], new Set(), NOW);
    expect(laneOf(lanes, "p")?.childCount).toBe(2);
  });

  it("state dot is driven by the parent thread's own state", () => {
    const workingParent = thread({ id: "wp", status: "active" });
    const child = thread({ id: "c", parentThreadId: "wp" });
    const lanes = buildParentLanes([workingParent, child], new Set(), NOW);
    expect(laneOf(lanes, "wp")?.headerThread?.id).toBe("wp");
  });

  it("a done parent still serves as its lane's header", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true });
    const lanes = buildParentLanes([parent, child], new Set(["p"]), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(lane.headerThread?.id).toBe("p");
    expect(idsOf(rowOf(lane, "unread"))).toEqual(["c"]);
  });
});

describe("buildParentLanes — Standalone lane", () => {
  it("uses the same row ladder as family lanes", () => {
    const urgent = thread({ id: "urgent", hasPendingInteraction: true });
    const working = thread({ id: "working", status: "active" });
    const idle = thread({ id: "idle", updatedAt: NOW - HOUR });
    const lanes = buildParentLanes([urgent, working, idle], new Set(), NOW);
    const standalone = laneOf(lanes, "standalone")!;
    expect(idsOf(rowOf(standalone, "attention"))).toEqual(["urgent"]);
    expect(idsOf(rowOf(standalone, "working"))).toEqual(["working"]);
    expect(idsOf(rowOf(standalone, "idle-today"))).toEqual(["idle"]);
  });

  it("empty input still produces a single empty Standalone lane", () => {
    const lanes = buildParentLanes([], new Set(), NOW);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].id).toBe("standalone");
  });

  it("pinned standalone floats to the top of its in-lane cell", () => {
    const plain = thread({ id: "plain", updatedAt: NOW - HOUR });
    const pinned = thread({ id: "pinned", isPinned: true, updatedAt: NOW - 2 * HOUR });
    const lanes = buildParentLanes([plain, pinned], new Set(), NOW);
    const standalone = laneOf(lanes, "standalone")!;
    expect(idsOf(rowOf(standalone, "idle-today"))).toEqual(["pinned", "plain"]);
  });
});

describe("buildParentLanes — archived riders (D7)", () => {
  it("archived children render as riders under the family header", () => {
    const parent = thread({ id: "p" });
    const live = thread({ id: "live", parentThreadId: "p" });
    const archived = thread({ id: "arch", parentThreadId: "p", isArchived: true });
    const lanes = buildParentLanes([parent, live, archived], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "idle-awhile"))).toEqual(["live"]);
    expect(idsOf(lane.archivedChildren)).toEqual(["arch"]);
  });

  it("archived children never appear in a row cell", () => {
    const parent = thread({ id: "p" });
    const archived = thread({ id: "arch", parentThreadId: "p", isArchived: true });
    const lanes = buildParentLanes([parent, archived], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(lane.rows.every((row) => !idsOf(row.threads).includes("arch"))).toBe(true);
  });
});

describe("buildParentLanes — family filtering (D10)", () => {
  it("a matching child keeps the whole lane in the filtered input", () => {
    const parent = thread({ id: "p", displayTitle: "parent" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "target" });
    const lanes = buildParentLanes([parent, child], new Set(), NOW);
    expect(laneIds(lanes)).toContain("p");
  });

  it("a non-matching family is dropped from the filtered input", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const lanes = buildParentLanes([parent, child], new Set(), NOW);
    expect(laneIds(lanes)).toContain("p");
  });
});

describe("buildParentLanes — depth cap (D8)", () => {
  it("level-1 child carries a +N chip via grandchildCountFor", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const gc1 = thread({ id: "g1", parentThreadId: "c" });
    const gc2 = thread({ id: "g2", parentThreadId: "c" });
    const lanes = buildParentLanes([parent, child, gc1, gc2], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    const c = rowOf(lane, "idle-awhile")?.find((t) => t.id === "c")!;
    const familyIndex = { childrenByParent: new Map([["c", [gc1, gc2]]]), parentOf: new Map(), rootIds: new Set() };
    expect(grandchildCountFor(c, familyIndex.childrenByParent)).toBe(2);
  });

  it("grandchildren never render as lane cards", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const gc1 = thread({ id: "g1", parentThreadId: "c" });
    const lanes = buildParentLanes([parent, child, gc1], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    const allCardIds = lane.rows.flatMap((row) => idsOf(row.threads));
    expect(allCardIds).toContain("c");
    expect(allCardIds).not.toContain("g1");
  });
});

describe("buildParentLanes — Done row", () => {
  it("sorts the Done row newest-done first when doneTimes are provided", () => {
    const parent = thread({ id: "p" });
    const older = thread({ id: "older", parentThreadId: "p" });
    const newer = thread({ id: "newer", parentThreadId: "p" });
    const doneIds = new Set(["older", "newer"]);
    const doneTimes = new Map([
      ["older", NOW - 2 * DAY],
      ["newer", NOW - HOUR],
    ]);
    const lanes = buildParentLanes([parent, older, newer], doneIds, NOW, doneTimes);
    const lane = laneOf(lanes, "p")!;
    expect(idsOf(rowOf(lane, "done"))).toEqual(["newer", "older"]);
  });
});

describe("parseGroupStored (group-by persistence)", () => {
  it("round-trips the new 'parent' value", () => {
    expect(parseGroupStored("parent")).toBe("parent");
  });

  it("falls back to Attention for invalid or stale values", () => {
    expect(parseGroupStored(null)).toBe("status");
    expect(parseGroupStored("environment")).toBe("status");
    expect(parseGroupStored("")).toBe("status");
  });
});
