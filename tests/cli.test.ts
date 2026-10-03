import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import type { PluginCliExecutionResult } from "@get-bb/plugin-sdk";
import server from "../server";

type Bb = BbPluginApi;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-25T12:00:00.000Z");

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("bb focus-board CLI (done + config)", () => {
  let bb: Bb;
  let harness: FakePluginHarness;
  let metadata: Map<string, Record<string, unknown>>;
  let listedThreads: ReturnType<typeof makeThreadResponse>[];
  let archivedThreads: ReturnType<typeof makeThreadResponse>[];
  let archived: string[];

  beforeEach(() => {
    metadata = new Map();
    listedThreads = [];
    archivedThreads = [];
    archived = [];
  });

  async function load(): Promise<void> {
    const host = createFakePluginHost({
      pluginId: "focus-board",
      sdk: {
        threads: {
          list: async (args?: { archived?: boolean }) =>
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
          archive: async ({ threadId }: { threadId: string }) => {
            archived.push(threadId);
            return { archivedAt: Date.now() };
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

  describe("done list", () => {
    it("prints an empty message when nothing is done", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a", title: "Alpha" })];
      const result = await harness.behavior.runCli(["done", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No threads are marked Done");
    });

    it("lists done threads with doneAt, keep, and title", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({ id: "thr_a", title: "Alpha" }),
        makeThreadResponse({ id: "thr_b", title: null, titleFallback: "Beta" }),
      ];
      await harness.behavior.callRpc("done_set", { threadId: "thr_a", done: true });
      await harness.behavior.callRpc("done_set", { threadId: "thr_b", done: true });

      const result = await harness.behavior.runCli(["done", "list", "--json"]);
      expect(result.exitCode).toBe(0);
      const rows = JSON.parse(result.stdout) as Array<{
        id: string;
        title: string | null;
        doneAt: string;
        keep: boolean;
        inLiveList: boolean;
      }>;
      expect(rows).toHaveLength(2);
      const alpha = rows.find((row) => row.id === "thr_a");
      expect(alpha).toMatchObject({
        title: "Alpha",
        keep: false,
        inLiveList: true,
      });
      expect(Date.parse(alpha?.doneAt ?? "")).not.toBeNaN();
      const beta = rows.find((row) => row.id === "thr_b");
      expect(beta?.title).toBe("Beta");
      expect(beta?.inLiveList).toBe(true);
    });

    it("reports archived done threads and index-only deleted threads", async () => {
      await load();
      // thr_arch is archived but done: visible through the archived list,
      // flagged as not in the live list. thr_gone is done but deleted
      // since its mark: the board's done index is the only way to see it.
      archivedThreads = [makeThreadResponse({ id: "thr_arch", title: "Arch" })];
      await harness.behavior.callRpc("done_set", {
        threadId: "thr_arch",
        done: true,
      });
      metadata.set("thr_gone", {
        done: { doneAt: iso(2 * DAY_MS), keep: true },
      });
      await bb.storage.kv.set("done-index", ["thr_gone"]);

      const result = await harness.behavior.runCli(["done", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("thr_arch");
      expect(result.stdout).toContain("Arch");
      expect(result.stdout).toContain("not in the live thread list");
      expect(result.stdout).toContain("thr_gone");
      expect(result.stdout).toContain("keep");
    });

    it("surfaces a keep flag set through the KV keep store", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_live" })];
      await harness.behavior.callRpc("done_set", {
        threadId: "thr_live",
        done: true,
      });
      await harness.behavior.callRpc("sweep_keep_set", {
        threadId: "thr_live",
        keep: true,
      });

      const result = await harness.behavior.runCli(["done", "list", "--json"]);
      const rows = JSON.parse(result.stdout) as Array<{
        id: string;
        keep: boolean;
      }>;
      expect(rows.find((row) => row.id === "thr_live")?.keep).toBe(true);
    });

    it("shows legacy-migrated marks with their import stamp", async () => {
      await load();
      // The legacy KV row is imported on demand inside done_list: ids
      // arrive stamped with the import time (no fabricated ages).
      await bb.storage.kv.set("done-thread-ids", ["thr_old"]);
      const result = await harness.behavior.runCli(["done", "list"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("thr_old");
      const stamp = result.stdout.split("\t")[1];
      expect(Number.isNaN(Date.parse(stamp ?? ""))).toBe(false);
    });
  });

  describe("done mark", () => {
    it("stamps doneAt on each named thread", async () => {
      await load();
      listedThreads = [
        makeThreadResponse({ id: "thr_a" }),
        makeThreadResponse({ id: "thr_b" }),
      ];
      const result = await harness.behavior.runCli([
        "done",
        "mark",
        "thr_a",
        "thr_b",
      ]);
      expect(result.exitCode).toBe(0);
      for (const id of ["thr_a", "thr_b"]) {
        const record = metadata.get(id)?.["done"] as { doneAt?: string };
        expect(Number.isNaN(Date.parse(record.doneAt ?? ""))).toBe(false);
      }
      expect(result.stdout).toContain("marked thr_a");
      expect(result.stdout).toContain("marked thr_b");
    });

    it("re-marking refreshes doneAt and preserves keep (idempotent)", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      metadata.set("thr_a", {
        done: { doneAt: iso(20 * DAY_MS), keep: true },
      });
      const result = await harness.behavior.runCli(["done", "mark", "thr_a"]);
      expect(result.exitCode).toBe(0);
      const record = metadata.get("thr_a")?.["done"] as {
        doneAt?: string;
        keep?: boolean;
      };
      expect(record.keep).toBe(true);
      expect(Date.parse(record.doneAt ?? "")).toBeGreaterThan(
        Date.parse(iso(20 * DAY_MS)),
      );
    });

    it("emits the marked id array with --json", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      const result = await harness.behavior.runCli([
        "done",
        "mark",
        "thr_a",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ marked: ["thr_a"] });
    });

    it("rejects an invocation with no thread ids (missing required)", async () => {
      await load();
      const result = await harness.behavior.runCli(["done", "mark"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required arguments");
    });

    it("broadcasts done-changed with the marked thread id so boards refresh", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      await harness.behavior.runCli(["done", "mark", "thr_a"]);
      expect(harness.inspection.realtimeSignals).toContainEqual({
        channel: "done-changed",
        payload: { threadId: "thr_a", done: true },
      });
    });
  });

  describe("done clear", () => {
    it("removes the done key", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      await harness.behavior.callRpc("done_set", { threadId: "thr_a", done: true });
      const result = await harness.behavior.runCli(["done", "clear", "thr_a"]);
      expect(result.exitCode).toBe(0);
      expect(metadata.get("thr_a")?.["done"]).toBeUndefined();
      expect(result.stdout).toContain("cleared thr_a");
    });

    it("is idempotent when the thread is not done", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_never" })];
      const result = await harness.behavior.runCli([
        "done",
        "clear",
        "thr_never",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("cleared thr_never");
    });

    it("does not touch the sweep keep flag (clear ≠ allow-sweep)", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      await harness.behavior.callRpc("done_set", { threadId: "thr_a", done: true });
      await harness.behavior.callRpc("sweep_keep_set", {
        threadId: "thr_a",
        keep: true,
      });
      await harness.behavior.runCli(["done", "clear", "thr_a"]);
      const raw: unknown = await bb.storage.kv.get("sweep-keep-flags");
      expect(raw).toEqual({ thr_a: { keep: true } });
    });

    it("rejects an invocation with no thread ids", async () => {
      await load();
      const result = await harness.behavior.runCli(["done", "clear"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("missing required arguments");
    });

    it("emits the cleared array with --json", async () => {
      await load();
      const result = await harness.behavior.runCli([
        "done",
        "clear",
        "thr_x",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ cleared: ["thr_x"] });
    });

    it("publishes done-changed with done: false", async () => {
      await load();
      listedThreads = [makeThreadResponse({ id: "thr_a" })];
      await harness.behavior.callRpc("done_set", { threadId: "thr_a", done: true });
      await harness.behavior.runCli(["done", "clear", "thr_a"]);
      expect(harness.inspection.realtimeSignals).toContainEqual({
        channel: "done-changed",
        payload: { threadId: "thr_a", done: false },
      });
    });
  });

  describe("config show", () => {
    it("shows defaults with the overridden flag false", async () => {
      await load();
      const result = await harness.behavior.runCli(["config", "show", "--json"]);
      expect(result.exitCode).toBe(0);
      const rows = JSON.parse(result.stdout) as Array<{
        key: string;
        value: number | string;
        default: number | string;
        overridden: boolean;
      }>;
      expect(rows).toEqual([
        { key: "doneArchiveValue", value: 2, default: 2, overridden: false },
        { key: "doneArchiveUnit", value: "days", default: "days", overridden: false },
        { key: "idleArchiveValue", value: 2, default: 2, overridden: false },
        { key: "idleArchiveUnit", value: "days", default: "days", overridden: false },
      ]);
    });

    it("flags overridden keys in the human output", async () => {
      await load();
      // Seed the KV row the way the settings section / config set write it:
      // one row, both arms (lib/sweep-config owns the shape).
      await bb.storage.kv.set("sweep-config", {
        doneArchiveValue: 14,
        doneArchiveUnit: "days",
        idleArchiveValue: 2,
        idleArchiveUnit: "days",
      });
      const result = await harness.behavior.runCli(["config", "show"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("doneArchiveValue=14");
      expect(result.stdout).toContain("overridden");
      expect(result.stdout).toContain("idleArchiveValue=2");
    });

    it("fails loud on a stored row that fails validation", async () => {
      await load();
      await bb.storage.kv.set("sweep-config", { doneArchiveValue: "lots" });
      const result = await harness.behavior.runCli(["config", "show"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("sweep-config");
      expect(result.stderr).toContain("failed validation");
    });
  });

  describe("config set", () => {
    it("sets a valid key and echoes the new effective value", async () => {
      await load();
      const result = await harness.behavior.runCli([
        "config",
        "set",
        "idleArchiveValue",
        "14",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("idleArchiveValue=14");
      const unit = await harness.behavior.runCli([
        "config",
        "set",
        "idleArchiveUnit",
        "hours",
      ]);
      expect(unit.exitCode).toBe(0);
      expect(unit.stdout).toContain("idleArchiveUnit=hours");
      const show = await harness.behavior.runCli(["config", "show", "--json"]);
      expect(show.stdout).toContain('"idleArchiveValue"');
      expect(show.stdout).toContain("14");
      expect(show.stdout).toContain('"idleArchiveUnit"');
      expect(show.stdout).toContain('"hours"');
    });

    it("rejects an unknown key naming the valid keys", async () => {
      await load();
      const result = await harness.behavior.runCli([
        "config",
        "set",
        "bogusKey",
        "3",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown setting 'bogusKey'");
      expect(result.stderr).toContain("doneArchiveValue");
      expect(result.stderr).toContain("idleArchiveUnit");
    });

    it("rejects zero, negative, non-integer, and over-cap counts", async () => {
      await load();
      for (const bad of ["0", "-5", "2.5", "abc", "366"]) {
        const result = await harness.behavior.runCli([
          "config",
          "set",
          "doneArchiveValue",
          bad,
        ]);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("invalid value");
      }
      // The stored value is untouched by the rejected writes.
      const show = await harness.behavior.runCli(["config", "show", "--json"]);
      const rows = JSON.parse(show.stdout) as Array<{
        key: string;
        value: number | string;
      }>;
      expect(rows.find((row) => row.key === "doneArchiveValue")?.value).toBe(2);
    });

    it("rejects a unit outside hours | days | weeks", async () => {
      await load();
      const result = await harness.behavior.runCli([
        "config",
        "set",
        "doneArchiveUnit",
        "fortnights",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid value");
      expect(result.stderr).toContain("hours, days, weeks");
    });

    it("emits the key/value object with --json", async () => {
      await load();
      const result = await harness.behavior.runCli([
        "config",
        "set",
        "doneArchiveValue",
        "10",
        "--json",
      ]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        key: "doneArchiveValue",
        value: 10,
      });
    });
  });

  describe("CLI declaration behavior", () => {
    it("renders top-level help listing every subcommand at exit 0", async () => {
      await load();
      const result = await harness.behavior.runCli(["--help"]);
      expect(result.exitCode).toBe(0);
      for (const path of [
        "done list",
        "done mark",
        "done clear",
        "sweep",
        "config show",
        "config set",
      ]) {
        expect(result.stdout).toContain(path);
      }
    });

    it("fails an unknown option with a suggestion and exit 1", async () => {
      await load();
      const result = await harness.behavior.runCli([
        "done",
        "list",
        "--jsn",
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown option '--jsn'");
    });

    it("fails an unknown subcommand", async () => {
      await load();
      const result = await harness.behavior.runCli(["done", "frobnicate"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown command");
    });

    it("keeps the CLI registered under the top-level name", async () => {
      await load();
      expect(harness.inspection.registrations.cli?.name).toBe("focus-board");
    });
  });
});

// The execution-result type is what runCli normalizes to; assert the
// contract so a shape change upstream is caught here.
describe("runCli result normalization", () => {
  it("returns exitCode/stdout/stderr", async () => {
    const host = createFakePluginHost({ pluginId: "focus-board" });
    await server(host.bb);
    const result: PluginCliExecutionResult = await host.harness.behavior.runCli(
      ["--help"],
    );
    expect(typeof result.exitCode).toBe("number");
    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    await host.harness.lifecycle.dispose();
  });
});