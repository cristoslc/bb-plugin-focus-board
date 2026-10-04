// Shared fake-host scaffolding for the snooze-RPC test suites: the same
// in-memory metadata stubbing as done-fake-host, plus read-state methods
// the snooze set/wake paths drive (markRead, markUnread, get) and helpers
// to seed snooze records before the plugin loads (so the load-time wake
// scan is observable) and to fake reads/missing threads during a wake.
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";
import { SNOOZE_METADATA_KEY } from "../../lib/snooze";

export type SnoozeTestHost = {
  host: FakePluginHost;
  harness: FakePluginHost["harness"];
  meta: Map<string, JsonValue>;
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
  /** The thread ids the stubbed threads.list returns; mutable per test. */
  setThreads: (ids: string[]) => void;
  /** The recorded lastReadAt per thread (null = unread). */
  lastReadOf: (threadId: string) => number | null;
  /** Simulate a genuine read of the thread at epoch `at` (after the set). */
  readAt: (threadId: string, at: number) => void;
  /** Make threads.get reject for every thread (simulates deletion). */
  failGets: () => void;
  /** The mark-unread wake calls recorded so far. */
  unreadCalls: () => Array<{ threadId: string }>;
};

export type SetupOptions = {
  /** Thread ids the stubbed threads.list returns (live threads). */
  threads?: string[];
  /** Snooze records present in thread metadata BEFORE the plugin loads. */
  snoozeSeed?: Record<string, { wakeAt: string; setAt: string }>;
};

export async function setup(opts: SetupOptions = {}): Promise<SnoozeTestHost> {
  const meta = new Map<string, JsonValue>();
  const lastRead = new Map<string, number | null>();
  let threadIds = [...(opts.threads ?? [])];
  let getsFail = false;
  const unread: Array<{ threadId: string }> = [];
  for (const [threadId, record] of Object.entries(opts.snoozeSeed ?? {})) {
    meta.set(threadId, { [SNOOZE_METADATA_KEY]: record } as JsonValue);
  }
  const host: FakePluginHost = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => threadIds.map((id) => ({ id })),
        get: async ({ threadId }: { threadId: string }) => {
          if (getsFail) throw new Error("thread gone");
          return { id: threadId, lastReadAt: lastRead.get(threadId) ?? null };
        },
        markRead: async ({ threadId }: { threadId: string }) => {
          lastRead.set(threadId, Date.now());
          return { id: threadId };
        },
        markUnread: async ({ threadId }: { threadId: string }) => {
          unread.push({ threadId });
          lastRead.set(threadId, null);
          return { id: threadId };
        },
        getPluginMetadata: async (args: { threadId: string }) =>
          meta.get(args.threadId) ?? {},
        updatePluginMetadata: async (args: {
          threadId: string;
          set?: Record<string, JsonValue>;
          remove?: string[];
        }) => {
          const current = (meta.get(args.threadId) ?? {}) as Record<string, JsonValue>;
          const next = { ...current };
          if (args.set) Object.assign(next, args.set);
          for (const key of args.remove ?? []) delete next[key];
          meta.set(args.threadId, next as JsonValue);
          return next;
        },
      },
    },
  });
  // Seed BEFORE the plugin loads: the wake scan must observe pre-seeded
  // records exactly as a daemon restart would.
  await plugin(host.bb);
  return {
    host,
    harness: host.harness,
    meta,
    callRpc: (method: string, input?: unknown) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
    setThreads: (ids: string[]) => {
      threadIds = [...ids];
    },
    lastReadOf: (threadId) => lastRead.get(threadId) ?? null,
    readAt: (threadId, at) => lastRead.set(threadId, at),
    failGets: () => {
      getsFail = true;
    },
    unreadCalls: () => unread.map((call) => ({ threadId: call.threadId })),
  };
}

export function snoozeRecordOf(
  meta: Map<string, JsonValue>,
  threadId: string,
): { wakeAt: string; setAt: string } | undefined {
  const namespace = meta.get(threadId) as Record<string, JsonValue> | undefined;
  return namespace?.[SNOOZE_METADATA_KEY] as
    | { wakeAt: string; setAt: string }
    | undefined;
}