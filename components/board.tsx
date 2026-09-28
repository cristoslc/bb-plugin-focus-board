import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn } from "./grouping";
import { threadState, withSweepGather } from "./grouping";
import { sweepColumnKind, type ArmedSweep } from "../lib/sweep";
import { ThreadCard } from "./thread-card";
import type { CardMenuAction } from "./thread-card-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface BoardProps {
  columns: readonly BoardColumn[];
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
  // When the thread pane opens (or is resized) the board container shrinks;
  // keep the open thread's card in view by scrolling it into the visible
  // horizontal range instead of letting the pane cover it.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null || activeThreadId === null) return;
    const keepActiveCardInView = () => {
      const card = container.querySelector(`[data-thread-card="${CSS.escape(activeThreadId)}"]`);
      if (!(card instanceof HTMLElement)) return;
      const cardRect = card.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // Adjust only horizontally; vertical card lists manage their own scroll.
      if (cardRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - cardRect.left;
      } else if (cardRect.right > containerRect.right) {
        container.scrollLeft += cardRect.right - containerRect.right;
      }
    };
    keepActiveCardInView();
    // Pane opening and drag-resizing both change the container's width; the
    // observer re-runs the adjustment for each size change.
    const observer = new ResizeObserver(keepActiveCardInView);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeThreadId]);
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
  // Only the Done and Unread lanes accept drops; Unread exists as a column
  // only in the Attention grouping.
  const dropHandlerFor = (columnId: string): ((threadId: string) => void) | null => {
    if (columnId === "done") return onDropDone;
    if (columnId === "unread") return onDropUnread;
    return null;
  };
  return (
    <div ref={scrollRef} onClick={handleBackgroundClick} className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3 pt-2">
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
          return (
            <section
              key={column.id}
              aria-label={`${column.label}, ${column.threads.length} threads`}
              onDragOver={
                isDropTarget
                  ? (event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverColumn(column.id);
                    }
                  : undefined
              }
              onDragLeave={isDropTarget ? () => setDragOverColumn((c) => (c === column.id ? null : c)) : undefined}
              onDrop={
                isDropTarget
                  ? (event) => {
                      event.preventDefault();
                      setDragOverColumn(null);
                      const threadId = event.dataTransfer.getData("text/focus-board-id");
                      if (threadId !== "") dropHandler(threadId);
                    }
                  : undefined
              }
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
                      <li key={thread.id}>
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