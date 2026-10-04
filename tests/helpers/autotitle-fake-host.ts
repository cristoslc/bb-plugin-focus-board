// Fake-host scaffolding for the thread_autotitle RPC tests: stubs
// system.aiServices (the thread-title selection bb routes its own title
// generation through), threads.promptHistory, and plugins.callRpc (the
// cross-plugin bridge focus-board rides on).
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";

export type AutotitleTestHost = {
  host: FakePluginHost;
  harness: FakePluginHost["harness"];
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
  /** The latest plugins.callRpc invocation, or null when none happened. */
  lastServiceCall: () => { pluginId: string; method: string; input: unknown } | null;
};

export type AutotitleSetupOptions = {
  selection?: unknown;
  history?: unknown[];
  /** What the stubbed service plugin answers with; a throw simulates failure. */
  serviceReply?: unknown | (() => never);
};

export async function setup(
  opts: AutotitleSetupOptions = {},
): Promise<AutotitleTestHost> {
  let lastCall:
    | { pluginId: string; method: string; input: unknown }
    | null = null;
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
          services: [],
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
  };
}