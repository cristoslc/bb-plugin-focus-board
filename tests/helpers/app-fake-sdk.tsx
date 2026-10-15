/**
 * A `vi.mock` target for `@get-bb/plugin-sdk/app`: a controllable fake host
 * that mounts the REAL app.tsx (the nav panel it registers) against a
 * simulated sidebar, so board-level gesture wiring — effects, attention
 * freezes, RPC state — can be tested end to end. No value imports from the
 * SDK here: this module replaces it (type-only imports are erased).
 *
 * The thread store is a subscription-backed module object; `setRead`/
 * `setPinned` land as DEFERRED writes the test resolves through
 * `landWrites()`, mirroring the host bridge's "lands in a later commit"
 * timing, which is exactly when attention-freeze races show themselves.
 */
import { useSyncExternalStore, type ReactNode } from "react";

interface FakeSidebarThread {
  id: string;
  projectId: string;
  providerId: string;
  status: string;
  isUnread: boolean;
  isPinned: boolean;
  isArchived: boolean;
  isHidden: boolean;
  parentThreadId: string | null;
  hasPendingInteraction: boolean;
  updatedAt: number;
  displayTitle: string;
  [key: string]: unknown;
}

const store: {
  threads: readonly FakeSidebarThread[];
  projects: readonly { id: string; name: string }[];
  listeners: Set<() => void>;
} = {
  threads: [],
  projects: [{ id: "proj_a", name: "Alpha" }],
  listeners: new Set(),
};

