// The attention freeze applied through board assembly (assembleBoard): a card
// or family the operator attends to (hover, open pane) pins the rendered
// placement captured at attention time, and wins over every placement rule
// (family R4 overrides and group-box overrides included) while attended.
// Releasing attention returns the card to the live placement rules.
import { describe, expect, it } from "vitest";
import { assembleBoard } from "../components/nesting";
import { columnFor, type GroupingContext } from "../components/grouping";
import { slotPinKey, type AttentionFreezePlan } from "../components/attention-freeze";
import { thread } from "./thread-fixture";

const NOW = 10 * 24 * 60 * 60 * 1000;
const context: GroupingContext = { projects: [], providers: [] };

function fixture(id: string, fields: Parameters<typeof thread>[0] = {}) {
  return thread({ id, updatedAt: NOW - 1000, ...fields });
}

/** The rendered placement of a thread in the assembled board. */
function placementOf(
  assembly: ReturnType<typeof assembleBoard>,
  threadId: string,
): { columnId: string; index: number; nestedIndex: number | null } | null {
  const columns = assembly.columns;
  for (const column of columns) {
    const index = column.threads.findIndex((card) => card.id === threadId);
    if (index !== -1) return { columnId: column.id, index, nestedIndex: null };
  }
  for (const [parentId, rows] of assembly.nestedChildrenByParent) {
    const index = rows.findIndex((card) => card.id === threadId);
    if (index !== -1) return { columnId: parentId, index, nestedIndex: index };
  }
  return null;
}

