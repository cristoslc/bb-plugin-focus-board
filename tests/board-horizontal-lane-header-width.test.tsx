// @vitest-environment jsdom
// A horizontal lane's LEFT header strip at phone width (operator report
// 2026-11-19: "in horizontal mode on phone, too much negative space at left").
//
// Measured on the harness at 390x844 before the fix
// (docs/screenshots/repro-horizontal-lane-header-left-gap/): the strip is a
// fixed 160px column of a 366px row, 43.7% of it, and the card list gets 206px
// for a 240px card — so no card was ever fully visible across the row's width,
// and the strip's own content (name, count) filled about 50 of its 288 rows of
// height. The width belongs to the cards, so at a phone-width viewport the
// label restacks above the row, the way vertical lanes already put a slim strip
// on top. Desktop keeps today's strip exactly.
//
// jsdom does no layout, so this pins the CONTRACT as tokens and attributes;
// the measured proof at a real 390x844 viewport lives in
// tests/manual/uat-views-mobile.yaml (lane_header_row rule).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import type { GroupingContext } from "../components/grouping";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const CONTEXT: GroupingContext = {
  projects: [{ id: "p1", name: "One", isPersonal: false, href: "", settingsHref: "" }],
  providers: [{ id: "pi", displayName: "Provider" }],
};
const UNREAD = "thr_unread_one";

/** Two lanes with cards: Unread holds the card the assertions measure, and
 *  Working holds another so the board is a multi-lane read, the shape the
 *  operator reported on. */
function threads(): PluginSidebarThread[] {
  return [
    thread({
      id: UNREAD,
      displayTitle: "Research: bb plugin RPC auth tokens",
      projectId: "p1",
      providerId: "pi",
      status: "idle",
      isUnread: true,
      updatedAt: NOW - 26 * 60 * 1000,
      lastReadAt: 0,
    }),
    thread({
      id: "thr_working_one",
      displayTitle: "Wire the release driver",
      projectId: "p1",
      providerId: "pi",
      status: "working",
      updatedAt: NOW - 5 * 60 * 1000,
      lastReadAt: NOW - 5 * 60 * 1000,
    }),
  ];
}

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(laneDirection: "vertical" | "horizontal", phone: boolean): void {
  const data = threads();
  const assembly = assembleBoard(data, "status", CONTEXT, new Map(), new Set(), NOW);
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
  render(
    phone ? (
      <CompactViewportOverrideProvider isCompactViewport>
        <Board {...props} />
      </CompactViewportOverrideProvider>
    ) : (
      <Board {...props} />
    ),
  );
}

function lane(columnId: string): HTMLElement {
  const el = document.querySelector(`[data-column-id="${columnId}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing the ${columnId} lane`);
  return el;
}

function headerOf(el: HTMLElement): HTMLElement {
  const header = el.querySelector("header");
  if (!(header instanceof HTMLElement)) throw new Error("missing the lane's header");
  return header;
}

function cardListOf(el: HTMLElement): HTMLElement {
  const list = el.querySelector("[data-card-list]");
  if (!(list instanceof HTMLElement)) throw new Error("missing the lane's card list");
  return list;
}

/** A class attribute as TOKENS: `w-40` must not match inside `w-40x`. */
function classTokens(el: HTMLElement): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

describe("a horizontal lane's header at phone width", () => {
  it("gives the row's width to the cards and stacks the label on top", () => {
    renderBoard("horizontal", true);
    const unread = lane("unread");
    // The row lays its header ABOVE the cards, so the card list spans the row.
    expect(classTokens(unread)).toContain("flex-col");
    expect(classTokens(unread)).not.toContain("flex-row");
    // The floor that keeps a sparse row reading as a row survives the restack.
    expect(classTokens(unread)).toContain("min-h-72");
    const header = headerOf(unread);
    expect(header.dataset.laneHeaderLayout).toBe("top");
    // The 160px strip is the thing that ate 43.7% of a 390px phone's row.
    expect(classTokens(header)).not.toContain("w-40");
    expect(classTokens(header)).toContain("w-full");
    // The card list takes the row's whole width and keeps its own flow scroll.
    const list = cardListOf(unread);
    expect(classTokens(list)).toContain("flex-1");
    expect(classTokens(list)).toContain("w-full");
    expect(classTokens(list)).toContain("overflow-x-auto");
    expect(classTokens(list)).toContain("overflow-y-clip");
  });

  it("keeps every control the strip carries", () => {
    renderBoard("horizontal", true);
    for (const columnId of ["unread", "working"]) {
      const header = headerOf(lane(columnId));
      // The lane menu's tap target, its caret, and the bare count.
      const trigger = header.querySelector("[data-lane-menu-trigger]");
      expect(trigger).not.toBeNull();
      expect(trigger?.querySelector("svg")).not.toBeNull();
      const label = header.querySelector("h3");
      expect(label?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      // The count is the header's own bare span beside the label.
      const count = [...header.children]
        .filter((child) => child.tagName === "SPAN")
        .find((span) => span.querySelector("h3") === null);
      expect(count?.textContent?.trim()).toMatch(/^\d+$/);
    }
  });

  it("keeps the lane's label truncating rather than wrapping the row taller", () => {
    renderBoard("horizontal", true);
    const header = headerOf(lane("unread"));
    const trigger = header.querySelector("[data-lane-menu-trigger]");
    // A long lane name ellipsizes inside its own box; it never widens the row.
    expect(classTokens(trigger as HTMLElement)).toContain("min-w-0");
    const label = header.querySelector("h3");
    expect(classTokens(label as HTMLElement)).toContain("truncate");
  });
});

describe("a horizontal lane's header on a desktop viewport", () => {
  it("keeps today's left strip and the full-width card flow beside it", () => {
    renderBoard("horizontal", false);
    const unread = lane("unread");
    expect(classTokens(unread)).toContain("flex-row");
    const header = headerOf(unread);
    expect(header.dataset.laneHeaderLayout).toBe("strip");
    expect(classTokens(header)).toContain("w-40");
    expect(classTokens(header)).not.toContain("w-full");
    // The desktop read is unchanged: the list keeps its own flow scroll and
    // takes the rest of the row (`flex-1`), never the whole width.
    const list = cardListOf(unread);
    expect(classTokens(list)).toContain("flex-1");
    expect(classTokens(list)).not.toContain("w-full");
    expect(classTokens(list)).toContain("overflow-x-auto");
  });
});

describe("the restack is scoped to horizontal lanes", () => {
  it("leaves the vertical board untouched at phone width", () => {
    renderBoard("vertical", true);
    const unread = lane("unread");
    // A vertical lane is a full-height column in both directions.
    expect(classTokens(unread)).toContain("w-64");
    expect(classTokens(unread)).toContain("flex-col");
    const header = headerOf(unread);
    expect(classTokens(header)).not.toContain("w-40");
    expect(header.dataset.laneHeaderLayout).toBeUndefined();
  });
});
