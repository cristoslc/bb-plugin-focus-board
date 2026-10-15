// The lane-move transport planner: the board diffs each commit's lane map
// against the previous one and plans a dissolve-wipe per relocated card.
// These tests pin the planner's rules on pure data (no rendering), so the
// board's only job is feeding it snapshots.
//
// @vitest-environment jsdom
// (jsdom for the one DOM test — firstRealCard's ghost skip; the rest is pure
// data and runs fine either way)
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  laneSignature,
  planLaneTransports,
  collapseRunTransports,
  runUnits,
  firstRealCard,
  insertGhostSlots,
  TRANSPORT_WIPE_OUT_MS,
  TRANSPORT_WIPE_IN_MS,
  TRANSPORT_COLLAPSE_MS,
  TRANSPORT_GROW_MS,
  TRANSPORT_EASE,
  TRANSPORT_GROW_EASE,
  arrivalGrowKeyframes,
  ghostCollapseKeyframes,
  wipeInKeyframes,
  wipeOutKeyframes,
  shimmerSparks,
  sparkKeyframes,
  TRANSPORT_BATCH_CAP,
  TRANSPORT_SPARK_COUNT,
  TRANSPORT_VARIANT,
  TRANSPORT_ZOOM_IN_EASE,
  TRANSPORT_ZOOM_IN_MS,
  TRANSPORT_ZOOM_MIN_SCALE,
  TRANSPORT_ZOOM_OUT_EASE,
  TRANSPORT_ZOOM_OUT_MS,
  transportPhasePlan,
  zoomInKeyframes,
  zoomOutKeyframes,
} from "../components/card-transport";
import { thread } from "./thread-fixture";

function columnOf(id: string, threads: readonly PluginSidebarThread[]) {
  return { id, label: id, threads, cards: [] };
}

/** A two-member box shared by both member threads (the GroupBoxMap shape). */
function groupBoxOf(...members: PluginSidebarThread[]) {
  const box = { groupId: "grp_1", name: "Feature", members };
  return new Map(members.map((member) => [member.id, box]));
}

function moveOf(
  threadId: string,
  fromIndex: number,
  fromColumnId: string,
  toColumnId: string,
) {
  return {
    threadId,
    thread: thread({ id: threadId, displayTitle: `${threadId} Before` }),
    fromColumnId,
    fromIndex,
    toColumnId,
  };
}

describe("laneSignature", () => {
  it("maps each thread id to its lane", () => {
    const a = thread({ id: "thr_a" });
    const signature = laneSignature([columnOf("unread", [a])]);
    expect(signature.get("thr_a")).toBe("unread");
  });

  it("joins a thread's lanes (Done projection renders the same id twice) sorted", () => {
    const a = thread({ id: "thr_a" });
    const signature = laneSignature([
      columnOf("unread", [a]),
      columnOf("done", [a]),
    ]);
    expect(signature.get("thr_a")).toBe("done|unread");
  });
});

