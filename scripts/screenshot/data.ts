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

/**
 * Workspace files the mocked `workspace_files_exist` RPC vouches for,
 * keyed by nothing — existence, not content. The inline-code decoration
 * (components/decorate-inline-code.ts) refuses to linkify a path the
 * thread's workspace does not have, so the UAT fixture's message names a
 * path from this list.
 */
export const SIM_WORKSPACE_FILES: readonly string[] = [
  "docs/rfcs/rfc-support-triage-process-workflow-acceptance-checklist.md",
];

export const SIM_PROVIDERS: readonly { id: string; displayName: string }[] = [
  { id: "pi", displayName: "Pi" },
  { id: "claude-code", displayName: "Claude Code" },
  { id: "codex", displayName: "Codex" },
];

/** Thread ids marked Done on the simulated board. */
export const SIM_DONE_IDS: readonly string[] = ["thr_pane_padding", "thr_license", "thr_proj_done"];

/**
 * Done records for the Done fixtures, stamped past the default 7-day sweep
 * threshold so the Done column's sweep button is eligible (and the armed
 * state is reachable) in screenshots and UAT.
 */
export const SIM_DONE_RECORDS: Record<string, { doneAt: string }> = {
  thr_pane_padding: { doneAt: new Date(SIM_NOW - 9 * DAY).toISOString() },
  thr_license: { doneAt: new Date(SIM_NOW - 12 * DAY).toISOString() },
  // Stamped past the 7-day sweep threshold like the other Done fixtures, so
  // the projection card's row reads as a settled, sweepable done thread.
  thr_proj_done: { doneAt: new Date(SIM_NOW - 13 * DAY).toISOString() },
};

