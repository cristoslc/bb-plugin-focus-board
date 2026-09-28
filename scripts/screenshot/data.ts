/**
 * Simulated sidebar data for screenshot rendering. Shapes mirror
 * `PluginSidebarThread` / `PluginSidebarProject` / `ProviderInfo` from the bb
 * plugin SDK; the test fixture in tests/grouping.test.ts is the source of
 * truth for the thread shape.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SIM_NOW = Date.now();

export interface SimProject {
  id: string;
  name: string;
  isPersonal: boolean;
  href: string;
  settingsHref: string;
}

export const SIM_PROJECTS: readonly SimProject[] = [
  { id: "personal", name: "Personal", isPersonal: true, href: "/projects/personal", settingsHref: "" },
  { id: "proj_board", name: "Focus Board", isPersonal: false, href: "/projects/board", settingsHref: "/projects/board/settings" },
  { id: "proj_api", name: "API Gateway", isPersonal: false, href: "/projects/api", settingsHref: "/projects/api/settings" },
  { id: "proj_web", name: "Web App", isPersonal: false, href: "/projects/web", settingsHref: "/projects/web/settings" },
];

export const SIM_SECTIONS: readonly { id: string; name: string }[] = [];

export const SIM_PROVIDERS: readonly { id: string; displayName: string }[] = [
  { id: "pi", displayName: "Pi" },
  { id: "claude-code", displayName: "Claude Code" },
  { id: "codex", displayName: "Codex" },
];

/** Thread ids marked Done on the simulated board. */
export const SIM_DONE_IDS: readonly string[] = ["thr_pane_padding", "thr_license"];

type SimThread = Record<string, unknown> & {
  id: string;
  updatedAt: number;
};

