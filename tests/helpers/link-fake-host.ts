// Shared fake-host scaffolding for the link-RPC test suites: a
// createFakePluginHost host with an in-memory metadata namespace stubbing
// the threads.* SDK methods, plus a links reader for assertions.
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";
import { LINK_METADATA_KEY, parseLinkedIssues } from "../../lib/link-metadata";

export type LinkTestHost = {
  host: FakePluginHost;
  harness: FakePluginHost["harness"];
  meta: Map<string, JsonValue>;
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
};

export async function setup(opts: { threads?: string[] } = {}): Promise<LinkTestHost> {
  const meta = new Map<string, JsonValue>();
  const host: FakePluginHost = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => (opts.threads ?? []).map((id) => ({ id })),
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
  await plugin(host.bb);
  return {
    host,
    harness: host.harness,
    meta,
    callRpc: (method: string, input?: unknown) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
  };
}

export function linksOf(
  meta: Map<string, JsonValue>,
  threadId: string,
): ThreadLinkLike[] | undefined {
  const namespace = meta.get(threadId) as Record<string, JsonValue> | undefined;
  return parseLinkedIssues(namespace?.[LINK_METADATA_KEY] ?? undefined) ?? undefined;
}

export type ThreadLinkLike = {
  repo: string;
  issue: number;
  kind: "issue" | "pull";
  href: string;
  createdAt: string;
  source: "agent" | "operator" | "auto";
};