export type SimThread = Record<string, unknown> & {
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

  // Parent-lane UAT fixtures: two families. Family A (thr_parent_lane /
  // thr_child_lane) exercises a sparse ruler lane; family B (thr_sweep_*)
  // stacks six old, still-working children so locking it grows the Working
  // band under a visible lower card — the regression case for the clicked
  // card being pushed off-screen by the recut. B stays lane 1 (older than A).
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
  thread({
    id: "thr_sweep_parent",
    displayTitle: "Archive sweep program",
    updatedAt: SIM_NOW - 14 * DAY,
    lastReadAt: SIM_NOW - 14 * DAY,
  }),
  ...Array.from({ length: 6 }, (_, index) =>
    thread({
      id: `thr_sweep_w${index}`,
      displayTitle: `Sweep worker ${index}: retire stale records`,
      parentThreadId: "thr_sweep_parent",
      status: "active",
      runtimeStatus: "active",
      updatedAt: SIM_NOW - 13 * DAY - index * MINUTE,
      lastReadAt: SIM_NOW - 13 * DAY,
    }),
  ),
  thread({
    id: "thr_sweep_child",
    displayTitle: "Sweep the done archive",
    parentThreadId: "thr_sweep_parent",
    updatedAt: SIM_NOW - 12 * DAY,
    lastReadAt: SIM_NOW - 12 * DAY,
  }),

  thread({
    id: "thr_glyph_glue",
    displayTitle: "Wrap check: long path with the open glyph",
    updatedAt: SIM_NOW - 14 * MINUTE,
    lastReadAt: SIM_NOW - 14 * MINUTE,
    environment: boardEnv("dev"),
  }),

  // Done-projection fixture: a live family with one done child. The done
  // child renders in a second family card (the projection) in the Done
  // column while the live card keeps the live child. Older than the
  // parent-lane UAT families so lane recency order (and the fixed-pan
  // assertions in tests/manual/uat-parent-lanes.yaml) stays put.
  thread({
    id: "thr_proj_family",
    displayTitle: "Migration runner phase two",
    updatedAt: SIM_NOW - 16 * DAY,
    lastReadAt: SIM_NOW - 16 * DAY,
  }),
  thread({
    id: "thr_proj_live",
    displayTitle: "Dry-run the cutover checklist",
    parentThreadId: "thr_proj_family",
    updatedAt: SIM_NOW - 15 * DAY,
    lastReadAt: SIM_NOW - 15 * DAY,
  }),
  thread({
    id: "thr_proj_done",
    displayTitle: "Backfill the legacy rows",
    parentThreadId: "thr_proj_family",
    updatedAt: SIM_NOW - 15 * DAY,
    lastReadAt: SIM_NOW - 15 * DAY,
  }),

  // Big-family fixture: nine nested children — past the scroll threshold,
  // the family card's child list caps and scrolls inside the card. Older
  // than the parent-lane UAT families (see above).
  thread({
    id: "thr_big_family",
    displayTitle: "Import sweep: fifty-two legacy boards",
    updatedAt: SIM_NOW - 17 * DAY,
    lastReadAt: SIM_NOW - 17 * DAY,
  }),
  ...Array.from({ length: 9 }, (_, index) =>
    thread({
      id: `thr_big_c${index}`,
      displayTitle: `Legacy board ${index + 1}: migrate rows and links`,
      parentThreadId: "thr_big_family",
      updatedAt: SIM_NOW - 16 * DAY + index * MINUTE,
      lastReadAt: SIM_NOW - 16 * DAY,
    }),
  ),

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

/**
 * Demo-mode extras (`?demo=1`): three fresh families so screenshot runs show
 * nested child threads folded and unfolded inside the attention lanes. The
 * base fixture's families are deliberately 9–17 days old to keep the
 * parent-lane UAT lanes stable, so they never surface in an attention
 * column; these land in the lanes a new board shows on arrival.
 *
 * Column placement follows nesting.ts's rules: the Working and Unread
 * families lift on an active/unread child (`familyColumnOverrides`), while
 * the Needs-you family lifts on its parent's OWN pending-interaction state —
 * an attention child un-nests to its own card instead of lifting the family,
 * so the family itself carries the flag.
 */
export const SIM_DEMO_THREADS: readonly SimThread[] = [
  // Family A — Working (lifted by its two active children), expanded in the
  // shots: a parent card with three nested child rows visible.
  thread({
    id: "thr_demo_work",
    displayTitle: "Cut the 1.0.0 release branch",
    updatedAt: SIM_NOW - 30 * MINUTE,
    lastReadAt: SIM_NOW - 30 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_demo_work_c0",
    displayTitle: "Regenerate the what's-new gift from the changelog",
    parentThreadId: "thr_demo_work",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 40 * 1000,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_demo_work_c1",
    displayTitle: "Smoke the marketplace install range",
    parentThreadId: "thr_demo_work",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 3 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_demo_work_c2",
    displayTitle: "Sweep the stale done fixtures",
    parentThreadId: "thr_demo_work",
    updatedAt: SIM_NOW - 18 * MINUTE,
    lastReadAt: SIM_NOW - 18 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),

  // Family B — Needs you (lifted by the parent's own pending interaction),
  // collapsed in the shots: a "3 child threads" fold over a status dot strip
  // whose dots span working, unread, and idle colors.
  thread({
    id: "thr_demo_needs",
    displayTitle: "Migrate the household ledger schema",
    hasPendingInteraction: true,
    indicatorLabel: "Thread needs user input",
    latestAttentionAt: SIM_NOW - 9 * MINUTE,
    updatedAt: SIM_NOW - 9 * MINUTE,
    lastReadAt: SIM_NOW - 25 * MINUTE,
  }),
  thread({
    id: "thr_demo_needs_c0",
    displayTitle: "Backfill the ledger rows in batches",
    parentThreadId: "thr_demo_needs",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 4 * MINUTE,
    environment: boardEnv("feat/ledger-migrate"),
  }),
  thread({
    id: "thr_demo_needs_c1",
    displayTitle: "Audit the legacy ledger rows",
    parentThreadId: "thr_demo_needs",
    isUnread: true,
    lastReadAt: SIM_NOW - 40 * MINUTE,
    updatedAt: SIM_NOW - 20 * MINUTE,
  }),
  thread({
    id: "thr_demo_needs_c2",
    displayTitle: "Tag the schema version",
    parentThreadId: "thr_demo_needs",
    updatedAt: SIM_NOW - 35 * MINUTE,
    lastReadAt: SIM_NOW - 35 * MINUTE,
  }),

  // Family C — Unread (lifted by its unread child), expanded, on another
  // project with a different provider so the nested rows also carry the
  // project/provider variety the loose cards show.
  thread({
    id: "thr_demo_unread",
    displayTitle: "Research the realtime sidebar bridge",
    updatedAt: SIM_NOW - 3 * HOUR,
    lastReadAt: SIM_NOW - 3 * HOUR,
    projectId: "proj_web",
    providerId: "codex",
    href: `/projects/web/threads/${"thr_demo_unread"}`,
  }),
  thread({
    id: "thr_demo_unread_c0",
    displayTitle: "Benchmark the archived-changed bridge",
    parentThreadId: "thr_demo_unread",
    isUnread: true,
    lastReadAt: SIM_NOW - 90 * MINUTE,
    updatedAt: SIM_NOW - 50 * MINUTE,
    projectId: "proj_web",
    providerId: "codex",
    href: `/projects/web/threads/${"thr_demo_unread_c0"}`,
  }),
  thread({
    id: "thr_demo_unread_c1",
    displayTitle: "Sketch the subscribe fan-out",
    parentThreadId: "thr_demo_unread",
    updatedAt: SIM_NOW - 2 * HOUR,
    lastReadAt: SIM_NOW - 2 * HOUR,
    projectId: "proj_web",
    providerId: "codex",
    href: `/projects/web/threads/${"thr_demo_unread_c1"}`,
  }),
];