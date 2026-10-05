// Rank-write serialization tests.
//
// The 1.0 hardening pass found a real bug here: rank_move's read-merge-write
// cycle over one KV row had an interleaving window, and a gated interleave
// made writer A's stale spread revert writer B's column entirely (the pinned
// write came back undone). The fix serializes every rank write through an
// in-process queue (withRankWriteLock in server.ts); these tests pin what
// that serialization guarantees.
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { RANK_KV_KEY } from "../lib/rank";

type Deferred = { promise: Promise<void>; release: () => void };

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function setup(): Promise<{
  host: FakePluginHost;
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
  kvGet: (key: string) => Promise<unknown>;
  gateNextSet: (key: string) => Deferred;
}> {
  const store = new Map<string, unknown>();
  const host: FakePluginHost = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => [],
        getPluginMetadata: async () => ({}),
        updatePluginMetadata: async (args: { threadId: string }) => args,
      },
    },
  });
  const kv = host.bb.storage.kv;
  const rawGet = kv.get.bind(kv);
  const rawSet = kv.set.bind(kv);
  const gates = new Map<string, Deferred>();
  kv.get = (async (key: string) => rawGet(key)) as typeof kv.get;
  kv.set = (async (key: string, value: unknown) => {
    const gate = gates.get(key);
    if (gate !== undefined) {
      gates.delete(key);
      await gate.promise;
    }
    await rawSet(key, value);
  }) as typeof kv.set;
  await plugin(host.bb);
  return {
    host,
    callRpc: (method, input) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
    kvGet: async (key) => (await rawGet(key)) as unknown,
    gateNextSet: (key) => {
      const gate = deferred();
      gates.set(key, gate);
      return gate;
    },
  };
}

describe("interleaved rank_move writes", () => {
  it("a move held mid-write blocks the next move: the store keeps the seeded order until the write lands", async () => {
    const { callRpc, kvGet, gateNextSet } = await setup();
    await callRpc("rank_move", {
      columnKey: "status:unread",
      threadId: "x1",
      beforeId: null,
      toEnd: false,
      visibleIds: ["x1", "x2", "x3"],
    });
    await callRpc("rank_move", {
      columnKey: "status:unread",
      threadId: "x2",
      beforeId: null,
      toEnd: false,
      visibleIds: ["x1", "x2", "x3"],
    });

    // Writer A is gated inside its kv.set, holding the rank write lock.
    const gateA = gateNextSet(RANK_KV_KEY);
    const moveA = callRpc("rank_move", {
      columnKey: "status:unread",
      threadId: "x3",
      beforeId: "x1",
      toEnd: false,
      visibleIds: ["x1", "x2", "x3"],
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // While A is held, the store still reads the seeded order — writer A
    // has not landed, and (serialization) nothing else can land either.
    const held = (await kvGet(RANK_KV_KEY)) as { "status:unread"?: string[] };
    expect(held["status:unread"]).toEqual(["x2", "x1"]);

    // Writer B queues behind the lock. Release A; B runs after A.
    const moveB = callRpc("rank_move", {
      columnKey: "status:unread",
      threadId: "x2",
      beforeId: null,
      toEnd: true,
      visibleIds: ["x1", "x2", "x3"],
    });
    gateA.release();
    await moveA;
    await moveB;

    // B ran on A's landed state, so B's intent wins, applied whole — a
    // permutation of the column, never a partial merge.
    const stored = (await kvGet(RANK_KV_KEY)) as { "status:unread"?: string[] };
    expect(stored["status:unread"]).toEqual(["x1", "x3", "x2"]);
  });

  it("a queued move on another column runs after the held one and both columns keep their own content", async () => {
    const { callRpc, kvGet, gateNextSet } = await setup();
    // Seed both columns by real moves.
    await callRpc("rank_move", {
      columnKey: "status:unread",
      threadId: "u1",
      beforeId: null,
      toEnd: false,
      visibleIds: ["u1", "u2"],
    });
    await callRpc("rank_move", {
      columnKey: "pinned",
      threadId: "p1",
      beforeId: null,
      toEnd: false,
      visibleIds: ["p1", "p2"],
    });

    // Writer A (unread column) is gated inside its kv.set, holding the lock.
    const gate = gateNextSet(RANK_KV_KEY);
    const moveA = callRpc("rank_move", {
      columnKey: "status:unread",
      threadId: "u2",
      beforeId: "u1",
      toEnd: false,
      visibleIds: ["u1", "u2"],
    });
    // Writer B (pinned column) queues behind A — started now, awaited only
    // after the release, because B cannot interleave into A's cycle.
    const moveB = callRpc("rank_move", {
      columnKey: "pinned",
      threadId: "p2",
      beforeId: null,
      toEnd: false,
      visibleIds: ["p1", "p2"],
    });
    gate.release();
    await moveA;
    await moveB;

    // Each column holds exactly its own cards in its last writer's order:
    // A's unread order landed first, and B — running after it — reordered
    // pinned on the fresh store. Before the lock, A's stale spread reverted
    // B's pinned write entirely (the red run of this suite).
    const stored = (await kvGet(RANK_KV_KEY)) as Record<string, string[]>;
    expect(stored["status:unread"]).toEqual(["u2", "u1"]);
    expect(stored["pinned"]).toEqual(["p2", "p1"]);
  });
});
