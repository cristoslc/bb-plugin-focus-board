// rank_list / rank_move over the plugin KV store. The pure order mechanics
// live in tests/rank.test.ts; this file pins the RPC surface, the storage
// round trip, and the publish that keeps other boards in sync.
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/done-fake-host";
import { RANK_KV_KEY } from "../lib/rank";

type Rpc = Awaited<ReturnType<typeof setup>>;

const list = async (rpc: Rpc) =>
  (await rpc.callRpc("rank_list", null)) as { orders: Record<string, string[]> };

// `visibleIds` defaults to the column's stored order, which is what the
// display order equals when every visible card is already ranked. Tests that
// exercise unranked cards pass the list explicitly.
const move = async (
  rpc: Rpc,
  columnKey: string,
  threadId: string,
  beforeId: string | null,
  toEnd = false,
  visibleIds?: readonly string[],
) => {
  const seen = visibleIds ?? ((await list(rpc)).orders[columnKey] ?? []);
  return (await rpc.callRpc("rank_move", {
    columnKey,
    threadId,
    beforeId,
    toEnd,
    visibleIds: seen.includes(threadId) ? seen : [...seen, threadId],
  })) as {
    columnKey: string;
    order: string[];
  };
};

describe("rank_list", () => {
  it("reads as no ranks when nothing is stored", async () => {
    const rpc = await setup();
    expect((await list(rpc)).orders).toEqual({});
  });

  it("reads back what rank_move wrote", async () => {
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_b", null);
    expect((await list(rpc)).orders).toEqual({ "status:unread": ["thr_b"] });
  });

  it("keeps each column's order independent", async () => {
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_u", null);
    await move(rpc, "pinned", "thr_p", null);
    expect((await list(rpc)).orders).toEqual({
      "status:unread": ["thr_u"],
      pinned: ["thr_p"],
    });
  });
});

describe("rank_move", () => {
  it("returns the new order and persists it", async () => {
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_a", null);
    const second = await move(rpc, "status:unread", "thr_b", null);
    expect(second.order).toEqual(["thr_b", "thr_a"]);
    expect((await list(rpc)).orders["status:unread"]).toEqual(["thr_b", "thr_a"]);
  });

  it("rejects column keys that are never legitimate", async () => {
    // Security: columnKey becomes a computed object key on the KV store
    // write. `__proto__` would reassign the store object's prototype, and
    // control characters are invisible pollution of the KV row. The
    // contract rejects both shapes before the handler runs.
    const rpc = await setup();
    await expect(
      rpc.callRpc("rank_move", {
        columnKey: "__proto__",
        threadId: "thr_a",
        beforeId: null,
        toEnd: false,
        visibleIds: ["thr_a"],
      }),
    ).rejects.toThrow();
    await expect(
      rpc.callRpc("rank_move", {
        columnKey: "status:\u0000unread",
        threadId: "thr_a",
        beforeId: null,
        toEnd: false,
        visibleIds: ["thr_a"],
      }),
    ).rejects.toThrow();
    // The store is untouched: nothing was written under either key.
    expect(await list(rpc)).toEqual({ orders: {} });
  });

  it("accepts every real key shape", async () => {
    const rpc = await setup();
    for (const columnKey of ["pinned", "done", "status:unread", "project:proj_a", "provider:claude-code", "idle-earlier"]) {
      await expect(
        rpc.callRpc("rank_move", {
          columnKey,
          threadId: "thr_a",
          beforeId: null,
          toEnd: false,
          visibleIds: ["thr_a"],
        }),
      ).resolves.toMatchObject({ columnKey });
    }
  });

  it("publishes rank-changed so other boards refetch", async () => {
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_a", null);
    expect(rpc.harness.inspection.realtimeSignals).toContainEqual({
      channel: "rank-changed",
      payload: { columnKey: "status:unread" },
    });
  });

  it("does not publish when the move changes nothing", async () => {
    // A drop that lands where the card already sits must not trigger a
    // refetch storm across every open board.
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_a", null);
    const signalsAfterFirst = rpc.harness.inspection.realtimeSignals.length;
    await move(rpc, "status:unread", "thr_a", null);
    expect(rpc.harness.inspection.realtimeSignals.length).toBe(signalsAfterFirst);
  });

  it("appends with toEnd instead of using the null anchor", async () => {
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_a", null);
    await move(rpc, "status:unread", "thr_b", null);
    const result = await move(rpc, "status:unread", "thr_a", null, true);
    expect(result.order).toEqual(["thr_b", "thr_a"]);
  });

  it("a move rewrites only the moved card's slot, never the whole order", async () => {
    // The non-clobber property behind the move op: a second board on the same
    // column performs its own move against the stored order, so every card
    // the first board ranked survives it.
    const rpc = await setup();
    await move(rpc, "status:unread", "thr_a", null);
    await move(rpc, "status:unread", "thr_b", null);
    await move(rpc, "status:unread", "thr_c", "thr_b");
    // A later, independent move inserts without disturbing the earlier ones.
    await move(rpc, "status:unread", "thr_d", "thr_a");
    expect((await list(rpc)).orders["status:unread"]).toEqual([
      "thr_c",
      "thr_b",
      "thr_d",
      "thr_a",
    ]);
  });

  it("a move against a store written by someone else keeps their cards", async () => {
    // Simulates a second writer: the row is pre-populated as another board
    // left it, then this board's move is applied on top.
    const rpc = await setup();
    await rpc.kvSet(RANK_KV_KEY, { "status:unread": ["thr_x", "thr_y", "thr_z"] });
    await move(rpc, "status:unread", "thr_mine", "thr_y");
    expect((await list(rpc)).orders["status:unread"]).toEqual([
      "thr_x",
      "thr_mine",
      "thr_y",
      "thr_z",
    ]);
  });

  it("preserves other columns' orders when one column moves", async () => {
    const rpc = await setup();
    await move(rpc, "pinned", "thr_p", null);
    await move(rpc, "status:unread", "thr_a", null);
    await move(rpc, "status:unread", "thr_b", null);
    expect((await list(rpc)).orders.pinned).toEqual(["thr_p"]);
  });

  it("refuses an empty column key rather than writing a junk column", async () => {
    const rpc = await setup();
    await expect(move(rpc, "", "thr_a", null)).rejects.toThrow();
  });
});

describe("a malformed stored row fails loud", () => {
  it("rejects instead of silently reverting to recency", async () => {
    const rpc = await setup();
    await rpc.kvSet(RANK_KV_KEY, { "status:unread": "thr_a" });
    // Silently returning an empty store here would look exactly like the
    // drag never saved.
    await expect(list(rpc)).rejects.toThrow(/not an array/);
  });

  it("an absent row is not a failure", async () => {
    const rpc = await setup();
    expect((await list(rpc)).orders).toEqual({});
  });
});