describe("planLaneTransports", () => {
  const from = columnOf("unread", [thread({ id: "thr_a" }), thread({ id: "thr_b" })]);

  it("plans a move when a thread relocates from one lane to another", () => {
    const a = thread({ id: "thr_a" });
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map([["thr_a", thread({ id: "thr_a" })]]),
      [columnOf("pinned", [a])],
    );
    expect(moves.map((move) => move.threadId)).toEqual(["thr_a"]);
    expect(moves[0]).toMatchObject({
      fromColumnId: "unread",
      toColumnId: "pinned",
      fromIndex: 0,
    });
  });

  it("plans nothing when every thread kept its lane", () => {
    const a = thread({ id: "thr_a" });
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map([["thr_a", a]]),
      [columnOf("unread", [a])],
    );
    expect(moves).toEqual([]);
  });

  it("plans nothing for a brand-new card (no wipe-in without an old lane)", () => {
    const newcomer = thread({ id: "thr_new" });
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map(),
      [columnOf("unread", [...from.threads, newcomer])],
    );
    expect(moves).toEqual([]);
  });

  it("plans nothing when a card left the board entirely (no destination lane)", () => {
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map([["thr_b", thread({ id: "thr_b" })]]),
      [columnOf("unread", [thread({ id: "thr_b" })])],
    );
    expect(moves.map((move) => move.threadId)).toEqual([]);
  });

  it("plans nothing for multiplicity changes (a projection card gaining or losing its second lane)", () => {
    const a = thread({ id: "thr_a" });
    // Before: one lane. After: the same id in two lanes — a projection
    // card popped into existence, it did not move.
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [a])]),
      new Map([["thr_a", a]]),
      [columnOf("unread", [a]), columnOf("done", [a])],
    );
    expect(moves).toEqual([]);
    // And the reverse: a projection disappearing leaves the live card where
    // it was — the id's lane signature narrowed, nothing moved.
    const reverse = planLaneTransports(
      laneSignature([columnOf("unread", [a]), columnOf("done", [a])]),
      new Map([["thr_a", a]]),
      [columnOf("unread", [a])],
    );
    expect(reverse).toEqual([]);
  });

  it("reports the TRUE old slot index, read off the PREVIOUS columns even though the card already left the old lane", () => {
    const a = thread({ id: "thr_a" });
    const b = thread({ id: "thr_b" });
    const c = thread({ id: "thr_c" });
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [a, b, c])]),
      new Map([["thr_c", c]]),
      [columnOf("unread", [a, b]), columnOf("pinned", [c])],
      [columnOf("unread", [a, b, c])],
    );
    expect(moves.map((move) => move.threadId)).toEqual(["thr_c"]);
    expect(moves[0].fromIndex).toBe(2);
  });

  it("prefers the previous DISPLAYED order for the old slot: a gathered box member's ghost weaves at its rendered position", () => {
    // Raw old lane [a, b, x, c] with b and c grouped: the gather walk
    // pulls c's card into the frame at b's slot, so the lane rendered
    // [a, b, c, x]. Only a caller carrying that displayed order lets the
    // planner read c's true slot (2, not the raw 3).
    const a = thread({ id: "thr_a" });
    const b = thread({ id: "thr_b" });
    const c = thread({ id: "thr_c" });
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [a, b, c])]),
      new Map([["thr_c", c]]),
      [columnOf("unread", [a, b]), columnOf("pinned", [c])],
      [columnOf("unread", [a, b, c])],
      new Map([["unread", ["thr_a", "thr_b", "thr_c", "thr_x"]]]),
    );
    expect(moves[0].fromIndex).toBe(2);
    // A card the displayed order never held falls back to the raw slot
    // with the old clamp, so no ghost ever degrades to a skipped move.
    const fallback = planLaneTransports(
      laneSignature([columnOf("unread", [a, b, c])]),
      new Map([["thr_c", c]]),
      [columnOf("unread", [a, b]), columnOf("pinned", [c])],
      [columnOf("unread", [a, b, c])],
      new Map([["unread", ["thr_a", "thr_b"]]]),
    );
    expect(fallback[0].fromIndex).toBe(2);
  });

  it("reports the previous thread snapshot so the ghost renders pre-move visuals", () => {
    const before = thread({ id: "thr_a", displayTitle: "Before" });
    const after = thread({ id: "thr_a", displayTitle: "After" });
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [before])]),
      new Map([["thr_a", before]]),
      [columnOf("done", [after])],
    );
    expect(moves[0].thread.displayTitle).toBe("Before");
  });
});

describe("runUnits", () => {
  it("maps a box run's members (≥ two in one column) to one unit keyed by group id", () => {
    const m1 = thread({ id: "thr_m1" });
    const m2 = thread({ id: "thr_m2" });
    const units = runUnits(
      [columnOf("unread", [m1, m2]), columnOf("pinned", [thread({ id: "thr_x" })])],
      groupBoxOf(m1, m2),
    );
    expect([...units.keys()]).toEqual(["grp_1"]);
    expect(units.get("grp_1")).toEqual({
      groupId: "grp_1",
      name: "Feature",
      columnId: "unread",
      memberIds: ["thr_m1", "thr_m2"],
    });
  });

  it("keeps a group-of-one a unit (the live board keeps its dashed container)", () => {
    const m1 = thread({ id: "thr_m1" });
    const units = runUnits([columnOf("unread", [m1])], groupBoxOf(m1));
    expect(units.get("grp_1")?.memberIds).toEqual(["thr_m1"]);
  });

  it("drops a split group's units: per-lane slices never fold (per-thread transports)", () => {
    // Issue #86's split default: the same group renders a slice per column.
    // Folding needs one group in ONE column; a split group's members move
    // per-thread instead.
    const m1 = thread({ id: "thr_m1" });
    const m2 = thread({ id: "thr_m2" });
    const units = runUnits(
      [columnOf("unread", [m1]), columnOf("pinned", [m2])],
      groupBoxOf(m1, m2),
    );
    expect(units.size).toBe(0);
  });

  it("reads member order off the column's own display order, not the plan's", () => {
    const m1 = thread({ id: "thr_m1" });
    const m2 = thread({ id: "thr_m2" });
    const units = runUnits(
      [columnOf("unread", [m2, m1])],
      groupBoxOf(m1, m2),
    );
    expect(units.get("grp_1")?.memberIds).toEqual(["thr_m2", "thr_m1"]);
  });
});

