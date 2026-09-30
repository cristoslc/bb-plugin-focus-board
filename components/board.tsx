import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn, GroupBy } from "./grouping";
import { threadState, withSweepGather } from "./grouping";
import { sweepColumnKind, type ArmedSweep } from "../lib/sweep";
import { ThreadCard } from "./thread-card";
import type { CardMenuAction } from "./thread-card-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  applyMoveVisible,
  columnIsRanked,
  columnRankKey,
  displayAfterMove,
  isLaneDrag,
  moveTargetFor,
  type RankStore,
} from "../lib/rank";

/**
 * Drag payload keys.
 *
 * `DRAG_ID_KEY` carries the moved card and is readable at drop time.
 *
 * The lane the drag came from is carried in the MIME **type name**, not in a
 * payload value. A real browser holds the drag payload write-only until the
 * drop: `getData` returns "" during `dragover`, so any handler that decides
 * from `getData` mid-drag silently sees nothing, never calls
 * `preventDefault`, and the browser then refuses the drop outright. `types`
 * stays readable for the whole drag, so the lane is discoverable exactly when
 * the drop has to be authorised. Reading the lane from the type name is the
 * difference between a reorder that works and one that does nothing.
 */
const DRAG_ID_KEY = "text/focus-board-id";

/** How long a refusal banner stays on screen before auto-dismissing. */
const RANK_ERROR_AUTO_DISMISS_MS = 10_000;

/** Where an insertion line would land: before or after the hovered card. */
type Half = "before" | "after";

/**
 * The dragged card, for a DROP.
 *
 * Read from the payload first: `drop` is one of the two moments the browser
 * lets a handler read it, so this is the authoritative source. The ref is the
 * fallback for the rare case where a payload is unavailable, and it must never
 * be the only source — losing it silently turns every reorder into a no-op,
 * because an empty id makes `applyMove` return the order unchanged and the
 * RPC reject it, with nothing on screen to say why.
 */
