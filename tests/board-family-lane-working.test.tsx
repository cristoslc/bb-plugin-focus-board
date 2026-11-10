// @vitest-environment jsdom
// The reported shape (2026-11-10, thr_nusa59caqp): a working orchestrator
// with one working child and one unread child rendered in the Unread lane,
// so the operator's live work read as a reply waiting to be caught up on.
// The family lane drive scores members by `DRIVE_STATE_ORDER` (Needs you,
// live work, unread arm), not by the lanes' own left-to-right read, so the
// running parent keeps the lane its dot already names. Rendered through the
// real Board so the lane section, not just the assembly, is what is pinned;
// the idle control keeps the lift an unread child has always had.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import type { GroupingContext } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

// The live clock at the report (epoch ms), so the fixture's ages bucket the
// way the operator saw them.
const NOW = 1_794_318_000_000;
const CONTEXT: GroupingContext = {
  projects: [{ id: "proj_rzv6zurfm8", name: "Decisions", isPersonal: false, href: "", settingsHref: "" }],
  providers: [{ id: "acp-opencode", displayName: "OpenCode" }],
};

type BoardProps = Parameters<typeof Board>[0];

/** thr_nusa59caqp: status "active", read (lastReadAt just past updatedAt). */
function orchestrator(overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return thread({
    id: "thr_nusa59caqp",
    displayTitle: "Decision Queue bb plugin orchestrator",
    projectId: "proj_rzv6zurfm8",
    providerId: "acp-opencode",
    status: "active",
    updatedAt: 1_794_317_353_389,
    lastReadAt: 1_794_317_353_388,
    latestAttentionAt: 1_794_286_570_073,
    ...overrides,
  });
}

/** thr_p5nbnx7axz: the working child. */
function workingChild(): PluginSidebarThread {
  return thread({
    id: "thr_p5nbnx7axz",
    displayTitle: "Fix: desktop intercom bottom-right",
    projectId: "proj_rzv6zurfm8",
    providerId: "acp-opencode",
    parentThreadId: "thr_nusa59caqp",
    status: "active",
    updatedAt: 1_794_317_972_824,
    lastReadAt: 1_794_317_972_824,
    latestAttentionAt: 1_794_317_454_502,
  });
}

/** thr_pbbcsgytvh: the unread child (latestAttentionAt past lastReadAt). */
function unreadChild(): PluginSidebarThread {
  return thread({
    id: "thr_pbbcsgytvh",
    displayTitle: "Review: Decisions journey, workflow, and UX",
    projectId: "proj_rzv6zurfm8",
    providerId: "acp-opencode",
    parentThreadId: "thr_nusa59caqp",
    isUnread: true,
    updatedAt: 1_794_116_650_680,
    lastReadAt: 1_794_114_998_161,
    latestAttentionAt: 1_794_116_240_326,
  });
}

function renderBoard(threads: readonly PluginSidebarThread[]) {
  const assembly = assembleBoard(threads, "status", CONTEXT, new Map(), new Set(), NOW);
  const props = {
    groupBy: "status" as const,
    columns: assembly.columns,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    dimmedIds: new Set<string>(),
    projectNameFor: () => "Decisions",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

function cardsIn(laneId: string): string[] {
  const lane = document.querySelector(`[data-column-id="${laneId}"]`);
  if (lane === null) return [];
  return [...lane.querySelectorAll("[data-thread-card]")].map(
    (card) => card.getAttribute("data-thread-card") ?? "",
  );
}

describe("a working family with a working and an unread child", () => {
  it("renders the family in the Working lane, both children nested under the card", () => {
    renderBoard([orchestrator(), workingChild(), unreadChild()]);
    expect(cardsIn("working")).toEqual([
      "thr_nusa59caqp",
      "thr_p5nbnx7axz",
      "thr_pbbcsgytvh",
    ]);
    expect(cardsIn("unread")).toEqual([]);
  });

  it("an idle orchestrator with the same unread child still lifts to the Unread lane", () => {
    renderBoard([orchestrator({ status: "idle" }), unreadChild()]);
    expect(cardsIn("unread")).toEqual(["thr_nusa59caqp", "thr_pbbcsgytvh"]);
    expect(cardsIn("working")).toEqual([]);
  });
});
