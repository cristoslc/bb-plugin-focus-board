// @vitest-environment jsdom
// Issue #127 hardening: a ticket chip's anchors may never nest inside the
// card's own link, nor inside a nested row's link. #171 (PR #177) already
// moved the card's chip rows beside the content anchor and left a single
// one-chip pin; these pins widen the guard to the edge shapes that pin did
// not draw — several chips on one card, an id link whose provider mark is
// inert (an unknown tracker), a card with no chips at all, and the collapsed
// and expanded family rows — so the #104 chip-layout rework cannot silently
// reintroduce the nesting, whatever shape it draws.
//
// The defect itself is fixed; this file asserts the invariant, not a fix.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";
import type { GitHubItemLink, ExternalItemLink } from "../lib/link-metadata";

const BASE = "https://github.com/owner/repo";
const PARENT_ID = "thr_card";

type CardProps = Parameters<typeof ThreadCard>[0];

function renderCard(overrides: Partial<CardProps> = {}) {
  const props = {
    thread: thread({ id: PARENT_ID, displayTitle: "Plain card", updatedAt: 5000 }),
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    repoHrefBase: BASE,
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

/** The card root the render produced. The parent card is the outermost
 *  `[data-thread-card]`; a nested child row carries its own marker deeper in
 *  the tree, so the first match in document order is the card. */
function cardRoot(): Element {
  const el = document.querySelector(`[data-thread-card="${PARENT_ID}"]`);
  if (el === null) throw new Error("missing card root");
  return el;
}

/** Every anchor inside `root` that sits inside another anchor — the invalid
 *  nesting this guard bans. Empty on a valid card. */
function nestedAnchors(root: Element): Element[] {
  return Array.from(root.querySelectorAll("a")).filter((anchor) => {
    const outer = anchor.parentElement?.closest("a");
    return outer !== null && outer !== undefined;
  });
}

/** A child thread whose title carries a `#N` text ref, so its row chips. */
function childWithRef(): PluginSidebarThread {
  return thread({
    id: "thr_child",
    displayTitle: "resolve #17 inside the family",
    parentThreadId: PARENT_ID,
    updatedAt: 4000,
  });
}

const githubIssue = (issue: number): GitHubItemLink => ({
  tracker: "github",
  repo: "owner/repo",
  issue,
  kind: "issue",
  href: `${BASE}/issues/${issue}`,
  createdAt: "2026-10-09T00:00:00.000Z",
  source: "agent",
});

const githubPull = (issue: number): GitHubItemLink => ({
  ...githubIssue(issue),
  kind: "pull",
  href: `${BASE}/pull/${issue}`,
});

/** An unknown tracker: not a forgejo URL, and the project base is GitHub, so
 *  no list page can be derived — the provider mark renders inert while the
 *  id still links its own item. */
const unknownTracker: ExternalItemLink = {
  tracker: "external",
  url: "https://linear.app/t/PROJ-142",
  hostname: "linear.app",
  label: "PROJ-142",
  createdAt: "2026-10-09T00:00:00.000Z",
  source: "operator",
};

afterEach(cleanup);

describe("chip anchors never nest inside a card link (issue #127 hardening)", () => {
  it("several chips on one card keep every chip anchor outside the card's link", () => {
    renderCard({ linkedIssues: [githubIssue(12), githubPull(16), unknownTracker] });
    const card = cardRoot();
    // Non-vacuous: three chips across the three placement regions really
    // render (issue #104 replaced the per-provider row wrappers with the
    // issues / pulls / tags regions, so the chips themselves carry the
    // provider key).
    expect(card.querySelectorAll("[data-ticket-chip]").length).toBe(3);
    expect(card.querySelectorAll("[data-provider-row]").length).toBe(3);
    // The issues and pulls regions hold them; PROJ-142 is a WORD-123 key, so
    // it stays a ticket in the issues region rather than a tag.
    expect(card.querySelectorAll("[data-ticket-chip-region]").length).toBe(2);
    // The link-bearing chips are anchors; the inert one is a span (below).
    expect(card.querySelectorAll("a[data-ticket-chip-mark]").length).toBe(2);
    expect(card.querySelectorAll("a[data-ticket-id]").length).toBe(3);
    expect(nestedAnchors(card)).toEqual([]);
  });

  it("an id link whose provider mark is inert still clears the card's link", () => {
    renderCard({ linkedIssues: [unknownTracker] });
    const card = cardRoot();
    const mark = card.querySelector("[data-ticket-chip-mark]");
    // The unknown tracker's mark cannot point anywhere: it stays an inert span.
    expect(mark?.tagName).toBe("SPAN");
    expect(mark?.getAttribute("href")).toBeNull();
    // The id still links its own item, and that anchor is outside the card's.
    const id = card.querySelector("[data-ticket-id]");
    expect(id?.tagName).toBe("A");
    expect(id?.getAttribute("href")).toBe("https://linear.app/t/PROJ-142");
    expect(nestedAnchors(card)).toEqual([]);
  });

  it("a card with no chips renders only its own content link", () => {
    renderCard();
    const card = cardRoot();
    expect(card.querySelectorAll("[data-ticket-chip]").length).toBe(0);
    // Exactly one anchor, the content link, and it nests nothing.
    expect(card.querySelectorAll("a").length).toBe(1);
    expect(nestedAnchors(card)).toEqual([]);
  });

  it("the expanded family rows keep their chips inert inside the row link", () => {
    renderCard({ childThreads: [childWithRef()] });
    const card = cardRoot();
    const row = card.querySelector('[data-nested-rows] a[data-thread-card="thr_child"]');
    expect(row).not.toBeNull();
    // The whole row is one anchor; its condensed chip renders spans, so the
    // row holds its chip and no nested link.
    expect(row?.querySelectorAll("[data-ticket-chip]").length).toBe(1);
    expect(row?.querySelectorAll("a").length).toBe(0);
    expect(nestedAnchors(card)).toEqual([]);
  });

  it("the collapsed family's listed active row keeps its chips inert too", () => {
    renderCard({
      childThreads: [childWithRef()],
      isCollapsed: true,
      activeThreadId: "thr_child",
    });
    const card = cardRoot();
    const row = card.querySelector('[data-child-active-row] a[data-thread-card="thr_child"]');
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll("[data-ticket-chip]").length).toBe(1);
    expect(row?.querySelectorAll("a").length).toBe(0);
    expect(nestedAnchors(card)).toEqual([]);
  });
});
