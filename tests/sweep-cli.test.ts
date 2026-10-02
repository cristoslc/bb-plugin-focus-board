import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import server from "../server";

const DAY_MS = 24 * 60 * 60 * 1000;
// The server CLI sweeps with the real clock (the pure eligibility core takes
// an injected `now`; the CLI entry feeds it Date.now() and offers no seam).
// Fixtures must therefore be relative to the real clock: a pinned NOW made
// "done 2 days ago" cross the 7-day threshold five days after this file was
// written, time-bombing the below-threshold test (observed 2026-10-01).
const NOW = Date.now();

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

// A thread whose updatedAt sits `days` ago, never done, never archived.
function idleThread(id: string, daysAgo: number) {
  return makeThreadResponse({ id, updatedAt: NOW - daysAgo * DAY_MS });
}

describe("bb focus-board sweep", () => {
  let harness: FakePluginHarness;
  let bb: BbPluginApi;
  let metadata: Map<string, Record<string, unknown>>;
  let listedThreads: ReturnType<typeof makeThreadResponse>[];
  let archived: string[];

  beforeEach(() => {
    metadata = new Map();
    listedThreads = [];
    archived = [];
  });

  async function load(): Promise<void> {
    const host = createFakePluginHost({
      pluginId: "focus-board",
      sdk: {
        threads: {
          list: async () => listedThreads,
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
          archive: async ({ threadId }: { threadId: string }) => {
            archived.push(threadId);
            return { archivedAt: Date.now() };
          },
        },
      },
    });
    harness = host.harness;
    bb = host.bb;
    await server(bb);
  }

  /** Seed the legacy KV row (imported on demand inside the sweep). */
  async function storeLegacy(ids: string[]): Promise<void> {
    await bb.storage.kv.set("done-thread-ids", ids);
  }

  afterEach(async () => {
    await harness.lifecycle.dispose();
  });

  function archiveArgs(): string[] {
    return harness.inspection.sdk
      .callsTo("threads.archive")
      .map((args) => (args[0] as { threadId: string }).threadId);
  }

  describe("dry-run (no --confirm)", () => {
    it("prints the eligible set with reasons and exits 1", async () => {
      await load();
      listedThreads = [
        idleThread("thr_old", 40),
        idleThread("thr_fresh", 1),
      ];
      metadata.set("thr_done", { done: { doneAt: iso(10 * DAY_MS) } });
      listedThreads.push(makeThreadResponse({ id: "thr_done" }));

      const result = await harness.behavior.runCli(["sweep"]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("thr_old");
      expect(result.stdout).toContain("idle longer than 30d");
      expect(result.stdout).toContain("thr_done");
      expect(result.stdout).toContain("done longer than 7d");
      expect(result.stdout).toContain("--confirm");
      expect(archived).toEqual([]);
      expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    });

    it("reports no eligible threads without archiving", async () => {
      await load();
      listedThreads = [idleThread("thr_fresh", 1)];
      const result = await harness.behavior.runCli(["sweep", "--json"]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({ eligible: [], count: 0 });
      expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    });

    it("counts a thread at exactly the threshold as eligible", async () => {
      await load();
      listedThreads = [idleThread("thr_edge", 30)];
      const result = await harness.behavior.runCli(["sweep", "--json"]);
      const body = JSON.parse(result.stdout) as {
        eligible: Array<{ id: string; reason: string }>;
        count: number;
      };
      expect(body.count).toBe(1);
      expect(body.eligible[0]).toMatchObject({ id: "thr_edge", reason: "idle" });
    });

    it("excludes keep, pinned, and already-archived threads", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({ id: "thr_keep", pinnedAt: null }),
        makeThreadResponse({
          id: "thr_pinned",
          pinnedAt: NOW - 90 * DAY_MS,
        }),
        makeThreadResponse({
          id: "thr_arch",
          updatedAt: NOW - 90 * DAY_MS,
          archivedAt: NOW - 5 * DAY_MS,
        }),
        idleThread("thr_other", 90),
      ];
      metadata.set("thr_keep", {
        done: { doneAt: iso(100 * DAY_MS), keep: true },
      });

      const result = await harness.behavior.runCli(["sweep", "--json"]);
      const body = JSON.parse(result.stdout) as {
        eligible: Array<{ id: string }>;
      };
      expect(body.eligible.map((entry) => entry.id)).toEqual(["thr_other"]);
    });

    it("honors a keep flag from the KV keep store on a never-done thread", async () => {
      await load();
      listedThreads = [idleThread("thr_kvkeep", 90)];
      await harness.behavior.callRpc("sweep_keep_set", {
        threadId: "thr_kvkeep",
        keep: true,
      });

      const result = await harness.behavior.runCli(["sweep", "--json"]);
      expect(JSON.parse(result.stdout)).toEqual({ eligible: [], count: 0 });
    });

    it("a done thread below the done threshold is not claimed as idle", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({ id: "thr_recent", updatedAt: 0 }),
      ];
      metadata.set("thr_recent", { done: { doneAt: iso(2 * DAY_MS) } });

      const result = await harness.behavior.runCli(["sweep", "--json"]);
      expect(JSON.parse(result.stdout)).toEqual({ eligible: [], count: 0 });
    });

    it("--ids narrows the dry-run print to the named ids", async () => {
      await load();
      listedThreads = [
        idleThread("thr_a", 40),
        idleThread("thr_b", 40),
        idleThread("thr_c", 40),
      ];
      const result = await harness.behavior.runCli([
        "sweep",
        "--ids",
        "thr_b,thr_c",
        "--json",
      ]);
      const body = JSON.parse(result.stdout) as {
        eligible: Array<{ id: string }>;
      };
      expect(body.eligible.map((entry) => entry.id).sort()).toEqual([
        "thr_b",
        "thr_c",
      ]);
      expect(archived).toEqual([]);
    });

    it("rejects --ids without a value", async () => {
      await load();
      const result = await harness.behavior.runCli(["sweep", "--ids"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--ids requires a value");
    });
  });

  describe("sweep-family contract and status guard (server side)", () => {
    it("a parent with a live child is never eligible; the child is eligible independently", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({
          id: "thr_parent",
          updatedAt: NOW - 90 * DAY_MS,
        }),
        makeThreadResponse({
          id: "thr_child",
          parentThreadId: "thr_parent",
          updatedAt: NOW - 90 * DAY_MS,
        }),
      ];
      const result = await harness.behavior.runCli(["sweep", "--json"]);
      expect(
        (JSON.parse(result.stdout) as { eligible: Array<{ id: string }> })
          .eligible.map((entry) => entry.id),
      ).toEqual(["thr_child"]);
    });

    it("a done parent with a live child is excluded from the done arm", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({
          id: "thr_parent",
          updatedAt: NOW - 90 * DAY_MS,
        }),
        makeThreadResponse({
          id: "thr_child",
          parentThreadId: "thr_parent",
          updatedAt: NOW - 90 * DAY_MS,
        }),
      ];
      metadata.set("thr_parent", { done: { doneAt: iso(100 * DAY_MS) } });
      const result = await harness.behavior.runCli(["sweep", "--json"]);
      // The parent is excluded by the family contract; the child stays
      // eligible through the idle arm, independently of its parent.
      expect(
        (JSON.parse(result.stdout) as { eligible: Array<{ id: string }> })
          .eligible.map((entry) => entry.id),
      ).toEqual(["thr_child"]);
    });

    it("running and unread threads are never idle-eligible", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({
          id: "thr_active",
          status: "active",
          updatedAt: NOW - 90 * DAY_MS,
        }),
        makeThreadResponse({
          id: "thr_unread",
          lastReadAt: NOW - 100 * DAY_MS,
          latestAttentionAt: NOW,
          updatedAt: NOW - 90 * DAY_MS,
        }),
        idleThread("thr_quiet", 90),
      ];
      const result = await harness.behavior.runCli(["sweep", "--json"]);
      expect(
        (JSON.parse(result.stdout) as { eligible: Array<{ id: string }> })
          .eligible.map((entry) => entry.id),
      ).toEqual(["thr_quiet"]);
    });
  });

  describe("--confirm", () => {
    it("archives exactly the resolved eligible set", async () => {
      await load();
      listedThreads = [
        idleThread("thr_a", 40),
        idleThread("thr_b", 40),
        idleThread("thr_fresh", 2),
      ];
      const result = await harness.behavior.runCli(["sweep", "--confirm"]);
      expect(result.exitCode).toBe(0);
      expect(archiveArgs().sort()).toEqual(["thr_a", "thr_b"]);
      expect(result.stdout).toContain("archived thr_a");
      expect(result.stdout).toContain("archived thr_b");
    });

    it("archives nothing when nothing is eligible", async () => {
      await load();
      listedThreads = [idleThread("thr_fresh", 1)];
      const result = await harness.behavior.runCli(["sweep", "--confirm", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ archived: [], count: 0 });
      expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    });

    it("with --ids, archives exactly those ids even if others also qualify", async () => {
      await load();
      listedThreads = [
        idleThread("thr_a", 40),
        idleThread("thr_b", 40),
        idleThread("thr_c", 40),
      ];
      const result = await harness.behavior.runCli([
        "sweep",
        "--confirm",
        "--ids",
        "thr_b",
      ]);
      expect(result.exitCode).toBe(0);
      expect(archiveArgs()).toEqual(["thr_b"]);
    });

    it("with --ids, skips named ids that are already archived", async () => {
      await load();
      listedThreads = [
        idleThread("thr_a", 40),
        makeThreadResponse({
          id: "thr_gone",
          updatedAt: NOW - 40 * DAY_MS,
          archivedAt: NOW - DAY_MS,
        }),
      ];
      const result = await harness.behavior.runCli([
        "sweep",
        "--confirm",
        "--ids",
        "thr_a,thr_gone",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      expect(archiveArgs()).toEqual(["thr_a"]);
      const body = JSON.parse(result.stdout) as {
        archived: Array<{ id: string }>;
      };
      expect(body.archived.map((result2) => result2.id)).toEqual(["thr_a"]);
    });

    it("never archives keep threads (metadata keep)", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_keep" })];
      metadata.set("thr_keep", {
        done: { doneAt: iso(100 * DAY_MS), keep: true },
      });
      const result = await harness.behavior.runCli(["sweep", "--confirm", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ archived: [], count: 0 });
      expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    });

    it("never archives keep threads (KV keep store)", async () => {
      await load();
      listedThreads = [idleThread("thr_kvkeep", 90)];
      await harness.behavior.callRpc("sweep_keep_set", {
        threadId: "thr_kvkeep",
        keep: true,
      });
      const result = await harness.behavior.runCli(["sweep", "--confirm", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ archived: [], count: 0 });
      expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    });

    it("a legacy-imported done thread stamped at import is not immediately eligible", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_mig", updatedAt: NOW })];
      // The import stamps doneAt = import time, so the thread is Done
      // with a fresh stamp: not eligible on either arm.
      await storeLegacy(["thr_mig"]);
      await harness.behavior.runCli(["sweep", "--confirm", "--json"]);
      expect(harness.inspection.sdk.callsTo("threads.archive")).toHaveLength(0);
    });
  });

  describe("settings integration", () => {
    it("respects a config-set threshold change", async () => {
      await load();
      listedThreads = [idleThread("thr_mid", 14)];
      // Below the default 30d idle threshold.
      expect(
        JSON.parse(
          (await harness.behavior.runCli(["sweep", "--json"])).stdout,
        ),
      ).toEqual({ eligible: [], count: 0 });

      await harness.behavior.runCli(["config", "set", "idleArchiveDays", "14"]);
      const after = await harness.behavior.runCli(["sweep", "--json"]);
      const body = JSON.parse(after.stdout) as {
        eligible: Array<{ id: string }>;
      };
      expect(body.eligible.map((entry) => entry.id)).toEqual(["thr_mid"]);
    });
  });
});