describe("attention freeze through board assembly", () => {
  it("pins an attended card's slot while sibling activity re-sorts the column", () => {
    const first = [
      fixture("s1", { updatedAt: 100 }),
      fixture("s2", { updatedAt: 200 }),
      fixture("s3", { updatedAt: 300 }),
    ];
    const base = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW);
    // The operator attends to s1, the bottom card of the column.
    const captured = placementOf(base, "s1");
    expect(captured).toMatchObject({ columnId: "proj_a", index: 2 });

    // s1 itself receives activity — the churn that would vault it to the top.
    const churned = [
      fixture("s1", { updatedAt: 600 }),
      fixture("s2", { updatedAt: 200 }),
      fixture("s3", { updatedAt: 300 }),
    ];
    const moved = assembleBoard(churned, "project", context, new Map(), new Set<string>(), NOW);
    expect(placementOf(moved, "s1")).toMatchObject({ index: 0 });

    const plan: AttentionFreezePlan = {
      columns: new Map([["s1", { id: captured!.columnId, label: "proj_a" }]]),
      slots: new Map([[slotPinKey(captured!.columnId, "s1"), captured!.index]]),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(churned, "project", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "s1")).toEqual(captured);
  });

  it("a state flip re-lanes an attended family — the capture never outranks live state", () => {
    // The operator's report (2026-10-31, thr_cyyyqxsvix): a card attended by
    // an open pane kept its captured lane through a live state flip, so a
    // working thread read Unread for as long as the pane stayed open.
    const quiet = [fixture("p", { updatedAt: 5000 }), fixture("c", { parentThreadId: "p", updatedAt: 4000 })];
    const base = assembleBoard(quiet, "status", context, new Map(), new Set<string>(), NOW);
    const quietColumnId = placementOf(base, "p")!.columnId;

    // The child turning unread lifts the whole family into the unread lane
    // (R4). An attention FLIP would instead un-nest the child — the lift
    // intentionally excludes attention members — so unread drives the lane.
    const attended = [
      fixture("p", { updatedAt: 5000 }),
      fixture("c", { parentThreadId: "p", updatedAt: 4000, isUnread: true }),
    ];
    const live = assembleBoard(attended, "status", context, new Map(), new Set<string>(), NOW);
    const liveColumnId = placementOf(live, "p")!.columnId;
    expect(liveColumnId).not.toBe(quietColumnId);

    // Attending to the family's parent card captured the quiet lane, and the
    // family's live lane has since moved: the card follows its state.
    const plan: AttentionFreezePlan = {
      columns: new Map([["p", { id: quietColumnId, label: quietColumnId }]]),
      slots: new Map(),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(attended, "status", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "p")!.columnId).toBe(liveColumnId);
  });

  it("an idle-bucket aging flip keeps an attended card's captured lane", () => {
    // Time churn is not a state flip: a card that ages out of its idle
    // bucket while the operator attends it holds the bucket it was read in.
    const threads = [fixture("s1", { updatedAt: NOW - 3 * 60 * 60 * 1000 })];
    const base = assembleBoard(threads, "status", context, new Map(), new Set<string>(), NOW);
    expect(placementOf(base, "s1")!.columnId).toBe("idle-today");

    const plan: AttentionFreezePlan = {
      columns: new Map([["s1", { id: "idle-yesterday", label: "Idle · Yesterday" }]]),
      slots: new Map(),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(threads, "status", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "s1")!.columnId).toBe("idle-yesterday");
  });

  it("an attended nested child stays nested and keeps its row slot", () => {
    const quiet = [
      fixture("p", { updatedAt: 5000 }),
      fixture("c1", { parentThreadId: "p", updatedAt: 4000 }),
      fixture("c2", { parentThreadId: "p", updatedAt: 3000 }),
    ];
    const base = assembleBoard(quiet, "status", context, new Map(), new Set<string>(), NOW);
    expect(placementOf(base, "c1")).toMatchObject({ nestedIndex: 0 });

    // c2 (not c1) goes attention: it must un-nest normally (the control).
    const churned = [
      fixture("p", { updatedAt: 5000 }),
      fixture("c1", { parentThreadId: "p", updatedAt: 4000 }),
      fixture("c2", { parentThreadId: "p", updatedAt: 3000, hasPendingInteraction: true }),
    ];
    // The operator is attending to c1 (a nested row): c1 stays anchored.
    const plan: AttentionFreezePlan = {
      columns: new Map(),
      slots: new Map(),
      stayNested: new Set(["c1"]),
      rowSlots: new Map([["p", new Map([["c1", 0]])]]),
    };
    const pinned = assembleBoard(churned, "status", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "c1")).toMatchObject({ nestedIndex: 0 });
  });

  it("an attended card's slot pin pins its own column, never its Done projection twin (Defect 2)", () => {
    // A live root with done children renders twice: its live lane slot and
    // its projection card in Done. The pin is keyed by lane AND thread
    // today? No: by thread alone, so attending to the live card moved the
    // twin to the live slot's index inside Done. The twin keeps its own
    // slot now.
    const family = [
      fixture("older-done", { updatedAt: 1000 }),
      fixture("p", { updatedAt: 5000 }),
      fixture("d1", { parentThreadId: "p", updatedAt: 4000 }),
      fixture("p2", { updatedAt: 6000 }),
    ];
    const doneIds = new Set<string>(["older-done", "d1"]);
    const base = assembleBoard(family, "status", context, new Map(), doneIds, NOW);
    const liveSlot = base.columns
      .find((column) => placementOf(base, "p")!.columnId === column.id)!
      .threads.findIndex((entry) => entry.id === "p");
    const doneColumnBase = base.columns.find((column) => column.id === "done")!;
    const doneSlotBase = doneColumnBase.threads.findIndex((entry) => entry.id === "p");
    expect(liveSlot).not.toBe(doneSlotBase);
    expect(doneSlotBase).toBeGreaterThanOrEqual(0);

    const plan: AttentionFreezePlan = {
      columns: new Map(),
      slots: new Map([[slotPinKey(placementOf(base, "p")!.columnId, "p"), liveSlot]]),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(family, "status", context, new Map(), doneIds, NOW, {
      attentionFreeze: plan,
    });
    const doneColumnPinned = pinned.columns.find((column) => column.id === "done")!;
    expect(doneColumnPinned.threads.findIndex((entry) => entry.id === "p")).toBe(doneSlotBase);
    expect(
      pinned.columns
        .find((column) => placementOf(base, "p")!.columnId === column.id)!
        .threads.findIndex((entry) => entry.id === "p"),
    ).toBe(liveSlot);
  });

  it("recapture of a pin already applied reproduces the pinned placement (idempotent)", () => {
    const first = [fixture("s1", { updatedAt: 100 }), fixture("s2", { updatedAt: 200 })];
    const base = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW);
    const captured = placementOf(base, "s1")!;
    const plan: AttentionFreezePlan = {
      columns: new Map([["s1", { id: captured.columnId, label: captured.columnId }]]),
      slots: new Map([[slotPinKey(captured.columnId, "s1"), captured.index]]),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const again = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(again, "s1")).toEqual(captured);
  });

  it("a rank write from another surface does not move the attended card; its rank renders again on release", () => {
    // Build 1: no ranks; the operator attends to s1 (last card).
    const first = [
      fixture("s1", { updatedAt: 100 }),
      fixture("s2", { updatedAt: 200 }),
      fixture("s3", { updatedAt: 300 }),
    ];
    const base = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW);
    const captured = placementOf(base, "s1")!;
    expect(captured.index).toBe(2);

    // Another surface ranks s1 first; the stored order renders the change
    // for every unattended card, but the attended card holds its slot.
    const ranked = { "project:proj_a": ["s1"] };
    const moved = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW, {
      ranks: ranked,
    });
    expect(placementOf(moved, "s1")!.index).toBe(0);

    const plan: AttentionFreezePlan = {
      columns: new Map([["s1", { id: captured.columnId, label: captured.columnId }]]),
      slots: new Map([[slotPinKey(captured.columnId, "s1"), captured.index]]),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW, {
      ranks: ranked,
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "s1")!.index).toBe(2);
  });

  it("the natural column lookup the capture reads agrees with the rendered lane", () => {
    const threads = [fixture("s1", { updatedAt: NOW })];
    expect(columnFor(threads[0]!, "project", context, NOW).id).toBe("proj_a");
  });
});