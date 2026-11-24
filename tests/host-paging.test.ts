// Issue #504: a host list read is paged, never one capped call.
//
// The fakes here model the host's own contract, not a convenient one: a call
// that names no `limit` serves 200 rows, and a `limit` above 500 is refused.
// A single-shot read therefore comes back short against these fakes, which is
// exactly what the real host would do to a board holding more than one page.
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { HOST_PAGE_LIMIT, readAllPages, type HostPageRequest } from "../lib/host-paging";

type Row = { id: string; projectId?: string };

function rowsNamed(count: number, prefix = "thr"): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}_${String(index).padStart(4, "0")}`,
  }));
}

/** The host's cap on a call that names no limit, and its ceiling (`limit`). */
const HOST_DEFAULT_LIMIT = 200;
const HOST_LIMIT_CEILING = 500;

/**
 * A host list call that honours `limit` and `offset` the way bb does. Every
 * request is recorded so a test can assert the page offsets that produced a
 * result, and which filters rode each one.
 */
function pagedHost<T>(
  source: (filters: { archived?: boolean; projectId?: string }) => readonly T[],
) {
  const calls: Array<HostPageRequest & { archived?: boolean; projectId?: string }> = [];
  const list = async (args: {
    limit?: number;
    offset?: number;
    archived?: boolean;
    projectId?: string;
  }): Promise<readonly T[]> => {
    calls.push({ ...args, limit: args.limit ?? HOST_DEFAULT_LIMIT, offset: args.offset ?? 0 });
    const limit = args.limit ?? HOST_DEFAULT_LIMIT;
    if (limit > HOST_LIMIT_CEILING) {
      throw new Error(`400: limit ${limit} exceeds ${HOST_LIMIT_CEILING}`);
    }
    const offset = args.offset ?? 0;
    return source({ archived: args.archived, projectId: args.projectId }).slice(
      offset,
      offset + limit,
    );
  };
  return { calls, list };
}

describe("readAllPages", () => {
  it("returns a set larger than one page whole, in host order", async () => {
    const all = rowsNamed(1_200);
    const host = pagedHost(() => all);

    const read = await readAllPages("threads", (page) => host.list(page));

    expect(read.map((row) => row.id)).toEqual(all.map((row) => row.id));
    expect(host.calls.map((call) => call.offset)).toEqual([0, 500, 1_000]);
    expect(host.calls.every((call) => call.limit === HOST_PAGE_LIMIT)).toBe(true);
  });

  it("ends the loop at the ceiling offset when the set is exactly one page", async () => {
    const all = rowsNamed(HOST_PAGE_LIMIT);
    const host = pagedHost(() => all);

    const read = await readAllPages("threads", (page) => host.list(page));

    expect(read).toHaveLength(HOST_PAGE_LIMIT);
    expect(host.calls.map((call) => call.offset)).toEqual([0, HOST_PAGE_LIMIT]);
  });

  it("stops after one page when the set is shorter than a page", async () => {
    const all = rowsNamed(3);
    const host = pagedHost(() => all);

    const read = await readAllPages("threads", (page) => host.list(page));

    expect(read).toHaveLength(3);
    expect(host.calls).toHaveLength(1);
  });

  it("keeps the call site's filter on every page it asks for", async () => {
    const live = rowsNamed(40);
    const archived = rowsNamed(1_100, "arch");
    const host = pagedHost(({ archived: wantsArchived }) => (wantsArchived === true ? archived : live));

    const read = await readAllPages("threads", (page) =>
      host.list({ ...page, archived: true }),
    );

    expect(read.map((row) => row.id)).toEqual(archived.map((row) => row.id));
    expect(host.calls).toHaveLength(3);
    expect(host.calls.every((call) => call.archived === true)).toBe(true);
  });

  it("pages an environment read the same way, filter included", async () => {
    const environments = rowsNamed(1_100, "env").map((row) => ({ ...row, projectId: "proj_a" }));
    const host = pagedHost(({ projectId }) =>
      projectId === "proj_a" ? environments : [],
    );

    const read = await readAllPages("environments", (page) =>
      host.list({ ...page, projectId: "proj_a" }),
    );

    expect(read.map((row) => row.id)).toEqual(environments.map((row) => row.id));
    expect(host.calls.map((call) => call.offset)).toEqual([0, 500, 1_000]);
    expect(host.calls.every((call) => call.projectId === "proj_a")).toBe(true);
  });

  it("throws when the host serves the same rows twice instead of returning a doubled list", async () => {
    const all = rowsNamed(1_200);
    const repeated = async ({ limit }: HostPageRequest) => all.slice(0, limit);

    await expect(readAllPages("threads", repeated)).rejects.toThrow(
      /paged threads read: .*same 500 rows again at offset 500/u,
    );
  });

  it("throws when the host ignores the limit rather than concatenating the overflow", async () => {
    const all = rowsNamed(1_200);
    const unbounded = async () => all;

    await expect(readAllPages("threads", unbounded)).rejects.toThrow(
      /paged threads read: .*1200 rows for limit 500 at offset 0/u,
    );
  });
});

describe("the server's own list reads (issue #504)", () => {
  const doneAt = "2026-01-01T00:00:00.000Z";

  /**
   * The plugin mounted against a host that pages `threads.list` exactly as bb
   * does: 200 rows when the call names no limit, at most 500 when it does.
   * Every call is recorded for the assertions below.
   */
  async function setupBoard(options: {
    live: number;
    archived: number;
    /** Thread id → its board-metadata namespace. */
    metadata?: Record<string, JsonValue>;
  }) {
    const meta = new Map<string, JsonValue>(Object.entries(options.metadata ?? {}));
    const live = rowsNamed(options.live);
    const archived = rowsNamed(options.archived, "arch");
    const calls: Array<{ archived?: boolean; limit?: number; offset?: number }> = [];
    const pageOf = <T,>(rows: readonly T[], args: { limit?: number; offset?: number }) => {
      const limit = args.limit ?? HOST_DEFAULT_LIMIT;
      if (limit > HOST_LIMIT_CEILING) throw new Error(`400: limit ${limit} exceeds ${HOST_LIMIT_CEILING}`);
      const offset = args.offset ?? 0;
      return rows.slice(offset, offset + limit);
    };
    const host = createFakePluginHost({
      pluginId: "focus-board",
      sdk: {
        threads: {
          list: async (args: { archived?: boolean; limit?: number; offset?: number }) => {
            calls.push(args);
            return pageOf(args.archived === true ? archived : live, args);
          },
          getPluginMetadata: async (args: { threadId: string }) => meta.get(args.threadId) ?? {},
          updatePluginMetadata: async (args: {
            threadId: string;
            set?: Record<string, JsonValue>;
            remove?: string[];
          }) => {
            const current = (meta.get(args.threadId) ?? {}) as Record<string, JsonValue>;
            const next = { ...current };
            if (args.set !== undefined) Object.assign(next, args.set);
            for (const key of args.remove ?? []) delete next[key];
            meta.set(args.threadId, next as JsonValue);
            return next;
          },
        },
      },
    });
    await plugin(host.bb);
    return {
      calls,
      callRpc: (method: string, input?: unknown) =>
        host.harness.callRpc(method, input) as Promise<unknown>,
    };
  }

  it("done state on a thread past the host's cap reaches the board", async () => {
    const { callRpc, calls } = await setupBoard({
      live: 600,
      archived: 0,
      metadata: { thr_0550: { done: { doneAt } } },
    });

    const payload = (await callRpc("done_list")) as { doneIds: string[] };

    expect(payload.doneIds).toContain("thr_0550");
    // The read that found it was a paged one, not the capped single call.
    expect(calls).toContainEqual(
      expect.objectContaining({ limit: HOST_PAGE_LIMIT, offset: 500 }),
    );
  });

  it("the archived member scan pages too, filter intact, so no group is pruned behind the cap", async () => {
    const { callRpc, calls } = await setupBoard({ live: 20, archived: 600 });

    const created = (await callRpc("group_create", { name: "Alpha" })) as {
      group: { id: string };
    };
    await callRpc("group_set", { threadId: "thr_0001", groupId: created.group.id });

    expect(calls).toContainEqual(
      expect.objectContaining({ archived: true, limit: HOST_PAGE_LIMIT, offset: 0 }),
    );
    expect(calls).toContainEqual(
      expect.objectContaining({ archived: true, limit: HOST_PAGE_LIMIT, offset: 500 }),
    );
  });
});
