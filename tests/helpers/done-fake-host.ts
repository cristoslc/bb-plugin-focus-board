// Shared fake-host scaffolding for the done-RPC test suites: a
// createFakePluginHost host with an in-memory metadata namespace stubbing
// the three threads.* SDK methods (merge-then-remove, the semantics the
// real SDK documents), plus a record reader for assertions.
//
// The branch-rename suites extend the same host with threads.get,
// environments.get, projects.get and a fake git terminals.* area: marking a
// thread done renames its managed worktree branch (tests/done-branch-rename).
// All extra stubs are additive — threads without configured environments
// resolve to environmentId null, so the rename glue is a no-op for the
// original done-RPC suites.
import type { FakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server";
import { DONE_METADATA_KEY } from "../../lib/done-metadata";
import { doneBranchName } from "../../lib/worktree-branch";

export type DoneTestHost = {
  host: FakePluginHost;
  harness: FakePluginHost["harness"];
  meta: Map<string, JsonValue>;
  kv: FakePluginHost["bb"]["storage"]["kv"];
  kvSet: (key: string, value: unknown) => Promise<void>;
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
  git: FakeGit;
};

type SetupOptions = {
  /** Thread ids the stubbed threads.list returns (live threads). */
  threads?: string[];
  /** threadId → the managed branch its fake worktree environment reports. */
  branchByThread?: Record<string, string>;
  /** Fake environment's workspaceProvisionType (default "managed-worktree"). */
  provisionType?: "managed-worktree" | "unmanaged" | "personal";
  /** Extra local branch refs the fake git starts with (name collisions). */
  extraBranches?: string[];
  /** After the first rename lands, re-create the original branch ref. */
  occupyOriginalAfterRename?: boolean;
  /** After the first rename lands, the environments.get lookup throws. */
  environmentGoneAfterRename?: boolean;
  /** Store the rename-on-done setting off before the plugin loads. */
  renameBranchOnDone?: boolean;
};

/** In-memory git assertions surface shared by all setups. */
export type FakeGit = {
  /** Sorted local branch refs — the state `git branch -m` leaves behind. */
  branches: () => string[];
  /** How many successful renames ran. */
  renames: () => number;
  /** Every command string the fake git saw, in order. */
  history: () => string[];
};

type FakeGitState = { refs: Set<string> };

/**
 * A tiny in-memory git behind the terminals.* SDK area: local branch refs
 * live in a Set, `branch -m` moves them, `show-ref --verify` probes them.
 * Each create() resolves immediately to an exited session, which is the
 * shape the glue's get/output polling loop handles.
 */
function createFakeGit(
  refs: string[],
  onRename: (state: FakeGitState) => void,
): { terminals: Record<string, unknown>; git: FakeGit; state: FakeGitState } {
  const state: FakeGitState = { refs: new Set(refs) };
  const history: string[] = [];
  let renames = 0;
  const sessions = new Map<string, { exitCode: number; text: string }>();
  let seq = 0;

  function run(command: string): { exitCode: number; text: string } {
    history.push(command);
    // The glue shells `git <args> ; exit` through a terminal; strip the tail.
    const args = command.replace(/;\s*exit\s*$/, "").trim().split(/\s+/);
    if (args[0] === "git") args.shift();

    if (args[0] === "branch" && args[1] === "-m") {
      const from = args[2];
      const to = args[3];
      if (from === undefined || to === undefined || !state.refs.has(from)) {
        return { exitCode: 1, text: `error: refspec ${from ?? ""}` };
      }
      if (state.refs.has(to)) return { exitCode: 1, text: `error: ref exists ${to}` };
      state.refs.delete(from);
      state.refs.add(to);
      renames += 1;
      onRename(state);
      return { exitCode: 0, text: "" };
    }
    if (args[0] === "show-ref" && args[1] === "--verify") {
      const probe = args.find((a) => a.startsWith("refs/heads/")) ?? "";
      const ref = probe.replace("refs/heads/", "");
      return state.refs.has(ref)
        ? { exitCode: 0, text: "" }
        : { exitCode: 1, text: `fatal: unknown ref ${probe}` };
    }
    return { exitCode: 1, text: `fatal: unsupported git command: ${command}` };
  }

  const terminals = {
    async create(got: { start: { command: string } }) {
      const id = `term_${++seq}`;
      const { exitCode, text } = run(got.start.command);
      sessions.set(id, { exitCode, text });
      return { id, status: "exited", exitCode };
    },
    async get(got: { terminalId: string }) {
      const session = sessions.get(got.terminalId)!;
      return { id: got.terminalId, status: "exited", exitCode: session.exitCode };
    },
    async output(got: { terminalId: string }) {
      const dataBase64 = Buffer.from(
        sessions.get(got.terminalId)!.text,
        "utf8",
      ).toString("base64");
      return { chunks: [{ dataBase64 }] };
    },
    async close(got: { terminalId: string }) {
      const session = sessions.get(got.terminalId)!;
      return { id: got.terminalId, status: "exited", exitCode: session.exitCode };
    },
  };

  return {
    terminals,
    git: {
      branches: () => [...state.refs].sort(),
      renames: () => renames,
      history: () => [...history],
    },
    state,
  };
}

export async function setup(opts: SetupOptions = {}): Promise<DoneTestHost> {
  const meta = new Map<string, JsonValue>();
  const branchByThread = opts.branchByThread ?? {};
  const envByThread = new Map(
    Object.entries(branchByThread).map(([threadId, branch]) => [
      `env_${threadId}`,
      {
        id: `env_${threadId}`,
        projectId: "project-test",
        hostId: "host_1",
        path: "/repo/worktree",
        isGitRepo: true,
        workspaceProvisionType: opts.provisionType ?? "managed-worktree",
        branch,
        defaultBranch: "main",
      },
    ]),
  );
  const environmentGone = { value: false };
  const { terminals, git, state } = createFakeGit(
    Object.values(branchByThread).concat(opts.extraBranches ?? []),
    (state) => {
      if (opts.occupyOriginalAfterRename) {
        for (const branch of Object.values(branchByThread)) {
          // The original name comes back occupied after the rename lands,
          // as if an operator re-created it or bb re-provisioned.
          state.refs.add(branch);
        }
      }
      if (opts.environmentGoneAfterRename) {
        // The environment (and its db row) vanishes with the worktree.
        environmentGone.value = true;
      }
    },
  );
  // A `git branch -m` moves the ref the worktree environment reports a
  // thread as sitting on, so the fake environment's branchName is read
  // live from the fake git refs instead of frozen at setup time.
  const branchNameNow = (original: string): string => {
    const done = doneBranchName(original);
    return done !== null && state.refs.has(done) ? done : original;
  };

  const host: FakePluginHost = createFakePluginHost({
    pluginId: "focus-board",
    settings:
      opts.renameBranchOnDone === false
        ? { renameBranchOnDone: false }
        : undefined,
    sdk: {
      threads: {
        list: async () =>
          (opts.threads ?? Object.keys(branchByThread)).map((id) => ({ id })),
        get: async (args: { threadId: string }) => ({
          id: args.threadId,
          projectId: "project-test",
          environmentId: envByThread.has(`env_${args.threadId}`)
            ? `env_${args.threadId}`
            : null,
        }),
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
      environments: {
        get: async (args: { environmentId: string }) => {
          if (environmentGone.value) {
            throw new Error(`environment ${args.environmentId} not found`);
          }
          const base = envByThread.get(args.environmentId);
          if (base === undefined) return base;
          return {
            ...base,
            branch: undefined,
            branchName: branchNameNow(base.branch),
          };
        },
      },
      projects: {
        get: async (_args: { projectId: string }) => ({
          id: "project-test",
          name: "Test project",
          gitRemoteUrl: null,
          sources: [
            {
              id: "src_1",
              hostId: "host_1",
              path: "/repo/main",
              isDefault: true,
            },
          ],
        }),
      },
      terminals,
    },
  });
  await plugin(host.bb);
  return {
    host,
    harness: host.harness,
    meta,
    kv: host.bb.storage.kv,
    kvSet: async (key, value) => {
      await host.bb.storage.kv.set(key, value);
    },
    callRpc: (method: string, input?: unknown) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
    git,
  };
}

export function doneRecordOf(
  meta: Map<string, JsonValue>,
  threadId: string,
): { doneAt: string; keep?: boolean } | undefined {
  const namespace = meta.get(threadId) as Record<string, JsonValue> | undefined;
  return namespace?.[DONE_METADATA_KEY] as
    | { doneAt: string; keep?: boolean }
    | undefined;
}