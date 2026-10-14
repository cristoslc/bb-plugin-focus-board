// @vitest-environment jsdom
// The focus spotlight: the mouseover spotlight (issue #123) keys its arm to
// the POINTER (`:has` a hovered card div). When the thread pane holds a
// thread open (`activeThreadId`), the user is focused on one thread whether
// they got there by hovering or by clicking INTO the card — so the same
// spotlight must arm on the FOCUSED card instead: that card (and the family
// card whose nested rows contain a focused child) keeps the opaque solid
// surface while every other card div on the board recedes. The existing dim
// systems stay in charge (a card whose life fades it keeps marker + scrim,
// never a second surface), and a transport ghost never claims the marker.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  CARD_SPOTLIGHT_CLASSES,
  CARD_SURFACE_SOLID,
  ThreadCard,
} from "../components/thread-card";
import { Board } from "../components/board";
import { ParentLaneBoard } from "../components/parent-lane-board";
import { buildColumns } from "../components/grouping";
import { buildParentLanes } from "../components/parent-lanes";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_focus", displayTitle: "Focus card", updatedAt: 1 });
const child = thread({ id: "thr_child_focus", displayTitle: "Focus child", updatedAt: 2 });

// The parent-lane render pins scroll to the active card on mount, and its
// locator needs CSS.escape (jsdom has none) — the same jsdom stub the
// parent-lane board tests carry.
let restoreCss: () => void = () => {};
beforeAll(() => {
  const globalWithCss = globalThis as { CSS?: { escape?: unknown } };
  if (globalWithCss.CSS?.escape !== undefined) {
    restoreCss = () => {};
    return;
  }
  globalWithCss.CSS = {
    escape: (value: string) => value.replace(/[^\w-]/g, "\\$&"),
  };
  restoreCss = () => {
    delete globalWithCss.CSS;
  };
});

type Props = Partial<ComponentProps<typeof ThreadCard>>;

function renderCard(props: Props = {}) {
  render(
    <ThreadCard
      thread={base}
      stateDot={null}
      isActive={false}
      isDone={false}
      projectName="Proj"
      menuActions={[]}
      onOpen={() => {}}
      {...props}
    />,
  );
}

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_focus"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card root");
  return root;
}

function tokens(): string[] {
  return cardRoot().className.split(" ");
}

afterEach(cleanup);
afterAll(() => restoreCss());