describe("collapseRunTransports", () => {
  const prevUnits = new Map([
    ["grp_1", { groupId: "grp_1", name: "Feature", columnId: "unread", memberIds: ["thr_m1", "thr_m2"] }],
  ]);
  const nextUnits = new Map([
    ["grp_1", { groupId: "grp_1", name: "Feature", columnId: "pinned", memberIds: ["thr_m1", "thr_m2"] }],
  ]);
  const prevThreads = new Map([
    ["thr_m1", thread({ id: "thr_m1", displayTitle: "M1 Before" })],
    ["thr_m2", thread({ id: "thr_m2", displayTitle: "M2 Before" })],
  ]);

  it("folds a box's lockstep member moves into ONE run transport carrying pre-move snapshots", () => {
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned"), moveOf("thr_m2", 1, "unread", "pinned")],
      prevUnits,
      nextUnits,
      prevThreads,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      threadId: "grp_1",
      boxName: "Feature",
      fromColumnId: "unread",
      toColumnId: "pinned",
      fromIndex: 0,
      thread: { displayTitle: "M1 Before" },
    });
    expect(result[0].members?.map((member) => member.displayTitle)).toEqual([
      "M1 Before",
      "M2 Before",
    ]);
  });

  it("keeps per-thread transports when only part of a box moved (a split, not a unit)", () => {
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned")],
      prevUnits,
      nextUnits,
      prevThreads,
    );
    expect(result.map((transport) => transport.threadId)).toEqual(["thr_m1"]);
    expect(result[0].members).toBeUndefined();
  });

  it("keeps per-thread transports when the box's membership changed while it moved", () => {
    const changed = new Map([
      ["grp_1", { groupId: "grp_1", name: "Feature", columnId: "pinned", memberIds: ["thr_m2", "thr_m1"] }],
    ]);
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned"), moveOf("thr_m2", 1, "unread", "pinned")],
      prevUnits,
      changed,
      prevThreads,
    );
    expect(result.map((transport) => transport.threadId).sort()).toEqual(["thr_m1", "thr_m2"]);
  });

  it("falls back to per-thread transports when a member has no pre-move snapshot", () => {
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned"), moveOf("thr_m2", 1, "unread", "pinned")],
      prevUnits,
      nextUnits,
      new Map([["thr_m1", prevThreads.get("thr_m1")!]]),
    );
    expect(result.map((transport) => transport.threadId).sort()).toEqual(["thr_m1", "thr_m2"]);
  });

  it("counts a collapsed unit as ONE transport, so a 13-member box stays under the batch cap", () => {
    const memberIds = Array.from({ length: 13 }, (_, index) => `thr_m${index}`);
    const members = memberIds.map((id) => thread({ id }));
    const prevThirteen = new Map([
      ["grp_1", { groupId: "grp_1", name: "Big", columnId: "unread", memberIds }],
    ]);
    const nextThirteen = new Map([
      ["grp_1", { groupId: "grp_1", name: "Big", columnId: "pinned", memberIds }],
    ]);
    const snapshots = new Map(members.map((member) => [member.id, member]));
    const result = collapseRunTransports(
      memberIds.map((id, index) => moveOf(id, index, "unread", "pinned")),
      prevThirteen,
      nextThirteen,
      snapshots,
    );
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(13);
    expect(TRANSPORT_BATCH_CAP).toBeGreaterThan(1);
  });
});

