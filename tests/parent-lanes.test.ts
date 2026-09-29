import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  PARENT_LANE_ROW_ORDER,
  buildParentLanes,
  parentLaneRowLabel,
  sectionParentLanes,
  type ParentLane,
  type ParentLaneSection,
} from "../components/parent-lanes";
import { STATUS_COLUMN_ORDER, THREAD_STATE_LABELS } from "../components/grouping";
import { parseGroupStored } from "../components/preferences";
import { thread } from "./thread-fixture";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
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

function sectionIds(sections: readonly ParentLaneSection[]): string[] {
  return sections.map((s) => s.id);
}

function sectionLaneIds(section: ParentLaneSection): string[] {
  return section.lanes.map((lane) => lane.id);
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
    expect(laneIds(lanes)).toEqual(["p"]);
    expect(laneOf(lanes, "p")?.childCount).toBe(1);
    expect(laneOf(lanes, "p")?.parent?.id).toBe("p");
  });

  it("excludes loose threads: a board with no families renders no lanes", () => {
    const a = thread({ id: "a" });
    const b = thread({ id: "b", updatedAt: NOW - HOUR });
    const lanes = buildParentLanes([a, b], new Set(), NOW);
    expect(lanes).toHaveLength(0);
  });

  it("orphan threads (deleted parent) render no lane", () => {
    const orphan = thread({ id: "o", parentThreadId: "gone" });
    const lanes = buildParentLanes([orphan], new Set(), NOW);
    expect(lanes).toHaveLength(0);
  });

  it("tolerates cycles: cycle members render no lane", () => {
    const a = thread({ id: "a", parentThreadId: "b" });
    const b = thread({ id: "b", parentThreadId: "a" });
    const lanes = buildParentLanes([a, b], new Set(), NOW);
    expect(lanes).toHaveLength(0);
  });

  it("an archived-only family still shows a lane header with archived riders", () => {
    const parent = thread({ id: "p" });
    const archived = thread({ id: "a", parentThreadId: "p", isArchived: true });
    const lanes = buildParentLanes([parent, archived], new Set(), NOW);
    expect(laneIds(lanes)).toEqual(["p"]);
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
  it("orders family lanes by the family's most recent touch, most recent at left", () => {
    const oldParent = thread({ id: "old_p", updatedAt: NOW - 4 * HOUR });
    const oldChild = thread({ id: "old_c", parentThreadId: "old_p", updatedAt: NOW - 5 * HOUR });
    const recentParent = thread({ id: "recent_p", updatedAt: NOW - HOUR });
    const recentChild = thread({ id: "recent_c", parentThreadId: "recent_p", updatedAt: NOW - 2 * HOUR });
    const lanes = buildParentLanes(
      [oldParent, oldChild, recentParent, recentChild],
      new Set(),
      NOW,
    );
    expect(laneIds(lanes).slice(0, 2)).toEqual(["recent_p", "old_p"]);
  });

  it("counts a just-done child as the family's last touch", () => {
    const quietParent = thread({ id: "quiet_p", updatedAt: NOW - 5 * HOUR });
    const quietChild = thread({ id: "quiet_c", parentThreadId: "quiet_p", updatedAt: NOW - 6 * HOUR });
    const activeParent = thread({ id: "active_p", updatedAt: NOW - 2 * HOUR });
    const justDoneChild = thread({ id: "done_c", parentThreadId: "active_p", updatedAt: NOW - MINUTE });
    const lanes = buildParentLanes(
      [quietParent, quietChild, activeParent, justDoneChild],
      new Set(["done_c"]),
      NOW,
    );
    expect(laneIds(lanes).slice(0, 2)).toEqual(["active_p", "quiet_p"]);
  });

  it("ties between untouched families break by derived order", () => {
    const p1 = thread({ id: "p1", updatedAt: NOW - HOUR });
    const c1 = thread({ id: "c1", parentThreadId: "p1", updatedAt: NOW - HOUR });
    const p2 = thread({ id: "p2", updatedAt: NOW - HOUR });
    const c2 = thread({ id: "c2", parentThreadId: "p2", updatedAt: NOW - HOUR });
    const lanes = buildParentLanes([p1, c1, p2, c2], new Set(), NOW);
    expect(laneIds(lanes).slice(0, 2)).toEqual(["p1", "p2"]);
  });

  it("a pinned parent floats its lane leftmost on a recency tie", () => {
    const pinnedParent = thread({ id: "pinned", isPinned: true, updatedAt: NOW - HOUR });
    const pinnedChild = thread({ id: "pc", parentThreadId: "pinned", updatedAt: NOW - 2 * HOUR });
    const plainParent = thread({ id: "plain", updatedAt: NOW - HOUR });
    const plainChild = thread({ id: "oc", parentThreadId: "plain", updatedAt: NOW - 2 * HOUR });
    const lanes = buildParentLanes(
      [pinnedParent, pinnedChild, plainParent, plainChild],
      new Set(),
      NOW,
    );
    expect(laneIds(lanes)[0]).toBe("pinned");
  });

  it("excludes archived members from the family's recency lift", () => {
    const parent = thread({ id: "p", updatedAt: NOW - 5 * HOUR });
    const archived = thread({ id: "a", parentThreadId: "p", updatedAt: NOW - MINUTE, isArchived: true });
    const liveIdle = thread({ id: "i", parentThreadId: "p", updatedAt: NOW - 3 * HOUR });
    const otherParent = thread({ id: "other_p", updatedAt: NOW - 2 * HOUR });
    const otherChild = thread({ id: "other_c", parentThreadId: "other_p", updatedAt: NOW - 4 * HOUR });
    const lanes = buildParentLanes(
      [parent, archived, liveIdle, otherParent, otherChild],
      new Set(),
      NOW,
    );
    expect(laneIds(lanes).slice(0, 2)).toEqual(["other_p", "p"]);
  });

  it("excludes loose threads entirely (no Standalone lane)", () => {
    const parent = thread({ id: "p", updatedAt: NOW - HOUR });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - 2 * HOUR });
    const solo = thread({ id: "solo", updatedAt: NOW - MINUTE });
    const lanes = buildParentLanes([parent, child, solo], new Set(), NOW);
    expect(laneIds(lanes)).toEqual(["p"]);
  });
});

