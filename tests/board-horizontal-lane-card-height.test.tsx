// @vitest-environment jsdom
// A family card in a HORIZONTAL lane must be reachable to its last child row
// (operator report 2026-11-18, phone screenshot: two child rows on the card,
// the second sliced at the row's bottom edge, no inner scroll and no Show all
// handle).
//
// The rows region itself has carried no height cap since the 2026-10-22
// ruling (see FAMILY_ROWS_BEFORE_FOLD), so the cut came from the row: the
// horizontal lane pinned every row to `h-72` (288px) while its card list
// clips the cross axis (`overflow-y: clip`, the value that keeps that list
// from becoming a second scroller and trapping the pan). A family card taller
// than 288px therefore lost its lower rows AND its Show all handle, with
// nothing on screen to reach them.
//
// jsdom does no layout, so this test pins the contract that prevents the
// clip: the row is content-tall with a floor, never a fixed height, and the
// list keeps its cross-axis clip. The measured proof at a phone viewport
// lives in tests/manual/uat-board-touch.yaml.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import type { GroupingContext } from "../components/grouping";
import { FAMILY_ROWS_BEFORE_FOLD } from "../components/thread-card";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const CONTEXT: GroupingContext = {
  projects: [{ id: "p1", name: "One", isPersonal: false, href: "", settingsHref: "" }],
  providers: [{ id: "pi", displayName: "Provider" }],
};
const PARENT = "thr_family_parent";

/** A parent with `count` children: enough rows to make a card taller than a
 *  lane row's floor, the shape the operator's phone screenshot shows. */
function family(count: number): PluginSidebarThread[] {
  return [
    thread({
      id: PARENT,
      displayTitle: "HomeLab Infrastructure orchestrator",
      projectId: "p1",
      providerId: "pi",
      status: "idle",
      updatedAt: NOW - 60 * 60 * 1000,
      lastReadAt: NOW - 60 * 60 * 1000,
    }),
    ...Array.from({ length: count }, (_, index) =>
      thread({
        id: `thr_family_child_${index}`,
        displayTitle: `Child ${index}: a row with a wrapping title`,
        parentThreadId: PARENT,
        projectId: "p1",
        providerId: "pi",
        status: "idle",
        updatedAt: NOW - 60 * 60 * 1000 * (index + 2),
        lastReadAt: NOW - 60 * 60 * 1000 * (index + 2),
      }),
    ),
  ];
}

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: readonly PluginSidebarThread[],
  laneDirection: "vertical" | "horizontal",
): void {
  const assembly = assembleBoard(threads, "status", CONTEXT, new Map(), new Set(), NOW);
  const props = {
    groupBy: "status" as const,
    laneDirection,
    columns: assembly.columns,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
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

/** The lane section that holds the family card. */
function familyLane(): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${PARENT}"]`);
  const lane = card?.closest("[data-column-id]") ?? null;
  if (!(lane instanceof HTMLElement)) throw new Error("missing the family's lane");
  return lane;
}

/** The lane's own card list (the element that clips its cross axis). */
function cardList(lane: HTMLElement): HTMLElement {
  const list = lane.querySelector("[data-card-list]");
  if (!(list instanceof HTMLElement)) throw new Error("missing the lane's card list");
  return list;
}

/** A class attribute as TOKENS: `h-72` must not match inside `min-h-72`. */
function classTokens(el: HTMLElement): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("a horizontal lane's row is content-tall, never height-capped", () => {
  it("floors the row's height instead of fixing it, so a tall family card is not clipped", () => {
    renderBoard(family(FAMILY_ROWS_BEFORE_FOLD + 2), "horizontal");
    const lane = familyLane();
    const tokens = classTokens(lane);
    // The regression: a fixed height capped the row below the card's own
    // content, so the cross-axis clip cut the rows (and the handle) away.
    expect(tokens).not.toContain("h-72");
    // Content-tall with a floor, so a sparse lane still reads as a row.
    expect(tokens).toContain("min-h-72");
    // The card list keeps its cross-axis clip: a vertical scroll container
    // there would capture the board's own pan (the issue #330 coupling this
    // value exists to avoid), so the ROW growing is what keeps the card whole.
    expect(classTokens(cardList(lane))).toContain("overflow-y-clip");
    // The card really carries the rows and the handle the row must not cut:
    // one fold budget of rows, every one of them inside the lane.
    const rows = lane.querySelectorAll("[data-nested-rows] > ul > li");
    expect(rows).toHaveLength(FAMILY_ROWS_BEFORE_FOLD);
    expect(lane.querySelector("[data-show-all-rows]")).not.toBeNull();
    for (const row of rows) {
      expect(lane.contains(row)).toBe(true);
    }
  });

  it("keeps the vertical read a full-height column with its own stack scroll", () => {
    renderBoard(family(FAMILY_ROWS_BEFORE_FOLD + 2), "vertical");
    const lane = familyLane();
    const tokens = classTokens(lane);
    expect(tokens).toContain("h-full");
    expect(tokens).not.toContain("min-h-72");
    // The vertical lane's list is the scroller that reaches a tall card's
    // lower rows on that axis, and the fix must not touch it.
    expect(classTokens(cardList(lane))).toContain("overflow-y-auto");
    expect(classTokens(cardList(lane))).not.toContain("overflow-y-clip");
  });
});
