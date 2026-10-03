import { describe, expect, it } from "vitest";
import { setup, snoozeRecordOf } from "./helpers/snooze-fake-host";
import { SNOOZE_METADATA_KEY } from "../lib/snooze";
import type { JsonValue } from "@get-bb/plugin-sdk";

type Host = Awaited<ReturnType<typeof setup>>;

/** A future wake time, relative to now (the future check is clock-live). */
const futureIso = (ms: number) => new Date(Date.now() + ms).toISOString();

function metaCalls(host: Host) {
  return host.harness.inspection.sdk.callsTo("threads.updatePluginMetadata");
}

describe("snooze_list over plugin metadata", () => {
  it("returns the record map for live threads carrying a snooze record", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a", "thr_b"] });
    const record = { wakeAt: "2026-10-02T12:00:00.000Z", setAt: "2026-10-02T10:00:00.000Z" };
    meta.set("thr_a", { [SNOOZE_METADATA_KEY]: record } as JsonValue);
    expect(await callRpc("snooze_list", null)).toEqual({
      snoozes: { thr_a: record },
    });
  });

  it("drops threads that have left the live list", async () => {
    const { callRpc, meta } = await setup({ threads: [] });
    meta.set("thr_gone", {
      [SNOOZE_METADATA_KEY]: { wakeAt: "2026-10-02T12:00:00.000Z", setAt: "2026-10-02T10:00:00.000Z" },
    } as JsonValue);
    expect(await callRpc("snooze_list", null)).toEqual({ snoozes: {} });
  });

  it("fails loud on a malformed record (never coerces)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_bad"] });
    meta.set("thr_bad", { [SNOOZE_METADATA_KEY]: { wakeAt: 123 } } as JsonValue);
    await expect(callRpc("snooze_list", null)).rejects.toThrow(/wakeAt/);
  });
});

describe("snooze_set", () => {
  it("stamps { wakeAt, setAt } into the thread's metadata namespace", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    const wakeAt = futureIso(3_600_000);
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt });
    const record = snoozeRecordOf(meta, "thr_a");
    expect(record?.wakeAt).toBe(wakeAt);
    expect(Number.isNaN(Date.parse(record!.setAt))).toBe(false);
  });

  it("marks the thread read at set time (read now, unread later)", async () => {
    const { callRpc, lastReadOf } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(3_600_000) });
    expect(lastReadOf("thr_a")).not.toBeNull();
  });

  it("anchors setAt at the read mark, not the wall clock after it", async () => {
    // Wake-time read detection compares lastReadAt against setAt strictly;
    // the set gesture's own read must never count as "read since snoozed",
    // so setAt is stamped from the mark that snoozing itself caused.
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(3_600_000) });
    const record = snoozeRecordOf(meta, "thr_a")!;
    expect(Date.parse(record.setAt)).toBeLessThanOrEqual(Date.parse(record.wakeAt));
  });

  it("rejects an unparseable wakeAt at the contract (never stored)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await expect(
      callRpc("snooze_set", { threadId: "thr_a", wakeAt: "nope" }),
    ).rejects.toThrow();
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
  });

  it("rejects a wake time already in the past", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await expect(
      callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(-3_600_000) }),
    ).rejects.toThrow();
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
  });

  it("publishes snooze-changed with { threadId }", async () => {
    const { callRpc, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(3_600_000) });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "snooze-changed",
      payload: { threadId: "thr_a" },
    });
  });

  it("re-snoozing replaces the record", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(3_600_000) });
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(7_200_000) });
    expect(snoozeRecordOf(meta, "thr_a")?.wakeAt).toBe(futureIso(7_200_000));
  });

  it("echoes { threadId, wakeAt }", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    const wakeAt = futureIso(3_600_000);
    expect(
      await callRpc("snooze_set", { threadId: "thr_a", wakeAt }),
    ).toEqual({ threadId: "thr_a", wakeAt });
  });
});

