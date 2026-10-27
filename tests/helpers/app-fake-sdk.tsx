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
import {
  applyRankMoveFractions,
  type FractionColumn,
  ordersFromFractionStore,
} from "../../lib/rank-fractions";
import { mintLegacyColumn } from "../../lib/rank-fractions";

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

// Rank orders: per-card FRACTIONS internally (the real storage model,
// lib/rank-fractions.ts), projected to the ordered id lists the app reads.
// The rank_move arm runs the REAL shared move op (applyRankMoveFractions)
// — the same function the live server calls — so app-level rank races are
// testable end to end and the semantics cannot drift between host and
// fake. Seeding keeps the ordered-list API and converts losslessly, the
// same migration the server does on its first read.
let fakeRanks: Record<string, FractionColumn> = {};
const rpcCalls: { method: string; args?: unknown }[] = [];
// A host rejection stub (issue #232: the operator's host served rank RPCs
// from a foreign plugin instance that rejected rank_move with an input
// validation failure — the drags fell back silently). When armed, every
// rank_move rejects with this message, exactly like the live logs showed.
let rankMoveFailure: string | null = null;

/** Reject every rank_move with `message` until cleared (null = serve). */
export function stubRankMoveFailure(message: string | null): void {
  rankMoveFailure = message;
}

/** Every rpc method the app under test called, in order (test introspection). */
export function fakeRpcCalls(): { method: string; args?: unknown }[] {
  return structuredClone(rpcCalls);
}

export function resetFakeRpcCalls(): void {
  rpcCalls.splice(0, rpcCalls.length);
}

/** Seed the fake rank store from ordered lists (fresh per test). */
export function seedFakeRanks(orders: Record<string, string[]>): void {
  fakeRanks = Object.fromEntries(
    Object.entries(orders).map(([columnKey, order]) => [
      columnKey,
      mintLegacyColumn(order),
    ]),
  );
}

export function fakeRankOrders(): Record<string, string[]> {
  return structuredClone(ordersFromFractionStore(fakeRanks));
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

// Family fold + idle-hide server state: ONE module store the family_state_*
// writes mutate, seeded and read by tests. The app hydrates from it on mount
// and converges from the writes' own realtime echoes, exactly as it does
// against a live host.
let fakeFamilyState: { collapsedFamilies: string[]; hideIdleChildren: string[] } = {
  collapsedFamilies: [],
  hideIdleChildren: [],
};
let familyStateWriteFailure: string | null = null;

/** Seed the fake family-state server row (call in beforeEach to reset it). */
export function seedFakeFamilyState(state: {
  collapsedFamilies?: string[];
  hideIdleChildren?: string[];
}): void {
  fakeFamilyState = {
    collapsedFamilies: [...(state.collapsedFamilies ?? [])],
    hideIdleChildren: [...(state.hideIdleChildren ?? [])],
  };
  familyStateWriteFailure = null;
}

/** The fake family-state server row, as the host holds it. */
export function fakeFamilyStateStore(): {
  collapsedFamilies: string[];
  hideIdleChildren: string[];
} {
  return structuredClone(fakeFamilyState);
}

/** Reject every family_state write with `message` until cleared (null = serve). */
export function stubFamilyStateWriteFailure(message: string | null): void {
  familyStateWriteFailure = message;
}

const rpcCall = async (method: string, args?: unknown): Promise<unknown> => {
  rpcCalls.push({ method, args });
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
      return { orders: structuredClone(ordersFromFractionStore(fakeRanks)) };
    case "rank_move": {
      if (rankMoveFailure !== null) throw new Error(rankMoveFailure);
      const { columnKey, threadId, beforeId, toEnd, visibleIds, unitIds } =
        args as {
          columnKey: string;
          threadId: string;
          beforeId: string | null;
          toEnd: boolean;
          visibleIds: string[];
          unitIds?: string[];
        };
      const result = applyRankMoveFractions(fakeRanks, {
        columnKey,
        threadId,
        beforeId,
        toEnd,
        visibleIds,
        unitIds,
      });
      fakeRanks = result.next;
      return { columnKey, order: result.order };
    }
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
    case "done_set": {
      // The board tracks done-ness in its own state (done_list + the write's
      // own echo); the fake only has to answer, like the real handler does.
      const { threadId, done } = args as { threadId: string; done: boolean };
      publishThreadChanged();
      return { threadId, done };
    }
    case "thread_reparent": {
      const { threadId, parentThreadId } = args as { threadId: string; parentThreadId: string | null };
      mutateThread(threadId, (thread) => ({ ...thread, parentThreadId }));
      publishThreadChanged();
      return { threadId, parentThreadId };
    }
    case "tracker_validate":
      return { results: {} };
    case "family_state_list":
      return {
        collapsedFamilies: [...fakeFamilyState.collapsedFamilies],
        hideIdleChildren: [...fakeFamilyState.hideIdleChildren],
      };
    case "family_state_set": {
      if (familyStateWriteFailure !== null) throw new Error(familyStateWriteFailure);
      const { key, id, on } = args as {
        key: "collapsedFamilies" | "hideIdleChildren";
        id: string;
        on: boolean;
      };
      const set = new Set(fakeFamilyState[key]);
      if (on) set.add(id);
      else set.delete(id);
      fakeFamilyState = { ...fakeFamilyState, [key]: [...set].sort() };
      fireRealtime("family-state-changed", { key, id, on });
      return { key, id, on };
    }
    case "family_state_merge": {
      if (familyStateWriteFailure !== null) throw new Error(familyStateWriteFailure);
      const incoming = args as { collapsedFamilies: string[]; hideIdleChildren: string[] };
      fakeFamilyState = {
        collapsedFamilies: [...new Set([...fakeFamilyState.collapsedFamilies, ...incoming.collapsedFamilies])].sort(),
        hideIdleChildren: [...new Set([...fakeFamilyState.hideIdleChildren, ...incoming.hideIdleChildren])].sort(),
      };
      fireRealtime("family-state-changed", { key: null, id: null, on: null });
      return structuredClone(fakeFamilyState);
    }
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