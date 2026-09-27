import { useEffect, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn, GroupBy } from "./grouping";
import { threadState, withSweepGather } from "./grouping";
import { sweepColumnKind, type ArmedSweep } from "../lib/sweep";
import { ThreadCard } from "./thread-card";
import type { CardMenuAction } from "./thread-card-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  appendTo,
  applyMove,
  columnIsRanked,
  columnRankKey,
  moveTargetFor,
  type RankStore,
} from "../lib/rank";

/**
 * Drag payload keys. The id is the moved card; the rank key is the column it
 * is being reordered WITHIN, set only when that column is ranked. Its presence
 * is what tells a same-column reorder apart from a cross-column drop onto
 * Done or Unread, which the column-level drop handlers own.
 */
const DRAG_ID_KEY = "text/focus-board-id";
const DRAG_RANK_KEY = "text/focus-board-rank";

/** Where an insertion line would land: before or after the hovered card. */
type Half = "before" | "after";

interface BoardProps {
  columns: readonly BoardColumn[];
  /** The active grouping — a column's rank key is namespaced by it. */
  groupBy: GroupBy;
  activeThreadId: string | null;
  doneIds: ReadonlySet<string>;
  /** Parent id → children that render as nested rows under the parent card. */
  nestedChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /**
   * Parent id → ALL its visible children (raw family index); drives the
   * child-count chip, which counts children that render standalone too.
   */
  childCountByParent: ReadonlyMap<string, number>;
  /** Family members that did not match the active filters; rendered dimmed. */
  dimmedIds: ReadonlySet<string>;
  projectNameFor: (projectId: string) => string;
  /** GitHub repo base per project ("https://github.com/owner/repo"), when known. */
  repoBaseFor: (projectId: string) => string | null;
  /** GitHub cache status for a repo slug + number, when known. */
  statusFor?: (repo: string | null, number: number | undefined) =>
    | { kind: string; state: string }
    | undefined;
  onOpenThread: (threadId: string) => void;
  onNewTask: () => void;
  /**
   * Per-column manual orders. A column is reorderable only when it has a
   * stored order, so the board never shows a drag affordance for a
   * rearrange it would silently discard.
   */
  rankStore?: RankStore;
  /**
   * Move `threadId` within `columnKey`. `beforeId` names the card to land in
   * front of (null = top); `toEnd` drops below the last ranked card instead,
   * which is a different intent that would otherwise share the null.
   */
  onRankMove?: (
    columnKey: string,
    threadId: string,
    beforeId: string | null,
    toEnd: boolean,
  ) => void;
  /** Drop a card onto the Done column. */
  onDropDone: (threadId: string) => void;
  /** Drop a card onto the Unread column (Attention grouping only). */
  onDropUnread: (threadId: string) => void;
  /** Right-click menu actions for one thread, sidebar-menu style. */
  menuActionsFor: (thread: PluginSidebarThread) => readonly CardMenuAction[];
  /**
   * Sweep wiring: eligibility per column (empty when nothing is eligible),
   * and the armed lifecycle. While armed, `armedSweep`'s FROZEN id list is
   * the display and confirm truth; `sweepCandidatesFor` is consulted only at
   * arm time by the caller.
   */
  sweepCandidatesFor?: (columnId: string) => readonly string[];
  armedSweep?: ArmedSweep | null;
  onSweepArm?: (columnId: string) => void;
  onSweepDisarm?: () => void;
  onSweepConfirm?: (columnId: string) => void;
}

const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

function StateDot({ thread }: { thread: PluginSidebarThread }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT_CLASS[threadState(thread)] ?? "bg-muted-foreground/30",
      )}
      aria-hidden
    />
  );
}

