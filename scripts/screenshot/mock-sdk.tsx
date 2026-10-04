/**
 * Stand-in for `@get-bb/plugin-sdk/app` used only by the screenshot harness.
 * Vite aliases the SDK specifier to this module, so the real app code
 * (app.tsx + components/) renders unmodified against simulated data.
 *
 * Styling here uses inline styles exclusively: dist/app.css is the plugin's
 * compiled Tailwind output and only contains classes the plugin's own source
 * uses, so utility classes invented here would silently not exist.
 */
import { createRoot } from "react-dom/client";
import type { ComponentType, ReactNode } from "react";
import { SIM_DONE_IDS, SIM_DONE_RECORDS, SIM_PROJECTS, SIM_PROVIDERS, SIM_SECTIONS, SIM_THREADS, SIM_WORKSPACE_FILES } from "./data";
import { applyMoveVisible } from "../../lib/rank";
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
      // The sidebar-footer settings gear (0.5.21): no sidebar is rendered in
      // the harness, so the registration just has to be accepted.
      sidebarFooterAction: (_config: { id: string }) => undefined,
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

export function experimental_useSidebarThreads(): unknown {
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

/** A copy the mock actions can rewrite; the constant stays pristine. */
let simThreads: readonly SimThread[] = SIM_THREADS;

export function experimental_useSidebarThreadActions(): unknown {
  return {
    open: () => {},
    openNewThread: () => {},
    setPinned: async (threadId: string, pinned: boolean) => {
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
    rename: async () => {},
    archive: () => {},
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
  subscribe: () => () => {},
  threads: {
    list: async () => [],
    // The pane resolves the thread's environment once (the inline-code
    // decoration gates on it); mirror the fixture's own environment id.
    get: async ({ threadId }: { threadId: string }) => {
      const sim = SIM_THREADS.find((candidate) => candidate.id === threadId);
      const environment = sim?.environment as { id?: string } | null;
      return { environmentId: environment?.id ?? null };
    },
    unarchive: async () => {},
    // The awaited archive the sweep runner uses; the mock drops the thread
    // from the simulated sidebar so the harness sweep visibly empties.
    archive: async ({ threadId }: { threadId: string }) => {
      simThreads = simThreads.filter((candidate) => candidate.id !== threadId);
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
  projects: {
    list: async () => SIM_PROJECTS.map((project) => ({ ...project, gitRemoteUrl: null })),
    create: async () => ({}),
  },
};

export function useSdk(): unknown {
  return mockSdk;
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
(globalThis as unknown as { __uat?: unknown }).__uat = {
  seedRanks: (orders: Record<string, string[]>) => {
    simRanks = structuredClone(orders);
  },
  ranks: () => structuredClone(simRanks),
  calls: () => structuredClone(uatCalls),
  resetCalls: () => {
    uatCalls.length = 0;
  },
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
  if (method === "thread_autotitle") {
    // Deterministic canned reply: the real server builds the title from the
    // thread's first prompt over bb's selected AI service; a UAT pass
    // exercises the editor's commit-on-return flow with this. The override
    // target (fallback modal pick) names the alternative it simulated with.
    const { pluginId, serviceId } = (args ?? {}) as { pluginId?: string; serviceId?: string };
    return {
      title:
        pluginId !== undefined && serviceId !== undefined
          ? `Simulated ${serviceId} title`
          : "Simulated auto title",
    };
  }
  if (method === "thread_autotitle_services") {
    // The fallback modal's menu: one ready alternative (the simulated
    // selection itself is excluded), one disabled with its blocker.
    return {
      selected: { pluginId: "openrouter-inference", serviceId: "default" },
      services: [
        { pluginId: "openrouter-inference", serviceId: "default", displayName: "OpenRouter", ready: true, message: null },
        { pluginId: "sim-alternative", serviceId: "other", displayName: "Simulated other service", ready: true, message: null },
        { pluginId: "sim-offline", serviceId: "down", displayName: "Simulated offline service", ready: false, message: "Simulated sign-in needed" },
      ],
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
    const { columnKey, threadId, beforeId, toEnd, visibleIds } = args as {
      columnKey: string;
      threadId: string;
      beforeId: string | null;
      toEnd: boolean;
      visibleIds: string[];
    };
    simRanks[columnKey] = applyMoveVisible(
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
 * Stub for the SDK's reactive plugin-settings hook (0.5.21): the harness has
 * no host settings surface, so values stay null — the app treats null
 * settings as the documented default (escape-stops-running stays ON).
 */
export function useSettings(): { values: Record<string, unknown> | null } {
  return { values: null };
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