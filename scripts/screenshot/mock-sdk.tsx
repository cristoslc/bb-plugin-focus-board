/**
 * Stand-in for `@get-bb/plugin-sdk/app` used only by the screenshot harness.
 * Vite aliases the SDK specifier to this module, so the real app code
 * (app.tsx + components/) renders unmodified against simulated data.
 *
 * Styling here uses inline styles exclusively: dist/app.css is the plugin's
 * compiled Tailwind output and only contains classes the plugin's own source
 * uses, so utility classes invented here would silently not exist.
 */
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentType, ReactNode } from "react";
import { SIM_DEMO_THREADS, SIM_DONE_IDS, SIM_DONE_RECORDS, SIM_PROJECTS, SIM_PROVIDERS, SIM_SECTIONS, SIM_THREADS, SIM_WORKSPACE_FILES, type SimThread } from "./data";
import { applyMoveVisible } from "../../lib/rank";
import { applyUnitMoveVisible } from "../../lib/rank-unit-move";
// Pure constants only — lib/sweep would drag components/grouping into the
// mock, whose SDK-app import this file itself stands in for (cycle).
import { DAY_MS } from "../../lib/duration";

export const registeredNavPanel: {
  path?: string;
  component?: ComponentType<{ subPath: string }>;
} = {};

export const registeredContentScripts: Array<{
  id: string;
  mount: (context: { signal: AbortSignal; pluginId: string; generation: number }) => unknown;
}> = [];

export function definePluginApp(setup: (app: unknown) => void): unknown {
  setup({
    contentScripts: {
      register: (registration: { id: string; mount: unknown }) => {
        registeredContentScripts.push(registration as never);
      },
    },
    slots: {
      navPanel: (config: {
        path: string;
        component: ComponentType<{ subPath: string }>;
      }) => {
        registeredNavPanel.path = config.path;
        registeredNavPanel.component = config.component;
      },
      // The sidebar-footer settings gear (0.5.21): no sidebar renders in
      // the harness, but the registration is captured so the verify script
      // can assert the title (the "configuration" noun rule).
      sidebarFooterAction: (config: { id: string; title: string }) => {
        registeredSidebarFooterAction = { ...config };
      },
      // The plugin detail page's configuration section (the Appearance
      // mirror): captured so `?page=configuration` can mount it standalone
      // for the headless verify (the harness has no host plugin page).
      settingsSection: (
        config: {
          id: string;
          title?: string;
          description?: string;
          component: ComponentType<Record<string, never>>;
        },
      ) => {
        registeredSettingsSections[config.id] = { ...config };
      },
    },
    // The brand-icon registration (app.tsx FocusBoardAppIcon): no host
    // surface renders icons in the harness, so accept and drop it.
    experimental_icons: {
      register: (_registration: { name: string; component: ComponentType }) => undefined,
    },
  });
  return { id: "screenshot-mock" };
}

const MOCK_PLUGIN_ID = "focus-board";
let mockSubPath = "";
let mockRoot: ReturnType<typeof createRoot> | null = null;

function mockRender(): void {
  const Component = registeredNavPanel.component;
  const rootElement = document.getElementById("root");
  if (!Component || !rootElement) return;
  if (mockRoot === null) mockRoot = createRoot(rootElement);
  mockRoot.render(<Component subPath={mockSubPath} />);
  // Mount the plugin's content scripts once, like the real host does per
  // frontend generation; the board's glue sweep runs against the mock DOM.
  if (!mount.contentScripts) {
    mount.contentScripts = true;
    for (const script of registeredContentScripts) {
      const disposer = script.mount({
        pluginId: MOCK_PLUGIN_ID,
        generation: 1,
        signal: new AbortController().signal,
      });
      mount.dispose.push(typeof disposer === "function" ? disposer : null);
    }
  }
}

/** Mount bookkeeping for the mock generation above. */
const mount: { contentScripts: boolean; dispose: Array<(() => void) | null> } = {
  contentScripts: false,
  dispose: [],
};

/**
 * A minimal real-history router for the panel route, so UAT steps can drive
 * genuine browser back/forward against the app's pane-history behavior.
 *
 * Mirrors the two contract clauses the app is written against:
 * - a push re-renders the panel with the new `subPath`;
 * - an external history change (back/forward, popstate) re-renders it too.
 */