function emit(): void {
  for (const listener of [...store.listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

/** Replace the simulated sidebar's threads (and render every mounted app). */
export function seedFakeThreads(threads: readonly FakeSidebarThread[]): void {
  store.threads = threads;
  emit();
}

export function fakeThreads(): readonly FakeSidebarThread[] {
  return store.threads;
}

interface FakeSidebarProject {
  id: string;
  name: string;
  [key: string]: unknown;
}

// The registered nav panel: definePluginApp captures the app's own
// BoardPage so the test can mount exactly what bb mounts.
export const registeredNavPanel: {
  path?: string;
  component?: (props: { subPath: string }) => ReactNode;
} = {};

export function definePluginApp(setup: (app: unknown) => void): unknown {
  setup({
    contentScripts: {
      register: () => {},
    },
    slots: {
      navPanel: (config: { path: string; component: (props: { subPath: string }) => ReactNode }) => {
        registeredNavPanel.path = config.path;
        registeredNavPanel.component = config.component;
      },
      sidebarFooterAction: () => {},
      settingsSection: () => {},
    },
    experimental_icons: {
      register: () => {},
    },
  });
  return { id: "app-fake-sdk" };
}

/** One armed sidebar write waiting for the test to land it. */
interface DeferredWrite {
  apply: () => void;
}
const deferredWrites: DeferredWrite[] = [];

/** Apply (and settle) every armed sidebar write — the host bridge echo. */
export function landWrites(): void {
  const pending = deferredWrites.splice(0, deferredWrites.length);
  for (const write of pending) write.apply();
}

export function pendingWriteCount(): number {
  return deferredWrites.length;
}

export function experimental_useSidebarThreads(): unknown {
  const threads = useSyncExternalStore(subscribe, () => store.threads);
  return {
    status: "ready" as const,
    threads,
    projects: store.projects as readonly FakeSidebarProject[],
    sections: [],
    experimental_archived: null,
  };
}

// The realtime signal channels: useRealtime registers handlers, tests fire
// them through fireRealtime.
const realtimeChannels = new Map<string, Set<(payload: unknown) => void>>();

function mutateThread(threadId: string, patch: (thread: FakeSidebarThread) => FakeSidebarThread): void {
  store.threads = store.threads.map((thread) =>
    thread.id === threadId ? patch(thread) : thread,
  );
  emit();
}

// One stable actions object across renders (same identity lesson as rpc).
const fakeActions = {
  open: () => {},
  openNewThread: () => {},
  setPinned: (threadId: string, pinned: boolean) =>
    new Promise((resolve) => {
      deferredWrites.push({
        apply: () => {
          mutateThread(threadId, (thread) => ({ ...thread, isPinned: pinned }));
          resolve({ ok: true as const });
        },
      });
    }),
  setRead: (threadId: string, read: boolean) =>
    new Promise((resolve) => {
      deferredWrites.push({
        apply: () => {
          // The deliberate mark-unread route nulls `lastReadAt` (the
          // single-writer fact lib/pin-park keys on); a read write stamps it.
          mutateThread(threadId, (thread) => ({
            ...thread,
            isUnread: !read,
            lastReadAt: read ? Date.now() : null,
          }));
          resolve({ ok: true as const });
        },
      });
    }),
  rename: () => Promise.resolve({ ok: true as const }),
  archive: () => Promise.resolve({ ok: true as const }),
  requestDelete: () => {},
};

export function experimental_useSidebarThreadActions(): unknown {
  return fakeActions;
}

const fakeProvidersSnapshot = {
  status: "ready",
  providers: [{ id: "pi", displayName: "Pi" }],
};

export function experimental_useProviders(): unknown {
  return fakeProvidersSnapshot;
}

// A panel route the app's pushes always fail (returns false): the pane then
// opens in fallback mode — component state alone, no history integration.
// Stable identity: callbacks hanging off navigate must not churn.
const fakeNavigate = {
  toThread: () => {},
  toPluginPanel: (): boolean => false,
};

export function useBbNavigate(): unknown {
  return fakeNavigate;
}

export function experimental_usePluginId(): string {
  return "focus-board";
}

export function useRealtime(channel: string, handler: (payload: unknown) => void): void {
  if (channel === undefined) return; // legacy no-arg stub signature
  if (!realtimeChannels.has(channel)) realtimeChannels.set(channel, new Set());
  realtimeChannels.get(channel)?.add(handler);
}

/** Every handler registered for `channel` (the fake equivalent of a realtime signal). */
export function fireRealtime(channel: string, payload: unknown = {}): void {
  for (const handler of [...realtimeChannels.get(channel) ?? []]) handler(payload);
}

const rpcSubscribers = new Set<(event: unknown) => void>();
function publishThreadChanged(): void {
  for (const subscriber of [...rpcSubscribers]) {
    subscriber({ entity: "thread", changes: [] });
  }
}
/** Counted rpc activity: tests assert refetch coalescing through this log
 * (one burst of signals must produce one call per list, not per signal). */
const rpcCallLog: string[] = [];

/** The methods rpc.call has handed the server so far; clear with clearRpcCallLog(). */
export function rpcCalls(): readonly string[] {
  return rpcCallLog;
}

export function clearRpcCallLog(): void {
  rpcCallLog.length = 0;
}

// Feature-group fake state: the registry and the assignments the group_*
// writes mutate directly. `useRealtime` above is a no-op, so — as in a
// connection window where ephemeral signals cannot deliver — the app under
// test can settle its group surface only through its own writes' responses.
let fakeGroups: Record<string, { name: string; createdAt: string }> = {};
let fakeGroupMemberships: Record<string, string> = {};
let fakeGroupSeq = 0;

/** Seed the fake group registry and memberships (fresh per test). */
export function seedFakeGroups(
  groups: Record<string, { name: string; createdAt: string }>,
  memberships: Record<string, string> = {},
): void {
  fakeGroups = structuredClone(groups);
  fakeGroupMemberships = structuredClone(memberships);
  fakeGroupSeq = 0;
}

const rpcCall = async (method: string, args?: unknown): Promise<unknown> => {
  rpcCallLog.push(method);
  switch (method) {
    case "done_list":
      return { doneIds: [], records: {} };
    case "pin_parks_list":
      return { parks: {} };
    case "sweep_config_get":
      return { doneArchiveMs: 172800000, idleArchiveMs: 172800000 };
    case "link_list":
      return { links: {} };
    case "snooze_list":
      return { snoozes: {} };
    case "rank_list":
      return { orders: {} };
    case "groups_list":
      return {
        groups: structuredClone(fakeGroups),
        memberships: structuredClone(fakeGroupMemberships),
      };
    case "group_create": {
      const { name } = args as { name: string };
      const existing = Object.entries(fakeGroups).find(([, record]) => record.name === name);
      if (existing !== undefined) {
        return { group: { id: existing[0], ...existing[1] } };
      }
      fakeGroupSeq += 1;
      const id = `grp_fake_${fakeGroupSeq}`;
      const record = { name, createdAt: new Date().toISOString() };
      fakeGroups[id] = record;
      return { group: { id, ...record } };
    }
    case "group_rename": {
      const { groupId, name } = args as { groupId: string; name: string };
      if (fakeGroups[groupId] === undefined) {
        throw new Error(`group ${groupId} does not exist`);
      }
      fakeGroups[groupId] = { ...fakeGroups[groupId], name };
      return { group: { id: groupId, ...fakeGroups[groupId] } };
    }
    case "group_set": {
      const { threadId, groupId } = args as { threadId: string; groupId: string | null };
      if (groupId !== null && fakeGroups[groupId] === undefined) {
        throw new Error(`group ${groupId} does not exist`);
      }
      if (groupId !== null) fakeGroupMemberships[threadId] = groupId;
      else delete fakeGroupMemberships[threadId];
      return { threadId, groupId };
    }
    case "group_delete": {
      const { groupId } = args as { groupId: string };
      delete fakeGroups[groupId];
      for (const [threadId, assigned] of Object.entries(fakeGroupMemberships)) {
        if (assigned === groupId) delete fakeGroupMemberships[threadId];
      }
      return { groupId };
    }
    case "tracker_validate":
      return { results: {} };
    default:
      // The real server rejects unknown/misrouted methods too; the board's
      // callers all attach a failure path or catch.
      throw new Error(`app-fake-sdk: no RPC handler for ${method}`);
  }
};

// One stable object across renders (the screenshot harness's own lesson:
// the app's effects key on the rpc identity, so a fresh object per render
// re-runs the effect forever).
const rpc = { call: rpcCall };

export function useRpc(): { call: (method: string, args?: unknown) => Promise<unknown> } {
  return rpc;
}

const fakeSdk = {
  subscribe: (args: { event: string; callback: (event: unknown) => void }) => {
    rpcSubscribers.add(args.callback);
    return () => rpcSubscribers.delete(args.callback);
  },
  threads: {
    list: async (args?: { archived?: boolean }) =>
      args?.archived === true
        ? store.threads
            .filter((thread) => thread.isArchived)
            .map((thread) => ({
              id: thread.id,
              title: thread.displayTitle,
              titleFallback: null,
              href: null,
            }))
        : [],
    get: async ({ threadId }: { threadId: string }) => {
      const found = store.threads.find((thread) => thread.id === threadId);
      return found === undefined
        ? {}
        : {
            environmentId:
              (found.environment as { id?: string } | null | undefined)?.id ?? null,
          };
    },
    interactions: {
      list: async () => [],
      respond: async () => ({}),
      cancel: async () => ({}),
    },
    events: {
      list: async () => [],
    },
  },
  hosts: {
    list: async () => [{ id: "host_local", name: "Local", lifecycle: { phase: "active" } }],
  },
  projects: {
    list: async () =>
      store.projects.map((project) => ({ ...project, gitRemoteUrl: null })),
    create: async () => ({}),
  },
  plugins: {
    updateSettings: async () => {
      publishThreadChanged();
      return { ok: true as const };
    },
  },
};

export function useSdk(): unknown {
  return fakeSdk;
}

const fakeSettingsSnapshot = { values: undefined };

export function useSettings(): { values: Record<string, unknown> | undefined } {
  return fakeSettingsSnapshot;
}

// The pane's embedded chat: only imported for render; tests stub it out as
// a marker node.
export function ThreadChat(): ReactNode {
  return <div data-testid="fake-thread-chat" />;
}

// The new-thread composer: the modal under test here never opens it.
export function experimental_NewThreadComposer(): ReactNode {
  return <div data-testid="fake-new-thread-composer" />;
}