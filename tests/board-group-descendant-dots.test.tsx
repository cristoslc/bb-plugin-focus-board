// @vitest-environment jsdom
// Issue #321: the folded feature-group card paints the parent card's dot grid
// one generation deeper. Before this, `renderCollapsedBoxRun` painted ONE dot
// per direct member (`box.members.map`), so a member thread's children and
// grandchildren were invisible while the box was folded.
//
// The grid, matching components/thread-card.tsx's collapsed strip: a member's
// dot leads its children at one size step down, and those children's children
// at the smallest tier, each member in its own nowrap cluster with a wider
// gap between clusters than inside one. The walk reads the board's own display
// map (`nestedChildrenByParent`, the same map the board hands ThreadCard as
// `grandchildThreadsByParent`), so a member deeper than two row tiers has
// already been re-attached to its family root by `buildFamilyIndex` and rides
// the middle tier rather than inventing a fourth.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { DOT_PULSE_ATTR, DOT_PULSE_STYLE_ID } from "../components/dot-pulse";
import { PULSE_BASE_PERIOD_MS } from "../lib/pulse-rate";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById(DOT_PULSE_STYLE_ID)?.remove();
});

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

/** A controllable IntersectionObserver, fresh per call (the visible-only dot
 *  pulse gate revalidates against the constructor's identity). */
function stubObserver() {
  const observed = new Set<Element>();
  class StubIntersectionObserver {
    observe(element: Element) {
      observed.add(element);
    }
    unobserve(element: Element) {
      observed.delete(element);
    }
    disconnect() {
      observed.clear();
    }
    takeRecords() {
      return [];
    }
    constructor(_cb: IntersectionObserverCallback) {
      void _cb;
    }
  }
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  return { observed };
}

/**
 * A group of two members where the first is a family root: two children, and
 * a grandchild under the first child. The second member has no descendants, so
 * every case also carries the no-descendants shape the regression pins.
 */