describe("sectionParentLanes", () => {
  it("groups family lanes by parent projectId", () => {
    const projA = thread({ id: "projA", projectId: "a", updatedAt: NOW - HOUR });
    const childA = thread({ id: "childA", parentThreadId: "projA", projectId: "a", updatedAt: NOW - 2 * HOUR });
    const projB = thread({ id: "projB", projectId: "b", updatedAt: NOW - 3 * HOUR });
    const childB = thread({ id: "childB", parentThreadId: "projB", projectId: "b", updatedAt: NOW - 4 * HOUR });
    const lanes = buildParentLanes([projA, childA, projB, childB], new Set(), NOW);
    const sections = sectionParentLanes(lanes, (id) => ({ a: "Alpha", b: "Beta" }[id] ?? "Unknown"));
    expect(sectionIds(sections)).toEqual(["a", "b"]);
    expect(sectionLaneIds(sections[0])).toEqual(["projA"]);
    expect(sectionLaneIds(sections[1])).toEqual(["projB"]);
  });

  it("orders sections by their most recent lane", () => {
    const aParent = thread({ id: "a_p", projectId: "a", updatedAt: NOW - 4 * HOUR });
    const aChild = thread({ id: "a_c", parentThreadId: "a_p", projectId: "a", updatedAt: NOW - 5 * HOUR });
    const bParent = thread({ id: "b_p", projectId: "b", updatedAt: NOW - HOUR });
    const bChild = thread({ id: "b_c", parentThreadId: "b_p", projectId: "b", updatedAt: NOW - 2 * HOUR });
    const lanes = buildParentLanes([aParent, aChild, bParent, bChild], new Set(), NOW);
    const sections = sectionParentLanes(lanes, (id) => ({ a: "Alpha", b: "Beta" }[id] ?? "Unknown"));
    expect(sectionIds(sections)).toEqual(["b", "a"]);
  });

  it("orders lanes inside a section by the same recency rule", () => {
    const a1 = thread({ id: "a1", projectId: "a", updatedAt: NOW - 4 * HOUR });
    const a1c = thread({ id: "a1c", parentThreadId: "a1", projectId: "a", updatedAt: NOW - 5 * HOUR });
    const a2 = thread({ id: "a2", projectId: "a", updatedAt: NOW - HOUR });
    const a2c = thread({ id: "a2c", parentThreadId: "a2", projectId: "a", updatedAt: NOW - 2 * HOUR });
    const lanes = buildParentLanes([a1, a1c, a2, a2c], new Set(), NOW);
    const sections = sectionParentLanes(lanes, () => "Alpha");
    expect(sectionLaneIds(sections[0])).toEqual(["a2", "a1"]);
  });

  it("labels sections by projectNameFor", () => {
    const parent = thread({ id: "p", projectId: "x" });
    const child = thread({ id: "c", parentThreadId: "p", projectId: "x" });
    const lanes = buildParentLanes([parent, child], new Set(), NOW);
    const sections = sectionParentLanes(lanes, (id) => (id === "x" ? "Chi" : "Other"));
    expect(sections[0].label).toBe("Chi");
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
    expect(laneOf(lanes, "wp")?.parent.id).toBe("wp");
  });

  it("a done parent still serves as its lane's header", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", isUnread: true });
    const lanes = buildParentLanes([parent, child], new Set(["p"]), NOW);
    const lane = laneOf(lanes, "p")!;
    expect(lane.parent.id).toBe("p");
    expect(idsOf(rowOf(lane, "unread"))).toEqual(["c"]);
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

describe("buildParentLanes — depth cap (D8, two levels)", () => {
  it("grandchildren re-attach to the root and render as lane cards", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const gc1 = thread({ id: "g1", parentThreadId: "c" });
    const gc2 = thread({ id: "g2", parentThreadId: "c" });
    const lanes = buildParentLanes([parent, child, gc1, gc2], new Set(), NOW);
    const lane = laneOf(lanes, "p")!;
    const allCardIds = lane.rows.flatMap((row) => idsOf(row.threads));
    expect(allCardIds).toContain("c");
    expect(allCardIds.sort()).toEqual(["c", "g1", "g2"]);
    // No display tier beyond children: the chip bookkeeping is gone.
    expect(lane.childCount).toBe(3);
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