describe("insertGhostSlots", () => {
  const ghost = {
    threadId: "thr_moved",
    thread: thread({ id: "thr_moved" }),
    fromColumnId: "unread",
    toColumnId: "pinned",
    fromIndex: 1,
  };

  it("injects the ghost between the runs its old card slot sat in", () => {
    const entries = insertGhostSlots(
      [
        { kind: "single" as const, thread: thread({ id: "thr_0" }) },
        { kind: "single" as const, thread: thread({ id: "thr_1" }) },
      ],
      [ghost],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["run", "ghost", "run"]);
  });

  it("counts a box run as one slot per member (fromIndex indexes the lane's card slots)", () => {
    const entries = insertGhostSlots(
      [
        {
          kind: "box" as const,
          box: {
            groupId: "grp_1",
            name: "Feature",
            members: [thread({ id: "thr_m1" }), thread({ id: "thr_m2" })],
          },
        },
        { kind: "single" as const, thread: thread({ id: "thr_2" }) },
      ],
      [{ ...ghost, fromIndex: 2 }],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["run", "ghost", "run"]);
  });

  it("clamps a stale fromIndex (the old lane reflowed between) to the lane's end", () => {
    const entries = insertGhostSlots(
      [{ kind: "single" as const, thread: thread({ id: "thr_0" }) }],
      [{ ...ghost, fromIndex: 7 }],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["run", "ghost"]);
  });
});

