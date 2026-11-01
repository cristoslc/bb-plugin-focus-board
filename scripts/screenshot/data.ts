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
export const SIM_DONE_IDS: readonly string[] = [
  "thr_pane_padding",
  "thr_license",
  "thr_proj_done",
  // The overview fixture's Done lane: three standalone cards plus the
  // projection's done child (SIM_OVERVIEW_THREADS). Ids that are not on a
  // given board are harmless: doneIds is a set read by id.
  "thr_ov_done_padding",
  "thr_ov_done_license",
  "thr_ov_done_stale",
  "thr_ov_release_c_done",
];

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
  // The overview board's Done lane (9–13 days, past the harness's 2-day
  // sweep threshold, so its broom shows an eligible count and an armed
  // sweep paints the cards).
  thr_ov_done_padding: { doneAt: new Date(SIM_NOW - 9 * DAY).toISOString() },
  thr_ov_done_license: { doneAt: new Date(SIM_NOW - 10 * DAY).toISOString() },
  thr_ov_done_stale: { doneAt: new Date(SIM_NOW - 13 * DAY).toISOString() },
  thr_ov_release_c_done: { doneAt: new Date(SIM_NOW - 8 * DAY).toISOString() },
};

/**
 * Scale-fixture builder (issue #186): `?scale=N` appends N synthetic
 * top-level threads so board-scale behavior — hundreds of cards on one
 * board — renders for benches and probes. Ages spread across ten days (the
 * cards distribute over the idle columns), providers and statuses rotate,
 * and ids all share the `thr_scale_` prefix so a driver can find them.
 * Nothing else reads this fixture: the UAT suites stay pinned to the base
 * one.
 */
