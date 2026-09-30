// pin_parks_list / pin_park_set over the board's thread-metadata namespace:
// the RPC surface the parked-pin lane-exit rides. done_set composes nothing
// itself — the park is written by the caller that performs the unpin, so
// the RPC stays a dumb, testable record store.
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { setup } from "./helpers/done-fake-host";
import { PIN_PARK_METADATA_KEY } from "../lib/pin-park";

function parkRecordOf(
  meta: Map<string, JsonValue>,
  threadId: string,
): { parkedAt: string } | undefined {
  const namespace = meta.get(threadId) as
    | Record<string, { [key: string]: unknown }>
    | undefined;
  return namespace?.[PIN_PARK_METADATA_KEY] as
    | { parkedAt: string }
    | undefined;
}

describe("pin_park_set", () => {
  it("parking stamps a pin record into the thread's board-metadata namespace", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("pin_park_set", { threadId: "thr_a", parked: true });
    const record = parkRecordOf(meta, "thr_a");
    expect(record).toBeDefined();
    expect(Number.isNaN(Date.parse(record!.parkedAt))).toBe(false);
  });

  it("clearing removes the record; clearing twice is idempotent", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("pin_park_set", { threadId: "thr_a", parked: true });
    await callRpc("pin_park_set", { threadId: "thr_a", parked: false });
    expect(parkRecordOf(meta, "thr_a")).toBeUndefined();
    await callRpc("pin_park_set", { threadId: "thr_a", parked: false });
    expect(parkRecordOf(meta, "thr_a")).toBeUndefined();
  });

  it("re-parking refreshes parkedAt — a prior park never survives a newer gesture", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("pin_park_set", { threadId: "thr_a", parked: true });
    const first = parkRecordOf(meta, "thr_a")!;
    await new Promise((r) => setTimeout(r, 5));
    await callRpc("pin_park_set", { threadId: "thr_a", parked: true });
    const second = parkRecordOf(meta, "thr_a")!;
    expect(Date.parse(second.parkedAt)).toBeGreaterThan(
      Date.parse(first.parkedAt),
    );
  });

  it("echoes { threadId, parked }", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    expect(
      await callRpc("pin_park_set", { threadId: "thr_a", parked: true }),
    ).toEqual({ threadId: "thr_a", parked: true });
  });
});

describe("pin_parks_list", () => {
  it("returns parks for live threads only, parkedAt preserved", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a", "thr_b"] });
    await callRpc("pin_park_set", { threadId: "thr_a", parked: true });
    // A park on a thread the live list no longer reports is dead weight —
    // simulate by writing directly into a namespace threads.list never saw.
    meta.set("thr_gone", { [PIN_PARK_METADATA_KEY]: { parkedAt: "2026-09-29T09:00:00Z" } });
    const result = (await callRpc("pin_parks_list")) as {
      parks: Record<string, { parkedAt: string }>;
    };
    expect(Object.keys(result.parks)).toEqual(["thr_a"]);
  });

  it("an empty board lists nothing", async () => {
    const { callRpc } = await setup({ threads: [] });
    expect(await callRpc("pin_parks_list")).toEqual({ parks: {} });
  });
});