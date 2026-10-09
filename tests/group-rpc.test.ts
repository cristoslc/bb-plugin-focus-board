import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import {
  GROUP_METADATA_KEY,
  GROUPS_KV_KEY,
  parseGroupsStore,
} from "../lib/group-metadata";

// Red-first: the fake host has no group handlers until server.ts grows
// them, so these suites fail before the wiring lands (same shape as the
// link-RPC suite).

export type GroupTestHost = {
  host: ReturnType<typeof createFakePluginHost>;
  harness: ReturnType<typeof createFakePluginHost>["harness"];
  meta: Map<string, string>;
  kv: Map<string, unknown>;
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
};

export async function setup(opts: {
  threads?: string[];
  archived?: string[];
} = {}): Promise<GroupTestHost> {
  const metaStore = new Map<string, { [key: string]: unknown }>();
  const kv = new Map<string, unknown>();
  const liveIds = opts.threads ?? ["thr_a"];
  const archivedIds = opts.archived ?? [];
  const host = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async (args?: { archived?: boolean; limit?: number }) =>
          (args?.archived === true ? archivedIds : liveIds).map((id) => ({
            id,
            archivedAt: args?.archived === true ? 1000 : null,
          })),
        get: async (args: { threadId: string }) => ({ id: args.threadId, projectId: "proj_test" }),
        getPluginMetadata: async (args: { threadId: string }) =>
          (metaStore.get(args.threadId) ?? {}) as never,
        updatePluginMetadata: async (args: {
          threadId: string;
          set?: Record<string, unknown>;
          remove?: string[];
        }) => {
          const current = metaStore.get(args.threadId) ?? {};
          const next = { ...current };
          if (args.set) Object.assign(next, args.set);
          for (const key of args.remove ?? []) delete next[key];
          metaStore.set(args.threadId, next);
          return next as never;
        },
      },
    },
  });
  Object.defineProperty(host.bb.storage, "kv", {
    value: {
      get: async (key: string) => kv.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        kv.set(key, value);
        return value;
      },
    },
  });
  await plugin(host.bb as never);
  return {
    host,
    harness: host.harness,
    meta: metaStore as unknown as Map<string, string>,
    kv,
    callRpc: (method, input) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
  };
}

describe("group_create over the registry KV", () => {
  it("stores a named record with a parseable createdAt and publishes group-changed", async () => {
    const { callRpc, kv, harness } = await setup();
    const result = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string; name: string; createdAt: string };
    };
    expect(result.group.name).toBe("Auth rework");
    expect(Number.isNaN(Date.parse(result.group.createdAt))).toBe(false);
    expect(parseGroupsStore(await Promise.resolve(kv.get(GROUPS_KV_KEY)))).toEqual({
      [result.group.id]: { name: result.group.name, createdAt: result.group.createdAt },
    });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "group-changed",
      payload: { threadId: null },
    });
  });

  it("rejects a blank name (fail loud)", async () => {
    const { callRpc } = await setup();
    await expect(callRpc("group_create", { name: "   " })).rejects.toThrow();
  });

  it("rejects a name over 80 characters", async () => {
    const { callRpc } = await setup();
    await expect(callRpc("group_create", { name: "x".repeat(81) })).rejects.toThrow();
  });
});

describe("group_rename", () => {
  it("renames in place and propagates through the registry (one record, all members)", async () => {
    const { callRpc, kv } = await setup();
    const created = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string };
    };
    const renamed = (await callRpc("group_rename", { groupId: created.group.id, name: "Auth v2" })) as {
      group: { name: string };
    };
    expect(renamed.group.name).toBe("Auth v2");
    const store = parseGroupsStore(kv.get(GROUPS_KV_KEY));
    expect(store[created.group.id].name).toBe("Auth v2");
  });

  it("renaming an unknown group fails loud", async () => {
    const { callRpc } = await setup();
    await expect(
      callRpc("group_rename", { groupId: "ghost", name: "nope" }),
    ).rejects.toThrow();
  });
});

describe("group_set over thread plugin metadata", () => {
  it("assigns threads and reports memberships in groups_list", async () => {
    const { callRpc } = await setup({ threads: ["thr_a", "thr_b", "thr_c"] });
    const created = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_a", groupId: created.group.id });
    await callRpc("group_set", { threadId: "thr_b", groupId: created.group.id });
    await expect(callRpc("groups_list", null)).resolves.toEqual({
      groups: expect.objectContaining({
        [created.group.id]: expect.objectContaining({ name: "Auth rework" }),
      }),
      memberships: { thr_a: created.group.id, thr_b: created.group.id },
    });
  });

  it("assigning to an unknown group fails loud", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    await expect(
      callRpc("group_set", { threadId: "thr_a", groupId: "ghost" }),
    ).rejects.toThrow();
  });

  it("prunes the registry when the LAST member is unassigned", async () => {
    const { callRpc, kv } = await setup({ threads: ["thr_a", "thr_b"] });
    const created = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_a", groupId: created.group.id });
    await callRpc("group_set", { threadId: "thr_a", groupId: null });
    // thr_b was never assigned; the registry must be empty now.
    expect(parseGroupsStore(kv.get(GROUPS_KV_KEY))).toEqual({});
  });

  it("keeps the record while another member (live or archived) holds it", async () => {
    const { callRpc, kv } = await setup({
      threads: ["thr_a"],
      archived: ["thr_z"],
    });
    const created = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_z", groupId: created.group.id });
    await callRpc("group_set", { threadId: "thr_a", groupId: created.group.id });
    await callRpc("group_set", { threadId: "thr_a", groupId: null });
    expect(parseGroupsStore(kv.get(GROUPS_KV_KEY))[created.group.id].name).toBe("Auth rework");
  });

  it("a reassignment moves ONE thread, not the group", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a", "thr_b"] });
    const created = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_a", groupId: created.group.id });
    const second = (await callRpc("group_create", { name: "Search v2" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_a", groupId: second.group.id });
    const namespace = meta.get("thr_a") as unknown as Record<string, { groupId: string }>;
    expect(namespace[GROUP_METADATA_KEY].groupId).toBe(second.group.id);
    // And the abandoned group evaporated on the write (it held nobody).
    const list = (await callRpc("groups_list", null)) as {
      groups: Record<string, { name: string }>;
      memberships: Record<string, string>;
    };
    expect(list.memberships).toEqual({ thr_a: second.group.id });
    expect(Object.values(list.groups).map((group) => group.name)).toEqual(["Search v2"]);
  });

  it("membership persists on an archived thread (no board surface, no data loss)", async () => {
    const { callRpc, kv } = await setup({ threads: [], archived: ["thr_z"] });
    const created = (await callRpc("group_create", { name: "Auth rework" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_z", groupId: created.group.id });
    // groups_list reports ONLY live memberships, but the registry keeps the
    // group: the assignment metadata survives archiving.
    const list = (await callRpc("groups_list", null)) as { memberships: Record<string, string> };
    expect(list.memberships).toEqual({});
    expect(parseGroupsStore(kv.get(GROUPS_KV_KEY))).not.toEqual({});
  });
});

describe("groups_list fail-loud guards", () => {
  it("a malformed membership record throws (never coerces)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_bad"] });
    meta.set("thr_bad", { group: "nope" } as unknown as string);
    await expect(callRpc("groups_list", null)).rejects.toThrow(/group metadata/);
  });
});