function installMockRouter(panelPath: string): void {
  const base = `${window.location.pathname}#/plugins/${MOCK_PLUGIN_ID}/${panelPath}`;
  const subPathFromUrl = (): string => {
    const prefix = `#/plugins/${MOCK_PLUGIN_ID}/${panelPath}`;
    const hash = window.location.hash;
    if (!hash.startsWith(prefix)) return "";
    const rest = hash.slice(prefix.length);
    return rest.startsWith("/") ? rest.slice(1) : rest;
  };
  mockSubPath = subPathFromUrl();
  window.addEventListener("popstate", () => {
    mockSubPath = subPathFromUrl();
    mockRender();
  });
  (window as unknown as {
    __mockRouter: { push: (subPath: string, replace: boolean) => void };
  }).__mockRouter = {
    push: (subPath, replace) => {
      const next = subPath === "" ? base : `${base}/${subPath}`;
      const before = history.length;
      if (replace) history.replaceState(null, "", next);
      else history.pushState(null, "", next);
      console.log("ROUTER", JSON.stringify({ subPath, replace, lenBefore: before, lenAfter: history.length }));
      mockSubPath = subPath;
      mockRender();
    },
  };
}

/** Mount (once) the panel the app registered, under the mock router. */
export function mountRegisteredPanel(): void {
  const panelPath = registeredNavPanel.path;
  if (panelPath === undefined) throw new Error("harness: no nav panel registered");
  installMockRouter(panelPath);
  mockRender();
}

/**
 * Standalone config-page mount (`?page=configuration`): the harness has no
 * host plugin-detail page, so this renders the registered settings section
 * bare. The headless verify drives the mirrored Appearance rows against the
 * same mock SDK the board runs on.
 */
export function mountRegisteredConfigSection(): void {
  const section = registeredSettingsSections["appearance"];
  if (section === undefined) throw new Error("harness: no settings section registered");
  const rootElement = document.createElement("div");
  rootElement.setAttribute("data-focus-board-config-section", "");
  rootElement.className = "p-6";
  document.body.append(rootElement);
  // Render through JSX (an element, never a direct call): the section uses
  // hooks, which only work inside the renderer's component context.
  const Section = section.component;
  createRoot(rootElement).render(<Section {...( {} as Record<string, never>)} />);
}

export function useBbNavigate(): unknown {
  return {
    toThread: () => {},
    toPluginPanel: (
      _path: string,
      options?: { subPath?: string; replace?: boolean },
    ): boolean => {
      const router = (
        window as unknown as {
          __mockRouter?: { push: (subPath: string, replace: boolean) => void };
        }
      ).__mockRouter;
      if (router === undefined) return false;
      router.push(options?.subPath ?? "", options?.replace === true);
      return true;
    },
  };
}

/** The plugin id the real SDK resolves from the host registration. */
export function experimental_usePluginId(): string {
  return MOCK_PLUGIN_ID;
}

export function experimental_useSidebarThreads(): unknown {
  // Subscribe to the sidebar's revision so a host push re-renders the board.
  useSyncExternalStore(
    (onStoreChange) => {
      sidebarListenerSet.add(onStoreChange);
      return () => {
        sidebarListenerSet.delete(onStoreChange);
      };
    },
    () => simThreadsRevision,
  );
  return {
    status: "ready",
    // The live array, not the constant: setPinned rewrites it, and the app's
    // memo chain keyed on this identity must see a fresh object to re-sort
    // the Pinned lane.
    threads: simThreads,
    projects: SIM_PROJECTS,
    sections: SIM_SECTIONS,
    experimental_archived: null,
  };
}

/** A copy the mock actions can rewrite; the constant stays pristine. In
 *  screenshot demo mode (`?demo=1`) it also gains the fresh demo families
 *  (data.ts SIM_DEMO_THREADS) so shots show nested child threads folded and
 *  unfolded in the attention lanes. UAT suites never set the flag, so their
 *  lane and column-order assertions see exactly the base fixture. */
