// @vitest-environment jsdom
// The Pinned-lane attention UX: a pinned family cannot move to Needs you
// (the family-column overrides apply to unpinned roots only), so the call for
// attention happens where the family already sits — a pulsing amber border on
// the pinned parent card, and the family card at the top of the lane.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import type { GroupingContext } from "../components/grouping";
import { thread } from "./thread-fixture";
import type { ReactNode } from "react";

const NOW = 10_000_000;
const DAY = 86_400_000;
const HOUR = 3_600_000;
const CONTEXT: GroupingContext = {
  projects: [{ id: "proj_a", name: "Alpha" }],
  providers: [{ id: "pi", displayName: "Pi" }],
};

type BoardProps = Parameters<typeof Board>[0];

function renderFamilyBoard(threads: PluginSidebarThread[]) {
  const assembly = assembleBoard(threads, "status", CONTEXT, new Map(), new Set(), NOW);
  const props = {
    columns: assembly.columns,
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    dimmedIds: new Set<string>(),
    projectNameFor: () => "Alpha",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onNewTask: vi.fn(),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    // stateDot is not read from props in Board (it renders its own), but the
    // prop is typed required; supply a no-op node.
    stateDot: null as ReactNode,
  } as unknown as BoardProps;
  // Board requires stateDot per card? No — Board builds its own StateDot;
  // the prop above is stripped by the cast.
  return render(<Board {...props} />);
}

function pinnedCardIds(): string[] {
  const section = document.querySelector('section[data-column-id="pinned"]');
  if (section === null) throw new Error("missing pinned column");
  // Top-level column cards only: nested child rows carry the same marker
  // inside their parent card, so drop any match that itself sits inside a
  // `[data-thread-card]`.
  return [...section.querySelectorAll("[data-thread-card]")]
    .filter((el) => el.parentElement?.closest("[data-thread-card]") === null)
    .map((el) => (el instanceof HTMLElement ? el.getAttribute("data-thread-card") : ""));
}

function pulseOn(cardId: string): boolean {
  const card = document.querySelector(`[data-thread-card="${cardId}"]`);
  if (card === null) throw new Error(`missing card ${cardId}`);
  return card.querySelector("[data-attention-pulse]") !== null;
}

afterEach(cleanup);

describe("Pinned-lane attention (pulse + lift)", () => {
  it("the attention family's pinned card pulses and leads the lane; the bystander stays quiet", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - HOUR,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    renderFamilyBoard([parent, child, bystander]);
    expect(pinnedCardIds()).toEqual(["p", "q"]);
    expect(pulseOn("p")).toBe(true);
    expect(pulseOn("q")).toBe(false);
  });

  it("the pulse disappears when the child's question is answered", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    renderFamilyBoard([parent, child, bystander]);
    // No pending interaction anywhere: no lift (q is newer), no pulse.
    expect(pinnedCardIds()).toEqual(["q", "p"]);
    expect(pulseOn("p")).toBe(false);
    expect(pulseOn("q")).toBe(false);
  });
});