describe("the pane-held card's focus marker (data-focus-solid)", () => {
  it("the card the thread pane holds open wears the marker and the solid surface", () => {
    renderCard({ activeThreadId: "thr_focus", isActive: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).toContain(CARD_SURFACE_SOLID);
  });

  it("an unfocused card (the pane holds another thread) wears neither", () => {
    renderCard({ activeThreadId: "thr_other" });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(false);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a card with no wired pane state wears neither", () => {
    renderCard({ activeThreadId: undefined });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(false);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("the family card whose nested row holds the focused child wears both", () => {
    renderCard({ childThreads: [child], activeThreadId: "thr_child_focus" });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).toContain(CARD_SURFACE_SOLID);
  });

  it("a pane-held done card keeps the marker but its own dim stays in charge", () => {
    // The done card's opacity-50 is its own life, not the spotlight's —
    // painting the solid surface under a faded card would just mute the fade.
    renderCard({ activeThreadId: "thr_focus", isActive: true, isDone: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a pane-held sweep-highlighted card keeps its amber read (no surface mix)", () => {
    renderCard({
      activeThreadId: "thr_focus",
      isActive: true,
      isSweepHighlighted: true,
    });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a transport ghost never claims the marker (two solid copies lie)", () => {
    renderCard({ activeThreadId: "thr_focus", isTransportGhost: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(false);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a caller-forced family member wears the marker but not the surface", () => {
    // The parent-lane board renders a family as sibling cells, not nested
    // rows; it forces the marker on the lane's cells so the whole lane reads
    // solid. The surface stays with the focused card itself.
    renderCard({ activeThreadId: "thr_other", familySolid: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });
});

describe("the CSS-only focus spotlight (board-root wiring pin)", () => {
  it("the spotlight arms on the focus marker and recedes every other card div", () => {
    // The same arm-and-recede chain as the hover rule, keyed to
    // `data-focus-solid` instead of `:hover`: hover keeps its own escape
    // (`:hover` on a card lifts that card even under the focus arm). No
    // debounce here — a click cannot sweep, so the recede rides the card's
    // own base transition.
    expect(CARD_SPOTLIGHT_CLASSES).toContain(
      "has-[div[data-focus-solid]]:[&_div[data-thread-card]:not(:hover):not([data-focus-solid]):not([data-sweep-highlighted]):not([data-card-faded])]:opacity-70",
    );
  });

  it("the columns board root carries the focus-armed spotlight rule", () => {
    // Rendered through the real Board the way board-sweep-select.test.tsx
    // does, so the wiring on `[data-columns-board]` can't silently drop out.
    const doneIds = new Set<string>();
    const props = {
      columns: buildColumns(
        [base] as unknown as PluginSidebarThread[],
        "status",
        { projects: [], providers: [] },
        new Map(),
        doneIds,
        1,
        {},
      ),
      groupBy: "status" as const,
      activeThreadId: null,
      doneIds,
      nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
      childCountByParent: new Map<string, number>(),
      doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
      dimmedIds: new Set<string>(),
      projectNameFor: () => "Proj",
      repoBaseFor: () => null,
      onOpenThread: vi.fn(),
      onClosePane: vi.fn(),
      onNewTask: vi.fn(),
      menuActionsFor: () => [],
      sweepCandidatesFor: () => [],
      onSweepArm: vi.fn(),
      onSweepDisarm: vi.fn(),
      onSweepToggle: vi.fn(),
      onSweepRangeSelect: vi.fn(),
    } as unknown as Parameters<typeof Board>[0];
    render(<Board {...props} />);
    const root = document.querySelector("[data-columns-board]");
    if (!(root instanceof HTMLElement)) throw new Error("missing columns board root");
    expect(root.className.split(" ")).toContain(
      "has-[div[data-focus-solid]]:[&_div[data-thread-card]:not(:hover):not([data-focus-solid]):not([data-sweep-highlighted]):not([data-card-faded])]:opacity-70",
    );
  });
});

describe("the parent-lane family solid (families render as sibling cells there)", () => {
  it("every cell of the lane holding the focused thread wears the marker; other lanes never do", () => {
    // The parent-lane view renders a family as sibling mini cells, so the
    // board forces the marker on the lane's cells (familySolid): a focused
    // mini keeps its whole lane solid, not just itself.
    const NOW = 10 * 24 * 60 * 60 * 1000;
    const mk = (id: string, age: number) => {
      const parent = thread({ id, displayTitle: `Family ${id}`, updatedAt: NOW - age });
      const kids = Array.from({ length: 2 }, (_, i) =>
        thread({
          id: `${id}k${i}`,
          displayTitle: `Kid ${id}#${i}`,
          parentThreadId: id,
          status: "active",
          updatedAt: NOW - age,
        }),
      );
      return [parent, ...kids];
    };
    const lanes = buildParentLanes(
      [...mk("a", 0), ...mk("b", 60 * 60 * 1000)] as PluginSidebarThread[],
      new Set<string>(),
      NOW,
    );
    render(
      <ParentLaneBoard
        lanes={lanes}
        activeThreadId="ak0"
        doneIds={new Set()}
        dimmedIds={new Set()}
        childrenByParent={new Map()}
        projectNameFor={() => "Proj"}
        repoBaseFor={() => null}
        parentLaneOrder="recency"
        onParentLaneOrderChange={vi.fn()}
        onOpenThread={vi.fn()}
        onClosePane={vi.fn()}
        onNewTask={vi.fn()}
        menuActionsFor={() => []}
      />,
    );
    const byId = (id: string) => document.querySelector(`[data-thread-card="${id}"]`);
    // The focused cell and its lane-sibling cell are the focused family; the
    // other family never joins.
    expect(byId("ak0")?.hasAttribute("data-focus-solid")).toBe(true);
    expect(byId("ak1")?.hasAttribute("data-focus-solid")).toBe(true);
    expect(byId("bk0")?.hasAttribute("data-focus-solid")).toBe(false);
  });
});