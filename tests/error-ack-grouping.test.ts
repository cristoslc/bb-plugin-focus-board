import { describe, expect, it } from "vitest";
import { columnFor, threadState } from "../components/grouping";
import { assembleBoard } from "../components/nesting";
import { thread } from "./thread-fixture";
import { staleErrorAckIds } from "../lib/error-ack-metadata";

// An acknowledged error (lib/error-ack-metadata, key "errorAck") silences
// the board's error arms of threadState() — status "error",
// indicator "unread-error"/"queued-failed", queuedWork "failed" — without
// touching bb's record or the pending-interaction arm, which a real answer
// must settle (lib/interaction-sync.ts).

const NOW = 10 * 24 * 60 * 60 * 1000;

describe("threadState with an error ack", () => {
  it("an acked status-error thread reads as idle", () => {
    const acked = new Set(["thr_a"]);
    expect(threadState(thread({ id: "thr_a", status: "error" }), acked)).toBe(
      "idle",
    );
    // No ack: the error arm holds (the default contract the tests above pin).
    expect(threadState(thread({ id: "thr_b", status: "error" }), acked)).toBe(
      "attention",
    );
  });

  it("an acked thread still reads as unread or working on its other arms", () => {
    const acked = new Set(["thr_a"]);
    expect(
      threadState(thread({ id: "thr_a", status: "error", isUnread: true }), acked),
    ).toBe("unread");
    expect(
      threadState(thread({ id: "thr_a", status: "active" }), acked),
    ).toBe("working");
  });

  it("an ack never silences a pending interaction", () => {
    const acked = new Set(["thr_a"]);
    expect(
      threadState(
        thread({ id: "thr_a", status: "error", hasPendingInteraction: true }),
        acked,
      ),
    ).toBe("attention");
    // The record only exists beside error signals anyway; a question card
    // keeps its pulse regardless (lib/interaction-sync.ts owns this flag).
    expect(
      threadState(thread({ id: "thr_a", hasPendingInteraction: true }), acked),
    ).toBe("attention");
  });

  it("an ack silences the other error signals too (indicator, queuedWork)", () => {
    const acked = new Set(["thr_a"]);
    expect(
      threadState(thread({ id: "thr_a", indicator: "unread-error" }), acked),
    ).toBe("idle");
    expect(
      threadState(thread({ id: "thr_a", indicator: "queued-failed" }), acked),
    ).toBe("idle");
    expect(
      threadState(thread({ id: "thr_a", queuedWork: "failed" }), acked),
    ).toBe("idle");
  });

  it("no ack set passed: the error arms behave exactly as before", () => {
    expect(threadState(thread({ status: "error" }))).toBe("attention");
    expect(threadState(thread({ queuedWork: "failed" }))).toBe("attention");
  });
});

describe("columnFor with an error ack", () => {
  const context = { projects: [], providers: [] };

  it("an acked status-error card maps to an idle bucket, not attention", () => {
    const acked = columnFor(
      thread({ id: "thr_a", status: "error", updatedAt: NOW - 5 * 60 * 1000 }),
      "status",
      context,
      NOW,
      new Set(["thr_a"]),
    );
    expect(acked.id).toBe("idle-recent");
    // No ack: the attention column holds.
    expect(
      columnFor(
        thread({ id: "thr_b", status: "error" }),
        "status",
        context,
        NOW,
      ).id,
    ).toBe("attention");
  });
});

describe("assembleBoard with an error ack (issue #405)", () => {
  const context = { projects: [], providers: [] };

  it("a lone acked errored card settles out of Needs you through the full assembly", () => {
    const assembly = assembleBoard(
      [thread({ id: "thr_a", status: "error", updatedAt: NOW - 5 * 60 * 1000 })],
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { errorAcks: new Set(["thr_a"]) },
    );
    const attention = assembly.columns.find((column) => column.id === "attention");
    expect(attention?.threads ?? []).toEqual([]);
    const idle = assembly.columns.find((column) => column.id === "idle-recent");
    expect(idle?.threads.map((thread) => thread.id)).toEqual(["thr_a"]);
  });

  it("a family whose errored child's ack settled the family override out of Needs you", () => {
    const assembly = assembleBoard(
      [
        thread({ id: "thr_parent", status: "idle", updatedAt: NOW - 60 * 60 * 1000 }),
        thread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          status: "error",
          updatedAt: NOW - 5 * 60 * 1000,
        }),
      ],
      "status",
      context,
      new Map(),
      new Set(),
      NOW,
      { errorAcks: new Set(["thr_child"]) },
    );
    const attention = assembly.columns.find((column) => column.id === "attention");
    expect(attention?.threads ?? []).toEqual([]);
    // The family lives in its settled bucket (its parent's own idle age), not
    // Needs you; the acked child still renders as the parent's nested row.
    const idleParent = assembly.columns.some((column) =>
      column.threads.some((thread) => thread.id === "thr_parent"),
    );
    expect(idleParent).toBe(true);
    expect(assembly.nestedChildrenByParent.get("thr_parent")?.map((c) => c.id)).toEqual([
      "thr_child",
    ]);
  });
});

describe("staleErrorAckIds", () => {
  it("drops acks whose thread no longer sits in error status", () => {
    const acks = new Set(["thr_acked_still_error", "thr_working", "thr_idle"]);
    const threads = [
      thread({ id: "thr_acked_still_error", status: "error" }),
      thread({ id: "thr_working", status: "active" }),
      thread({ id: "thr_idle", status: "idle" }),
    ];
    expect(staleErrorAckIds(threads, acks)).toEqual([
      "thr_working",
      "thr_idle",
    ]);
  });

  it("skips acks whose thread left the live list (dormant, not stale)", () => {
    const acks = new Set(["thr_gone", "thr_error"]);
    const threads = [thread({ id: "thr_error", status: "error" })];
    expect(staleErrorAckIds(threads, acks)).toEqual([]);
  });
});