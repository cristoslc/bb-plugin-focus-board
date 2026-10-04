// @vitest-environment jsdom
// The Pinned-lane attention UX keys on the pinned card's OWN state. An
// attention CHILD un-nests (nesting.ts childPlacement) and surfaces as its
// own card in Needs you, so the family neither pulses nor lifts for it — the
// needy child is its own actionable card now. A pinned card whose own state
// needs you still pulses and leads the lane.
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
  return render(<Board {...props} />);
}

function columnCardIds(columnId: string): string[] {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (section === null) throw new Error(`missing column ${columnId}`);
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

describe("Pinned-lane attention (pulse + lift for the card's own state)", () => {
  it("an attention child of a pinned parent stands alone in Needs you; the pinned card stays quiet", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({
      id: "c",
      parentThreadId: "p",
      hasPendingInteraction: true,
      updatedAt: NOW - HOUR,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    renderFamilyBoard([parent, child, bystander]);
    // No lift: the newer bystander leads the pinned lane, and the child is
    // not nested under it — it renders as its own card in Needs you.
    expect(columnCardIds("pinned")).toEqual(["q", "p"]);
    expect(columnCardIds("attention")).toEqual(["c"]);
    expect(pulseOn("p")).toBe(false);
    expect(pulseOn("q")).toBe(false);
  });

  it("a pinned card whose OWN state needs you pulses and leads the lane; the bystander stays quiet", () => {
    const pinnedAttention = thread({
      id: "p",
      isPinned: true,
      hasPendingInteraction: true,
      updatedAt: NOW - 2 * DAY,
    });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    renderFamilyBoard([pinnedAttention, bystander]);
    expect(columnCardIds("pinned")).toEqual(["p", "q"]);
    expect(pulseOn("p")).toBe(true);
    expect(pulseOn("q")).toBe(false);
  });

  it("the pulse disappears when the pinned card's own question is answered", () => {
    const parent = thread({ id: "p", isPinned: true, updatedAt: NOW - 2 * DAY });
    const child = thread({ id: "c", parentThreadId: "p", updatedAt: NOW - HOUR });
    const bystander = thread({ id: "q", isPinned: true, updatedAt: NOW - HOUR });
    renderFamilyBoard([parent, child, bystander]);
    // No pending interaction anywhere: no lift (q is newer), no pulse.
    expect(columnCardIds("pinned")).toEqual(["q", "p"]);
    expect(pulseOn("p")).toBe(false);
    expect(pulseOn("q")).toBe(false);
  });
});