describe("snooze_clear", () => {
  it("removes the record and reports cleared", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", { threadId: "thr_a", wakeAt: futureIso(3_600_000) });
    expect(await callRpc("snooze_clear", { threadId: "thr_a" })).toEqual({
      threadId: "thr_a",
      cleared: true,
    });
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
  });

  it("is idempotent on a never-snoozed thread (cleared: false)", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    expect(await callRpc("snooze_clear", { threadId: "thr_a" })).toEqual({
      threadId: "thr_a",
      cleared: false,
    });
  });

  it("cancels the pending wake timer", async () => {
    const { callRpc, meta, unreadCalls, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", {
      threadId: "thr_a",
      wakeAt: new Date(Date.now() + 1_500).toISOString(),
    });
    await callRpc("snooze_clear", { threadId: "thr_a" });
    // Set and clear published one signal each; capture that count.
    const afterClear = harness.inspection.realtimeSignals.filter(
      (signal: { channel: string }) => signal.channel === "snooze-changed",
    ).length;
    expect(afterClear).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    expect(unreadCalls()).toEqual([]);
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
    // The cancelled wake must not have added a signal on top.
    const signals = harness.inspection.realtimeSignals.filter(
      (signal: { channel: string }) => signal.channel === "snooze-changed",
    );
    expect(signals).toHaveLength(afterClear);
  });
});

describe("the wake timer", () => {
  it("fires near the target time: removes the record, publishes, marks unread", async () => {
    const { callRpc, meta, unreadCalls, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", {
      threadId: "thr_a",
      wakeAt: new Date(Date.now() + 60).toISOString(),
    });
    expect(unreadCalls()).toEqual([]); // nothing yet
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(unreadCalls()).toEqual([{ threadId: "thr_a" }]);
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "snooze-changed",
      payload: { threadId: "thr_a" },
    });
  }, 10_000);

  it("a replaced snooze's stale timer does not fire the old wake", async () => {
    const { callRpc, meta, unreadCalls } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", {
      threadId: "thr_a",
      wakeAt: new Date(Date.now() + 60).toISOString(),
    });
    await callRpc("snooze_set", {
      threadId: "thr_a",
      wakeAt: new Date(Date.now() + 400).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(unreadCalls()).toEqual([]); // old timer passed; fresh record says 400ms out
    expect(snoozeRecordOf(meta, "thr_a")).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(unreadCalls()).toEqual([{ threadId: "thr_a" }]);
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
  }, 10_000);

  it("a thread read since the snooze wakes without the unread mark (snooze consumed)", async () => {
    const { callRpc, meta, unreadCalls, readAt } = await setup({ threads: ["thr_a"] });
    const setAt = await (async () => {
      await callRpc("snooze_set", {
        threadId: "thr_a",
        wakeAt: new Date(Date.now() + 60).toISOString(),
      });
      return Date.parse(snoozeRecordOf(meta, "thr_a")!.setAt);
    })();
    // A genuine read strictly after the set gesture's own mark.
    readAt("thr_a", setAt + 5);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(unreadCalls()).toEqual([]);
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined(); // snooze consumed
  }, 10_000);

  it("a thread missing at wake time just drops its record", async () => {
    const { callRpc, meta, unreadCalls, failGets } = await setup({ threads: ["thr_a"] });
    await callRpc("snooze_set", {
      threadId: "thr_a",
      wakeAt: new Date(Date.now() + 60).toISOString(),
    });
    failGets();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(unreadCalls()).toEqual([]);
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
  }, 10_000);

  it("fires a past-due record immediately at plugin load (daemon restart", async () => {
    // Seed a record whose wake time already passed, then check the armed
    // scan fires without any client gesture.
    const { unreadCalls, meta } = await setup({
      threads: ["thr_a"],
      snoozeSeed: {
        thr_a: { wakeAt: "2020-01-01T00:00:00.000Z", setAt: "2019-01-01T00:00:00.000Z" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(unreadCalls()).toEqual([{ threadId: "thr_a" }]);
    expect(snoozeRecordOf(meta, "thr_a")).toBeUndefined();
  }, 10_000);
});