function groupFixture(): {
  members: PluginSidebarThread[];
  nested: ReadonlyMap<string, readonly PluginSidebarThread[]>;
} {
  const members = [
    thread({ id: "thr_a", displayTitle: "Owner", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", displayTitle: "Second", updatedAt: NOW - 2000 }),
  ];
  const childOne = thread({
    id: "thr_a1",
    parentThreadId: "thr_a",
    displayTitle: "Child one",
    status: "active",
    updatedAt: NOW - 3000,
  });
  const childTwo = thread({
    id: "thr_a2",
    parentThreadId: "thr_a",
    displayTitle: "Child two",
    isUnread: true,
    updatedAt: NOW - 3100,
  });
  const grandchild = thread({
    id: "thr_a1x",
    parentThreadId: "thr_a1",
    displayTitle: "Grandchild",
    updatedAt: NOW - 3200,
  });
  return {
    members,
    nested: new Map<string, readonly PluginSidebarThread[]>([
      ["thr_a", [childOne, childTwo]],
      ["thr_a1", [grandchild]],
    ]),
  };
}

interface FoldedOptions {
  nested?: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  errorAckIds?: ReadonlySet<string>;
  pulseRateFor?: (threadId: string) => number | undefined;
  onGroupCollapsedChange?: (groupId: string, collapsed: boolean) => void;
  onOpenThread?: (threadId: string) => void;
  onHighlightGroup?: (groupId: string | null) => void;
  /** Drop the pane wiring to read the no-pane fallback. */
  noPane?: boolean;
}

function renderFoldedBox(options: FoldedOptions = {}) {
  const { members, nested } = groupFixture();
  const groupBoxOf = new Map(
    members.map((member) => [
      member.id,
      { groupId: "grp_auth", name: "Auth rework", members },
    ]),
  );
  const props = {
    groupBy: "none" as const,
    // One lane, so the group frames one box carrying both members (the
    // split default frames one slice per lane, which is a different test).
    columns: buildColumns(members, "none", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    errorAckIds: options.errorAckIds ?? new Set<string>(),
    nestedChildrenByParent: options.nested ?? nested,
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<string, number>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf,
    collapsedGroupIds: new Set(["grp_auth"]),
    onGroupCollapsedChange: options.onGroupCollapsedChange ?? (() => {}),
    onHighlightGroup: options.onHighlightGroup,
    highlightedGroupId: null,
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: options.noPane ? undefined : (options.onOpenThread ?? (() => {})),
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    pulseRateFor: options.pulseRateFor,
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

/** The strip container (the expand surface behind the dots). */
function strip(): HTMLElement {
  const el = document.querySelector("[data-collapsed-group-dots]");
  if (!(el instanceof HTMLElement)) throw new Error("missing collapsed group dot strip");
  return el;
}

/** One dot's glyph, by thread id. */
function glyph(id: string): HTMLElement {
  const el = document.querySelector(`[data-collapsed-group-dot="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing dot for ${id}`);
  return el;
}

/** One dot's clickable button, by thread id. */
function dotButton(id: string): HTMLElement {
  const el = document.querySelector(`[data-collapsed-group-dot-button="${id}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing dot button for ${id}`);
  return el;
}

function tier(name: "member" | "child" | "grandchild"): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      `[data-collapsed-group-dot][data-collapsed-group-dot-tier="${name}"]`,
    ),
  );
}

function cluster(memberId: string): HTMLElement {
  const el = document.querySelector(`[data-collapsed-group-dot-group="${memberId}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`missing dot cluster for ${memberId}`);
  return el;
}

/** The dots' thread ids in paint order, across the whole strip. */
function dotIds(): string[] {
  return Array.from(document.querySelectorAll("[data-collapsed-group-dot]")).map(
    (dot) => dot.getAttribute("data-collapsed-group-dot") ?? "",
  );
}

function collapsedCard(): HTMLElement {
  const el = document.querySelector('[data-collapsed-group="grp_auth"]');
  if (!(el instanceof HTMLElement)) throw new Error("missing collapsed group card");
  return el;
}

describe("the folded box's dot grid reaches the members' descendants", () => {
  it("paints a member's grandchildren and children, family-ordered under its own dot", () => {
    renderFoldedBox();
    // Owner leads its child, that child's grandchild, then the second child;
    // the childless second member keeps one dot of its own.
    expect(dotIds()).toEqual(["thr_a", "thr_a1", "thr_a1x", "thr_a2", "thr_b"]);
    const owner = cluster("thr_a").textContent ?? "";
    expect(owner).not.toContain("Second");
    expect(cluster("thr_b").querySelectorAll("[data-collapsed-group-dot]")).toHaveLength(1);
  });

  it("draws the three generations at three sizes, the smallest still a dot", () => {
    renderFoldedBox();
    expect(glyph("thr_a").className).toContain("size-1.5");
    expect(glyph("thr_a1").className).toContain("size-1");
    expect(glyph("thr_a1").className).not.toContain("size-1.5");
    expect(glyph("thr_a1x").className).toContain("size-0.5");
    expect(glyph("thr_a1x").className).not.toContain("size-1 ");
    for (const id of ["thr_a", "thr_a1", "thr_a1x"]) {
      expect(glyph(id).className).toContain("rounded-full");
    }
  });

  it("clusters each member: a wide gap between members, tighter inside one", () => {
    renderFoldedBox();
    // The parent strip's own spacing (components/thread-card.tsx): gap-2.5
    // between clusters, gap-1 inside one, tighter still one tier deeper.
    expect(strip().className).toContain("gap-2.5");
    expect(cluster("thr_a").className).toContain("gap-1");
    expect(cluster("thr_a").className).toContain("flex-nowrap");
    const childCluster = document.querySelector('[data-collapsed-group-dot-cluster="thr_a1"]');
    if (!(childCluster instanceof HTMLElement)) throw new Error("missing child dot cluster");
    expect(childCluster.className).toContain("flex-nowrap");
    expect(childCluster.className).toContain("gap-0.5");
  });

  it("every dot previews its thread with its state label, at every depth", () => {
    renderFoldedBox();
    expect(glyph("thr_a").getAttribute("title")).toBe("Owner · Working");
    expect(glyph("thr_a2").getAttribute("title")).toBe("Child two · Unread");
    expect(glyph("thr_a1x").getAttribute("title")).toBe("Grandchild · Idle");
    expect(glyph("thr_b").getAttribute("title")).toBe("Second · Idle");
  });
});

describe("the counts and the descendant dots agree", () => {
  // Issue #282's lesson, one surface over: the counts and the dots must agree
  // member for member, so a deeper grid can never read as more threads than
  // the card claims. Each figure sits beside the dots it counts: the header
  // chip names the leading tier (the members), the strip's own tail names
  // every deeper dot, and the two sum to the dots painted.
  it("the member chip counts the leading dots, the strip's tail counts the rest", () => {
    renderFoldedBox();
    const chip = collapsedCard().querySelector("[data-collapsed-group-count]");
    expect(chip?.textContent).toBe("2 threads");
    const tail = collapsedCard().querySelector("[data-collapsed-group-nested-count]");
    expect(tail?.textContent).toBe("3 nested");
    expect(tier("member")).toHaveLength(2);
    expect(tier("child")).toHaveLength(2);
    expect(tier("grandchild")).toHaveLength(1);
    expect(document.querySelectorAll("[data-collapsed-group-dot]")).toHaveLength(5);
    expect(tier("member").length + tier("child").length + tier("grandchild").length).toBe(5);
  });

  it("a single nested thread reads '1 nested'", () => {
    const onlyChild = thread({
      id: "thr_a1",
      parentThreadId: "thr_a",
      displayTitle: "Child one",
      updatedAt: NOW - 3000,
    });
    renderFoldedBox({ nested: new Map([["thr_a", [onlyChild]]]) });
    expect(
      collapsedCard().querySelector("[data-collapsed-group-nested-count]")?.textContent,
    ).toBe("1 nested");
  });
});

describe("a descendant dot carries the member dot's behaviour", () => {
  it("a working descendant breathes at its own measured rate", () => {
    stubObserver();
    renderFoldedBox({
      pulseRateFor: (id) => (id === "thr_a1" ? 4 : undefined),
    });
    expect(glyph("thr_a1").getAttribute(DOT_PULSE_ATTR)).toBe("550");
    // The unmeasured working member answers the base period, never freezing.
    expect(glyph("thr_a").getAttribute(DOT_PULSE_ATTR)).toBe(String(PULSE_BASE_PERIOD_MS));
    // An idle grandchild never pulses.
    expect(glyph("thr_a1x").hasAttribute(DOT_PULSE_ATTR)).toBe(false);
  });

  it("an attention descendant animates and takes no rate period", () => {
    const waiting = thread({
      id: "thr_a1x",
      parentThreadId: "thr_a1",
      displayTitle: "Grandchild",
      hasPendingInteraction: true,
      updatedAt: NOW - 3200,
    });
    renderFoldedBox({
      nested: new Map([
        ["thr_a", [groupFixture().nested.get("thr_a")?.[0] as PluginSidebarThread]],
        ["thr_a1", [waiting]],
      ]),
      pulseRateFor: () => 4,
    });
    const attention = glyph("thr_a1x");
    expect(attention.className).toContain("motion-safe:animate-pulse");
    expect(attention.hasAttribute(DOT_PULSE_ATTR)).toBe(false);
  });

  it("an acknowledged error reads quiet at depth; unacknowledged it asks for you", () => {
    const errored = thread({
      id: "thr_a1x",
      parentThreadId: "thr_a1",
      displayTitle: "Grandchild",
      status: "error",
      updatedAt: NOW - 3200,
    });
    const nested = new Map([
      ["thr_a", [groupFixture().nested.get("thr_a")?.[0] as PluginSidebarThread]],
      ["thr_a1", [errored]],
    ]);
    renderFoldedBox({ nested });
    expect(glyph("thr_a1x").className).toContain("motion-safe:animate-pulse");
    expect(glyph("thr_a1x").getAttribute("title")).toBe("Grandchild · Needs you");
    cleanup();
    renderFoldedBox({ nested, errorAckIds: new Set(["thr_a1x"]) });
    const acked = glyph("thr_a1x");
    expect(acked.className).not.toContain("motion-safe:animate-pulse");
    expect(acked.className).toContain("bg-muted-foreground/30");
  });

  it("an idle descendant paints quiet rather than hiding: the folded card has no idle filter", () => {
    // Issue #172's filter is a parent CARD control; the folded box carries no
    // such control, so an idle descendant may never vanish from under a
    // figure that claims it. It reads quiet through the idle colour, the same
    // way an idle direct member always has.
    renderFoldedBox();
    expect(glyph("thr_a1x").className).toContain("bg-muted-foreground/30");
    expect(
      collapsedCard().querySelector("[data-collapsed-group-nested-count]")?.textContent,
    ).toBe("3 nested");
  });
});

describe("the dots are buttons inside a div: open a thread, never expand it", () => {
  it("clicking a descendant dot opens its pane and leaves the box folded", () => {
    const onOpenThread = vi.fn();
    const onGroupCollapsedChange = vi.fn();
    renderFoldedBox({ onOpenThread, onGroupCollapsedChange });
    fireEvent.click(dotButton("thr_a1x"));
    expect(onOpenThread).toHaveBeenCalledWith("thr_a1x");
    expect(onGroupCollapsedChange).not.toHaveBeenCalled();
    // Still folded, dots untouched.
    expect(strip()).not.toBeNull();
    expect(document.querySelector('[data-thread-card="thr_a1x"]')).toBeNull();
  });

  it("a dot click never marks the group's footprint on the way out", () => {
    const onHighlightGroup = vi.fn();
    renderFoldedBox({ onHighlightGroup });
    fireEvent.click(dotButton("thr_a1"));
    expect(onHighlightGroup).not.toHaveBeenCalled();
  });

  it("the strip's background still expands the group", () => {
    const onGroupCollapsedChange = vi.fn();
    renderFoldedBox({ onGroupCollapsedChange });
    fireEvent.click(strip());
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
  });

  it("a dot is a real button; the strip is a container, not a button", () => {
    renderFoldedBox();
    // A <button> may not contain interactive dots, so the strip became a div.
    expect(strip().tagName).toBe("DIV");
    expect(dotButton("thr_a1").tagName).toBe("BUTTON");
    expect(dotButton("thr_a1").getAttribute("aria-label")).toContain("Child one");
    expect(dotButton("thr_a1x").getAttribute("aria-label")).toContain("Grandchild");
  });

  it("the expand gesture keeps its keyboard path: the labeled toggle", () => {
    const onGroupCollapsedChange = vi.fn();
    renderFoldedBox({ onGroupCollapsedChange });
    const toggle = document.querySelector('[data-collapsed-group-toggle="grp_auth"]');
    if (!(toggle instanceof HTMLElement)) throw new Error("missing expand toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand group Auth rework");
    fireEvent.click(toggle);
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
  });

  it("without pane wiring a dot click falls back to expanding the group", () => {
    const onGroupCollapsedChange = vi.fn();
    renderFoldedBox({ onGroupCollapsedChange, noPane: true });
    fireEvent.click(dotButton("thr_a2"));
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
  });
});

describe("the folded card draws the same cluster capsule as the parent strip (issue #282)", () => {
  // Option D of the 2026-10-16 musing, one surface over: on the parent card a
  // child leads its sub-dots; here a child leads its grandchildren. The
  // capsule wraps that pair, so the boundary between one child's grandchildren
  // and the next child is visible while the box is folded. The member tier
  // keeps its own chip and the "N nested" tail, so the counts are untouched.
  function capsule(childId: string): HTMLElement {
    const el = document.querySelector(`[data-collapsed-group-dot-capsule="${childId}"]`);
    if (!(el instanceof HTMLElement)) throw new Error(`missing capsule for ${childId}`);
    return el;
  }

  it("wraps a child's dot with its grandchildren; a childless child stays bare", () => {
    renderFoldedBox();
    const parentCapsule = capsule("thr_a1");
    expect(parentCapsule.className).toContain("rounded-full");
    expect(parentCapsule.className).toContain("bg-muted/50");
    const ids = Array.from(
      parentCapsule.querySelectorAll("[data-collapsed-group-dot-button]"),
    ).map((button) => button.getAttribute("data-collapsed-group-dot-button"));
    expect(ids).toEqual(["thr_a1", "thr_a1x"]);
    expect(document.querySelector('[data-collapsed-group-dot-capsule="thr_a2"]')).toBeNull();
    // The member tier is not wrapped: its chip names its own count.
    expect(document.querySelector('[data-collapsed-group-dot-capsule="thr_a"]')).toBeNull();
  });

  it("names the child and its nested count on hover, using the card's own tooltip", () => {
    renderFoldedBox();
    expect(capsule("thr_a1").getAttribute("title")).toBe("Child one · 1 nested thread");
  });

  it("leaves the member chip and the nested tail exactly as they were", () => {
    renderFoldedBox();
    expect(
      collapsedCard().querySelector("[data-collapsed-group-count]")?.textContent,
    ).toBe("2 threads");
    expect(
      collapsedCard().querySelector("[data-collapsed-group-nested-count]")?.textContent,
    ).toBe("3 nested");
    expect(dotIds()).toEqual(["thr_a", "thr_a1", "thr_a1x", "thr_a2", "thr_b"]);
  });

  it("a dot inside a capsule still opens its own thread", () => {
    const onOpenThread = vi.fn();
    const onGroupCollapsedChange = vi.fn();
    renderFoldedBox({ onOpenThread, onGroupCollapsedChange });
    fireEvent.click(dotButton("thr_a1x"));
    expect(onOpenThread).toHaveBeenCalledWith("thr_a1x");
    expect(onGroupCollapsedChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-collapsed-group="grp_auth"]')).not.toBeNull();
  });
});

describe("a member with no descendants reads exactly as before", () => {
  it("paints one leading dot per member and keeps the chip's member count", () => {
    renderFoldedBox({ nested: new Map() });
    expect(dotIds()).toEqual(["thr_a", "thr_b"]);
    expect(tier("child")).toHaveLength(0);
    expect(tier("grandchild")).toHaveLength(0);
    // No descendant figure anywhere: the old card, untouched.
    expect(collapsedCard().textContent).toContain("2 threads");
    expect(collapsedCard().textContent).not.toContain("nested");
    expect(
      collapsedCard().querySelector("[data-collapsed-group-nested-count]"),
    ).toBeNull();
    expect(glyph("thr_a").className).toContain("size-1.5");
    expect(glyph("thr_a").getAttribute("title")).toBe("Owner · Working");
  });

  it("keeps the dots clickable and the strip a working expand surface", () => {
    const onOpenThread = vi.fn();
    const onGroupCollapsedChange = vi.fn();
    renderFoldedBox({ nested: new Map(), onOpenThread, onGroupCollapsedChange });
    fireEvent.click(dotButton("thr_b"));
    expect(onOpenThread).toHaveBeenCalledWith("thr_b");
    fireEvent.click(strip());
    expect(onGroupCollapsedChange).toHaveBeenCalledWith("grp_auth", false);
  });
});
