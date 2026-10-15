// @vitest-environment jsdom
// The memoization contract (issue #186's render half): a board-level
// re-render must skip every card whose DATA did not change, even though the
// real board's call site (components/board.tsx) rebuilds every closure,
// array, Set identity, and dot element on every render — the churn that
// defeats identity-based memoization.
//
// React's Profiler cannot play the render counter here (onRender fires even
// when a memo'd child bails out), so the contract is pinned at its exact
// seams: `sameCardProps` — the comparator React itself consults to skip —
// is unit-tested against the mimicked call-site churn, and the export is
// asserted to be a React.memo object wired to that same function. The
// behavioral suites (thread-card-*.test.tsx) pin that nothing regressed,
// and scripts/screenshot/bench-board.mjs measures the real Chrome wall
// clock.
import type { CardMenuAction } from "../components/thread-card-menu";
import { describe, expect, it } from "vitest";
import {
  sameCardProps,
  ThreadCard,
  ThreadCardImpl,
  type ThreadCardProps,
} from "../components/thread-card";
import { threadState } from "../components/grouping";
import { thread } from "./thread-fixture";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

/** The board's StateDot, reproduced: pure over (thread, errorAcks). */
function Dot({ thread: dotThread, errorAcks = new Set<string>() }: {
  thread: PluginSidebarThread;
  errorAcks?: ReadonlySet<string>;
}) {
  return (
    <span
      data-state-dot=""
      className={DOT_CLASS[threadState(dotThread, errorAcks)] ?? "bg-muted-foreground/30"}
    />
  );
}

interface BoardShape {
  threads: readonly PluginSidebarThread[];
  doneIds: ReadonlySet<string>;
  errorAckIds: ReadonlySet<string>;
  childrenByParent?: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  grandchildThreadsByParent?: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  snoozeFor?: (threadId: string) => number | null;
  activeThreadId?: string | null;
  menuLabel?: string;
  repoHrefBase?: string;
  statusFor?: ThreadCardProps["statusFor"];
}

const doneMenuRun = () => {};
function menuFor(
  menuThread: PluginSidebarThread,
  doneIds: ReadonlySet<string>,
  label: string,
): readonly CardMenuAction[] {
  return [
    {
      id: "done",
      label: doneIds.has(menuThread.id) ? "Mark not done" : "Mark done",
      icon: "Checkbox",
      run: doneMenuRun,
    },
    { id: "other", label, icon: "Pin", run: doneMenuRun },
  ];
}
const onOpen = (threadId: string) => void threadId;
const onCollapsedChange = (threadId: string, collapsed: boolean) => void `${threadId}${collapsed}`;
const onEnter = (threadId: string) => void threadId;
const onLeave = (threadId: string) => void threadId;

/** One card's props as the board builds them per render: every identity
 * fresh, the data free to be the same. */
function cardProps(board: BoardShape, entry: PluginSidebarThread): ThreadCardProps {
  return {
    thread: entry,
    stateDot: <Dot thread={entry} errorAcks={board.errorAckIds} />,
    isActive: entry.id === board.activeThreadId,
    isDone: board.doneIds.has(entry.id),
    doneIds: board.doneIds,
    errorAckIds: board.errorAckIds,
    onSweepToggle: (threadId, gesture) => void `${threadId}${gesture.shiftKey}`,
    onAttentionEnter: () => onEnter(entry.id),
    onAttentionLeave: () => onLeave(entry.id),
    isSweepHighlighted: false,
    isSweeping: false,
    isSweepSelecting: false,
    isSweepSelectable: false,
    projectName: "Alpha",
    repoHrefBase: board.repoHrefBase,
    statusFor: board.statusFor,
    menuActions: menuFor(entry, board.doneIds, board.menuLabel ?? "Actions"),
    childThreads: board.childrenByParent?.get(entry.id),
    grandchildThreadsByParent: board.grandchildThreadsByParent,
    childCount: board.childrenByParent?.get(entry.id)?.length,
    dimmed: false,
    rankKey: "column:needs",
    onRankDragStart: () => onOpen(entry.id),
    onOpen: () => onOpen(entry.id),
    activeThreadId: board.activeThreadId,
    isTransportGhost: false,
    onOpenThread: (childId: string) => onOpen(childId),
    childMenuActions: (child) => menuFor(child, board.doneIds, board.menuLabel ?? "Actions"),
    snoozeFor: board.snoozeFor ?? (() => null),
    isCollapsed: false,
    onCollapsedChange: (collapsed: boolean) => onCollapsedChange(entry.id, collapsed),
    compact: false,
  };
}

function baseThreads(count: number): PluginSidebarThread[] {
  return Array.from({ length: count }, (_, index) =>
    thread({ id: `thr_memo_${index}`, displayTitle: `Card ${index}`, updatedAt: 1000 - index }),
  );
}

