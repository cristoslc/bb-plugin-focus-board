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
  applyRankClearFractions,
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

// Per-thread plugin-metadata namespaces for the sdk-side reads (the
// thread-header action's getPluginMetadata): done and snooze records land
// here the way the real bridge serves them off the thread's namespace.
const fakeThreadMetadata: Record<string, Record<string, unknown>> = {};
export function seedFakeThreadMetadata(
  threadId: string,
  metadata: Record<string, unknown>,
): void {
  fakeThreadMetadata[threadId] = metadata;
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

// The registered thread-header action slot (the native-pane move): captured
// so tests assert the registration and mount the component directly.
export const registeredThreadHeaderAction: {
  id?: string;
  title?: string;
  component?: (props: { threadId: string; projectId: string; isCompactViewport: boolean }) => ReactNode;
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
      experimental_threadHeaderAction: (
        config: {
          id: string;
          title: string;
          component: (props: { threadId: string; projectId: string; isCompactViewport: boolean }) => ReactNode;
        },
      ) => {
        registeredThreadHeaderAction.id = config.id;
        registeredThreadHeaderAction.title = config.title;
        registeredThreadHeaderAction.component = config.component;
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
// `open` records every call (the native-pane move's click switch) AND runs
// bb's own placement rules against the simulated split layout
// (apps/app/src/lib/split-layout/openThreadInSplit.ts): a thread already in a
// pane focuses that pane, a split inserts a right-hand pane beside the
// focused one, and the eight-pane ceiling replaces the focused pane's
// content. The board's click rule is about how many panes the layout ends up
// with, so the fake has to place panes the way the host does, not only
// record the call.
const nativeOpens: Array<{ threadId: string; split?: boolean }> = [];
export function fakeNativeOpens(): Array<{ threadId: string; split?: boolean }> {
  return structuredClone(nativeOpens);
}
export function resetFakeNativeOpens(): void {
  nativeOpens.splice(0, nativeOpens.length);
}
const fakeActions = {
  open: (threadId: string, options?: { split?: boolean }) => {
    nativeOpens.push({ threadId, split: options?.split });
    fakeRouteThreadId = threadId;
    fakeRouteIsFallback = false;
    if (options?.split === true) placeSplitOpen(threadId);
  },
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

// The split layout the board’s native-pane awareness reads, and the pane-cap
// guard the card click consults: null means "no split" — what a single-pane
// board route reports on a real host. Controllable so a test can focus a native
// thread pane and read the board’s follow (attention capture, active card)
// exactly as it follows its own pane’s open thread, and so the click tests can
// drive the ceiling layouts the guard exists for.
//
// The HOST's own layout is kept apart from what the hook reports, the way bb's
// are: `splitLayoutAtom` holds a single pane for a one-pane window while
// `useSidebarSplitLayout()` answers null below two panes
// (apps/app/src/lib/plugin-sidebar-split.ts, `countPanes(layout.root) < 2`).
// Splitting from "no split" therefore still has a pane to split away from.
interface FakeSplitPane {
  paneId: string;
  threadId: string | null;
  isFocused: boolean;
}
/** A one-pane window: the board's own pane, focused. */
const BOARD_ONLY_PANES: readonly FakeSplitPane[] = [
  { paneId: "pane-1", threadId: null, isFocused: true },
];
let fakeHostPanes: readonly FakeSplitPane[] = BOARD_ONLY_PANES;
/** Splits off (a phone viewport, or the operator's setting): the host's split
 *  placement degrades to plain navigation and no second pane ever opens. */
let fakeSplitsOff = false;
/** The hook's snapshot, cached: `useSyncExternalStore` requires a stable value
 *  per revision, exactly as bb's own `useMemo` over the layout atom gives it. */
let fakeSplitSnapshot: { panes: readonly FakeSplitPane[] } | null = null;
function refreshSplitSnapshot(): void {
  fakeSplitSnapshot =
    fakeSplitsOff || fakeHostPanes.length < 2 ? null : { panes: fakeHostPanes };
}
const splitLayoutListeners = new Set<() => void>();
function subscribeSplitLayout(listener: () => void): () => void {
  splitLayoutListeners.add(listener);
  return () => splitLayoutListeners.delete(listener);
}
function emitSplitLayout(): void {
  for (const listener of [...splitLayoutListeners]) listener();
}
function setHostPanes(panes: readonly FakeSplitPane[]): void {
  fakeHostPanes = panes;
  refreshSplitSnapshot();
  emitSplitLayout();
}
export function setFakeSplitLayout(panes: readonly FakeSplitPane[] | null): void {
  setHostPanes(panes ?? BOARD_ONLY_PANES);
}
/** Turn bb's split placement off, the compact-viewport (phone) shape. */
export function setFakeSplitsOff(off: boolean): void {
  fakeSplitsOff = off;
  if (off) setHostPanes(BOARD_ONLY_PANES);
  else {
    refreshSplitSnapshot();
    emitSplitLayout();
  }
}
/** The simulated host's own pane list, what the panel layout renders. */
export function fakeSplitPanes(): FakeSplitPane[] {
  return structuredClone([...fakeHostPanes]);
}
/** bb's route reconciliation, placement only. */
function reconcileFakeRoute(threadId: string): void {
  if (fakeSplitsOff || fakeHostPanes.length < 2) return;
  const panes = fakeHostPanes;
  const existing = panes.find((pane) => pane.threadId === threadId);
  if (existing !== undefined) {
    setHostPanes(focusPane(panes, existing.paneId));
    return;
  }
  const focused = focusedPane(panes);
  if (focused === undefined) return;
  setHostPanes(
    panes.map((pane) =>
      pane.paneId === focused.paneId
        ? { ...pane, threadId, isFocused: true }
        : { ...pane, isFocused: false },
    ),
  );
}
function focusedPane(
  panes: readonly FakeSplitPane[],
): FakeSplitPane | undefined {
  return panes.find((pane) => pane.isFocused) ?? panes[0];
}
function focusPane(panes: readonly FakeSplitPane[], paneId: string): FakeSplitPane[] {
  return panes.map((pane) => ({ ...pane, isFocused: pane.paneId === paneId }));
}
function nextFakePaneId(panes: readonly FakeSplitPane[]): string {
  const ids = new Set(panes.map((pane) => pane.paneId));
  let sequence = 1;
  while (ids.has(`pane-${sequence}`)) sequence += 1;
  return `pane-${sequence}`;
}
/** bb's `openThreadInSplit`, as far as placement goes. */
function placeSplitOpen(threadId: string): void {
  if (fakeSplitsOff) return; // plain navigation: no pane change
  const panes = fakeHostPanes;
  const existing = panes.find((pane) => pane.threadId === threadId);
  if (existing !== undefined) {
    setHostPanes(focusPane(panes, existing.paneId));
    return;
  }
  const focused = focusedPane(panes);
  if (focused === undefined) return;
  if (panes.length >= 8) {
    setHostPanes(
      panes.map((pane) =>
        pane.paneId === focused.paneId
          ? { ...pane, threadId, isFocused: true }
          : { ...pane, isFocused: false },
      ),
    );
    return;
  }
  const inserted: FakeSplitPane = {
    paneId: nextFakePaneId(panes),
    threadId,
    isFocused: true,
  };
  const unfocused = focusPane(panes, inserted.paneId);
  const index = unfocused.findIndex((pane) => pane.paneId === focused.paneId);
  setHostPanes([
    ...unfocused.slice(0, index + 1),
    inserted,
    ...unfocused.slice(index + 1),
  ]);
}

/** Every `toThread` navigation the app asked for, in order. */
const threadNavigations: string[] = [];
export function fakeThreadNavigations(): string[] {
  return structuredClone(threadNavigations);
}
export function resetFakeThreadNavigations(): void {
  threadNavigations.splice(0, threadNavigations.length);
}
/**
 * The app's route, as the host's router sees it. Two properties matter to the
 * board's click rule and both are measured live:
 *
 * - Navigating to the route the app is ALREADY on is a no-op: react-router
 *   pushes no entry, bb's reconciliation never runs, and the focused pane does
 *   not change. A click whose focus step is that navigation therefore stalls.
 * - Navigating to a thread the host cannot resolve leaves the app on its
 *   fallback route instead of focusing a pane: the click disappears.
 */
let fakeRouteThreadId: string | null = null;
let fakeRouteIsFallback = false;
export function setFakeRouteThread(threadId: string | null): void {
  fakeRouteThreadId = threadId;
  fakeRouteIsFallback = false;
}
/** True once a navigation left the app on its unresolved-thread fallback. */
export function fakeRouteFellBack(): boolean {
  return fakeRouteIsFallback;
}
function liveThreadIds(): readonly string[] {
  return store.threads.map((thread) => thread.id);
}
export function useSidebarSplitLayout(): unknown {
  return useSyncExternalStore(
    subscribeSplitLayout,
    // bb reports the layout only once it splits; a single pane is null.
    () => fakeSplitSnapshot,
  );
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
// Stable identity: callbacks hanging off navigate must not churn. Every
// call is recorded (the native-pane move): the in-panel route is the pane's
// own surface now that card clicks open bb's native pane, so a test can pin
// exactly which gestures still push it.
const panelPushes: Array<{ path: string; subPath: string; replace: boolean }> = [];
export function fakePanelPushes(): Array<{ path: string; subPath: string; replace: boolean }> {
  return structuredClone(panelPushes);
}
export function resetFakePanelPushes(): void {
  panelPushes.splice(0, panelPushes.length);
}
const fakeNavigate = {
  // bb's route reconciliation (SplitThreadArea's effect →
  // `reconcileLayoutForContent`): the route's content lands in the pane that
  // already holds it (focusing it), else it replaces the FOCUSED pane. Where
  // splits are off the route simply navigates. A route the app is already on
  // is a no-op, and a thread the host cannot resolve falls back instead of
  // reaching a pane.
  toThread: (threadId: string) => {
    threadNavigations.push(threadId);
    if (threadId === fakeRouteThreadId) return;
    if (!liveThreadIds().includes(threadId)) {
      fakeRouteThreadId = null;
      fakeRouteIsFallback = true;
      return;
    }
    fakeRouteThreadId = threadId;
    fakeRouteIsFallback = false;
    reconcileFakeRoute(threadId);
  },
  toPluginPanel: (path: string, options?: { subPath?: string; replace?: boolean }): boolean => {
    panelPushes.push({ path, subPath: options?.subPath ?? "", replace: options?.replace === true });
    return false;
  },
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

/** The version the fake `host_version` RPC serves (lib/host-capabilities.ts).
 *  Defaults to the installed host, so a suite that never touches it drives the
 *  0.50 branch. `null` makes the read fail, which is the unknown host. The
 *  capability store settles once per module graph: a suite that flips this
 *  mid-file also calls `resetHostCapabilitiesForTests()`. */
let fakeHostVersion: string | null = "0.50.1";
export function setFakeHostVersion(version: string | null): void {
  fakeHostVersion = version;
}
// A host rejection stub (issue #232: the operator's host served rank RPCs
// from a foreign plugin instance that rejected rank_move with an input
// validation failure — the drags fell back silently). When armed, every
// rank_move rejects with this message, exactly like the live logs showed.
let rankMoveFailure: string | null = null;

/** Reject every rank_move with `message` until cleared (null = serve). */
export function stubRankMoveFailure(message: string | null): void {
  rankMoveFailure = message;
}

// The mount-readiness gate's probes (issue #403): arm ONE method to hang
// (never settles until released) or to reject, exactly the two shapes the
// gate must treat differently — a hung call is the ceiling's job, a
// rejected optional list is settled.
let hungMethod: string | null = null;
const hungResolvers: Array<(value: unknown) => void> = [];
let rejectedMethod: string | null = null;
// A SLOW-but-alive call (issue #424): the fan-in's real shape on a workspace
// big enough that the mount read costs real time. Distinct from a hang — it
// settles on its own, with no release needed.
let delayedMethod: string | null = null;
let delayedMs = 0;

/** Make every call to `method` hang until `releaseRpcHangs()` (null clears). */
export function stubRpcHang(method: string | null): void {
  hungMethod = method;
}

/** Make every call to `method` settle after `ms` (null clears). */
export function stubRpcDelay(method: string | null, ms = 0): void {
  delayedMethod = method;
  delayedMs = ms;
}

/** Resolve every hung call with an empty payload (the callers' guards hold). */
export function releaseRpcHangs(): void {
  const resolvers = hungResolvers.splice(0, hungResolvers.length);
  for (const resolve of resolvers) resolve({});
}

/** Make every call to `method` reject (null clears). */
export function stubRpcRejection(method: string | null): void {
  rejectedMethod = method;
}

/** Every rpc method the app under test called, in order (test introspection). */
export function fakeRpcCalls(): { method: string; args?: unknown }[] {
  return structuredClone(rpcCalls);
}

export function resetFakeRpcCalls(): void {
  rpcCalls.splice(0, rpcCalls.length);
}

// The retry arm (issue #405): the app's `sdk.threads.retry` calls recorded
// separately from the plugin rpc log, with a failure stub the refusal
// path's test arms — a host refusal must surface, never fail silently.
let retryFailure: string | null = null;
const retryCalls: { args?: unknown }[] = [];

/** Reject every threads.retry with `message` until cleared (null = serve). */
export function stubRetryFailure(message: string | null): void {
  retryFailure = message;
}

/** Every sdk.threads.retry call the app under test made, in order. */
export function fakeRetryCalls(): { args?: unknown }[] {
  return structuredClone(retryCalls);
}

export function resetFakeRetryCalls(): void {
  retryCalls.splice(0, retryCalls.length);
}

// The composer spawn (components/new-thread-modal → sdk.threads.spawn): every
// request recorded verbatim, with the thread record the spawn answers with. The
// record is the provisional pane row, so the title is what a suite asserts the
// pane shows.
const spawnCalls: Record<string, unknown>[] = [];
const fakeSpawnedThread = {
  id: "thr_spawned",
  title: "Spawned thread",
  titleFallback: null,
  status: "idle",
  projectId: "proj_a",
};

/** Every `threads.spawn` request the modal made, in order. */
export function fakeSpawnCalls(): Record<string, unknown>[] {
  return structuredClone(spawnCalls);
}

export function resetFakeSpawnCalls(): void {
  spawnCalls.splice(0, spawnCalls.length);
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

// The linked-issue records the plugin server (server.ts link_*) holds, seeded
// per test: thread id → the array shape parseLinkedIssues validates. Tests
// seed GitHub-shaped entries (repo + issue + kind + href + createdAt +
// source) to give the ticket chips a ref set, most often so the chip
// snapshot's refetch triggers (the operator-moment fingerprint) have
// something visible to count.
let fakeLinks: Record<string, unknown[]> = {};

/** Seed the fake link store (fresh per test; pass {} to clear). */
export function seedFakeLinks(links: Record<string, unknown[]>): void {
  fakeLinks = structuredClone(links);
}

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
  if (method === hungMethod) {
    return new Promise((resolve) => {
      hungResolvers.push(resolve);
    });
  }
  if (method === rejectedMethod) {
    throw new Error(`app-fake-sdk: ${method} stubbed to reject`);
  }
  if (method === delayedMethod) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayedMs);
    });
  }
  switch (method) {
    case "host_version": {
      // The one capability input (lib/host-capabilities.ts): the app reads it
      // once per process, so every branch of the one-pane click is reachable
      // here by setting the version before the board mounts.
      if (fakeHostVersion === null) {
        throw new Error("app-fake-sdk: host_version stubbed to fail");
      }
      return { version: fakeHostVersion };
    }
    case "board_state_get":
      // The mount aggregate (issue #424): the same six bodies the per-list
      // handlers answer with, so a suite that seeds links/groups sees them
      // through the mount exactly as it does through a signal refetch.
      return {
        done: { doneIds: [], records: {} },
        parks: { parks: {} },
        links: { links: structuredClone(fakeLinks) },
        acks: { ackIds: [], records: {} },
        snoozes: { snoozes: {} },
        groups: {
          groups: structuredClone(fakeGroups),
          memberships: structuredClone(fakeGroupMemberships),
        },
      };
    case "done_list":
      return { doneIds: [], records: {} };
    case "pin_parks_list":
      return { parks: {} };
    case "sweep_config_get":
      return { doneArchiveMs: 172800000, idleArchiveMs: 172800000 };
    case "link_list":
      // The seeded links ride the same shape the real host serves:
      // thread id → its array of link records (parseLinkedIssues validates
      // each entry and fails loud on a malformed one).
      return { links: structuredClone(fakeLinks) };
    case "tracker_status": {
      // The chip snapshot's status read. The fake serves no real statuses —
      // the resolution itself is what the snapshot's landing gate cares
      // about, and fetch-count assertions (the operator-moment bump) read
      // them off rpcCalls, not the dots.
      const { repo, numbers } = (args ?? {}) as { repo: string; numbers?: number[] };
      void repo;
      void numbers;
      return { statuses: {} };
    }
    case "snooze_list":
      return { snoozes: {} };
    case "snooze_set": {
      // The header action's write path (the native-pane move): answers like
      // the real handler, and the metadata read reflects it so a follow-up
      // realtime refetch paints the wake.
      const { threadId, wakeAt } = args as { threadId: string; wakeAt: string };
      fakeThreadMetadata[threadId] = {
        ...(fakeThreadMetadata[threadId] ?? {}),
        snooze: { wakeAt, setAt: new Date().toISOString() },
      };
      fireRealtime("snooze-changed", { threadId });
      return { threadId, wakeAt };
    }
    case "snooze_clear": {
      const { threadId } = args as { threadId: string };
      const namespace = fakeThreadMetadata[threadId] ?? {};
      delete namespace["snooze"];
      fakeThreadMetadata[threadId] = namespace;
      fireRealtime("snooze-changed", { threadId });
      return { threadId, cleared: true };
    }
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
    case "rank_clear": {
      const { columnKey } = args as { columnKey: string };
      // The shared clear op — the same function the real server runs, so
      // this arm cannot drift into its own re-spelling of the semantics.
      const result = applyRankClearFractions(fakeRanks, columnKey);
      fakeRanks = result.next;
      return { columnKey, order: [] };
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
      // The metadata write + signal serve the sdk-side readers (the thread
      // header action's refetch), mirroring the real server's fan-out.
      const { threadId, done } = args as { threadId: string; done: boolean };
      const namespace = fakeThreadMetadata[threadId] ?? {};
      if (done) {
        namespace["done"] = { doneAt: new Date().toISOString() };
        fakeThreadMetadata[threadId] = namespace;
      } else {
        delete namespace["done"];
        fakeThreadMetadata[threadId] = namespace;
      }
      publishThreadChanged();
      fireRealtime("done-changed", { threadId });
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
    case "family_state_set_many": {
      if (familyStateWriteFailure !== null) throw new Error(familyStateWriteFailure);
      const { key, ids, on } = args as {
        key: "collapsedFamilies" | "hideIdleChildren";
        ids: string[];
        on: boolean;
      };
      const set = new Set(fakeFamilyState[key]);
      for (const id of ids) {
        if (on) set.add(id);
        else set.delete(id);
      }
      fakeFamilyState = { ...fakeFamilyState, [key]: [...set].sort() };
      fireRealtime("family-state-changed", { key, id: null, on });
      return { key, ids, on };
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
            displayTitle: found.displayTitle,
          };
    },
    // The plugin-bound metadata read the thread-header action uses (the
    // native-pane move): serves the per-thread namespace seeded through
    // seedFakeThreadMetadata, like the host's bridge serves the real one.
    getPluginMetadata: async ({ threadId }: { threadId: string }) =>
      structuredClone(fakeThreadMetadata[threadId] ?? {}),
    // The board's composer spawn (components/new-thread-modal): the request is
    // recorded verbatim and the spawn result is the row the pane renders until
    // the sidebar cache carries the thread. The store stays untouched — a
    // freshly spawned thread is not in bb's sidebar list on the tick the pane
    // opens, which is the timing the provisional row exists for.
    spawn: async (args?: Record<string, unknown>) => {
      spawnCalls.push(structuredClone(args ?? {}));
      return structuredClone(fakeSpawnedThread);
    },
    interactions: {
      list: async () => [],
      respond: async () => ({}),
      cancel: async () => ({}),
    },
    events: {
      list: async () => [],
    },
    // The retry primitive (issue #405): recorded apart from rpcCalls, with
    // the stubbed rejection served from the failure knob above.
    retry: async (args?: { threadId: string }) => {
      retryCalls.push({ args });
      if (retryFailure !== null) throw new Error(retryFailure);
      return {
        ok: true as const,
        attempt: 1,
        delivery: "sent" as const,
        turnRequestId: "trq_fake_retry",
      };
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
    // The declared-settings write path, modelled the way the host behaves: the
    // patch merges into the store `useSettings` reads back, so a suite proves a
    // real round trip (write → re-render → the next click reads it). A store
    // nobody seeded stays UNSET: an unavailable settings surface is a state
    // several suites depend on (the setup dialog never asks without it), so a
    // write there is recorded but does not conjure a loaded store.
    updateSettings: async (args?: { pluginId?: string; values?: Record<string, unknown> }) => {
      const patch = args?.values ?? {};
      settingsWrites.push(structuredClone(patch));
      if (fakeSettingsValues !== undefined) {
        setFakeSettings({ ...fakeSettingsValues, ...patch });
      }
      publishThreadChanged();
      return { ok: true as const };
    },
  },
};

const settingsWrites: Record<string, unknown>[] = [];

/** Every declared-settings patch this suite wrote, in order (test
 *  introspection: the setup dialog's mark and the operator's pick are two
 *  writes a suite asserts the ORDER of). */
export function fakeSettingsWrites(): Record<string, unknown>[] {
  return structuredClone(settingsWrites);
}

export function resetFakeSettingsWrites(): void {
  settingsWrites.length = 0;
  setFakeSettings(null);
}

export function useSdk(): unknown {
  return fakeSdk;
}

let fakeSettingsValues: Record<string, unknown> | undefined = undefined;
let fakeSettingsSnapshot: { values: Record<string, unknown> | undefined } = {
  values: fakeSettingsValues,
};

/** Seed the host-declared settings the board reads (e.g. a developer trace
 *  switch). Null clears them, the unloaded state every other suite sees. */
export function setFakeSettings(values: Record<string, unknown> | null): void {
  fakeSettingsValues = values ?? undefined;
  fakeSettingsSnapshot = { values: fakeSettingsValues };
  emit();
}

export function useSettings(): { values: Record<string, unknown> | undefined } {
  // Reactive, like the host's own hook: a write from ANY surface (this board's
  // gear modal, bb's configuration page, the CLI) re-renders every reader, which
  // is the property the settings-surface plan calls structural sync (P1/P2 in
  // docs/plans/2026-10-10-settings-surface-sync-thr_57yyxtw9kf.md). A snapshot
  // object, not a fresh one per render, so useSyncExternalStore stays stable.
  return useSyncExternalStore(subscribe, () => fakeSettingsSnapshot);
}

// The pane's embedded chat: only imported for render; tests stub it out as
// a marker node.
export function ThreadChat(): ReactNode {
  return <div data-testid="fake-thread-chat" />;
}

/**
 * The spawn request the fake composer submits. The modal forwards a request
 * verbatim to `threads.spawn` (components/new-thread-modal), so one button is
 * enough to drive the real spawn path: the host composer's own pickers and
 * promptbox are not what the board's routing is about.
 */
const FAKE_COMPOSE_REQUEST = {
  prompt: "A thread from the board's own composer",
  projectId: "proj_a",
  providerId: "pi",
} as const;

/**
 * The new-thread composer: a marker node plus the submit affordance, so an
 * app-level suite can spawn from the board's own modal exactly as an operator
 * does (open the board's New Thread control, press this, and the app's spawn
 * path runs: `threads.spawn`, then wherever the spawn opens the thread).
 */
export function experimental_NewThreadComposer(props: {
  onSubmit: (request: Record<string, unknown>) => Promise<void>;
}): ReactNode {
  return (
    <div data-testid="fake-new-thread-composer">
      <button
        type="button"
        data-fake-composer-submit=""
        onClick={() => {
          // The modal rethrows a failed spawn so the host composer can keep
          // the draft; the stub has no draft, so it only settles the write.
          props.onSubmit({ ...FAKE_COMPOSE_REQUEST }).catch(() => {});
        }}
      >
        Spawn thread
      </button>
    </div>
  );
}