describe("firstRealCard", () => {
  it("skips transport ghosts when looking a card up by id in DOM order", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <ul data-column-id="unread"><li data-transport-ghost="" data-transport-out="wiping">
        <div data-thread-card="thr_a">ghost</div>
      </li></ul>
      <ul data-column-id="pinned"><li><div data-thread-card="thr_a">real</div>
        <div data-thread-card="thr_a">dup</div></li></ul>`;
    const found = firstRealCard(host, "thr_a");
    expect(found?.parentElement?.parentElement?.getAttribute("data-column-id")).toBe("pinned");
  });
});

describe("transport constants", () => {
  it("the arrival sweep deliberately outlasts the departure so its amber beam reads", () => {
    // Changed from the TNG-symmetric rule at the operator's ask ("maybe slow
    // down arrival more?"): the dissolve-in's crawl keeps the arriving slot
    // near-invisible for its first half, so the arrival gets a longer run for
    // its glints to peak inside the visible window. Deliberate asymmetric
    // retune, pinned exactly.
    expect(TRANSPORT_WIPE_OUT_MS).toBe(400);
    expect(TRANSPORT_WIPE_IN_MS).toBe(520);
    expect(TRANSPORT_COLLAPSE_MS).toBeGreaterThan(0);
  });

  it("wipes ease in (slight acceleration, not a linear or decelerating sweep)", () => {
    expect(TRANSPORT_EASE).toContain("cubic-bezier");
  });

  it("the sweeps are tuned long enough for the shimmer to read, with a slow ease-in start", () => {
    // Feel-tuned anchors (operator: "increase the ease-in time", then
    // "ease-in and ease-out should take the same amount of time", later
    // "maybe slow down arrival more?" — the arrival is deliberately longer
    // now). Pinned exactly so a retune is a deliberate test edit, never a
    // silent constant drift.
    expect(TRANSPORT_WIPE_OUT_MS).toBe(400);
    expect(TRANSPORT_WIPE_IN_MS).toBe(520);
    expect(TRANSPORT_COLLAPSE_MS).toBe(200);
    expect(TRANSPORT_EASE).toBe("cubic-bezier(0.5, 0, 0.6, 0.4)");
  });

  it("the arrival's space opens faster than the card materializes into it", () => {
    // Operator: "maybe expand faster than it dissolves in?" The slot's
    // growth is a quick open (well under the dissolve-in) rather than a
    // second 400ms ramp stacked on the materialize. Pinned exactly, same
    // deliberate-retune rule as the sweep anchors.
    expect(TRANSPORT_GROW_MS).toBe(180);
    expect(TRANSPORT_GROW_MS).toBeLessThan(TRANSPORT_WIPE_IN_MS);
  });

  it("the grow opens fast and settles gently (ease-out shaped, unlike the crawl-in sweeps)", () => {
    expect(TRANSPORT_GROW_EASE).toBe("cubic-bezier(0.3, 0.75, 0.4, 1)");
    expect(TRANSPORT_GROW_EASE).not.toBe(TRANSPORT_EASE);
  });

  it("a batch switch larger than the cap stays a plain reflow", () => {
    // Reassignment: planning a batch the size of a grouping change would
    // dissolve the whole board; the cap exists so those re-derivations read
    // as view switches.
    expect(TRANSPORT_BATCH_CAP).toBeGreaterThan(0);
    expect(TRANSPORT_BATCH_CAP).toBeLessThan(20);
  });
});

describe("wipe keyframes", () => {
  it("the dissolve-out fades in place — no directional wipe, and the bloom grows to the end", () => {
    const frames = wipeOutKeyframes();
    // No clip-path anywhere: the top-down curtain stacked into vertical
    // wipes once several lanes moved at once (operator: "a lot of vertical
    // wipes"). The card dissolves where it stands instead.
    for (const frame of frames) expect(frame.clipPath).toBeUndefined();
    expect(frames[0].opacity).toBe(1);
    expect(frames[frames.length - 1].opacity).toBe(0);
    // The dissolve's read: the bloom strengthens all the way to the end —
    // a fade without a strong growing bloom reads as a plain vanish.
    expect(String(frames[frames.length - 1].filter)).toContain("blur(10px)");
    expect(String(frames[frames.length - 1].filter)).toContain("brightness(2.1)");
  });

  it("the dissolve-in materializes in place — no directional wipe, blooming out of the beam", () => {
    const frames = wipeInKeyframes();
    for (const frame of frames) expect(frame.clipPath).toBeUndefined();
    expect(Number(frames[0].opacity)).toBe(0);
    expect(String(frames[0].filter)).toContain("blur(7px)");
    expect(Number(frames[frames.length - 1].opacity)).toBe(1);
    expect(frames[frames.length - 1].filter).toBe("none");
  });

  it("the arrival grows the new slot from nothing to its full measured height", () => {
    // The space itself grows: the slot opens from zero height so the lane's
    // neighbors slide as it materializes, never a fixed-height reveal.
    const frames = arrivalGrowKeyframes(240);
    expect(frames).toHaveLength(2);
    expect(frames[0].maxHeight).toBe("0px");
    expect(frames[frames.length - 1].maxHeight).toBe("240px");
  });

  it("the collapse closes the ghost's height and borrows nothing extra from the layout", () => {
    // The ghost's final margins must exactly cancel the flex gap it leaves
    // behind, so removing the node after the animation changes nothing.
    const frames = ghostCollapseKeyframes(120, 6);
    expect(frames[0].maxHeight).toBe("120px");
    expect(frames[frames.length - 1].maxHeight).toBe("0px");
    expect(frames[frames.length - 1].marginTop).toBe("-3px");
    expect(frames[frames.length - 1].marginBottom).toBe("-3px");
  });

  it("the collapse starts from the ghost's real margins, so a box container's own top margin dissolves smoothly", () => {
    // A box ghost's container carries a 6px top margin of its own; the
    // collapse must eat that smoothly (6px → borrowed halves), never jump.
    const frames = ghostCollapseKeyframes(120, 6, "6px", "0px");
    expect(frames[0].marginTop).toBe("6px");
    expect(frames[0].marginBottom).toBe("0px");
    expect(frames[frames.length - 1].marginTop).toBe("-3px");
    expect(frames[frames.length - 1].marginBottom).toBe("-3px");
  });

  it("a horizontal lane's arrival grows the slot along the flow's width axis", () => {
    const frames = arrivalGrowKeyframes(240, "horizontal");
    expect(frames).toHaveLength(2);
    expect(frames[0].maxWidth).toBe("0px");
    expect(frames[frames.length - 1].maxWidth).toBe("240px");
    expect(frames[0].maxHeight).toBeUndefined();
    expect(frames[frames.length - 1].maxHeight).toBeUndefined();
  });

  it("a horizontal lane's collapse closes the ghost's width and borrows nothing extra", () => {
    const frames = ghostCollapseKeyframes(120, 6, "6px", "0px", "horizontal");
    expect(frames[0].maxWidth).toBe("120px");
    expect(frames[0].marginLeft).toBe("6px");
    expect(frames[0].marginRight).toBe("0px");
    expect(frames[frames.length - 1].maxWidth).toBe("0px");
    // The horizontal flow's gap sits on the left/right margins instead.
    expect(frames[frames.length - 1].marginLeft).toBe("-3px");
    expect(frames[frames.length - 1].marginRight).toBe("-3px");
    expect(frames[frames.length - 1].maxHeight).toBeUndefined();
  });
});

describe("shimmerSparks", () => {
  it("lays a deterministic field of glints whose lives fit inside the phase", () => {
    const sparks = shimmerSparks(TRANSPORT_WIPE_OUT_MS);
    expect(sparks).toHaveLength(TRANSPORT_SPARK_COUNT);
    // Same seed, same field: layer re-renders (a phase flip, a re-target)
    // must not reshuffle the glints mid-sweep.
    expect(shimmerSparks(TRANSPORT_WIPE_OUT_MS)).toEqual(sparks);
    for (const spark of sparks) {
      expect(spark.leftPct).toBeGreaterThanOrEqual(0);
      expect(spark.leftPct).toBeLessThanOrEqual(100);
      expect(spark.topPct).toBeGreaterThanOrEqual(0);
      expect(spark.topPct).toBeLessThanOrEqual(100);
      expect(spark.delayMs).toBeGreaterThanOrEqual(0);
      expect(spark.durationMs).toBeGreaterThan(0);
      // Each glint's whole life stays inside its phase: no orphaned sparkle
      // blinking on a settled card after the machine moved on.
      expect(spark.delayMs + spark.durationMs).toBeLessThanOrEqual(TRANSPORT_WIPE_OUT_MS);
      expect(spark.peak).toBeGreaterThan(0);
      expect(spark.peak).toBeLessThanOrEqual(1);
      expect(spark.driftPx).toBeGreaterThan(0);
    }
  });

  it("spreads the glints across the width and staggers their starts (a curtain, not a flash)", () => {
    const sparks = shimmerSparks(TRANSPORT_WIPE_OUT_MS);
    const leftBands = new Set(sparks.map((spark) => Math.floor(spark.leftPct / 10)));
    expect(leftBands.size).toBeGreaterThanOrEqual(TRANSPORT_SPARK_COUNT / 2);
    expect(new Set(sparks.map((spark) => spark.delayMs)).size).toBeGreaterThan(1);
  });

  it("respects a caller's count and phase length", () => {
    const sparks = shimmerSparks(200, 5);
    expect(sparks).toHaveLength(5);
    for (const spark of sparks) {
      expect(spark.delayMs + spark.durationMs).toBeLessThanOrEqual(200);
    }
  });

  it("departure glints rise from the bottom of the slot (departing is up)", () => {
    const sparks = shimmerSparks(TRANSPORT_WIPE_OUT_MS);
    expect(sparks.every((spark) => spark.direction === "up")).toBe(true);
    for (const spark of sparks) {
      // The field anchors toward the slot's lower half so the rise reads.
      expect(spark.topPct).toBeGreaterThanOrEqual(30);
      expect(spark.topPct).toBeLessThanOrEqual(95);
    }
  });

  it("arrival glints descend from the top of the slot (arriving is down)", () => {
    const sparks = shimmerSparks(
      TRANSPORT_WIPE_IN_MS,
      TRANSPORT_SPARK_COUNT,
      undefined,
      "down",
    );
    expect(sparks.every((spark) => spark.direction === "down")).toBe(true);
    for (const spark of sparks) {
      // The field anchors toward the slot's upper half so the descent reads.
      expect(spark.topPct).toBeGreaterThanOrEqual(5);
      expect(spark.topPct).toBeLessThanOrEqual(55);
      // Same envelope discipline as the departure field. No schedule bias:
      // the glide layer is decoupled from the card's fade (the glints ride
      // the slot, not the card), so they twinkle across the WHOLE arrival.
      expect(spark.delayMs + spark.durationMs).toBeLessThanOrEqual(TRANSPORT_WIPE_IN_MS);
    }
    // Determinism holds per direction, not just for the shared default seed.
    expect(shimmerSparks(TRANSPORT_WIPE_IN_MS, TRANSPORT_SPARK_COUNT, undefined, "down")).toEqual(
      sparks,
    );
  });
});

describe("sparkKeyframes", () => {
  it("a glint twinkles in to its peak and fades away while it drifts upward", () => {
    const spark = shimmerSparks(400)[0]!;
    const frames = sparkKeyframes(spark);
    expect(frames[0].opacity).toBe(0);
    expect(frames.some((frame) => Number(frame.opacity) > 0)).toBe(true);
    expect(frames[frames.length - 1].opacity).toBe(0);
    // The drift: the end frame sits HIGHER than the start (negative Y).
    expect(String(frames[frames.length - 1].transform)).toContain("-");
  });
  it("an arrival glint mirrors the motion: it falls from above its peak", () => {
    const spark = shimmerSparks(400, 14, undefined, "down")[0]!;
    const frames = sparkKeyframes(spark);
    // The drift: the start frame hangs BELOW-start (the glint enters from
    // higher up), and the end frame sits LOWER than the peak (positive Y).
    expect(String(frames[0].transform)).toContain("translateY(-");
    const last = String(frames[frames.length - 1].transform);
    expect(last).toContain("translateY(");
    expect(last).not.toContain("translateY(-");
  });
});

describe("the zoom transport variant (shrink out / grow in)", () => {
  it("defaults the board to the dissolve, with zoom a named selectable variant (additive, not a replacement)", () => {
    expect(TRANSPORT_VARIANT).toBe("dissolve");
    // The seam: the board reads a plan per variant, keyed by name.
    expect(transportPhasePlan("dissolve")).not.toEqual(transportPhasePlan("zoom"));
  });

  it("the dissolve's phase plan stays the operator-tuned one (the zoom changes nothing there)", () => {
    const plan = transportPhasePlan("dissolve");
    expect(plan.settleMs).toBe(TRANSPORT_WIPE_IN_MS);
    expect(plan.collapseStartMs).toBe(TRANSPORT_WIPE_OUT_MS);
    expect(plan.removeMs).toBe(TRANSPORT_WIPE_OUT_MS + TRANSPORT_COLLAPSE_MS);
  });

  it("pins the zoom's clocks exactly (deliberate retune, same rule as the sweep anchors)", () => {
    expect(TRANSPORT_ZOOM_OUT_MS).toBe(320);
    expect(TRANSPORT_ZOOM_IN_MS).toBe(320);
  });

  it("the zoom is symmetric — the card shrinks out and grows in at the same rate", () => {
    expect(TRANSPORT_ZOOM_OUT_MS).toBe(TRANSPORT_ZOOM_IN_MS);
  });

  it("the old slot's space collapses IN TIME WITH the shrink, never after it", () => {
    // The dissolve waits for its wipe-out to finish before collapsing; the
    // zoom starts its slot close the moment the shrink starts (clock 0).
    const plan = transportPhasePlan("zoom");
    expect(plan.collapseStartMs).toBe(0);
    expect(plan.removeMs).toBe(TRANSPORT_ZOOM_OUT_MS);
  });

  it("the arrival's space grows on the SAME clock as the card's growth, so space and card land together", () => {
    const plan = transportPhasePlan("zoom");
    expect(plan.settleMs).toBe(TRANSPORT_ZOOM_IN_MS);
  });

  it("the recede accelerates away; the arrival eases out and settles", () => {
    expect(TRANSPORT_ZOOM_OUT_EASE).toBe("cubic-bezier(0.45, 0, 0.85, 0.6)");
    expect(TRANSPORT_ZOOM_IN_EASE).toBe("cubic-bezier(0.2, 0.65, 0.3, 1)");
    expect(TRANSPORT_ZOOM_OUT_EASE).not.toBe(TRANSPORT_ZOOM_IN_EASE);
  });

  it("zoom-out recedes: the whole card shrinks toward the portal scale and fades out (no directional clip)", () => {
    const frames = zoomOutKeyframes();
    for (const frame of frames) expect(frame.clipPath).toBeUndefined();
    expect(frames[0]).toMatchObject({ opacity: 1, transform: "scale(1)" });
    expect(Number(frames[frames.length - 1].opacity)).toBe(0);
    expect(frames[frames.length - 1].transform).toBe(`scale(${TRANSPORT_ZOOM_MIN_SCALE})`);
  });

  it("zoom-in grows: the card grows from the portal scale to full size and lands opaque (no directional clip)", () => {
    const frames = zoomInKeyframes();
    for (const frame of frames) expect(frame.clipPath).toBeUndefined();
    expect(frames[0]).toMatchObject({ opacity: 0, transform: `scale(${TRANSPORT_ZOOM_MIN_SCALE})` });
    expect(Number(frames[frames.length - 1].opacity)).toBe(1);
    expect(frames[frames.length - 1].transform).toBe("scale(1)");
  });

  it("both directions meet at the same portal scale (the shrink-out and grow-in read as one opening)", () => {
    expect(TRANSPORT_ZOOM_MIN_SCALE).toBe(0.2);
    expect(TRANSPORT_ZOOM_MIN_SCALE).toBeGreaterThan(0);
    expect(TRANSPORT_ZOOM_MIN_SCALE).toBeLessThan(0.5);
  });
});