function draggedIdFor(
  event: React.DragEvent,
  fallback: string | null,
): string {
  return event.dataTransfer.getData(DRAG_ID_KEY) || fallback || "";
}

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
  /** Close the open thread pane when the operator clicks empty board area. */
  onClosePane?: () => void;
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
   * `visibleIds` is the column's displayed order, so the writer can rank
   * every card above the drop point — without it, a first drop into an
   * unranked column would rank one card and reorder nothing.
   */
  onRankMove?: (
    columnKey: string,
    threadId: string,
    beforeId: string | null,
    toEnd: boolean,
    visibleIds: readonly string[],
  ) => void;
  /** Drop a card onto the Done column. */
  onDropDone: (threadId: string) => void;
  /** Drop a card onto the Unread column (Attention grouping only). */
  onDropUnread: (threadId: string) => void;
  /**
   * Drop a card onto the Pinned column. Optional because pinning is a state
   * change the caller may not wire: the column then stays a no-drop target,
   * exactly as before this prop existed.
   */
  onDropPinned?: (threadId: string) => void;
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
  onClosePane,
  rankStore,
  onRankMove,
  onDropDone,
  onDropUnread,
  onDropPinned,
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

  // When the thread pane opens (or is resized) the board container shrinks;
  // keep the open thread's card in view by scrolling it into the visible
  // horizontal range instead of letting the pane cover it.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The lane the active card currently sits in (a stable id string, not the
  // columns array identity). The effect re-fits when this changes — pin/
  // unpin, done, archive, and grouping changes all relocate the card to a
  // lane that can be offscreen — while mere data refreshes (same lane) never
  // yank the user's scroll.
  const activeCardLaneId = useMemo(() => {
    if (activeThreadId === null) return null;
    for (const column of columns) {
      if (column.threads.some((thread) => thread.id === activeThreadId)) {
        return column.id;
      }
    }
    return null;
  }, [columns, activeThreadId]);
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null || activeThreadId === null) return;
    const keepActiveCardInView = () => {
      const card = container.querySelector(`[data-thread-card="${CSS.escape(activeThreadId)}"]`);
      if (!(card instanceof HTMLElement)) return;
      const cardRect = card.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // Horizontal: the pane opening (or a drag resize) narrows the visible
      // range; slide the card back inside it.
      if (cardRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - cardRect.left;
      } else if (cardRect.right > containerRect.right) {
        container.scrollLeft += cardRect.right - containerRect.right;
      }
      // Vertical: a lane taller than the board scrolls its own list, and a
      // card that history just restored (deep link, back/forward — no click
      // preceded it) can sit below the fold. scrollIntoView would scroll
      // every ancestor including the host page, so adjust the lane list
      // directly, the same way the horizontal case does.
      const list = card.closest("[data-card-list]");
      if (list instanceof HTMLElement) {
        const listRect = list.getBoundingClientRect();
        if (cardRect.top < listRect.top) {
          list.scrollTop -= listRect.top - cardRect.top;
        } else if (cardRect.bottom > listRect.bottom) {
          list.scrollTop += cardRect.bottom - listRect.bottom;
        }
      }
    };
    keepActiveCardInView();
    // Pane opening and drag-resizing both change the container's width; the
    // observer re-runs the adjustment for each size change.
    const observer = new ResizeObserver(keepActiveCardInView);
    observer.observe(container);
    return () => observer.disconnect();
    // activeCardLaneId re-fits when the active card relocates (pin, done,
    // archive, grouping change) without firing on same-lane data refreshes.
  }, [activeThreadId, activeCardLaneId]);

  const sweepActive = sweepCandidatesFor !== undefined && onSweepArm !== undefined;
  // Clicking empty board area (anything that is not a card, control, or link)
  // while a thread is open closes the pane.
  const handleBackgroundClick = (event: MouseEvent) => {
    if (activeThreadId === null || onClosePane === undefined) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("[data-thread-card], button, a, input, textarea, select, [role='menu'], [role='menuitem']") !== null) return;
    onClosePane();
  };
  const ranking = rankStore !== undefined && onRankMove !== undefined;

  // Announce a completed move so a reorder is legible without sight of the
  // insertion line, which is the only feedback a screen reader would miss.
  const [announcement, setAnnouncement] = useState("");
  // A reorder that cannot complete says so ON SCREEN. A live region alone
  // leaves the sighted operator with a drag that silently does nothing, which
  // is exactly how the last version of this shipped.
  const [rankError, setRankError] = useState<string | null>(null);
  // Bumped on every refusal so the auto-dismiss timer restarts even when the
  // new message is identical to the old one — React would otherwise bail out
  // on the same string and let the stale clock cut the repeat refusal short.
  const [rankErrorSeq, setRankErrorSeq] = useState(0);

  // A refusal leaves the screen on its own after a while: the operator has
  // read it (or dismissed it), and a banner that outlives its drag reads as
  // a board that is still broken. Generous, because "fail loud" loses to
  // "vanish before it was read". The dismiss button clears the same state.
  useEffect(() => {
    if (rankError === null) return;
    const timer = setTimeout(() => setRankError(null), RANK_ERROR_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [rankError, rankErrorSeq]);

  // The card being dragged, captured at dragstart. Held here rather than read
  // from the payload because the payload is unreadable until the drop, and
  // dragover needs to know this to avoid drawing an insertion line on the
  // card under the cursor.
  const draggingIdRef = useRef<string | null>(null);

  function clearRankDrop(): void {
    setRankDrop(null);
  }

  /**
   * Report a reorder that cannot complete, naming the reason.
   *
   * A drop that quietly does nothing is indistinguishable from a board
   * ignoring the operator, which is precisely how this shipped twice: once
   * because dragover read a protected payload, and once because the drop could
   * not identify the card. Every early return names itself so one reproduction
   * says which one fired.
   */
  function reportRefusal(reason: string): void {
    setAnnouncement(`Reorder refused: ${reason}`);
    setRankError(`Reorder refused: ${reason}`);
    setRankErrorSeq((seq) => seq + 1);
  }

  function commitMove(
    column: BoardColumn,
    threadId: string,
    beforeId: string | null,
    toEnd: boolean,
    visibleIds: readonly string[],
  ): void {
    if (!ranking) {
      reportRefusal("card ordering is not available on this board.");
      return;
    }
    // Fail loud, on screen. An empty id means the drop could not identify the
    // dragged card; the move would otherwise be a silent no-op that looks
    // exactly like the board ignoring the operator.
    if (threadId === "") {
      reportRefusal(`could not identify the dragged card in ${column.label}.`);
      return;
    }
    setRankError(null);
    onRankMove?.(
      columnRankKey(groupBy, column.id),
      threadId,
      beforeId,
      toEnd,
      visibleIds,
    );
    // Report the resulting position from the order the move produces, not
    // from the anchor's old index: dropping onto a card's top half lands one
    // above where that card was, and the message must match the new board.
    // The DISPLAYED order, not the sparse stored one — a card that keeps its
    // rank below the drop point is still a card on the board.
    const after = displayAfterMove(visibleIds, threadId, beforeId, toEnd);
    setAnnouncement(
      `Moved to position ${after.indexOf(threadId) + 1} of ${after.length} in ${column.label}.`,
    );
  }
  // Done, Unread, and Pinned lanes accept state-change drops; Unread exists
  // as a column only in the Attention grouping, and Pinned only once a card
  // is in it. Pinned without a handler stays a plain no-drop lane: dropping
  // anywhere else then reads as the browser's no-drop cursor, not as the
  // board eating the gesture silently.
  const dropHandlerFor = (columnId: string): ((threadId: string) => void) | null => {
    if (columnId === "done") return onDropDone;
    if (columnId === "unread") return onDropUnread;
    if (columnId === "pinned") return onDropPinned ?? null;
    return null;
  };
  return (
    <div
      ref={scrollRef}
      onClick={handleBackgroundClick}
      className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3 pt-2"
    >
      {/* The insertion line is the only visual feedback a reorder gives, so
          a screen reader gets the same information in words. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {rankError !== null ? (
        <div
          role="status"
          data-testid="rank-error-banner"
          className="mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
        >
          <p className="min-w-0">{rankError}</p>
          <button
            type="button"
            onClick={() => setRankError(null)}
            aria-label="Dismiss error"
            title="Dismiss"
            className="shrink-0 rounded p-0.5 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline focus-visible:outline-1 focus-visible:outline-destructive"
          >
            <Icon name="X" className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}
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
                // Same-lane drag: the lane's own empty space accepts the drop
                // as an append, so the column must allow the event.
                if (ranking && isLaneDrag(event.dataTransfer.types, rankKey)) {
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
                const threadId = draggedIdFor(event, draggingIdRef.current);
                if (ranking && isLaneDrag(event.dataTransfer.types, rankKey)) {
                  // Released over the lane's empty space below the last card:
                  // append. A drop ON a card was already claimed by that
                  // card's own handler, which stops propagation.
                  event.preventDefault();
                  clearRankDrop();
                  if (threadId !== "") {
                    commitMove(
                      column,
                      threadId,
                      null,
                      true,
                      shownThreads.map((candidate) => candidate.id),
                    );
                  }
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
              <div
                data-card-list
                className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted/30 p-1.5"
              >
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
                            if (!ranking) return;
                            if (!isLaneDrag(event.dataTransfer.types, rankKey)) {
                              // A drag from ANOTHER lane. A lane that takes
                              // state-change drops accepts it positioned:
                              // the same insertion line a same-lane drag
                              // gets, and the drop both moves the card into
                              // this lane and ranks it at that edge in one
                              // gesture. Lanes without a state-change drop
                              // (derived columns such as Attention or the
                              // idle buckets) keep refusing: membership
                              // there is the thread's own data — state, age,
                              // project — not a slot the board can honour.
                              if (draggingIdRef.current === null || !isDropTarget) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              const rect = event.currentTarget.getBoundingClientRect();
                              const edge: Half =
                                event.clientY - rect.top < rect.height / 2 ? "before" : "after";
                              setRankDrop((current) =>
                                current?.columnId === column.id &&
                                current?.threadId === thread.id &&
                                current?.edge === edge
                                  ? current
                                  : { columnId: column.id, threadId: thread.id, edge },
                              );
                              return;
                            }
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const rect = event.currentTarget.getBoundingClientRect();
                            const edge: Half =
                              event.clientY - rect.top < rect.height / 2 ? "before" : "after";
                            if (draggingIdRef.current === thread.id) {
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
                            if (!isLaneDrag(event.dataTransfer.types, rankKey)) {
                              // A cross-lane drop ON a card: the state change
                              // and the ranked position the line showed happen
                              // in the one drop — no second drag to place the
                              // card after it lands. Guards mirror dragover
                              // above: only state-change lanes, only lane
                              // drags, or a foreign drag could write an order
                              // for a card the lane never held.
                              if (draggingIdRef.current === null || !isDropTarget) return;
                              const droppedId = draggedIdFor(event, draggingIdRef.current);
                              event.preventDefault();
                              // Claim the event so the column's own handler —
                              // the unpositioned state-change path — does not
                              // also fire for this drop.
                              event.stopPropagation();
                              // Live position, not React state, per the
                              // same-lane case below.
                              const rect = event.currentTarget.getBoundingClientRect();
                              const edge: Half =
                                event.clientY - rect.top < rect.height / 2 ? "before" : "after";
                              clearRankDrop();
                              if (droppedId === "") return;
                              // The state change first — the card joins the
                              // lane — then the ranked slot the line showed.
                              if (dropHandler !== null) dropHandler(droppedId);
                              const target = moveTargetFor(
                                shownThreads.map((candidate) => candidate.id),
                                thread.id,
                                edge,
                                droppedId,
                              );
                              if (target !== null) {
                                commitMove(
                                  column,
                                  droppedId,
                                  target.beforeId,
                                  target.toEnd,
                                  shownThreads.map((candidate) => candidate.id),
                                );
                              }
                              return;
                            }
                            event.preventDefault();
                            const threadId = draggedIdFor(event, draggingIdRef.current);
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
                            if (target === null) {
                              reportRefusal(
                                `the drop position in ${column.label} resolved to no move.`,
                              );
                              return;
                            }
                            commitMove(
                              column,
                              threadId,
                              target.beforeId,
                              target.toEnd,
                              shownThreads.map((candidate) => candidate.id),
                            );
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
                            const visibleIds = shownThreads.map((candidate) => candidate.id);
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
                            commitMove(column, thread.id, beforeId, beforeId === null, visibleIds);
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
                          doneIds={doneIds}
                          activeThreadId={activeThreadId}
                          dimmed={dimmedIds.has(thread.id)}
                          onOpen={() => onOpenThread(thread.id)}
                          onOpenThread={onOpenThread}
                          childMenuActions={menuActionsFor}
                          rankKey={ranking ? rankKey : undefined}
                          onRankDragStart={(id) => {
                            draggingIdRef.current = id;
                            // A drag that ends anywhere but a successful drop
                            // (Escape, a refused target) must not leave its
                            // insertion line on screen.
                            if (id === null) clearRankDrop();
                          }}
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