function thread(overrides: Partial<SimThread> & { id: string; updatedAt: number }): SimThread {
  return {
    projectId: "proj_board",
    title: null,
    titleFallback: null,
    displayTitle: "Test thread",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "pi",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/board/threads/${overrides.id}`,
    isHidden: false,
    environment: null,
    host: { id: "host_local", name: "MacBook Pro" },
    createdAt: overrides.updatedAt - DAY,
    lastReadAt: overrides.updatedAt,
    latestAttentionAt: 0,
    ...overrides,
  } as SimThread;
}

const boardEnv = (branch: string) => ({
  id: `env_board_${branch.replace(/[^a-z0-9]/gi, "-")}`,
  name: "Focus Board",
  branchName: branch,
  path: "~/Documents/code/bb-plugin-focus-board",
  isWorktree: false,
  providerId: null,
  workspaceDisplayKind: null,
});

const apiEnv = (branch: string) => ({
  id: `env_api_${branch.replace(/[^a-z0-9]/gi, "-")}`,
  name: "API Gateway",
  branchName: branch,
  path: "~/code/api-gateway",
  isWorktree: false,
  providerId: null,
  workspaceDisplayKind: null,
});

export const SIM_THREADS: readonly SimThread[] = [
  // Pinned
  thread({
    id: "thr_ship_release",
    displayTitle: "Ship 0.1.1: column ordering fix + release notes",
    isPinned: true,
    pinnedAt: SIM_NOW - 6 * HOUR,
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 4 * MINUTE,
    lastReadAt: SIM_NOW - 4 * MINUTE,
    environment: boardEnv("main"),
  }),
  thread({
    id: "thr_roadmap",
    displayTitle: "Plan Q4 plugin roadmap",
    isPinned: true,
    pinnedAt: SIM_NOW - 2 * DAY,
    isUnread: true,
    lastReadAt: SIM_NOW - 3 * DAY,
    updatedAt: SIM_NOW - 2 * DAY - 2 * HOUR,
  }),

  // Needs you
  thread({
    id: "thr_permissions",
    displayTitle: "Fix permission prompt loop on environment connect",
    hasPendingInteraction: true,
    indicatorLabel: "Thread needs user input",
    latestAttentionAt: SIM_NOW - 7 * MINUTE,
    updatedAt: SIM_NOW - 7 * MINUTE,
    lastReadAt: SIM_NOW - 7 * MINUTE,
    environment: boardEnv("fix/permission-loop"),
  }),
  thread({
    id: "thr_deploy_fail",
    displayTitle: "Deploy failed: missing DATABASE_URL secret",
    indicator: "unread-error",
    indicatorLabel: "Unread error",
    latestAttentionAt: SIM_NOW - 35 * MINUTE,
    updatedAt: SIM_NOW - 35 * MINUTE,
    lastReadAt: SIM_NOW - 2 * HOUR,
    projectId: "proj_api",
    providerId: "claude-code",
    environment: apiEnv("main"),
    href: `/projects/api/threads/${"thr_deploy_fail"}`,
  }),

  // Unread
  thread({
    id: "thr_uat_queue",
    displayTitle: "Queue the UAT pass for the rank lane",
    isUnread: true,
    lastReadAt: SIM_NOW - 3 * HOUR,
    updatedAt: SIM_NOW - 2 * HOUR,
  }),
  thread({
    id: "thr_rpc_auth",
    displayTitle: "Research: bb plugin RPC auth tokens",
    isUnread: true,
    lastReadAt: SIM_NOW - 40 * MINUTE,
    updatedAt: SIM_NOW - 26 * MINUTE,
  }),
  thread({
    id: "thr_review_pr",
    displayTitle: "Review PR #14 — extract thread-pane subcomponents",
    isUnread: true,
    lastReadAt: SIM_NOW - 5 * HOUR,
    updatedAt: SIM_NOW - 3 * HOUR,
    projectId: "proj_web",
    providerId: "codex",
    environment: { ...apiEnv("refactor/pane"), name: "Web App", path: "~/code/web-app" },
    href: `/projects/web/threads/${"thr_review_pr"}`,
  }),

  // Working
  thread({
    id: "thr_column_sort",
    displayTitle: "Refactor grouping.ts column sort keys",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 40 * 1000,
    environment: boardEnv("fix/column-order"),
  }),
  thread({
    id: "thr_drag_done",
    displayTitle: "Write E2E test for drag-to-done",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 12 * MINUTE,
    projectId: "proj_web",
    environment: boardEnv("feat/drag-done"),
  }),

  // Idle · Recent
  thread({
    id: "thr_kbd_focus",
    displayTitle: "Add keyboard shortcuts for column focus",
    updatedAt: SIM_NOW - 22 * MINUTE,
    lastReadAt: SIM_NOW - 22 * MINUTE,
  }),
  thread({
    id: "thr_toolbar_labels",
    displayTitle: "Tidy board toolbar dropdown labels",
    updatedAt: SIM_NOW - 48 * MINUTE,
    lastReadAt: SIM_NOW - 48 * MINUTE,
    projectId: "proj_api",
    providerId: "codex",
    environment: apiEnv("ui/polish"),
    href: `/projects/api/threads/${"thr_toolbar_labels"}`,
  }),

  // Idle · Today
  thread({
    id: "thr_flaky_ci",
    displayTitle: "Investigate flaky vitest worker on CI",
    updatedAt: SIM_NOW - 4 * HOUR,
    lastReadAt: SIM_NOW - 4 * HOUR,
  }),
  thread({
    id: "thr_readme_quickstart",
    displayTitle: "Draft README quickstart",
    updatedAt: SIM_NOW - 9 * HOUR,
    lastReadAt: SIM_NOW - 9 * HOUR,
    projectId: "proj_web",
    providerId: "claude-code",
  }),

  // Idle · Earlier
  thread({
    id: "thr_icon_lazy",
    displayTitle: "Refactor icon registry to lazy chunks",
    updatedAt: SIM_NOW - 3 * DAY,
    lastReadAt: SIM_NOW - 3 * DAY,
    projectId: "proj_web",
    environment: boardEnv("perf/icons"),
  }),
  thread({
    id: "thr_env_edge",
    displayTitle: "Explore environment grouping edge cases",
    updatedAt: SIM_NOW - 5 * DAY,
    lastReadAt: SIM_NOW - 5 * DAY,
    projectId: "proj_api",
    providerId: "claude-code",
  }),

  // Idle · A while ago
  thread({
    id: "thr_grouping_spike",
    displayTitle: "Spike: grouping model",
    updatedAt: SIM_NOW - 9 * DAY,
    lastReadAt: SIM_NOW - 9 * DAY,
  }),

  // Parent-lane UAT fixture: one family with an idle parent and idle child so
  // the suite can exercise lane headers, child cards, and the Standalone lane.
  thread({
    id: "thr_parent_lane",
    displayTitle: "Parent thread lane fixture",
    updatedAt: SIM_NOW - 10 * DAY,
    lastReadAt: SIM_NOW - 10 * DAY,
  }),
  thread({
    id: "thr_child_lane",
    displayTitle: "Child thread lane fixture",
    parentThreadId: "thr_parent_lane",
    updatedAt: SIM_NOW - 9 * DAY,
    lastReadAt: SIM_NOW - 9 * DAY,
  }),

  // Done
  thread({
    id: "thr_pane_padding",
    displayTitle: "Fix pane safe-area padding on mobile",
    updatedAt: SIM_NOW - 26 * HOUR,
    lastReadAt: SIM_NOW - 26 * HOUR,
  }),
  thread({
    id: "thr_license",
    displayTitle: "Add MIT license",
    updatedAt: SIM_NOW - 4 * DAY,
    lastReadAt: SIM_NOW - 4 * DAY,
  }),
];