describe("the memoized card field's comparator", () => {
  it("ThreadCard is memo-wired to the comparator", () => {
    const memoObject = ThreadCard as unknown as {
      $$typeof: symbol;
      type: unknown;
      compare?: unknown;
    };
    expect(typeof memoObject.$$typeof).toBe("symbol");
    expect(memoObject.type).toBe(ThreadCardImpl);
    expect(memoObject.compare).toBe(sameCardProps);
  });

  it("skips a churny re-render whose data did not change", () => {
    const threads = baseThreads(6);
    const doneIds = new Set(["thr_memo_1"]);
    const board: BoardShape = { threads, doneIds, errorAckIds: new Set() };
    const prev = cardProps(board, threads[3] as PluginSidebarThread);
    // The rerender: every closure, array, Set, dot element rebuilt fresh,
    // data identical.
    const next = cardProps(
      { threads, doneIds: new Set(doneIds), errorAckIds: new Set() },
      threads[3] as PluginSidebarThread,
    );
    expect(sameCardProps(prev, next)).toBe(true);
  });

  it("renders only the changed card's subtree for a done flip", () => {
    const threads = baseThreads(6);
    const doneIds = new Set(["thr_memo_1"]);
    const changedDone: BoardShape = {
      threads,
      doneIds: new Set([...doneIds, "thr_memo_3"]),
      errorAckIds: new Set(),
    };
    // Card 3 changed: its comparator must reject a skip.
    expect(
      sameCardProps(
        cardProps({ threads, doneIds, errorAckIds: new Set() }, threads[3] as PluginSidebarThread),
        cardProps(changedDone, threads[3] as PluginSidebarThread),
      ),
    ).toBe(false);
    // Card 0 is untouched: still skips even though doneIds, every closure,
    // and the dot element churned.
    expect(
      sameCardProps(
        cardProps({ threads, doneIds, errorAckIds: new Set() }, threads[0] as PluginSidebarThread),
        cardProps(changedDone, threads[0] as PluginSidebarThread),
      ),
    ).toBe(true);
  });

  it("renders only the parent card whose nested child's done state changed", () => {
    const child = thread({ id: "thr_memo_child", displayTitle: "Row", updatedAt: 900, parentThreadId: "thr_memo_2" });
    const threads = [...baseThreads(4), child];
    const childrenByParent = new Map([["thr_memo_2", [child]]]);
    const board: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(), childrenByParent };
    const changedChildDone: BoardShape = {
      threads,
      doneIds: new Set(["thr_memo_child"]),
      errorAckIds: new Set(),
      childrenByParent,
    };
    expect(
      sameCardProps(cardProps(board, threads[2] as PluginSidebarThread), cardProps(changedChildDone, threads[2] as PluginSidebarThread)),
    ).toBe(false);
    expect(
      sameCardProps(cardProps(board, threads[0] as PluginSidebarThread), cardProps(changedChildDone, threads[0] as PluginSidebarThread)),
    ).toBe(true);
  });

  it("renders only the acked card when the ack set changes", () => {
    const threads = baseThreads(6);
    const board: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(["thr_memo_5"]) };
    const acked: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(["thr_memo_5", "thr_memo_4"]) };
    expect(
      sameCardProps(cardProps(board, threads[4] as PluginSidebarThread), cardProps(acked, threads[4] as PluginSidebarThread)),
    ).toBe(false);
    expect(
      sameCardProps(cardProps(board, threads[0] as PluginSidebarThread), cardProps(acked, threads[0] as PluginSidebarThread)),
    ).toBe(true);
  });

  it("skips menu closure churn and renders menu content changes", () => {
    const threads = baseThreads(4);
    const board: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(), menuLabel: "Actions" };
    expect(
      sameCardProps(
        cardProps(board, threads[0] as PluginSidebarThread),
        cardProps({ ...board }, threads[0] as PluginSidebarThread),
      ),
    ).toBe(true);
    expect(
      sameCardProps(
        cardProps(board, threads[0] as PluginSidebarThread),
        cardProps({ ...board, menuLabel: "New label" }, threads[0] as PluginSidebarThread),
      ),
    ).toBe(false);
  });

  it("renders only the snoozed card when the lookup's result changes", () => {
    const threads = baseThreads(4);
    const idle = () => null;
    const board: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(), snoozeFor: idle };
    const wakes = (threadId: string) => (threadId === "thr_memo_2" ? Date.now() + 3_600_000 : null);
    const snoozed: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(), snoozeFor: wakes };
    const prevProps = cardProps(board, threads[2] as PluginSidebarThread);
    const nextProps = cardProps(snoozed, threads[2] as PluginSidebarThread);
    expect(
      sameCardProps(prevProps, nextProps),
    ).toBe(false);
    expect(
      sameCardProps(cardProps(board, threads[0] as PluginSidebarThread), cardProps(snoozed, threads[0] as PluginSidebarThread)),
    ).toBe(true);
  });

  it("renders the card whose status lookup's result changed", () => {
    const threads = [
      thread({ id: "thr_memo_status", displayTitle: "Card with #42", updatedAt: 998, href: "/p/threads/s" }),
      ...baseThreads(2),
    ];
    const board: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set(), repoHrefBase: "https://github.com/owner/repo" };
    const merged: BoardShape = { ...board, statusFor: () => ({ kind: "pull", state: "MERGED" }) };
    expect(
      sameCardProps(cardProps(board, threads[0] as PluginSidebarThread), cardProps(merged, threads[0] as PluginSidebarThread)),
    ).toBe(false);
    // A card with no refs has no status result to consume: skips.
    expect(
      sameCardProps(cardProps(board, threads[1] as PluginSidebarThread), cardProps(merged, threads[1] as PluginSidebarThread)),
    ).toBe(true);
  });

  it("renders a card whose thread object changed (title edits land)", () => {
    const threads = baseThreads(4);
    const board: BoardShape = { threads, doneIds: new Set(), errorAckIds: new Set() };
    const renamed = threads.map((candidate) =>
      candidate.id === "thr_memo_1" ? { ...candidate, displayTitle: "Renamed card" } : candidate,
    );
    expect(
      sameCardProps(
        cardProps(board, threads[0] as PluginSidebarThread),
        cardProps({ ...board, threads: renamed }, threads[0] as PluginSidebarThread),
      ),
    ).toBe(true);
    expect(
      sameCardProps(
        cardProps(board, threads[1] as PluginSidebarThread),
        cardProps({ ...board, threads: renamed }, renamed[1] as PluginSidebarThread),
      ),
    ).toBe(false);
  });
});