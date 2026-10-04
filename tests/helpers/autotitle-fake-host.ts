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
  /** Every plugins.callRpc invocation, oldest first — the bridge probe shows up here. */
  allServiceCalls: () => Array<{ pluginId: string; method: string; input: unknown }>;
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
  /**
   * Error message thrown by plugins.callRpc for the given pluginId — the
   * "HTTP 404: plugin X has no rpc method complete" shape bb answers for
   * plugins without the bridge.
   */
  rpcErrorByPluginId?: Record<string, string>;
  /** threads.defaultExecutionOptions result; undefined = a usable pair, null = unavailable. */
  executionOptions?: unknown;
  /** threads.get result for the source thread; defaults to a proj/env row. */
  threadRow?: unknown;
  /** Status sequence threads.get returns for the probe thread after spawn; the last one repeats. Default ["idle"] (settles on the first poll). */
  probeStatuses?: string[];
  /** threads.timeline result for the probe thread. Default: one assistant row with the canned title. */
  probeTimeline?: unknown;
  /**
   * threads.timeline result for the SOURCE thread (the first-user-row prompt
   * read); default [] so the server falls back to the prompt-history fixture.
   */
  sourceTimeline?: unknown;
  /**
   * Canned paging sequence for the source thread's timeline read (the walk
   * over bb's segment windows). Each entry is one call's response; the last
   * entry repeats when the walk keeps going.
   */
  sourceTimelinePages?: Array<{ rows?: unknown; timelinePage?: unknown }>;
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
  let lastPromptHistoryArgs: { threadId?: string; limit?: number } | null = null;
  let lastSourceTimelineArgs: { threadId: string; afterSequence?: number } | null = null;
  let sourceTimelineCallIndex = 0;
  const sourceTimelineCalls: Array<{ threadId: string; afterSequence?: number; beforeAnchorId?: string; beforeAnchorSeq?: string }> = [];
  const allServiceCalls: Array<{
    pluginId: string;
    method: string;
    input: unknown;
  }> = [];
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
        promptHistory: async (args?: { threadId?: string; limit?: number }) => {
          lastPromptHistoryArgs = args ?? null;
          return opts.history ?? [
            {
              id: "h1",
              createdAt: 1,
              input: [{ type: "text", text: "Fix the login redirect loop" }],
            },
          ];
        },
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
        timeline: async (args: { threadId: string; afterSequence?: number; beforeAnchorId?: string; beforeAnchorSeq?: string }) => {
          lastSourceTimelineArgs = args;
          // The PROBE thread's reply; the SOURCE thread reads empty so the
          // server falls back to prompt history unless a test wires a
          // source timeline (or a canned page walk).
          if (args.threadId !== probeId) {
            sourceTimelineCalls.push(args);
            if (opts.sourceTimelinePages !== undefined) {
              const index = Math.min(sourceTimelineCallIndex, opts.sourceTimelinePages.length - 1);
              sourceTimelineCallIndex += 1;
              return opts.sourceTimelinePages[index];
            }
            return opts.sourceTimeline ?? [];
          }
          return opts.probeTimeline ?? (DEFAULT_TIMELINE as unknown);
        },
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
          const rpcError = opts.rpcErrorByPluginId?.[args.pluginId];
          if (rpcError !== undefined) throw new Error(rpcError);
          allServiceCalls.push({
            pluginId: args.pluginId,
            method: args.method,
            input: args.input,
          });
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
    /** Every plugins.callRpc invocation, oldest first (probe calls included). */
    allServiceCalls: () => [...allServiceCalls],
    /** The latest threads.promptHistory args — the oldest-entry fetch needs a big limit. */
    lastPromptHistoryArgs: () => lastPromptHistoryArgs,
    /** The latest SOURCE-thread threads.timeline args — the prompt read must page from the beginning. */
    lastSourceTimelineArgs: () => lastSourceTimelineArgs,
    /** Every SOURCE-thread timeline call, oldest first (the walk's cursor passing). */
    sourceTimelineCalls: () => [...sourceTimelineCalls],
    lastSpawn: () => spawnArgs,
    deletedProbes: () => deleted,
    stoppedProbes: () => stopped,
    probePolls: () => polls,
  };
}