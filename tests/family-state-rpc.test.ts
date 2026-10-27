// Family fold + idle-hide server state: the per-family collapse and idle-hide
// sets move off browser localStorage onto a plugin-wide KV row so they follow
// across every window and machine.
//
// Red-first: the fake host has no family_state handlers until server.ts grows
// them, so every suite here throws "no RPC handler" before the wiring lands
// (same shape as the group-RPC and link-RPC suites).
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { FAMILY_STATE_KV_KEY } from "../lib/family-state";

async function setup(opts: { threads?: string[] } = {}) {
  const host = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => (opts.threads ?? []).map((id) => ({ id })),
      },
    },
  });
  await plugin(host.bb as never);
  return {
    host,
    harness: host.harness,
    kv: host.bb.storage.kv,
    callRpc: (method: string, input?: unknown) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
  };
}

describe("family_state_list", () => {
  it("answers empty lists on a fresh store (no row is not a failure)", async () => {
    const { callRpc } = await setup();
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: [],
      hideIdleChildren: [],
    });
  });

  it("fails loud on a malformed stored row (never coerces)", async () => {
    const { callRpc, kv } = await setup();
    await kv.set(FAMILY_STATE_KV_KEY, { collapsedFamilies: "not an array" });
    await expect(callRpc("family_state_list", null)).rejects.toThrow(/family state/);
  });
});

describe("family_state_set", () => {
  it("adds an id, persists the row, and publishes family-state-changed", async () => {
    const { callRpc, kv, harness } = await setup();
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_a",
      on: true,
    });
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: ["thr_a"],
      hideIdleChildren: [],
    });
    expect(await kv.get(FAMILY_STATE_KV_KEY)).toEqual({
      collapsedFamilies: ["thr_a"],
      hideIdleChildren: [],
    });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "family-state-changed",
      payload: { key: "collapsedFamilies", id: "thr_a", on: true },
    });
  });

  it("removes an id when on is false", async () => {
    const { callRpc } = await setup();
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_a",
      on: true,
    });
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_a",
      on: false,
    });
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: [],
      hideIdleChildren: [],
    });
  });

  it("keeps the two sets independent (fold does not hide, hide does not fold)", async () => {
    const { callRpc } = await setup();
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_a",
      on: true,
    });
    await callRpc("family_state_set", {
      key: "hideIdleChildren",
      id: "thr_b",
      on: true,
    });
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: ["thr_a"],
      hideIdleChildren: ["thr_b"],
    });
  });

  it("a Done-projection key (done:<parent id>) round-trips like any id", async () => {
    const { callRpc } = await setup();
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "done:thr_parent",
      on: true,
    });
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: ["done:thr_parent"],
      hideIdleChildren: [],
    });
  });

  it("a no-op toggle writes nothing and publishes nothing", async () => {
    const { callRpc, harness } = await setup();
    harness.inspection.realtimeSignals.length = 0;
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_a",
      on: false,
    });
    expect(harness.inspection.realtimeSignals).toEqual([]);
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: [],
      hideIdleChildren: [],
    });
  });

  it("two concurrent toggles on different ids both survive (the KV write lock)", async () => {
    const { callRpc } = await setup();
    await Promise.all([
      callRpc("family_state_set", { key: "collapsedFamilies", id: "thr_a", on: true }),
      callRpc("family_state_set", { key: "collapsedFamilies", id: "thr_b", on: true }),
    ]);
    await expect(callRpc("family_state_list", null)).resolves.toEqual({
      collapsedFamilies: ["thr_a", "thr_b"],
      hideIdleChildren: [],
    });
  });
});

describe("family_state_merge (the one-time localStorage migration)", () => {
  it("unions the incoming ids into the stored row and publishes once", async () => {
    const { callRpc, harness } = await setup();
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_server",
      on: true,
    });
    harness.inspection.realtimeSignals.length = 0;
    await expect(
      callRpc("family_state_merge", {
        collapsedFamilies: ["thr_local"],
        hideIdleChildren: ["thr_hidden"],
      }),
    ).resolves.toEqual({
      collapsedFamilies: ["thr_local", "thr_server"],
      hideIdleChildren: ["thr_hidden"],
    });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "family-state-changed",
      payload: { key: null, id: null, on: null },
    });
  });

  it("with nothing new writes nothing and publishes nothing", async () => {
    const { callRpc, harness } = await setup();
    await callRpc("family_state_set", {
      key: "collapsedFamilies",
      id: "thr_a",
      on: true,
    });
    harness.inspection.realtimeSignals.length = 0;
    await expect(
      callRpc("family_state_merge", {
        collapsedFamilies: ["thr_a"],
        hideIdleChildren: [],
      }),
    ).resolves.toEqual({ collapsedFamilies: ["thr_a"], hideIdleChildren: [] });
    expect(harness.inspection.realtimeSignals).toEqual([]);
  });
});