function SweepButton({
  eligibleCount,
  isArmed,
  onArm,
  onConfirm,
}: {
  eligibleCount: number;
  isArmed: boolean;
  onArm: () => void;
  onConfirm: () => void;
}) {
  if (eligibleCount === 0 && !isArmed) return null;
  return (
    <button
      type="button"
      data-sweep-button=""
      aria-pressed={isArmed}
      aria-label={
        isArmed
          ? `Confirm sweep of ${eligibleCount} threads from this column to Archive; click away to disarm`
          : `Arm sweep for this column: ${eligibleCount} eligible threads`
      }
      onClick={(event) => {
        event.stopPropagation();
        if (isArmed) onConfirm();
        else onArm();
      }}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isArmed
          ? "bg-amber-500/90 text-amber-950 hover:bg-amber-500"
          : "text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon name="Archive" className="size-3" aria-hidden />
      {isArmed ? (
        <>
          Sweep {eligibleCount} → Archive
          <span aria-hidden>?</span>
        </>
      ) : (
        <>Sweep {eligibleCount}</>
      )}
    </button>
  );
}

export function Board({
  columns,
  groupBy,
  activeThreadId,
  doneIds,
  nestedChildrenByParent,
  childCountByParent,
  dimmedIds,
  projectNameFor,
  repoBaseFor,
  statusFor,
  onOpenThread,
  onNewTask,
  rankStore,
  onRankMove,
  onDropDone,
  onDropUnread,
  menuActionsFor,
  sweepCandidatesFor,
  armedSweep = null,
  onSweepArm,
  onSweepDisarm,
  onSweepConfirm,
}: BoardProps) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // { columnId, threadId, edge } of the insertion line while a ranked card
  // is dragged over a ranked column. Null when no reorder is in flight.
  const [rankDrop, setRankDrop] = useState<{
    columnId: string;
    threadId: string;
    edge: Half;
  } | null>(null);
  const sweepActive = sweepCandidatesFor !== undefined && onSweepArm !== undefined;
  const ranking = rankStore !== undefined && onRankMove !== undefined;

  // Announce a completed move so a reorder is legible without sight of the
  // insertion line, which is the only feedback a screen reader would miss.
  const [announcement, setAnnouncement] = useState("");

  function clearRankDrop(): void {
    setRankDrop(null);
  }

  function commitMove(
    column: BoardColumn,
    threadId: string,
    beforeId: string | null,
    toEnd: boolean,
  ): void {
    if (!ranking) return;
    const current = column.threads.map((thread) => thread.id);
    onRankMove?.(columnRankKey(groupBy, column.id), threadId, beforeId, toEnd);
    // Report the resulting position from the order the move produces, not
    // from the anchor's old index: dropping onto a card's top half lands one
    // above where that card was, and the message must match the new board.
    const after = toEnd
      ? appendTo(current, threadId)
      : applyMove(current, threadId, beforeId);
    setAnnouncement(
      `Moved to position ${after.indexOf(threadId) + 1} of ${after.length} in ${column.label}.`,
    );
  }
  // Only the Done and Unread lanes accept drops; Unread exists as a column
  // only in the Attention grouping.
  const dropHandlerFor = (columnId: string): ((threadId: string) => void) | null => {
    if (columnId === "done") return onDropDone;
    if (columnId === "unread") return onDropUnread;
    return null;
  };
  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3 pt-2">
      {/* The insertion line is the only visual feedback a reorder gives, so
          a screen reader gets the same information in words. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex h-full min-h-0 items-stretch gap-4">
        {columns.map((column) => {
          const dropHandler = dropHandlerFor(column.id);
          const isDropTarget = dropHandler !== null;
          const sweepKind = sweepColumnKind(column.id);
          const isArmed = armedSweep !== null && armedSweep.columnId === column.id;
          // While armed, the FROZEN list drives count, gather, and highlight
          // — not the live eligible set. Before arming, the live eligible
          // set is what the button proposes.
          const eligible = isArmed
            ? (armedSweep?.threadIds ?? [])
            : sweepActive && sweepKind !== null
              ? (sweepCandidatesFor?.(column.id) ?? [])
              : [];
          const shownThreads = isArmed ? withSweepGather(column.threads, eligible) : column.threads;
          const armedSet = isArmed ? new Set(eligible) : null;
          const rankKey = columnRankKey(groupBy, column.id);
          // Seed on first intent: every card is a reorder target for its OWN
          // lane, whether or not that lane has a stored order yet. The drag
          // itself is the intent, and the first drop writes the order — so a
          // fresh install can reach the feature. The stored-order flag below
          // is for display only ("this lane is hand-ordered"), not a gate.
          const isOrdered = ranking && columnIsRanked(rankStore ?? {}, rankKey);
          return (
            <section
              key={column.id}
              data-column-id={column.id}
              data-column-ordered={isOrdered}
              aria-label={`${column.label}, ${column.threads.length} threads`}
              onDragOver={(event) => {
                const sourceKey = event.dataTransfer.getData(DRAG_RANK_KEY);
                // Same-lane drag: the lane's own empty space accepts the drop
                // as an append, so the column must allow the event.
                if (sourceKey === rankKey && ranking) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  return;
                }
                if (!isDropTarget) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverColumn(column.id);
              }}
              onDragLeave={isDropTarget ? () => setDragOverColumn((c) => (c === column.id ? null : c)) : undefined}
              onDrop={(event) => {
                const threadId = event.dataTransfer.getData(DRAG_ID_KEY);
                const sourceKey = event.dataTransfer.getData(DRAG_RANK_KEY);
                if (sourceKey === rankKey && ranking) {
                  // Released over the lane's empty space below the last card:
                  // append. A drop ON a card was already claimed by that
                  // card's own handler, which stops propagation.
                  event.preventDefault();
                  clearRankDrop();
                  if (threadId !== "") commitMove(column, threadId, null, true);
                  return;
                }
                if (!isDropTarget) return;
                event.preventDefault();
                setDragOverColumn(null);
                if (threadId !== "") dropHandler(threadId);
              }}
              className={cn(
                "flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg transition-colors",
                dragOverColumn === column.id && "bg-accent/60 ring-2 ring-ring",
              )}
            >
              <header className="flex items-baseline gap-1.5 px-1 pb-1.5">
                <h3 className="truncate text-[11px] font-medium text-muted-foreground">
                  {column.label}
                </h3>
                <span className="text-[11px] tabular-nums text-muted-foreground/60">
                  {column.threads.length}
                </span>
                {/* A hand-ordered lane says so, so a card sitting out of recency
                    order does not read as a bug. */}
                {isOrdered ? (
                  <span
                    title="This column is in your order, not by recency"
                    aria-label="Ordered by you, not by recency"
                    className="inline-flex items-center text-muted-foreground/50"
                  >
                    <Icon name="SortingOneNine" className="size-3" aria-hidden />
                  </span>
                ) : null}
                {sweepActive ? (
                  <span className="ml-auto">
                    <SweepButton
                      eligibleCount={eligible.length}
                      isArmed={isArmed}
                      onArm={() => onSweepArm?.(column.id)}
                      onConfirm={() => onSweepConfirm?.(column.id)}
                    />
                  </span>
                ) : null}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted/30 p-1.5">
                {column.threads.length === 0 && dragOverColumn !== column.id ? (
                  isDropTarget ? (
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground/60">
                      Drop to {column.id === "done" ? "mark done" : "mark unread"}
                    </p>
                  ) : null
                ) : null}
                {column.threads.length === 0 ? null : (
                  <ul className="flex flex-col gap-1.5">
                    {shownThreads.map((thread) => (
                      <li
                        key={thread.id}
                        data-rank-slot={ranking ? thread.id : undefined}
                        // Every card is a drop target for its own lane's drag;
                        // the hovered card decides which of its two edges the
                        // insertion line lands on.
                        onDragOver={
                          (event) => {
                            // Same lane only. A drag from another lane would
                            // write an order for a card that is not in this
                            // one — invisible on drop — so it falls through to
                            // the column's Done/Unread handler instead.
                            if (!ranking) return;
                            if (event.dataTransfer.getData(DRAG_RANK_KEY) !== rankKey) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const rect = event.currentTarget.getBoundingClientRect();
                            const edge: Half =
                              event.clientY - rect.top < rect.height / 2 ? "before" : "after";
                            const draggedId = event.dataTransfer.getData(DRAG_ID_KEY);
                            if (draggedId === thread.id) {
                              clearRankDrop();
                              return;
                            }
                            setRankDrop((current) =>
                              current?.columnId === column.id &&
                              current?.threadId === thread.id &&
                              current?.edge === edge
                                ? current
                                : { columnId: column.id, threadId: thread.id, edge },
                            );
                          }
                        }
                        onDrop={
                          (event) => {
                            if (!ranking) return;
                            if (event.dataTransfer.getData(DRAG_RANK_KEY) !== rankKey) return;
                            event.preventDefault();
                            const threadId = event.dataTransfer.getData(DRAG_ID_KEY);
                            // The drop bubbles to the column's own handler,
                            // which treats a same-lane drag as "append". Claim
                            // the event so one drop is one move, not an
                            // insert plus an append.
                            event.stopPropagation();
                            // Read the edge from the live drag position, not
                            // from React state: the last dragover before a
                            // drop can land on a different card than the one
                            // that was hovered when the state was set.
                            const rect = event.currentTarget.getBoundingClientRect();
                            const edge: Half =
                              event.clientY - rect.top < rect.height / 2 ? "before" : "after";
                            clearRankDrop();
                            if (threadId === "") return;
                            const target = moveTargetFor(
                              shownThreads.map((candidate) => candidate.id),
                              thread.id,
                              edge,
                              threadId,
                            );
                            if (target === null) return;
                            commitMove(column, threadId, target.beforeId, target.toEnd);
                          }
                        }
                        // A drag is mouse-only, so a column also takes Alt+Arrow
                        // from a focused card. Without it the reorder is
                        // unreachable for keyboard and touch.
                        onKeyDown={
                          (event) => {
                            if (!ranking) return;
                            if (!event.altKey) return;
                            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                            const at = shownThreads.indexOf(thread);
                            const to = event.key === "ArrowUp" ? at - 1 : at + 1;
                            if (to < 0 || to >= shownThreads.length) return;
                            event.preventDefault();
                            // Up anchors on the card being stepped over; down
                            // anchors on the one after the destination, or
                            // appends when the card is already last.
                            const beforeId =
                              event.key === "ArrowUp"
                                ? shownThreads[to].id
                                : (shownThreads[to + 1]?.id ?? null);
                            commitMove(column, thread.id, beforeId, beforeId === null);
                          }
                        }
                        className={cn(
                          "relative",
                          rankDrop?.columnId === column.id && rankDrop.threadId === thread.id && (
                            rankDrop.edge === "before"
                              ? "before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-ring"
                              : "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-ring"
                          ),
                        )}
                      >
                        <ThreadCard
                          thread={thread}
                          stateDot={<StateDot thread={thread} />}
                          isActive={thread.id === activeThreadId}
                          isDone={doneIds.has(thread.id)}
                          isSweepHighlighted={armedSet?.has(thread.id) ?? false}
                          projectName={projectNameFor(thread.projectId)}
                          repoHrefBase={repoBaseFor(thread.projectId) ?? undefined}
                          statusFor={statusFor}
                          menuActions={menuActionsFor(thread)}
                          childThreads={nestedChildrenByParent.get(thread.id)}
                          childCount={childCountByParent.get(thread.id) ?? 0}
                          childrenByParent={nestedChildrenByParent}
                          doneIds={doneIds}
                          activeThreadId={activeThreadId}
                          dimmed={dimmedIds.has(thread.id)}
                          onOpen={() => onOpenThread(thread.id)}
                          onOpenThread={onOpenThread}
                          childMenuActions={menuActionsFor}
                          rankKey={ranking ? rankKey : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {column.id === "working" ? (
                  <button
                    type="button"
                    onClick={onNewTask}
                    className={cn(
                      "mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2",
                      "text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <Icon name="Plus" className="size-3.5" aria-hidden />
                    New Task
                  </button>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Disarm an armed sweep when the operator clicks anywhere else. */
export function useSweepClickAway(armed: boolean, onDisarm: () => void): void {
  useEffect(() => {
    if (!armed) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-sweep-button]")) return;
      onDisarm();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDisarm();
    };
    document.addEventListener("pointerdown", onPointerDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [armed, onDisarm]);
}