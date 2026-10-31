// Issue #84: `bb focus-board group` grows create/rename/delete/add/remove/
// move beyond its read-only list. Red-first against commands the registry
// does not carry yet (same shape as the group-rpc suite).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi, PluginCliExecutionResult } from "@get-bb/plugin-sdk";
import type { FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import server from "../server";
import { GROUP_METADATA_KEY, GROUPS_KV_KEY, parseGroupsStore } from "../lib/group-metadata";

type Bb = BbPluginApi;

describe("bb focus-board group CLI (create/rename/delete/add/remove/move)", () => {
  let bb: Bb;
  let harness: FakePluginHarness;
  let metadata: Map<string, Record<string, unknown>>;
  let listedThreads: ReturnType<typeof makeThreadResponse>[];
  let archivedThreads: ReturnType<typeof makeThreadResponse>[];

  beforeEach(() => {
    metadata = new Map();
    listedThreads = [];
    archivedThreads = [];
  });

  async function load(): Promise<void> {
    const host = createFakePluginHost({
      pluginId: "focus-board",
      sdk: {
        threads: {
          list: async (args?: { archived?: boolean; limit?: number }) =>
            args?.archived ? archivedThreads : listedThreads,
          getPluginMetadata: async ({ threadId }: { threadId: string }) =>
            metadata.get(threadId) ?? {},
          updatePluginMetadata: async ({
            threadId,
            set,
            remove,
          }: {
            threadId: string;
            set?: Record<string, unknown>;
            remove?: string[];
          }) => {
            const current = { ...(metadata.get(threadId) ?? {}) };
            if (set) Object.assign(current, set);
            for (const key of remove ?? []) delete current[key];
            metadata.set(threadId, current);
            return current;
          },
        },
      },
    });
    bb = host.bb;
    harness = host.harness;
    await server(bb);
  }

  afterEach(async () => {
    await harness.lifecycle.dispose();
  });

  async function run(argv: string[]): Promise<PluginCliExecutionResult> {
    return harness.behavior.runCli(argv);
  }

  /** A registry record created outside the CLI (the RPC path). */
  async function callRpc(method: string, input?: unknown): Promise<Record<string, unknown>> {
    return (await harness.behavior.callRpc(method, input)) as Record<string, unknown>;
  }

  async function createGroup(name: string): Promise<string> {
    const out = await callRpc("group_create", { name });
    return (out.group as { id: string }).id;
  }

  async function registry(): Promise<Record<string, { name: string; createdAt: string }>> {
    return parseGroupsStore(await bb.storage.kv.get(GROUPS_KV_KEY));
  }

  function assignedTo(threadId: string): string | undefined {
    const record = metadata.get(threadId)?.[GROUP_METADATA_KEY] as
      | { groupId?: string }
      | undefined;
    return record?.groupId;
  }

  function groupSignals(): Array<{ channel: string; payload: unknown }> {
    return harness.inspection.realtimeSignals.filter(
      (signal) => signal.channel === "group-changed",
    );
  }

  describe("group create", () => {
    it("creates the registry record and reports the id and name", async () => {
      await load();
      const result = await run(["group", "create", "BV-INC-10"]);
      expect(result.exitCode).toBe(0);
      const store = await registry();
      const entries = Object.entries(store);
      expect(entries).toHaveLength(1);
      const [id, record] = entries[0]!;
      expect(record.name).toBe("BV-INC-10");
      expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
      expect(result.stdout).toContain(`created ${id}`);
      expect(result.stdout).toContain("BV-INC-10");
    });

    it("emits { group, created } with --json", async () => {
      await load();
      const result = await run(["group", "create", "BV-INC-10", "--json"]);
      const parsed = JSON.parse(result.stdout) as {
        group: { id: string; name: string; createdAt: string };
        created: boolean;
      };
      expect(parsed.created).toBe(true);
      expect(parsed.group.name).toBe("BV-INC-10");
      expect(Object.keys(await registry())).toEqual([parsed.group.id]);
    });

    it("re-creating the exact name returns the existing record (idempotent)", async () => {
      await load();
      const first = JSON.parse(
        (await run(["group", "create", "Auth rework", "--json"])).stdout,
      ) as { group: { id: string } };
      const second = JSON.parse(
        (await run(["group", "create", "Auth rework", "--json"])).stdout,
      ) as { group: { id: string }; created: boolean };
      expect(second.created).toBe(false);
      expect(second.group.id).toBe(first.group.id);
      expect(Object.keys(await registry())).toHaveLength(1);
    });

    it("rejects a blank name and a name over 80 characters", async () => {
      await load();
      expect((await run(["group", "create", "   "])).exitCode).toBe(1);
      expect(
        (await run(["group", "create", "x".repeat(81)])).exitCode,
      ).toBe(1);
    });

    it("publishes group-changed so a live board gains the new group", async () => {
      await load();
      await run(["group", "create", "BV-INC-10"]);
      expect(groupSignals()).toContainEqual({
        channel: "group-changed",
        payload: { threadId: null },
      });
    });
  });

  describe("group rename", () => {
    it("renames by exact current name and by id", async () => {
      await load();
      const id = await createGroup("Old name");
      const byName = await run(["group", "rename", "Old name", "New name"]);
      expect(byName.exitCode).toBe(0);
      expect((await registry())[id]?.name).toBe("New name");
      const byId = await run(["group", "rename", id, "Even newer"]);
      expect(byId.exitCode).toBe(0);
      expect((await registry())[id]?.name).toBe("Even newer");
    });

    it("emits the group record with --json", async () => {
      await load();
      const id = await createGroup("Old name");
      const result = await run(["group", "rename", id, "New name", "--json"]);
      const parsed = JSON.parse(result.stdout) as {
        group: { id: string; name: string; createdAt: string };
      };
      expect(parsed.group.id).toBe(id);
      expect(parsed.group.name).toBe("New name");
    });

    it("fails loud on an unknown group and on an invalid new name", async () => {
      await load();
      await createGroup("Old name");
      const unknown = await run(["group", "rename", "Nope", "X"]);
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toMatch(/does not exist/);
      const tooLong = await run(["group", "rename", "Old name", "x".repeat(81)]);
      expect(tooLong.exitCode).toBe(1);
    });

    it("refuses a name another group holds, naming it, and keeps both records", async () => {
      await load();
      const alpha = await createGroup("Alpha");
      const beta = await createGroup("Beta");
      const result = await run(["group", "rename", "Alpha", "Beta"]);
      expect(result.exitCode).toBe(1);
      // The refusal is quotable and names the holder, so an operator or an
      // agent can go straight to the group that owns the name.
      expect(result.stderr).toMatch(/already taken by group/);
      expect(result.stderr).toContain(beta);
      expect(await registry()).toEqual({
        [alpha]: expect.objectContaining({ name: "Alpha" }),
        [beta]: expect.objectContaining({ name: "Beta" }),
      });
    });

    it("renaming a group onto its own name is a no-op success", async () => {
      await load();
      const id = await createGroup("Alpha");
      const before = groupSignals().length;
      const result = await run(["group", "rename", "Alpha", "Alpha"]);
      expect(result.exitCode).toBe(0);
      expect((await registry())[id].name).toBe("Alpha");
      expect(groupSignals().length).toBe(before);
    });
  });

  describe("group delete", () => {
    it("deletes by exact name and strips every member's assignment, archived included", async () => {
      await load();
      const id = await createGroup("BV-INC-10");
      listedThreads = [makeThreadResponse({ id: "thr_a" }), makeThreadResponse({ id: "thr_b" })];
      archivedThreads = [makeThreadResponse({ id: "thr_gone" })];
      for (const threadId of ["thr_a", "thr_b", "thr_gone"]) {
        metadata.set(threadId, { group: { groupId: id } });
      }
      const result = await run(["group", "delete", "BV-INC-10"]);
      expect(result.exitCode).toBe(0);
      expect(await registry()).toEqual({});
      for (const threadId of ["thr_a", "thr_b", "thr_gone"]) {
        expect(metadata.get(threadId)?.[GROUP_METADATA_KEY]).toBeUndefined();
      }
      expect(groupSignals().length).toBeGreaterThan(0);
    });

    it("emits { deleted, cleared } with --json", async () => {
      await load();
      const id = await createGroup("BV-INC-10");
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      metadata.set("thr_a", { group: { groupId: id } });
      const result = await run(["group", "delete", "BV-INC-10", "--json"]);
      const parsed = JSON.parse(result.stdout) as {
        deleted: { id: string; name: string };
        cleared: string[];
      };
      expect(parsed.deleted).toEqual({ id, name: "BV-INC-10" });
      expect(parsed.cleared).toEqual(["thr_a"]);
    });

    it("refuses an unknown group (typo protection, not idempotent)", async () => {
      await load();
      const result = await run(["group", "delete", "Nope"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/does not exist/);
    });
  });

  describe("group add", () => {
    it("assigns threads to the group, resolving the group by exact name", async () => {
      await load();
      const id = await createGroup("BV-INC-10");
      listedThreads = [makeThreadResponse({ id: "thr_a" }), makeThreadResponse({ id: "thr_b" })];
      const result = await run(["group", "add", "BV-INC-10", "thr_a", "thr_b"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("added thr_a");
      expect(result.stdout).toContain("added thr_b");
      expect(assignedTo("thr_a")).toBe(id);
      expect(assignedTo("thr_b")).toBe(id);
    });

    it("is idempotent for a thread already in the group", async () => {
      await load();
      const id = await createGroup("BV-INC-10");
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      const first = await run(["group", "add", "BV-INC-10", "thr_a"]);
      expect(first.exitCode).toBe(0);
      const signalsAfterFirst = groupSignals().length;
      const second = await run(["group", "add", "BV-INC-10", "thr_a"]);
      expect(second.exitCode).toBe(0);
      expect(second.stdout).toContain("already thr_a");
      expect(assignedTo("thr_a")).toBe(id);
      expect(groupSignals().length).toBe(signalsAfterFirst);
    });

    it("refuses the whole batch when a thread already sits in another group", async () => {
      await load();
      const first = await createGroup("G1");
      await createGroup("G2");
      listedThreads = [makeThreadResponse({ id: "thr_a" }), makeThreadResponse({ id: "thr_b" })];
      metadata.set("thr_a", { group: { groupId: first } });
      const result = await run(["group", "add", "G2", "thr_a", "thr_b"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("thr_a");
      expect(result.stderr).toContain("group move");
      // Nothing written: the unrelated thread keeps its unassigned state.
      expect(metadata.get("thr_b")?.[GROUP_METADATA_KEY]).toBeUndefined();
      expect(assignedTo("thr_a")).toBe(first);
    });

    it("emits { added, already } with --json", async () => {
      await load();
      await createGroup("BV-INC-10");
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      const first = await run(["group", "add", "BV-INC-10", "thr_a", "--json"]);
      expect(JSON.parse(first.stdout)).toEqual({ added: ["thr_a"], already: [] });
      const second = await run(["group", "add", "BV-INC-10", "thr_a", "--json"]);
      expect(JSON.parse(second.stdout)).toEqual({ added: [], already: ["thr_a"] });
    });

    it("fails loud on an unknown group and on no thread ids", async () => {
      await load();
      const unknown = await run(["group", "add", "Nope", "thr_a"]);
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toMatch(/does not exist/);
      const missing = await run(["group", "add", "BV-INC-10"]);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("missing required");
    });
  });

  describe("group remove", () => {
    it("clears the assignment and reports the previous group", async () => {
      await load();
      await createGroup("BV-INC-10");
      const byName = (await callRpc("groups_list")) as {
        groups: Record<string, unknown>;
      };
      const id = Object.keys(byName.groups)[0]!;
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      metadata.set("thr_a", { group: { groupId: id } });
      const result = await run(["group", "remove", "thr_a"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("removed thr_a");
      expect(metadata.get("thr_a")?.[GROUP_METADATA_KEY]).toBeUndefined();
    });

    it("is idempotent when the thread is not in a group", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_never" })];
      const result = await run(["group", "remove", "thr_never"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("removed thr_never");
      expect(result.stdout).toContain("was not in a group");
    });

    it("a group emptied by removing keeps only its survivors' members", async () => {
      await load();
      const id = await createGroup("BV-INC-10");
      listedThreads = [makeThreadResponse({ id: "thr_a" }), makeThreadResponse({ id: "thr_b" })];
      for (const threadId of ["thr_a", "thr_b"]) {
        metadata.set(threadId, { group: { groupId: id } });
      }
      await run(["group", "remove", "thr_a"]);
      // One survivor left → the record stays (only-exists-while-assigned).
      expect(Object.keys(await registry())).toEqual([id]);
      await run(["group", "remove", "thr_b"]);
      expect(await registry()).toEqual({});
    });

    it("emits { removed: [{ threadId, groupId }] } with --json", async () => {
      await load();
      await createGroup("BV-INC-10");
      const { groups } = (await callRpc("groups_list")) as {
        groups: Record<string, unknown>;
      };
      const id = Object.keys(groups)[0]!;
      listedThreads = [makeThreadResponse({ id: "thr_a" }), makeThreadResponse({ id: "thr_b" })];
      metadata.set("thr_a", { group: { groupId: id } });
      const result = await run(["group", "remove", "thr_a", "thr_b", "--json"]);
      expect(JSON.parse(result.stdout)).toEqual({
        removed: [
          { threadId: "thr_a", groupId: id },
          { threadId: "thr_b", groupId: null },
        ],
      });
    });
  });

  describe("group move", () => {
    it("replaces any current group and GCs the emptied one", async () => {
      await load();
      const from = await createGroup("G1");
      const to = await createGroup("G2");
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      metadata.set("thr_a", { group: { groupId: from } });
      const result = await run(["group", "move", "thr_a", "--to", "G2"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("moved thr_a");
      expect(assignedTo("thr_a")).toBe(to);
      // G1 lost its last member through the move.
      expect(Object.keys(await registry())).toEqual([to]);
    });

    it("is idempotent when the thread is already in the target", async () => {
      await load();
      const to = await createGroup("G2");
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      metadata.set("thr_a", { group: { groupId: to } });
      const result = await run(["group", "move", "thr_a", "--to", "G2"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("unchanged thr_a");
    });

    it("emits { moved, unchanged } with --json", async () => {
      await load();
      const from = await createGroup("G1");
      const to = await createGroup("G2");
      listedThreads = [makeThreadResponse({ id: "thr_a" }), makeThreadResponse({ id: "thr_b" })];
      metadata.set("thr_a", { group: { groupId: from } });
      metadata.set("thr_b", { group: { groupId: to } });
      const result = await run(["group", "move", "thr_a", "thr_b", "--to", "G2", "--json"]);
      expect(JSON.parse(result.stdout)).toEqual({
        moved: [{ threadId: "thr_a", from }],
        unchanged: ["thr_b"],
      });
    });

    it("fails loud when --to is missing or names no group", async () => {
      await load();
      await createGroup("G1");
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      const missing = await run(["group", "move", "thr_a"]);
      expect(missing.exitCode).toBe(1);
      const unknown = await run(["group", "move", "thr_a", "--to", "Nope"]);
      expect(unknown.exitCode).toBe(1);
      expect(unknown.stderr).toMatch(/does not exist/);
      expect(metadata.get("thr_a")?.[GROUP_METADATA_KEY]).toBeUndefined();
    });
  });

  describe("group reference resolution (id or exact name)", () => {
    it("an ambiguous exact-name ref fails loud naming the ids", async () => {
      await load();
      const id1 = await createGroup("Twins");
      // A duplicate name cannot come from create (it is idempotent) — write
      // the duplicate record by hand the way a manual KV edit would.
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      const existing = await registry();
      const id2 = "grp_twins_two";
      await bb.storage.kv.set(GROUPS_KV_KEY, {
        ...existing,
        [id2]: { name: "Twins", createdAt: new Date().toISOString() },
      });
      const result = await run(["group", "add", "Twins", "thr_a"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(id1);
      expect(result.stderr).toContain(id2);
      expect(metadata.get("thr_a")?.[GROUP_METADATA_KEY]).toBeUndefined();
    });

    it("a missing ref fails loud with the group list's door", async () => {
      await load();
      const result = await run(["group", "add", "Nope", "thr_a"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("group list");
    });
  });
});