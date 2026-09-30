import { describe, expect, it } from "vitest";
import {
  applyInteractionFlags,
  interactionFlagChangeFromEvent,
  pendingFromInteractionRows,
  type InteractionFlagStore,
} from "../lib/interaction-sync";
import { thread } from "./thread-fixture";

describe("interactionFlagChangeFromEvent", () => {
  it("returns the flag change for an interactions-changed event", () => {
    expect(
      interactionFlagChangeFromEvent({
        type: "changed",
        entity: "thread",
        id: "thr_a",
        changes: ["interactions-changed"],
        metadata: { hasPendingInteraction: false },
      }),
    ).toEqual({ threadId: "thr_a", hasPendingInteraction: false });
  });

  it("reports an unverified change when the event carries no flag", () => {
    expect(
      interactionFlagChangeFromEvent({
        type: "changed",
        entity: "thread",
        id: "thr_a",
        changes: ["interactions-changed"],
      }),
    ).toEqual({ threadId: "thr_a", hasPendingInteraction: null });
  });

  it("allows co-occurring change kinds on the same event", () => {
    expect(
      interactionFlagChangeFromEvent({
        type: "changed",
        entity: "thread",
        id: "thr_a",
        changes: ["interactions-changed", "status-changed"],
        metadata: { hasPendingInteraction: true },
      }),
    ).toEqual({ threadId: "thr_a", hasPendingInteraction: true });
  });

  it("ignores events without the interactions-changed kind", () => {
    expect(
      interactionFlagChangeFromEvent({
        type: "changed",
        entity: "thread",
        id: "thr_a",
        changes: ["status-changed"],
      }),
    ).toBeNull();
  });

  it("ignores non-thread events", () => {
    expect(
      interactionFlagChangeFromEvent({
        type: "changed",
        entity: "project",
        changes: ["project-updated"],
      }),
    ).toBeNull();
  });

  it("ignores garbage payloads", () => {
    expect(interactionFlagChangeFromEvent(null)).toBeNull();
    expect(interactionFlagChangeFromEvent("thread:changed")).toBeNull();
    expect(interactionFlagChangeFromEvent({ entity: "thread" })).toBeNull();
  });

  it("ignores thread-wide events with no id to verify against", () => {
    expect(
      interactionFlagChangeFromEvent({
        type: "changed",
        entity: "thread",
        changes: ["interactions-changed"],
      }),
    ).toBeNull();
  });
});

describe("applyInteractionFlags", () => {
  it("overrides the sidebar flag with the verified one", () => {
    const rows = [
      thread({ id: "thr_a", hasPendingInteraction: true }),
      thread({ id: "thr_b" }),
    ];
    const flags: InteractionFlagStore = new Map([["thr_a", false]]);
    const applied = applyInteractionFlags(rows, flags);
    // Verified truth wins over the stale sidebar row.
    expect(applied.flatMap((row) => row.hasPendingInteraction)).toEqual([false, false]);
    expect(applied[1]).toBe(rows[1]);
  });

  it("promotes a thread into needs-you when verification saw a pending row", () => {
    const rows = [thread({ id: "thr_a" })];
    const flags: InteractionFlagStore = new Map([["thr_a", true]]);
    expect(applyInteractionFlags(rows, flags)[0].hasPendingInteraction).toBe(true);
  });

  it("drops a flag that already agrees with the sidebar row", () => {
    const rows = [thread({ id: "thr_a", hasPendingInteraction: false })];
    const flags: InteractionFlagStore = new Map([["thr_a", false]]);
    // Sidebar caught up; nothing to override, same references.
    expect(applyInteractionFlags(rows, flags)).toEqual(rows);
  });
});

describe("pendingFromInteractionRows", () => {
  it("treats a pending row as pending", () => {
    expect(pendingFromInteractionRows([{ status: "resolved" }, { status: "pending" }])).toBe(
      true,
    );
  });

  it("treats resolved, interrupted and empty sets as not pending", () => {
    expect(pendingFromInteractionRows([{ status: "resolved" }])).toBe(false);
    expect(pendingFromInteractionRows([{ status: "interrupted" }])).toBe(false);
    expect(pendingFromInteractionRows([])).toBe(false);
  });
});