const DEMO_MODE = new URLSearchParams(window.location.search).get("demo") === "1";
// `?failautotitle=` (comma list): autotitle call kinds that fail ONCE, then
// succeed — the UAT suite walks a failure into the fallback modal and out
// through an alternative. Kinds: "plain" (the bare ✨ call), "threadmodel"
// (the useThreadModel probe), "pair:<pluginId>/<serviceId>" (an override).
const FAIL_AUTOTITLE_KINDS = new Set(
  (new URLSearchParams(window.location.search).get("failautotitle") ?? "")
    .split(",")
    .map((kind) => kind.trim())
    .filter(Boolean),
);
let simThreads: readonly SimThread[] = DEMO_MODE
  ? [...SIM_THREADS, ...SIM_DEMO_THREADS]
  : SIM_THREADS;

/**
 * The sidebar store's revision: the React hook subscribes to it, so a host
 * push (or a mock action's rewrite) re-renders the board against the fresh
 * array — the way real bb's sidebar hook re-reads over its subscription.
 * Without this, a simulated push only re-rendered surfaces the app happened
 * to re-render for its own reasons, so UAT could never race a live update
 * against an in-flight gesture.
 */
let simThreadsRevision = 0;
const sidebarListenerSet = new Set<() => void>();

/** Rewrite the simulated sidebar and wake every reader (the hook, the realtime subscribers). */
function bumpSimThreads(
  next: readonly SimThread[],
  changes: readonly string[] = ["updated"],
): void {
  simThreads = next;
  simThreadsRevision += 1;
  for (const listener of sidebarListenerSet) listener();
  for (const subscriber of mockSubscribers) {
    subscriber.callback({ entity: "thread", changes: [...changes] });
  }
}

/** The thread patch a UAT driver or the fuzz engine pushes mid-suite. */
function pushThreadUpdate(
  threadId: string,
  patch: Record<string, unknown>,
): { ok: boolean; revision: number } {
  const next = simThreads.map((thread) =>
    thread.id === threadId ? ({ ...thread, ...patch } as SimThread) : thread,
  );
  bumpSimThreads(next);
  return { ok: true, revision: simThreadsRevision };
}

/** Threads archived in the harness; `threads.list({ archived: true })` serves these. */
let simArchived: readonly SimThread[] = [];

/** Ticket-chip store links (the app's link_list): none in the simulation. */
const simLinks: Record<string, unknown> = {};

/** Realtime subscribers (the app subscribes with `{ event, callback }`). */
type MockSubscribeArgs = { event: string; callback: (event: { entity: string; changes: string[] }) => void };
const mockSubscribers = new Set<MockSubscribeArgs>();
function mockPublishArchivedChanged(): void {
  for (const subscriber of mockSubscribers) {
    subscriber.callback({ entity: "thread", changes: ["archived-changed"] });
  }
}

export function experimental_useSidebarThreadActions(): unknown {
  return {
    open: () => {},
    openNewThread: () => {},
    setPinned: async (threadId: string, pinned: boolean) => {
      (globalThis as unknown as { __pinLog?: Array<{ threadId: string; pinned: boolean }> }).__pinLog =
        [
          ...((globalThis as unknown as { __pinLog?: Array<{ threadId: string; pinned: boolean }> }).__pinLog ?? []),
          { threadId, pinned },
        ];
      const before = simThreads.length;
      simThreads = simThreads.map((candidate) =>
        candidate.id === threadId ? { ...candidate, isPinned: pinned } : candidate,
      );
      const after = simThreads.length;
      if (before !== after) throw new Error(`setPinned changed the thread count (${before} → ${after})`);
      const moved = simThreads.find((candidate) => candidate.id === threadId);
      if (moved === undefined) throw new Error(`setPinned: unknown thread ${threadId}`);
      mockRender();
    },
    setRead: async () => {},
    // Mirror the real host: the rename lands in the simulated sidebar and
    // re-renders, so a ✨ commit (thread-pane's commit path) is visibly the
    // new title on the closed editor — what the UAT suite asserts.
    rename: async (threadId: string, nextTitle: string) => {
      const before = simThreads.find((candidate) => candidate.id === threadId);
      if (before === undefined) throw new Error(`rename: unknown thread ${threadId}`);
      simThreads = simThreads.map((candidate) =>
        candidate.id === threadId ? { ...candidate, displayTitle: nextTitle } : candidate,
      );
      mockRender();
    },
    // The pane's actions menu archives through this sidebar hook (the
    // sweep's awaited archive rides sdk.threads.archive below). Mirror the
    // real host: move the thread out of the simulated sidebar into the
    // archived set and re-render, so the gesture visibly archives and the
    // pane's archived lookup can keep the thread resolvable.
    archive: (threadId: string) => {
      (globalThis as unknown as { __mockArchives?: number }).__mockArchives =
        ((globalThis as unknown as { __mockArchives?: number }).__mockArchives ?? 0) + 1;
      const moved = simThreads.find((candidate) => candidate.id === threadId);
      simThreads = simThreads.filter((candidate) => candidate.id !== threadId);
      if (moved !== undefined) {
        simArchived = [...simArchived, moved];
      }
      mockPublishArchivedChanged();
      mockRender();
      return { ok: true as const };
    },
    requestDelete: () => {},
  };
}

