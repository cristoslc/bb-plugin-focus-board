/**
 * Stand-in for `@get-bb/plugin-sdk/app` used only by the screenshot harness.
 * Vite aliases the SDK specifier to this module, so the real app code
 * (app.tsx + components/) renders unmodified against simulated data.
 *
 * Styling here uses inline styles exclusively: dist/app.css is the plugin's
 * compiled Tailwind output and only contains classes the plugin's own source
 * uses, so utility classes invented here would silently not exist.
 */
import type { ComponentType, ReactNode } from "react";
import { SIM_DONE_IDS, SIM_PROJECTS, SIM_PROVIDERS, SIM_SECTIONS, SIM_THREADS } from "./data";

export const registeredNavPanel: { component?: ComponentType } = {};

export function definePluginApp(setup: (app: unknown) => void): unknown {
  setup({
    slots: {
      navPanel: (config: { component: ComponentType }) => {
        registeredNavPanel.component = config.component;
      },
    },
  });
  return { id: "screenshot-mock" };
}

export function experimental_useSidebarThreads(): unknown {
  return {
    status: "ready",
    threads: SIM_THREADS,
    projects: SIM_PROJECTS,
    sections: SIM_SECTIONS,
    experimental_archived: null,
  };
}

export function experimental_useSidebarThreadActions(): unknown {
  return {
    open: () => {},
    openNewThread: () => {},
    setPinned: async () => {},
    setRead: async () => {},
    rename: async () => {},
    archive: () => {},
    requestDelete: () => {},
  };
}

export function experimental_useProviders(): unknown {
  return { status: "ready", providers: SIM_PROVIDERS };
}

export function useBbNavigate(): unknown {
  return { toThread: () => {}, toPluginPanel: () => {} };
}

export function useSdk(): unknown {
  return {
    subscribe: () => () => {},
    threads: {
      list: async () => [],
      unarchive: async () => {},
      interactions: {
        list: async () => [],
        respond: async () => ({}),
        cancel: async () => ({}),
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
}

const rpcCall = async (method: string, args?: unknown): Promise<unknown> => {
  if (method === "done_list") return { doneIds: SIM_DONE_IDS, records: {} };
  if (method === "sweep_config_get") {
    return { doneArchiveDays: 7, idleArchiveDays: 30 };
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

interface MockMessage {
  role: "user" | "agent";
  text: string;
}

const CONVERSATIONS: Record<string, MockMessage[]> = {
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

function MockChat({ threadId }: { threadId: string }): ReactNode {
  const messages = CONVERSATIONS[threadId] ?? CONVERSATIONS.default;
  const bubble = (role: "user" | "agent", text: string, key: string): ReactNode => (
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
      {text}
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
        {messages.map((message, index) => bubble(message.role, message.text, String(index)))}
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