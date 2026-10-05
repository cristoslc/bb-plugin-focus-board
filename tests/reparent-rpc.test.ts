// thread_reparent over the host SDK. The drop-a-card-onto-a-card gesture and
// the card menu's "Make Top-Level" both write the parent link through this
// RPC; the handler re-checks lib/reparent's rules against its own fresh
// thread rows (the board's map can be stale) and then calls
// threads.update({ parentThreadId }). The host owns the write itself, so the
// record store here is only a stub of the two SDK methods the handler uses.
import { describe, expect, it } from "vitest";
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

type Row = { id: string; parentThreadId: string | null; isArchived?: boolean };

type RpcHost = {
  host: FakePluginHost;
  updates: { threadId: string; parentThreadId: string | null }[];
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
};

async function setup(rows: Row[]): Promise<RpcHost> {
  const updates: { threadId: string; parentThreadId: string | null }[] = [];
  const host: FakePluginHost = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => rows,
        update: async (args: { threadId: string; parentThreadId?: string | null }) => {
          updates.push({
            threadId: args.threadId,
            parentThreadId: args.parentThreadId ?? null,
          });
          return { ok: true as const };
        },
      },
    },
  });
  await plugin(host.bb);
  return {
    host,
    updates,
    callRpc: (method, input) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
  };
}

describe("thread_reparent", () => {
  it("attach: writes the parent link and echoes it back", async () => {
    const rpc = await setup([
      { id: "thr_parent", parentThreadId: null },
      { id: "thr_dropped", parentThreadId: null },
    ]);
    const result = (await rpc.callRpc("thread_reparent", {
      threadId: "thr_dropped",
      parentThreadId: "thr_parent",
    })) as { threadId: string; parentThreadId: string | null };
    expect(result).toEqual({ threadId: "thr_dropped", parentThreadId: "thr_parent" });
    expect(rpc.updates).toEqual([
      { threadId: "thr_dropped", parentThreadId: "thr_parent" },
    ]);
  });

  it("detach: writes null back to top level", async () => {
    const rpc = await setup([
      { id: "thr_parent", parentThreadId: null },
      { id: "thr_dropped", parentThreadId: "thr_parent" },
    ]);
    await rpc.callRpc("thread_reparent", { threadId: "thr_dropped", parentThreadId: null });
    expect(rpc.updates).toEqual([{ threadId: "thr_dropped", parentThreadId: null }]);
  });

  it("refuses the loop write: dropping a card under its own child", async () => {
    const rpc = await setup([
      { id: "thr_child", parentThreadId: "thr_root" },
      { id: "thr_root", parentThreadId: null },
    ]);
    await expect(
      rpc.callRpc("thread_reparent", { threadId: "thr_root", parentThreadId: "thr_child" }),
    ).rejects.toThrow(/loop/);
    expect(rpc.updates).toEqual([]);
  });

  it("refuses a self drop", async () => {
    const rpc = await setup([{ id: "thr_a", parentThreadId: null }]);
    await expect(
      rpc.callRpc("thread_reparent", { threadId: "thr_a", parentThreadId: "thr_a" }),
    ).rejects.toThrow(/itself/);
    expect(rpc.updates).toEqual([]);
  });

  it("refuses a drop onto its current parent (already a child)", async () => {
    const rpc = await setup([
      { id: "thr_parent", parentThreadId: null },
      { id: "thr_dropped", parentThreadId: "thr_parent" },
    ]);
    await expect(
      rpc.callRpc("thread_reparent", { threadId: "thr_dropped", parentThreadId: "thr_parent" }),
    ).rejects.toThrow(/already/);
    expect(rpc.updates).toEqual([]);
  });

  it("refuses unknown threads without writing", async () => {
    const rpc = await setup([{ id: "thr_a", parentThreadId: null }]);
    await expect(
      rpc.callRpc("thread_reparent", { threadId: "thr_missing", parentThreadId: "thr_a" }),
    ).rejects.toThrow(/dropped/);
    await expect(
      rpc.callRpc("thread_reparent", { threadId: "thr_a", parentThreadId: "thr_missing" }),
    ).rejects.toThrow(/target/);
    expect(rpc.updates).toEqual([]);
  });

  it("rejects blank ids at the contract, before the handler", async () => {
    const rpc = await setup([{ id: "thr_a", parentThreadId: null }]);
    await expect(rpc.callRpc("thread_reparent", { threadId: "", parentThreadId: "thr_a" }))
      .rejects.toThrow();
    await expect(rpc.callRpc("thread_reparent", { threadId: "thr_a", parentThreadId: "" }))
      .rejects.toThrow();
    expect(rpc.updates).toEqual([]);
  });
});