export function scaleThreads(count: number): readonly SimThread[] {
  return Array.from({ length: count }, (_, index) =>
    thread({
      id: `thr_scale_${index}`,
      displayTitle: `Scale thread ${index}: board interactions at hundreds of threads`,
      status: index % 7 === 0 ? "active" : "idle",
      runtimeStatus: index % 7 === 0 ? "active" : "idle",
      isUnread: index % 5 === 1,
      lastReadAt: index % 5 === 1 ? SIM_NOW - 3 * HOUR : SIM_NOW - index * HOUR,
      providerId: SIM_PROVIDERS[index % SIM_PROVIDERS.length].id,
      projectId: SIM_PROJECTS[index % SIM_PROJECTS.length].id,
      updatedAt: SIM_NOW - Math.min(index * 25 * MINUTE, 10 * DAY),
    }),
  );
}

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

  // Depth-2 (three-tier) family fixture (issue #192's UAT coverage): parent
  // card > nested child row > grandchild sub-row, with ticket refs on the
  // parent and the grandchild so chip tiers can be asserted at both depth
  // levels. Older than every other family (18 days) so the parent-lane UAT
  // lane order above stays put, and all-idle so no attention column moves.
  thread({
    id: "thr_gutter_family",
    displayTitle: "Three-tier family fixture #192",
    updatedAt: SIM_NOW - 18 * DAY,
    lastReadAt: SIM_NOW - 18 * DAY,
  }),
  thread({
    id: "thr_gutter_family_c0",
    displayTitle: "Regress the sub-row indent #193",
    parentThreadId: "thr_gutter_family",
    updatedAt: SIM_NOW - 18 * DAY + 2 * MINUTE,
    lastReadAt: SIM_NOW - 18 * DAY,
  }),
  thread({
    id: "thr_gutter_family_c0_gc0",
    displayTitle: "Pin the depth-2 chip gutter #191",
    parentThreadId: "thr_gutter_family_c0",
    updatedAt: SIM_NOW - 18 * DAY + 4 * MINUTE,
    lastReadAt: SIM_NOW - 18 * DAY,
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
  // Chip-probe cards: a title carrying many refs so the provider chips hold
  // a long id list — the roomy-cell layout and the merged treatment show
  // here. Demo-only (`?demo=1`) so the UAT fixtures stay pinned.
  thread({
    id: "thr_chips",
    displayTitle:
      "Card teleport effect #43 #44 #45 #46 #47 #48 #49 #50 #51 #52 #53 #54 #55 #56 merge all in one PR",
    status: "idle",
    updatedAt: SIM_NOW - 10 * MINUTE,
    lastReadAt: SIM_NOW - 9 * MINUTE,
  }),
  thread({
    id: "thr_chips_open",
    displayTitle: "Follow-ups #17 #21 #30 chip mix",
    status: "idle",
    updatedAt: SIM_NOW - 20 * MINUTE,
    lastReadAt: SIM_NOW - 19 * MINUTE,
  }),
  // Chip-probe cards: a single-id chip (the shrink-to-fit case) and a
  // two-id row — the small-count layouts the long list above never shows.
  thread({
    id: "thr_chips_single",
    displayTitle: "Mark thread done rename worktree #32",
    status: "idle",
    updatedAt: SIM_NOW - 15 * MINUTE,
    lastReadAt: SIM_NOW - 14 * MINUTE,
  }),
  thread({
    id: "thr_chips_pair",
    displayTitle: "Watch the pair #61 #62 settle",
    status: "idle",
    updatedAt: SIM_NOW - 18 * MINUTE,
    lastReadAt: SIM_NOW - 17 * MINUTE,
  }),
  // Chip-probe card: four external store links with long labels (the sim's
  // link_list serves them — mock-sdk.tsx). One provider hostname groups
  // them into a single chip, and the wide label is the wrapping case.
  thread({
    id: "thr_chips_cove",
    displayTitle: "Automate issue triage",
    status: "idle",
    updatedAt: SIM_NOW - 23 * MINUTE,
    lastReadAt: SIM_NOW - 22 * MINUTE,
  }),
  // Issue #104's placement contract, one card per clause (the store links
  // live in mock-sdk.tsx's simLinks). Titles carry no #N so each card's chips
  // come only from the links:
  //   typical — one short issue + one PR + a tag
  //   cluster — two short issues sharing the left half + a PR
  //   wrap    — a long id list inside the midpoint cap + a PR
  //   long    — one long external ticket id that bumps the PR down
  //   shrink  — one very long external id that scales instead of breaking
  //   tags    — a PR with a long hyphenated tag under it
  thread({
    id: "thr_chip_typical",
    displayTitle: "Card teleport effect on rank",
    status: "idle",
    updatedAt: SIM_NOW - 24 * MINUTE,
    lastReadAt: SIM_NOW - 23 * MINUTE,
  }),
  thread({
    id: "thr_chip_cluster",
    displayTitle: "Rank handles drag from the lane rail",
    status: "idle",
    updatedAt: SIM_NOW - 25 * MINUTE,
    lastReadAt: SIM_NOW - 24 * MINUTE,
  }),
  thread({
    id: "thr_chip_wrap",
    displayTitle: "Board teleport effect across many ids",
    status: "idle",
    updatedAt: SIM_NOW - 26 * MINUTE,
    lastReadAt: SIM_NOW - 25 * MINUTE,
  }),
  thread({
    id: "thr_chip_long",
    displayTitle: "Lane resize guard for the family card",
    status: "idle",
    updatedAt: SIM_NOW - 27 * MINUTE,
    lastReadAt: SIM_NOW - 26 * MINUTE,
  }),
  thread({
    id: "thr_chip_shrink",
    displayTitle: "Notification preferences export",
    status: "idle",
    updatedAt: SIM_NOW - 28 * MINUTE,
    lastReadAt: SIM_NOW - 27 * MINUTE,
  }),
  thread({
    id: "thr_chip_tags",
    displayTitle: "Card teleport effect with tags",
    status: "idle",
    updatedAt: SIM_NOW - 29 * MINUTE,
    lastReadAt: SIM_NOW - 28 * MINUTE,
  }),
  thread({
    id: "thr_chip_tag_row",
    displayTitle: "Rank handles drag from the lane rail here",
    status: "idle",
    updatedAt: SIM_NOW - 30 * MINUTE,
    lastReadAt: SIM_NOW - 29 * MINUTE,
  }),
  // Family D — chip + nested children (issue #192): the parent card carries a
  // ticket chip (title ref) alongside an expanded child row and a grandchild
  // sub-row, so the right-gutter measurement has the reported combination —
  // chip, family expander, and nested rows — on one card. Demo-only
  // (`?demo=1`) so the UAT fixtures stay pinned.
  thread({
    id: "thr_demo_gutter",
    displayTitle: "Card overruns the lane's right gutter #192",
    updatedAt: SIM_NOW - 12 * MINUTE,
    lastReadAt: SIM_NOW - 12 * MINUTE,
    environment: boardEnv("fix/gutter-repro"),
  }),
  thread({
    id: "thr_demo_gutter_c0",
    displayTitle: "Reproduce the leak headlessly in the harness",
    parentThreadId: "thr_demo_gutter",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 60 * 1000,
    environment: boardEnv("fix/gutter-repro"),
  }),
  thread({
    id: "thr_demo_gutter_c1",
    displayTitle: "Pin the leaking surface with a failing test",
    parentThreadId: "thr_demo_gutter",
    updatedAt: SIM_NOW - 8 * MINUTE,
    lastReadAt: SIM_NOW - 8 * MINUTE,
    environment: boardEnv("fix/gutter-repro"),
  }),
  thread({
    id: "thr_demo_gutter_c1_gc0",
    displayTitle: "Cover the grandchild sub-row tier too",
    parentThreadId: "thr_demo_gutter_c1",
    updatedAt: SIM_NOW - 6 * MINUTE,
    lastReadAt: SIM_NOW - 6 * MINUTE,
    environment: boardEnv("fix/gutter-repro"),
  }),

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
  // Issue #191's demo row: a child whose title carries a text ref, so the
  // nested row shows its condensed chip once rows carry chips.
  thread({
    id: "thr_demo_work_c3",
    displayTitle: "Relink the board chip fixtures #16",
    parentThreadId: "thr_demo_work",
    updatedAt: SIM_NOW - 24 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),

  // Family E — a big family (thread thr_pczkebjtyr, "Fix clipped selector"):
  // ten children with the family's open child mid-list, so the expanded rows
  // cross FAMILY_ROWS_BEFORE_FOLD and the card folds the surplus behind its
  // Show all handle where the operator's screenshot showed sliced rows.
  // Demo-only (`?demo=1`).
  thread({
    id: "thr_demo_big",
    displayTitle: "Focus Board Orchestrator Overview",
    updatedAt: SIM_NOW - 3 * MINUTE,
    lastReadAt: SIM_NOW - 3 * MINUTE,
    environment: boardEnv("dev"),
  }),
  ...["c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"].map((suffix, index) =>
    thread({
      id: `thr_demo_big_${suffix}`,
      displayTitle: `Big-family child ${index} · seed the repro rows`,
      parentThreadId: "thr_demo_big",
      ...(index === 2
        ? {
            status: "active" as const,
            runtimeStatus: "active" as const,
            updatedAt: SIM_NOW - 40 * 1000,
          }
        : {}),
      updatedAt: SIM_NOW - (index + 4) * MINUTE,
      environment: boardEnv("dev"),
    }),
  ),

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

/**
 * The README overview fixture (`?overview=1`): one purpose-built board that
 * packs the Focus view's feature surface into a handful of lanes so the
 * storyboard GIF and the still set can demonstrate it. It deliberately does
 * not extend the base fixture — the base board's nine lanes and its old UAT
 * families would push the Done lane off-screen and scatter the states the
 * story needs to sit side by side.
 *
 * The board is six lanes wide at 1600px:
 *
 * - Pinned: two cards (one working, one unread) so the lane's own state dots
 *   and its sweep pill read without a gesture.
 * - Needs you: a collapsed family parent (its dot strip shows working,
 *   unread and idle children) plus a pulsing error card.
 * - Unread: the "Triage" group of one (an expanded frame, the join target)
 *   and two loose unread cards, one of them a member of the "Release 1.0"
 *   group — so that group paints a frame in two lanes at once.
 * - Working: "Release 1.0" expanded around a parent family card (three live
 *   children and one done child, the Done projection) plus a second member;
 *   "Chat pipeline" next to it, collapsed by the capture's URL.
 * - Idle · Recent: the drag source for the nest, and the chip and snooze
 *   demonstration cards.
 * - Done: three standalone settled cards plus the projection.
 *
 * The group registry and assignments live in SIM_OVERVIEW_GROUPS; the mock
 * SDK registers them without any group_* write, the way it does for the
 * workpulse and descendant fixtures.
 */
export const SIM_OVERVIEW_GROUPS: readonly {
  id: string;
  name: string;
  memberIds: readonly string[];
}[] = [
  { id: "grp_release", name: "Release 1.0", memberIds: ["thr_ov_release_parent", "thr_ov_work_member", "thr_ov_release_watch"] },
  { id: "grp_chat", name: "Chat pipeline", memberIds: ["thr_ov_chat_sort", "thr_ov_chat_e2e"] },
  { id: "grp_triage", name: "Triage", memberIds: ["thr_ov_triage"] },
  { id: "grp_docs", name: "Docs sweep", memberIds: ["thr_ov_docs_readme", "thr_ov_docs_harness"] },
];

export const SIM_OVERVIEW_THREADS: readonly SimThread[] = [
  // Pinned: a working release card and an unread brief, so both state dots
  // and the lane's sweep read.
  thread({
    id: "thr_ov_pin_ship",
    displayTitle: "Ship 1.0.0: release notes and marketplace listing #331",
    isPinned: true,
    pinnedAt: SIM_NOW - 1 * HOUR,
    pinSortKey: 1,
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 2 * MINUTE,
    lastReadAt: SIM_NOW - 2 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_pin_brief",
    displayTitle: "Morning brief: marketplace copy",
    isPinned: true,
    pinnedAt: SIM_NOW - 3 * HOUR,
    pinSortKey: 2,
    isUnread: true,
    lastReadAt: SIM_NOW - 3 * HOUR,
    updatedAt: SIM_NOW - 2 * HOUR,
  }),

  // Needs you: the collapsed parent. Its three children carry one state each
  // (working, unread, idle), so the collapsed card's dot strip shows the
  // full colour vocabulary at a glance.
  thread({
    id: "thr_ov_ledger_parent",
    displayTitle: "Migrate the household ledger schema",
    hasPendingInteraction: true,
    indicatorLabel: "Thread needs user input",
    latestAttentionAt: SIM_NOW - 9 * MINUTE,
    updatedAt: SIM_NOW - 9 * MINUTE,
    lastReadAt: SIM_NOW - 25 * MINUTE,
  }),
  thread({
    id: "thr_ov_ledger_c0",
    displayTitle: "Backfill the ledger rows in batches",
    parentThreadId: "thr_ov_ledger_parent",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 4 * MINUTE,
    environment: boardEnv("feat/ledger-migrate"),
  }),
  thread({
    id: "thr_ov_ledger_c1",
    displayTitle: "Audit the legacy ledger rows",
    parentThreadId: "thr_ov_ledger_parent",
    isUnread: true,
    lastReadAt: SIM_NOW - 40 * MINUTE,
    updatedAt: SIM_NOW - 20 * MINUTE,
  }),
  thread({
    id: "thr_ov_ledger_c2",
    displayTitle: "Tag the schema version",
    parentThreadId: "thr_ov_ledger_parent",
    updatedAt: SIM_NOW - 35 * MINUTE,
    lastReadAt: SIM_NOW - 35 * MINUTE,
  }),
  // A pulsing attention card with an error, on another project and provider
  // so the lane's breadcrumbs also differ.
  thread({
    id: "thr_ov_attention_deploy",
    displayTitle: "Deploy failed: missing DATABASE_URL secret",
    indicator: "unread-error",
    indicatorLabel: "Unread error",
    latestAttentionAt: SIM_NOW - 35 * MINUTE,
    updatedAt: SIM_NOW - 35 * MINUTE,
    lastReadAt: SIM_NOW - 2 * HOUR,
    projectId: "proj_api",
    providerId: "claude-code",
    environment: apiEnv("main"),
    href: "/projects/api/threads/thr_ov_attention_deploy",
  }),

  // Unread: the group of one (a solo frame, the join target) leads the lane.
  thread({
    id: "thr_ov_triage",
    displayTitle: "Triage the marketplace listing copy",
    isUnread: true,
    lastReadAt: SIM_NOW - 50 * MINUTE,
    updatedAt: SIM_NOW - 20 * MINUTE,
  }),
  // The same group as the release parent, in another lane: the frame paints
  // here too, which is what the group label's click highlights.
  thread({
    id: "thr_ov_release_watch",
    displayTitle: "Watch the release canary for regressions",
    isUnread: true,
    lastReadAt: SIM_NOW - 55 * MINUTE,
    updatedAt: SIM_NOW - 28 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_review",
    displayTitle: "Review PR #14 — extract thread-pane subcomponents",
    isUnread: true,
    lastReadAt: SIM_NOW - 5 * HOUR,
    updatedAt: SIM_NOW - 40 * MINUTE,
    projectId: "proj_web",
    providerId: "codex",
    environment: { ...apiEnv("refactor/pane"), name: "Web App", path: "~/code/web-app" },
    href: "/projects/web/threads/thr_ov_review",
  }),
  // The join drag's source: an unread card in the Triage frame's own lane,
  // so the drop grows that frame in place instead of opening a second one.
  thread({
    id: "thr_ov_join_unread",
    displayTitle: "Relink the board chip fixtures #16",
    isUnread: true,
    lastReadAt: SIM_NOW - 70 * MINUTE,
    updatedAt: SIM_NOW - 55 * MINUTE,
  }),
  // The zoom family: a collapsed ten-child parent. Its own card is the
  // story's last stop — Zoom to family opens a Parent view with every lane
  // arm populated — and its folded strip is a second collapsed parent on
  // the Focus board. No attention or pinned child: those copy out of a
  // folded family, and the fold is the point.
  thread({
    id: "thr_ov_bridge_parent",
    displayTitle: "Research the realtime sidebar bridge",
    isUnread: true,
    lastReadAt: SIM_NOW - 2 * HOUR,
    updatedAt: SIM_NOW - 2 * HOUR,
    projectId: "proj_web",
    providerId: "codex",
    href: "/projects/web/threads/thr_ov_bridge_parent",
  }),
  ...(
    [
      { id: "c0", title: "Benchmark the archived-changed bridge", unread: true, updated: 25 * MINUTE },
      { id: "c1", title: "Sketch the subscribe fan-out", unread: true, updated: 45 * MINUTE },
      { id: "c2", title: "Cut the event batch size", active: true, updated: 3 * MINUTE },
      { id: "c3", title: "Reconnect after a dropped socket", active: true, updated: 8 * MINUTE },
      // All six idle children sit inside the Recent bucket on purpose: the
      // zoomed Parent view lays a state row's children out side by side, so
      // one populated row reads as a family, while six rows of one card
      // would read as an empty matrix.
      { id: "c4", title: "Cap the replay ring buffer", updated: 10 * MINUTE },
      { id: "c5", title: "Name the subscription channels", updated: 15 * MINUTE },
      { id: "c6", title: "Trace the fan-out hop", updated: 20 * MINUTE },
      { id: "c7", title: "Document the reconnect budget", updated: 25 * MINUTE },
      { id: "c8", title: "Sweep the stale listeners", updated: 30 * MINUTE },
      { id: "c9", title: "Backfill the bridge metrics", updated: 35 * MINUTE },
    ] as const
  ).map((child) =>
    thread({
      id: `thr_ov_bridge_${child.id}`,
      displayTitle: child.title,
      parentThreadId: "thr_ov_bridge_parent",
      ...(child.unread === true
        ? { isUnread: true, lastReadAt: SIM_NOW - child.updated - 30 * MINUTE }
        : child.active === true
          ? { status: "active" as const, runtimeStatus: "active" as const }
          : { lastReadAt: SIM_NOW - child.updated }),
      updatedAt: SIM_NOW - child.updated,
      projectId: "proj_web",
      providerId: "codex",
      href: `/projects/web/threads/thr_ov_bridge_${child.id}`,
    }),
  ),

  // Working: the expanded group around a parent family. Three live children
  // (two working, one idle) and one done child; the done child is the Done
  // projection's row.
  thread({
    id: "thr_ov_release_parent",
    displayTitle: "Fix the release-blocking pane overlap #273",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 2 * MINUTE,
    lastReadAt: SIM_NOW - 2 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_release_c0",
    displayTitle: "Reproduce the overlap at 1280 wide",
    parentThreadId: "thr_ov_release_parent",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 4 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_release_c1",
    displayTitle: "Clamp the pane margin to the lane floor",
    parentThreadId: "thr_ov_release_parent",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 6 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_release_c2",
    displayTitle: "Pin the wide-pane regression in UAT",
    parentThreadId: "thr_ov_release_parent",
    updatedAt: SIM_NOW - 10 * MINUTE,
    lastReadAt: SIM_NOW - 10 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_release_c_done",
    displayTitle: "Re-run the release-safety shots",
    parentThreadId: "thr_ov_release_parent",
    updatedAt: SIM_NOW - 14 * MINUTE,
    lastReadAt: SIM_NOW - 14 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  thread({
    id: "thr_ov_work_member",
    displayTitle: "Smoke the marketplace install range",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 3 * MINUTE,
    environment: boardEnv("release/1.0.0"),
  }),
  // "Chat pipeline", the second group: collapsed by the capture URL so the
  // board carries an expanded and a folded box at the same time.
  thread({
    id: "thr_ov_chat_sort",
    displayTitle: "Refactor grouping.ts column sort keys",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 5 * MINUTE,
    environment: boardEnv("fix/column-order"),
  }),
  thread({
    id: "thr_ov_chat_e2e",
    displayTitle: "Write E2E test for drag-to-done",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 7 * MINUTE,
    projectId: "proj_web",
    environment: boardEnv("feat/drag-done"),
  }),

  // Idle · Recent: the nest drag's source (idle, so the reparent renders as
  // a nested row instead of un-nesting onto its own card), the chip card,
  // and the snoozed card.
  thread({
    id: "thr_ov_drag_card",
    displayTitle: "Add keyboard shortcuts for column focus",
    updatedAt: SIM_NOW - 15 * MINUTE,
    lastReadAt: SIM_NOW - 15 * MINUTE,
  }),
  thread({
    id: "thr_ov_chip_card",
    displayTitle: "Card teleport effect on rank",
    updatedAt: SIM_NOW - 24 * MINUTE,
    lastReadAt: SIM_NOW - 24 * MINUTE,
    environment: boardEnv("fix/card-teleport"),
  }),
  thread({
    id: "thr_ov_snooze_card",
    displayTitle: "Draft the marketplace FAQ",
    updatedAt: SIM_NOW - 32 * MINUTE,
    lastReadAt: SIM_NOW - 32 * MINUTE,
  }),
  thread({
    id: "thr_ov_glyph_card",
    displayTitle: "Wrap check: long path with the open glyph",
    updatedAt: SIM_NOW - 44 * MINUTE,
    lastReadAt: SIM_NOW - 44 * MINUTE,
    environment: boardEnv("dev"),
  }),
  // "Docs sweep", folded by the capture URL: the board carries a collapsed
  // group card at rest while "Chat pipeline" is still expanded, so the
  // storyboard can fold Chat and leave two folded boxes beside the expanded
  // ones.
  thread({
    id: "thr_ov_docs_readme",
    displayTitle: "Draft the README quickstart",
    updatedAt: SIM_NOW - 50 * MINUTE,
    lastReadAt: SIM_NOW - 50 * MINUTE,
    projectId: "proj_web",
    providerId: "claude-code",
  }),
  thread({
    id: "thr_ov_docs_harness",
    displayTitle: "Tidy the screenshot harness README",
    updatedAt: SIM_NOW - 58 * MINUTE,
    lastReadAt: SIM_NOW - 58 * MINUTE,
  }),

  // Done: settled standalone cards, old enough for the lane's broom to have
  // an eligible count.
  thread({
    id: "thr_ov_done_padding",
    displayTitle: "Fix pane safe-area padding on mobile",
    updatedAt: SIM_NOW - 9 * DAY,
    lastReadAt: SIM_NOW - 9 * DAY,
  }),
  thread({
    id: "thr_ov_done_license",
    displayTitle: "Add MIT license",
    updatedAt: SIM_NOW - 10 * DAY,
    lastReadAt: SIM_NOW - 10 * DAY,
  }),
  thread({
    id: "thr_ov_done_stale",
    displayTitle: "Sweep the stale done fixtures",
    updatedAt: SIM_NOW - 13 * DAY,
    lastReadAt: SIM_NOW - 13 * DAY,
  }),
];

/**
 * The overview board's ticket-chip links: the chip card carries a two-issue
 * row and a merged PR, and the release parent's title refs resolve to their
 * own statuses in the mock's `tracker_status` answer.
 */
export const SIM_OVERVIEW_LINKS: Record<string, unknown> = {
  thr_ov_chip_card: [
    {
      tracker: "github",
      repo: "cristoslc/bb-plugin-focus-board",
      issue: 142,
      kind: "issue",
      href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/142",
      createdAt: "2026-10-20T00:00:00.000Z",
      source: "agent",
    },
    {
      tracker: "github",
      repo: "cristoslc/bb-plugin-focus-board",
      issue: 87,
      kind: "pull",
      href: "https://github.com/cristoslc/bb-plugin-focus-board/pull/87",
      createdAt: "2026-10-20T00:00:00.000Z",
      source: "agent",
    },
  ],
};

/**
 * A synthetic bulk population for performance probes: `?scale=N` appends N
 * threads (see mock-sdk.tsx) so a probe can measure a board the size an
 * operator accumulates after months, instead of the ~50-thread fixture that
 * fits every state treatment but is far smaller than a long-lived workspace.
 *
 * Deterministic and spread across the surfaces that cost work: the active,
 * unread, pending-interaction, and idle age buckets each get a share; every
 * sixth thread is a family root with one or two children (so nesting, child
 * rows, the family expander, and the collapsed dot strip all run); a mix of
 * providers and projects keeps the card's chip and breadcrumb paths warm.
 * Ids are `thr_bulk_<index>`; `now` is the usual simulated clock.
 */
export function SIM_BULK_THREADS(count: number, now: number = SIM_NOW): SimThread[] {
  const out: SimThread[] = [];
  const projects = ["proj_board", "proj_api", "proj_web"];
  const providers = ["pi", "claude-code", "codex"];
  for (let i = 0; i < count; i += 1) {
    // A realistic state mix for a long-lived workspace: most threads are
    // idle, a slice is active or unread, and "needs you" stays RARE (every
    // 50th) so the fixture does not manufacture an attention storm that a
    // real board would not have. The mix is the input to column occupancy,
    // so an unrealistic one would distort every measurement.
    const kind = i % 50 === 7 ? "pending" : i % 12 === 0 ? "active" : i % 12 === 5 ? "unread" : "idle";
    const projectId = projects[i % projects.length]!;
    const providerId = providers[i % providers.length]!;
    const age =
      kind === "active"
        ? 30 * MINUTE
        : kind === "unread"
          ? 3 * HOUR
          : kind === "pending"
            ? 20 * MINUTE
            : [5 * HOUR, DAY + 2 * HOUR, 9 * DAY][i % 3]!;
    const updatedAt = now - age - (i % 47) * MINUTE;
    const label = kind === "active" ? "active work" : kind === "unread" ? "unread report" : kind === "pending" ? "needs input" : "idle item";
    const common = {
      projectId,
      providerId,
      updatedAt,
      lastReadAt: updatedAt,
      displayTitle: `Bulk thread ${i}: ${label}`,
      environment: boardEnv(`perf/bulk-${i}`),
      href: `/projects/board/threads/thr_bulk_${i}`,
    };
    if (kind === "active") {
      out.push(thread({ id: `thr_bulk_${i}`, status: "active", runtimeStatus: "active", ...common }));
    } else if (kind === "unread") {
      out.push(thread({ id: `thr_bulk_${i}`, isUnread: true, ...common }));
    } else if (kind === "pending") {
      out.push(
        thread({
          id: `thr_bulk_${i}`,
          hasPendingInteraction: true,
          indicatorLabel: "Thread needs user input",
          latestAttentionAt: updatedAt,
          ...common,
        }),
      );
    } else {
      out.push(thread({ id: `thr_bulk_${i}`, ...common }));
    }
    // Every sixth thread is a family root: one or two children, one of them
    // active on the first child so the family lifts into the Working lane.
    if (i % 6 === 3) {
      const children = 1 + (i % 2);
      for (let c = 0; c < children; c += 1) {
        out.push(
          thread({
            id: `thr_bulk_${i}_c${c}`,
            displayTitle: `Bulk child ${i}.${c}: follow-up work`,
            parentThreadId: `thr_bulk_${i}`,
            projectId,
            providerId,
            status: c === 0 ? "active" : "idle",
            runtimeStatus: c === 0 ? "active" : "idle",
            updatedAt: updatedAt + (c + 1) * MINUTE,
            lastReadAt: updatedAt,
            environment: boardEnv(`perf/bulk-${i}`),
            href: `/projects/board/threads/thr_bulk_${i}_c${c}`,
          }),
        );
      }
    }
  }
  return out;
}

/**
 * The Zoom-to-family GIF fixture (`?zoomfamily=1` on top of `?demo=1`): a
 * 24-child family the README's animated capture right-clicks. The card's
 * fold reads "24 child threads", plainly past the 20-child bar the shot
 * promises, and the active child lifts the family into the Working lane so
 * the card sits on-screen at the capture viewport. Gated behind its own
 * flag so neither the UAT fixtures nor the standard demo shots ever see it.
 */
export const SIM_ZOOM_FAMILY_PARENT_ID = "thr_zoomfam";
export const SIM_ZOOM_FAMILY_THREADS: readonly SimThread[] = [
  thread({
    id: SIM_ZOOM_FAMILY_PARENT_ID,
    displayTitle: "Migrate the board to fractional ranks",
    updatedAt: SIM_NOW - 2 * MINUTE,
    lastReadAt: SIM_NOW - 2 * MINUTE,
    environment: boardEnv("feat/fractional-ranks"),
  }),
  ...Array.from({ length: 24 }, (_, index) =>
    thread({
      id: `${SIM_ZOOM_FAMILY_PARENT_ID}_c${index}`,
      displayTitle: `Rank migration step ${index} · rewrite the order writes`,
      parentThreadId: SIM_ZOOM_FAMILY_PARENT_ID,
      // The zoomed family surface lays children into per-lane arms, so the
      // fixture seeds one child per attention bucket (pinned, needs-you,
      // unread, working) ahead of the idle rest — empty arms would read as
      // blank bands in the GIF's closing frame.
      ...(index === 0
        ? { isPinned: true, pinnedAt: 1, pinSortKey: 1 }
        : index === 1
          ? {
              hasPendingInteraction: true,
              indicatorLabel: "Thread needs user input",
              latestAttentionAt: SIM_NOW - 60 * 1000,
              updatedAt: SIM_NOW - 60 * 1000,
            }
          : index === 2
            ? { isUnread: true }
            : index === 3
              ? { status: "active" as const, runtimeStatus: "active" as const, updatedAt: SIM_NOW - 30 * 1000 }
              : {}),
      updatedAt: SIM_NOW - (index + 3) * MINUTE,
      lastReadAt: SIM_NOW - (index + 3) * MINUTE,
      environment: boardEnv("feat/fractional-ranks"),
    }),
  ),
];

/**
 * The orchestrator shape (operator report 2026-10-22, "grandchildren don't
 * pop out"): a root with nine lieutenants, three of them childless and first
 * in order, the six busy ones carrying grandchildren below the rows cap's
 * scroll fold. Mirrors the real Workstation orchestrator board (9 direct
 * children, 77 grandchildren). `?orchestrator=1` only, so UAT stays pinned.
 */
export const SIM_ORCH_FAMILY_PARENT_ID = "thr_demo_orch";
export const SIM_ORCH_FAMILY_THREADS: readonly SimThread[] = (() => {
  const counts = [0, 0, 0, 6, 9, 14, 5, 16, 27];
  const out: SimThread[] = [
    thread({
      id: SIM_ORCH_FAMILY_PARENT_ID,
      displayTitle: "Workstation orchestrator",
      status: "active",
      runtimeStatus: "active",
      updatedAt: SIM_NOW - 90 * 1000,
      lastReadAt: SIM_NOW - 90 * 1000,
      environment: boardEnv("main"),
    }),
  ];
  counts.forEach((n, i) => {
    out.push(
      thread({
        id: `thr_demo_orch_L${i}`,
        displayTitle: `L${i + 1} lieutenant`,
        parentThreadId: SIM_ORCH_FAMILY_PARENT_ID,
        updatedAt: SIM_NOW - (i + 2) * MINUTE,
        lastReadAt: SIM_NOW - (i + 2) * MINUTE,
        environment: boardEnv("main"),
      }),
    );
    for (let g = 0; g < n; g += 1) {
      out.push(
        thread({
          id: `thr_demo_orch_L${i}_g${g}`,
          displayTitle: `L${i + 1} step ${g} · the grandchild tier`,
          parentThreadId: `thr_demo_orch_L${i}`,
          updatedAt: SIM_NOW - (i + 30 + g) * MINUTE,
          lastReadAt: SIM_NOW - (i + 30 + g) * MINUTE,
          environment: boardEnv("main"),
        }),
      );
    }
  });
  return out;
})();

/**
 * A synthetic ATTENTION-HEAVY population for the pulse probe (#260):
 * `?attention=N` appends N threads that all carry a pending interaction, so
 * every one renders the real pulsing attention treatment (the amber overlay
 * pulse plus the state-dot pulse) instead of an injected clone. This is the
 * shape a CI-failure burst or a batch of unanswered questions produces, and it
 * is the input the pulse cliff needs: the probe measures genuine board pulses,
 * not decorations appended by the probe.
 *
 * Deterministic; ids are `thr_pulse_<index>`, all in the Needs-you lane
 * (hasPendingInteraction), all recent so they lead the lane and sit together.
 */
/**
 * The working population for `?workpulse=N` (issue #279): N feature groups of
 * three active members each, so folding those boxes paints 3N genuine
 * `working` dots through the shipped rate-pulse path instead of probe-injected
 * clones. The harness answers `pulse_rates` for these ids with three different
 * rates, so every group carries the slow, middle, and fast periods together,
 * which is the mix that shows whether the durations themselves matter.
 *
 * Deterministic; group ids are `grp_wp_<i>`, member ids `thr_wp_<i>_<m>`.
 */
export function SIM_WORK_PULSE_GROUPS(
  count: number,
  now: number = SIM_NOW,
): {
  threads: SimThread[];
  groups: { groupId: string; name: string; memberIds: string[] }[];
} {
  const threads: SimThread[] = [];
  const groups: { groupId: string; name: string; memberIds: string[] }[] = [];
  const projects = ["proj_board", "proj_api", "proj_web"];
  const providers = ["pi", "claude-code", "codex"];
  for (let i = 0; i < count; i += 1) {
    const groupId = `grp_wp_${i}`;
    const memberIds: string[] = [];
    for (let m = 0; m < 3; m += 1) {
      const id = `thr_wp_${i}_${m}`;
      memberIds.push(id);
      const updatedAt = now - (i * 3 + m) * MINUTE;
      threads.push(
        thread({
          id,
          displayTitle: `Working ${i}.${m}: streaming tokens`,
          projectId: projects[i % projects.length]!,
          providerId: providers[i % providers.length]!,
          status: "active",
          runtimeStatus: "active",
          updatedAt,
          lastReadAt: updatedAt,
          environment: boardEnv(`perf/workpulse-${i}-${m}`),
          href: `/projects/board/threads/${id}`,
        }),
      );
    }
    groups.push({ groupId, name: `Workpulse ${i}`, memberIds });
  }
  return { threads, groups };
}

/**
 * The folded feature-group card's descendant dots (issue #321): ONE feature
 * group whose first member is a family root carrying two children and three
 * grandchildren, the second member childless. `?descgroup=1` only, so the
 * UAT fixture stays pinned. Both members are working, so they share the
 * Working lane and the group frames one folded card there; the descendants
 * mix working, unread and idle so one shot shows all three tiers' state
 * colours together. An attention or pinned child is deliberately absent:
 * `childPlacement` (components/nesting.ts) un-nests those onto their own
 * cards, so they can never paint as a nested dot in the first place.
 *
 * Deterministic; group id `grp_desc`, members `thr_desc_root` and
 * `thr_desc_solo`.
 */
export const SIM_DESC_GROUP = {
  groupId: "grp_desc",
  name: "Descendant dots",
  memberIds: ["thr_desc_root", "thr_desc_solo"],
} as const;

export const SIM_DESC_GROUP_THREADS: readonly SimThread[] = [
  thread({
    id: "thr_desc_root",
    displayTitle: "Root: owns the subtree",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 60 * 1000,
    lastReadAt: SIM_NOW - 60 * 1000,
    environment: boardEnv("main"),
  }),
  thread({
    // Unread on purpose: R4 moves the root's family into the Unread lane (its
    // unread child drives it there), and this member has to share that lane or
    // the split default would frame two folded cards, one slice each.
    id: "thr_desc_solo",
    displayTitle: "Solo member: no descendants",
    isUnread: true,
    updatedAt: SIM_NOW - 2 * MINUTE,
    environment: boardEnv("main"),
  }),
  thread({
    id: "thr_desc_c1",
    displayTitle: "Child one: runs the build",
    parentThreadId: "thr_desc_root",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 3 * MINUTE,
    lastReadAt: SIM_NOW - 3 * MINUTE,
    environment: boardEnv("main"),
  }),
  thread({
    id: "thr_desc_c2",
    displayTitle: "Child two: unread report",
    parentThreadId: "thr_desc_root",
    isUnread: true,
    updatedAt: SIM_NOW - 4 * MINUTE,
    environment: boardEnv("main"),
  }),
  thread({
    id: "thr_desc_c1_a",
    displayTitle: "Grandchild one: idle",
    parentThreadId: "thr_desc_c1",
    updatedAt: SIM_NOW - 5 * MINUTE,
    lastReadAt: SIM_NOW - 5 * MINUTE,
    environment: boardEnv("main"),
  }),
  thread({
    id: "thr_desc_c1_b",
    displayTitle: "Grandchild two: idle",
    parentThreadId: "thr_desc_c1",
    updatedAt: SIM_NOW - 6 * MINUTE,
    lastReadAt: SIM_NOW - 6 * MINUTE,
    environment: boardEnv("main"),
  }),
  thread({
    id: "thr_desc_c2_a",
    displayTitle: "Grandchild three: still running",
    parentThreadId: "thr_desc_c2",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 7 * MINUTE,
    lastReadAt: SIM_NOW - 7 * MINUTE,
    environment: boardEnv("main"),
  }),
];

export function SIM_ATTENTION_THREADS(count: number, now: number = SIM_NOW): SimThread[] {
  const out: SimThread[] = [];
  const projects = ["proj_board", "proj_api", "proj_web"];
  const providers = ["pi", "claude-code", "codex"];
  for (let i = 0; i < count; i += 1) {
    const updatedAt = now - (i % 30) * MINUTE;
    out.push(
      thread({
        id: `thr_pulse_${i}`,
        displayTitle: `Needs input ${i}: waiting on the operator`,
        projectId: projects[i % projects.length]!,
        providerId: providers[i % providers.length]!,
        hasPendingInteraction: true,
        indicatorLabel: "Thread needs user input",
        latestAttentionAt: updatedAt,
        updatedAt,
        lastReadAt: updatedAt,
        environment: boardEnv(`perf/pulse-${i}`),
        href: `/projects/board/threads/thr_pulse_${i}`,
      }),
    );
  }
  return out;
}

/**
 * The idle filter's busy grandchild (v1.7.0's "Hiding idle children no longer
 * buries a busy grandchild"): `?idlebusy=1` only.
 *
 * Three tiers under one idle root. The middle child is idle, its grandchild is
 * running, and a second child is idle AND leaf: hiding idle children must keep
 * the busy grandchild's row (and its host row above it) while the idle leaf
 * disappears, so the one gesture shows both outcomes side by side. The demo
 * board carried no idle child with a busy grandchild, which is why this bullet
 * shipped without a gif.
 */
export const SIM_IDLE_BUSY_THREADS: readonly SimThread[] = [
  thread({
    id: "thr_idle_busy_root",
    displayTitle: "Quarterly housekeeping pass",
    updatedAt: SIM_NOW - 40 * MINUTE,
    lastReadAt: SIM_NOW - 40 * MINUTE,
  }),
  thread({
    id: "thr_idle_busy_child",
    displayTitle: "Sweep the stale worktrees",
    parentThreadId: "thr_idle_busy_root",
    updatedAt: SIM_NOW - 42 * MINUTE,
    lastReadAt: SIM_NOW - 42 * MINUTE,
  }),
  thread({
    id: "thr_idle_busy_grandchild",
    displayTitle: "Re-run the migration the sweep unblocked",
    parentThreadId: "thr_idle_busy_child",
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 60 * 1000,
    lastReadAt: SIM_NOW - 60 * 1000,
  }),
  thread({
    id: "thr_idle_busy_leaf",
    displayTitle: "Fold the leftover release notes",
    parentThreadId: "thr_idle_busy_root",
    updatedAt: SIM_NOW - 45 * MINUTE,
    lastReadAt: SIM_NOW - 45 * MINUTE,
  }),
];

/**
 * The child that belongs to a different feature group than its parent
 * (v1.7.3's "A child in a different group than its parent shows twice"):
 * `?dualgroups=1` only.
 *
 * A pinned parent, so both homes render in the Pinned lane where one shot
 * shows them: the child keeps its nested row under the parent AND gains its
 * own card inside its own group's frame. The demo board had no pinned parent
 * whose child sat elsewhere.
 */
export const SIM_DUAL_GROUPS = [
  { id: "grp_dual_parent", name: "Release train", memberIds: ["thr_dual_parent"] },
  { id: "grp_dual_child", name: "Follow-ups", memberIds: ["thr_dual_child"] },
] as const;

export const SIM_DUAL_GROUP_THREADS: readonly SimThread[] = [
  thread({
    id: "thr_dual_parent",
    displayTitle: "Ship the 2.0 release train",
    isPinned: true,
    pinnedAt: SIM_NOW - 30 * MINUTE,
    updatedAt: SIM_NOW - 30 * MINUTE,
    lastReadAt: SIM_NOW - 30 * MINUTE,
  }),
  thread({
    id: "thr_dual_child",
    displayTitle: "Chase the 2.0 follow-up reports",
    parentThreadId: "thr_dual_parent",
    updatedAt: SIM_NOW - 25 * MINUTE,
    lastReadAt: SIM_NOW - 25 * MINUTE,
  }),
];

/**
 * The feature group whose only member is pinned (v1.7.3's "A pinned member
 * keeps its group's dashed frame"): `?pinnedgroup=1` only. One pinned, running
 * thread in a group of one, so the Pinned lane paints the dashed frame around
 * a single card — the shape the demo board could not stage.
 */
export const SIM_PINNED_GROUP = {
  groupId: "grp_pinned_only",
  name: "Pinned alone",
  memberIds: ["thr_pinned_solo"],
} as const;

export const SIM_PINNED_GROUP_THREADS: readonly SimThread[] = [
  thread({
    id: "thr_pinned_solo",
    displayTitle: "Keep the pinned frame on a group of one",
    isPinned: true,
    pinnedAt: SIM_NOW - 20 * MINUTE,
    status: "active",
    runtimeStatus: "active",
    updatedAt: SIM_NOW - 3 * MINUTE,
    lastReadAt: SIM_NOW - 3 * MINUTE,
  }),
];