export function experimental_useProviders(): unknown {
  return { status: "ready", providers: SIM_PROVIDERS };
}

// One stable object across renders: the app holds `sdk` in effect deps
// ([sdk]) and its handlers setState on resolve, so a per-render object here
// is an endless setState→render→new-sdk→setState loop (~1000 renders/s) that
// eventually wedges the page. The real host returns a stable client; the
// mock must too.
const mockSdk = {
  subscribe: (args: MockSubscribeArgs) => {
    mockSubscribers.add(args);
    return () => mockSubscribers.delete(args);
  },
  threads: {
    // The app's archived lookup calls `list({ archived: true })` to keep an
    // archived thread's pane resolvable; the rows carry the sidebar's
    // title/titleFallback/href shape. Everything else keeps the historic
    // empty list (the board reads the sidebar through the hooks above).
    list: async (args?: { archived?: boolean }) =>
      args?.archived === true
        ? simArchived.map((thread) => ({
            id: thread.id,
            title: thread.displayTitle,
            titleFallback: null,
            href: null,
          }))
        : [],
    // The pane resolves the thread's environment once (the inline-code
    // decoration gates on it); mirror the fixture's own environment id.
    get: async ({ threadId }: { threadId: string }) => {
      const sim = simThreads.find((candidate) => candidate.id === threadId);
      const environment = sim?.environment as { id?: string } | null;
      return { environmentId: environment?.id ?? null };
    },
    // Restore the most recent archived copy of the thread to the live list.
    unarchive: async ({ threadId }: { threadId: string }) => {
      const restored = [...simArchived].reverse().find((candidate) => candidate.id === threadId);
      if (restored !== undefined) {
        simArchived = simArchived.filter((candidate) => candidate.id !== threadId);
        simThreads = [...simThreads, restored];
        mockPublishArchivedChanged();
        mockRender();
      }
      return { ok: true as const };
    },
    // The awaited archive the sweep runner uses; the mock moves the thread
    // to the archived set so the harness sweep visibly empties.
    archive: async ({ threadId }: { threadId: string }) => {
      const moved = simThreads.find((candidate) => candidate.id === threadId);
      simThreads = simThreads.filter((candidate) => candidate.id !== threadId);
      if (moved !== undefined) {
        simArchived = [...simArchived, moved];
      }
      mockPublishArchivedChanged();
      mockRender();
      return { ok: true as const, archivedThreadIds: [threadId] };
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
    list: async () => [{ id: "host_local", name: "MacBook Pro", lifecycle: { phase: "active" } }],
  },
  plugins: {
    // The settings modal's Behavior tab writes the plugin's declarative
    // settings; the mock merges the patch into the simulated store below and
    // re-renders, so the reactive read side reflects the write the way the
    // real host confirms one. Records the patch in `uatCalls` too, so a UAT
    // driver can assert the write shape.
    updateSettings: async (args: { pluginId: string; values: Record<string, unknown> }) => {
      uatCalls.push({ method: "plugins.updateSettings", args });
      simSettings = { ...simSettings, ...(args.values as Record<string, string | number | boolean>) };
      mockRender();
      return { ok: true as const };
    },
  },
  projects: {
    list: async () =>
      SIM_PROJECTS.map((project) => ({
        ...project,
        // The Focus Board sim project carries the real repo so ticket chips
        // build hrefs and the status batch finds a repo to ask.
        gitRemoteUrl: project.id === "proj_board" ? "https://github.com/cristoslc/bb-plugin-focus-board.git" : null,
      })),
    create: async () => ({}),
  },
};

export function useSdk(): unknown {
  return mockSdk;
}

/**
 * A stub new-thread composer: the real one is bb's host compose surface,
 * which the harness has no host for. Renders a marker the pane/board shots
 * can show and a button that fires onSubmit with a minimal request, the
 * same recording contract the modal's unit-test stub uses. The mock SDK
 * must track every specifier app.tsx imports from '@get-bb/plugin-sdk/app'
 * or the harness fails to boot (it did: the ✨ child-thread composer import
 * was missing here and the harness rendered an empty root).
 */
export function experimental_NewThreadComposer(props: Record<string, unknown>): ReactNode {
  return (
    <button
      type="button"
      data-mock-composer=""
      onClick={() => {
        const submit = props.onSubmit as ((request: unknown) => void) | undefined;
        void submit?.({ projectId: "proj_1", input: [] });
      }}
      style={{ padding: "4px 8px", fontSize: 12 }}
    >
      Mock composer
    </button>
  );
}

/**
 * In-memory rank store for the harness, mirroring the server's KV row:
 * columnKey → sparse ordered id list. Seeded from `?ranks=` (a JSON object)
 * so a UAT pass can start from a ranked column, and mutated by rank_move the
 * way the real server mutates it. `__uat` exposes it to the page so a driver
 * can seed and inspect it without going through the app.
 */
let simRanks: Record<string, string[]> = {};
const uatCalls: { method: string; args?: unknown }[] = [];
// The simulated declared-settings store the plugins.updateSettings mock
// merges into and useSettings reads back; `?settings=` (main.tsx) seeds it
// so a verify run can prove the modal renders previously-written values.
let simSettings: Record<string, string | number | boolean> = {};
export function seedSimSettings(seed: Record<string, string | number | boolean>) {
  simSettings = { ...seed };
}
// The sidebar-footer action's captured registration (its title is the
 // "configuration" noun the verify script asserts).
let registeredSidebarFooterAction: Record<string, unknown> | null = null;
// The captured settings sections (the Appearance mirror), keyed by id, so
// `?page=configuration` can mount one standalone for the headless verify.
const registeredSettingsSections: Record<
  string,
  { title?: string; description?: string; component: (props: Record<string, never>) => unknown }
> = {};
// Feature groups: the registry (id → name stamps) and the per-thread
// assignments, module state mutated by group_* writes. The default box
// wraps the two active threads ("chat-imagegent", the live report's group).
let simGroupRegistry: Record<string, { name: string; createdAt: string }> = {
  grp_chat_imagegent: { name: "chat-imagegent", createdAt: "2026-10-09T22:00:00.000Z" },
};
let simGroupAssignments: Record<string, string> = {
  thr_column_sort: "grp_chat_imagegent",
  thr_drag_done: "grp_chat_imagegent",
};
(globalThis as unknown as { __uat?: unknown }).__uat = {
  seedRanks: (orders: Record<string, string[]>) => {
    simRanks = structuredClone(orders);
  },
  ranks: () => structuredClone(simRanks),
  calls: () => structuredClone(uatCalls),
  sidebarFooterAction: () => {
    const registration = registeredSidebarFooterAction;
    if (registration === null) return null;
    const { id, title } = registration as { id: unknown; title: unknown };
    return { id, title };
  },
  resetCalls: () => {
    uatCalls.length = 0;
  },
  // A mid-suite thread patch: rewrites the simulated sidebar (fresh array
  // identity, so the app's memo chain re-derives every lane) and wakes both
  // the React hook and the realtime subscribers — the shape of a real host
  // push, which races whatever gesture the driver has in flight.
  pushThreadUpdate,
};

const rpcCall = async (method: string, args?: unknown): Promise<unknown> => {
  uatCalls.push({ method, args });
  if (method === "done_list") {
    return { doneIds: SIM_DONE_IDS, records: structuredClone(SIM_DONE_RECORDS) };
  }
  if (method === "sweep_config_get") {
    // Resolved ms, mirroring the real server: defaults are 2 days per arm.
    return {
      doneArchiveMs: 2 * DAY_MS,
      idleArchiveMs: 2 * DAY_MS,
    };
  }
  if (method === "rank_list") return { orders: structuredClone(simRanks) };
  if (method === "pin_parks_list") return { parks: {} };
  if (method === "snooze_list") return { snoozes: {} };
  // The mock previously fell through to `{}` here, and the app's links
  // reader (`Object.entries(result.links)`) recorded an unhandled rejection
  // on every harness boot and every "link-changed" wake.
  if (method === "link_list") return { links: {} };
  // Live chip status: the sim answers merged for the chip-probe card's PR
  // run and a couple of open/closed items for the follow-up card, so dark
  // and light screenshots show every state treatment.
  if (method === "tracker_status") {
    const { repo, numbers } = args as { repo: string; numbers: number[] };
    const statuses: Record<string, { kind: string; state: string }> = {};
    if (repo === "cristoslc/bb-plugin-focus-board") {
      for (const n of numbers) {
        if (n >= 43 && n <= 59) statuses[String(n)] = { kind: "pull", state: "MERGED" };
        else if (n === 17 || n === 21) statuses[String(n)] = { kind: "issue", state: "OPEN" };
        else if (n === 30) statuses[String(n)] = { kind: "issue", state: "CLOSED" };
      }
    }
    return { statuses };
  }
  // Validation gates the text-ref chips in the real app; the sim confirms
  // everything asked of it so the probe cards render their chip rows.
  if (method === "tracker_validate") {
    const { urls } = args as { urls: string[] };
    const results: Record<string, { confirmed: boolean }> = {};
    for (const url of urls) results[url] = { confirmed: true };
    return { results };
  }
  // Feature groups (components/group-boxes): the harness renders one box
  // ("chat-imagegent") around the two active threads by default, and its
  // group writes mutate the module map + re-render, the way thread_reparent
  // does — the real app code renders unmodified against the simulation.
  if (method === "link_list") {
    return { links: structuredClone(simLinks) };
  }
  if (method === "groups_list") {
    return {
      groups: simGroupRegistry,
      memberships: structuredClone(simGroupAssignments),
    };
  }
  if (method === "group_create") {
    const { name } = args as { name: string };
    const id = `grp_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    simGroupRegistry[id] = { name, createdAt: new Date().toISOString() };
    return { group: { id, name, createdAt: simGroupRegistry[id].createdAt } };
  }
  if (method === "group_rename") {
    const { groupId, name } = args as { groupId: string; name: string };
    simGroupRegistry[groupId] = { ...simGroupRegistry[groupId], name };
    mockRender();
    return { group: { id: groupId, ...simGroupRegistry[groupId] } };
  }
  if (method === "group_set") {
    const { threadId, groupId } = args as { threadId: string; groupId: string | null };
    if (groupId !== null) simGroupAssignments[threadId] = groupId;
    else delete simGroupAssignments[threadId];
    mockRender();
    return { threadId, groupId };
  }
  if (method === "thread_reparent") {
    // The server's semantics, abbreviated for the harness: the real handler
    // re-checks lib/reparent against fresh rows, then calls threads.update
    // and bb's host pushes the changed thread back over the sidebar bridge.
    // The mock IS the whole chain, so it rewrites the simulated sidebar row
    // and re-renders — the board then nests the card via the normal
    // buildFamilyIndex pass. Refusals throw, the way the real RPC's
    // PluginCliError does.
    const { threadId, parentThreadId } = args as {
      threadId: string;
      parentThreadId: string | null;
    };
    const target = simThreads.find((candidate) => candidate.id === parentThreadId);
    if (parentThreadId !== null && target === undefined) {
      throw new Error("the target card is no longer on the board.");
    }
    simThreads = simThreads.map((candidate) =>
      candidate.id === threadId ? { ...candidate, parentThreadId } : candidate,
    );
    mockRender();
    return { threadId, parentThreadId };
  }
  if (method === "thread_autotitle") {
    // Deterministic canned reply: the real server builds the title from the
    // thread's first prompt over bb's selected AI service; a UAT pass
    // exercises the editor's commit-on-return flow with this. The override
    // targets name the path the fallback modal simulated with.
    const { pluginId, serviceId, useThreadModel } = (args ?? {}) as {
      pluginId?: string;
      serviceId?: string;
      useThreadModel?: boolean;
    };
    // `?failautotitle=` seeds ONE failing call per named kind, so a suite
    // step can walk a failure (the modal opens), then a success. Kinds map
    // onto the failure shapes found LIVE on the operator's board: `plain`
    // throws the unset title-task selection error every first click saw;
    // `openrouter` throws the bridge-overflow 400 the long-opener pick saw.
    const kind =
      useThreadModel === true
        ? "threadmodel"
        : pluginId === undefined && serviceId === undefined
          ? "plain"
          : `pair:${pluginId}/${serviceId}`;
    if (FAIL_AUTOTITLE_KINDS.delete(kind)) {
      if (kind === "plain") {
        throw new Error(
          "Title task is not set to a plugin AI service. Choose one under Settings → AI services → thread-title (bb cloud and automatic run inside bb and cannot be invoked from plugins).",
        );
      }
      if (useThreadModel === true) {
        throw new Error(
          "thread_autotitle: the title probe turn did not finish within 120s on sim-provider/sim-model",
        );
      }
      throw new Error("HTTP 400: rpc input validation failed");
    }
    if (useThreadModel === true) {
      return { title: "Simulated thread-model title" };
    }
    return {
      title:
        pluginId !== undefined && serviceId !== undefined
          ? `Simulated ${serviceId} title`
          : "Simulated auto title",
    };
  }
  if (method === "thread_autotitle_services") {
    // The fallback modal's menu: one ready alternative (the simulated
    // selection itself is excluded), one disabled with its blocker, and the
    // thread-model probe available. `sim-nobridge` mirrors the live shape
    // the real board carries (bb cloud / provider-codex): ready, but
    // without the complete bridge — it must render BLOCKED, because a pick
    // routes thread_autotitle at a plugin whose RPC surface has no method.
    return {
      selected: { pluginId: "openrouter-inference", serviceId: "default" },
      services: [
        { pluginId: "openrouter-inference", serviceId: "default", displayName: "OpenRouter", ready: true, message: null, bridge: true, bridgeReason: null },
        { pluginId: "sim-alternative", serviceId: "other", displayName: "Simulated other service", ready: true, message: null, bridge: true, bridgeReason: null },
        { pluginId: "sim-nobridge", serviceId: "x", displayName: "Simulated unbridged service", ready: true, message: null, bridge: false, bridgeReason: "sim-nobridge does not expose the complete bridge focus-board calls (only plugins implementing one can serve the ✨)" },
        { pluginId: "sim-offline", serviceId: "down", displayName: "Simulated offline service", ready: false, message: "Simulated sign-in needed", bridge: false, bridgeReason: null },
      ],
      threadModel: { available: true, reason: null },
    };
  }
  if (method === "workspace_files_exist") {
    // The decoration's existence gate (components/decorate-inline-code.ts):
    // a path the workspace has verifies true, everything else stays plain.
    const { paths } = args as { paths: string[] };
    const known = new Set(SIM_WORKSPACE_FILES);
    return { existence: Object.fromEntries(paths.map((path) => [path, known.has(path)])) };
  }
  if (method === "rank_move") {
    // The server's move semantics — applyMoveVisible, not a re-spelled copy
    // of them — so a UAT pass exercises the real state change. The copy this
    // replaced drifted the first time the move semantics changed (the
    // rank-everything-above-the-drop-point fix), and the suite caught it.
    const { columnKey, threadId, beforeId, toEnd, visibleIds, unitIds } = args as {
      columnKey: string;
      threadId: string;
      beforeId: string | null;
      toEnd: boolean;
      visibleIds: string[];
      unitIds?: string[];
    };
    simRanks[columnKey] =
      unitIds !== undefined && unitIds.length > 0
        ? applyUnitMoveVisible(simRanks[columnKey] ?? [], visibleIds, unitIds, beforeId, toEnd)
        : applyMoveVisible(
            simRanks[columnKey] ?? [],
            visibleIds,
            threadId,
            beforeId,
            toEnd,
          );
    return { columnKey, order: [...simRanks[columnKey]] };
  }
  return {};
};

// Module-level singleton: app.tsx's mount effect depends on the rpc object
// identity, so a fresh object per render would re-run the effect forever.
const rpc = { call: rpcCall };

export function useRpc(): { call: (method: string, args?: unknown) => Promise<unknown> } {
  return rpc;
}

export function useRealtime(_channel: string, _handler: (payload: unknown) => void): void {
  // No realtime traffic in the harness.
}

/**
 * The reactive plugin-settings hook: the harness simulates the host's
 * declared-settings store — `updateSettings` merges into `simSettings`, and
 * this hook reads it back so a write re-renders through the app. `?settings=`
 * (main.tsx) seeds the store, so a verify run can prove the modal renders
 * previously-written values. An empty store shows every setting's default.
 */
export function useSettings(): {
  values: Record<string, unknown> | null;
  isLoading: boolean;
} {
  return { values: structuredClone(simSettings), isLoading: false };
}

interface MockMessage {
  role: "user" | "agent";
  text: string;
}

const CONVERSATIONS: Record<string, MockMessage[]> = {
  thr_glyph_glue: [
    {
      role: "agent",
      text:
        "Sync design is settled. ADR-0004 (`docs/rfcs/rfc-support-triage-process-workflow-acceptance-checklist.md`) accepts background sync through cloud storage scoped to the household — an append-only record log of week statuses, ledger lines, and setup revisions.",
    },
  ],
  thr_permissions: [
    { role: "user", text: "The environment connect flow shows the permission prompt twice on macOS hosts. Can you dig in?" },
    { role: "agent", text: "Found it — the connect handler awaits the scope grant twice: once in connectEnvironment() and again in the retry wrapper, so the host rejects the second prompt and loops. I have a fix drafted in fix/permission-loop." },
    { role: "agent", text: "Before I commit: should the retry wrapper re-prompt, or reuse the first grant silently? Re-prompting is safer but noisier." },
  ],
  default: [
    { role: "user", text: "Morning! Continuing from yesterday — the column ordering fix is on main." },
    { role: "agent", text: "Confirmed: State lanes now read Needs you → Unread → Working, and the idle buckets run newest-leftmost, derived from the same AGE_BUCKETS as the Last activity board. 19 tests green." },
    { role: "user", text: "Nice. Next up: lock the order in with an ordering test and bump to 0.1.1." },
  ],
};

/**
 * Markdown-lite agent text: backtick spans become real `<code>` elements, the
 * shape the host's markdown preview renders and the pane's inline-code
 * decoration scans. The harness chat used to render plain text, which meant
 * the decoration never had a candidate in a UAT run. Inline styles only —
 * invented utility classes do not exist in the compiled app.css.
 */
function inlineMarkup(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <code
        key={index}
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.92em",
          background: "var(--secondary)",
          borderRadius: 4,
          padding: "1px 4px",
        }}
      >
        {part}
      </code>
    ) : (
      part
    ),
  );
}

function MockChat({ threadId }: { threadId: string }): ReactNode {
  const messages = CONVERSATIONS[threadId] ?? CONVERSATIONS.default;
  const bubble = (role: "user" | "agent", content: ReactNode, key: string): ReactNode => (
    <div
      key={key}
      style={{
        alignSelf: role === "user" ? "flex-end" : "flex-start",
        maxWidth: "85%",
        borderRadius: 10,
        padding: "7px 10px",
        fontSize: 12.5,
        lineHeight: 1.45,
        whiteSpace: "pre-wrap",
        ...(role === "user"
          ? { background: "var(--primary)", color: "var(--primary-foreground)" }
          : { background: "var(--secondary)", color: "var(--secondary-foreground)" }),
      }}
    >
      {content}
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        padding: 12,
        gap: 8,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "auto" }}>
        <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--muted-foreground)", padding: "4px 0" }}>
          Today
        </div>
        {messages.map((message, index) => bubble(message.role, inlineMarkup(message.text), String(index)))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRadius: 10,
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "8px 10px",
          color: "var(--muted-foreground)",
          fontSize: 12.5,
        }}
      >
        <span style={{ flex: 1 }}>Reply to thread…</span>
        <span
          style={{
            display: "inline-block",
            width: 22,
            height: 22,
            borderRadius: 6,
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            textAlign: "center",
            lineHeight: "22px",
            fontSize: 11,
          }}
        >
          ↑
        </span>
      </div>
    </div>
  );
}

export function ThreadChat(props: { threadId: string; variant?: string; layout?: string }): ReactNode {
  return <MockChat threadId={props.threadId} />;
}