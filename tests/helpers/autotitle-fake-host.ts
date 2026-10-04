// Fake-host scaffolding for the thread_autotitle RPC tests: stubs
// system.aiServices (the thread-title selection bb routes its own title
// generation through), threads.{promptHistory,spawn,get,timeline,delete,stop},
// threads.defaultExecutionOptions (the thread-model probe's model source),
// and plugins.callRpc (the cross-plugin bridge focus-board rides on).
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

export type AutotitleTestHost = {
  host: FakePluginHost;
  harness: FakePluginHost["harness"];
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
  /** The latest plugins.callRpc invocation, or null when none happened. */
  lastServiceCall: () => { pluginId: string; method: string; input: unknown } | null;
  /** The threads.spawn args of the latest probe spawn, or null when none. */
  lastSpawn: () => Record<string, unknown> | null;
  /** Thread ids threads.delete was called with, in order. */
  deletedProbes: () => string[];
  /** Thread ids threads.stop was called with, in order. */
  stoppedProbes: () => string[];
  /** How many times the probe thread's status was polled. */
  probePolls: () => number;
};

export type AutotitleSetupOptions = {
  selection?: unknown;
  /** The `services` array bb's aiServices response carries (registered services). */
  services?: unknown[];
  history?: unknown[];
  /** What the stubbed service plugin answers with; a throw simulates failure. */
  serviceReply?: unknown | (() => never);
  /** threads.defaultExecutionOptions result; undefined = a usable pair, null = unavailable. */
  executionOptions?: unknown;
  /** threads.get result for the source thread; defaults to a proj/env row. */
  threadRow?: unknown;
  /** Status sequence threads.get returns for the probe thread after spawn; the last one repeats. Default ["idle"] (settles on the first poll). */
  probeStatuses?: string[];
  /** threads.timeline result for the probe thread. Default: one assistant row with the canned title. */
  probeTimeline?: unknown;
};

const SOURCE_THREAD_ID = "thr_x";
const DEFAULT_EXECUTION_OPTIONS = {
  providerId: "claude-code",
  model: "claude-sonnet-4-6",
  permissionMode: "default",
  reasoningLevel: "low",
  serviceTier: null,
};
const DEFAULT_SOURCE_ROW = {
  id: SOURCE_THREAD_ID,
  projectId: "proj_1",
  environmentId: "env_1",
  status: "idle",
  visibility: "visible",
};
const DEFAULT_TIMELINE = {
  rows: [
    { kind: "conversation", role: "user", text: "title probe prompt", id: "r1" },
    {
      kind: "conversation",
      role: "assistant",
      text: "Login redirect loop fix",
      id: "r2",
    },
  ],
  maxSeq: 2,
};

export async function setup(
  opts: AutotitleSetupOptions = {},
): Promise<AutotitleTestHost> {
  let lastCall:
    | { pluginId: string; method: string; input: unknown }
    | null = null;
  let spawnArgs: Record<string, unknown> | null = null;
  let probeId: string | null = null;
  let probeCounter = 0;
  let statusIndex = 0;
  let polls = 0;
  const deleted: string[] = [];
  const stopped: string[] = [];
  const statuses = opts.probeStatuses ?? ["idle"];
  const sourceRow = opts.threadRow ?? DEFAULT_SOURCE_ROW;
  const host: FakePluginHost = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      system: {
        aiServices: async () => ({
          selections: {
            "thread-title":
              opts.selection ??
              ({
                mode: "service",
                pluginId: "openrouter-inference",
                serviceId: "default",
              }),
            "commit-message": { mode: "off" },
            voice: { mode: "off" },
          },
          services: opts.services ?? [],
        }),
      },
      threads: {
        promptHistory: async () =>
          opts.history ?? [
            {
              id: "h1",
              createdAt: 1,
              input: [{ type: "text", text: "Fix the login redirect loop" }],
            },
          ],
        defaultExecutionOptions: async (_args: { threadId: string }) =>
          opts.executionOptions !== undefined
            ? opts.executionOptions
            : DEFAULT_EXECUTION_OPTIONS,
        spawn: async (args: Record<string, unknown>) => {
          spawnArgs = args;
          probeId = `thr_probe_${++probeCounter}`;
          return { id: probeId, status: "pending" };
        },
        get: async ({ threadId }: { threadId: string }) => {
          if (threadId !== probeId) return sourceRow;
          polls += 1;
          const status = statuses[Math.min(statusIndex++, statuses.length - 1)];
          return { ...sourceRow, id: threadId, status };
        },
        timeline: async (_args: { threadId: string }) =>
          opts.probeTimeline ?? (DEFAULT_TIMELINE as unknown),
        delete: async ({ threadId }: { threadId: string }) => {
          deleted.push(threadId);
          return { ok: true };
        },
        stop: async ({ threadId }: { threadId: string }) => {
          stopped.push(threadId);
          return { ok: true };
        },
      },
      plugins: {
        callRpc: async (args: { pluginId: string; method: string; input?: unknown }) => {
          lastCall = { pluginId: args.pluginId, method: args.method, input: args.input };
          if (opts.serviceReply instanceof Function) return opts.serviceReply();
          if (opts.serviceReply !== undefined) return opts.serviceReply;
          return { text: "Login redirect loop fix" };
        },
      },
    },
  });
  await plugin(host.bb);
  return {
    host,
    harness: host.harness,
    callRpc: (method, input) => host.harness.callRpc(method, input) as Promise<unknown>,
    lastServiceCall: () => lastCall,
    lastSpawn: () => spawnArgs,
    deletedProbes: () => deleted,
    stoppedProbes: () => stopped,
    probePolls: () => polls,
  };
}