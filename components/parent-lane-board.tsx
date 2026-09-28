import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { ThreadCard } from "./thread-card";
import { ThreadCardMenu, type CardMenuAction } from "./thread-card-menu";
import { threadState } from "./grouping";
import { grandchildCountFor } from "./nesting";
import type { ParentLane, ParentLaneRow } from "./parent-lanes";

interface ParentLaneBoardProps {
  lanes: readonly ParentLane[];
  activeThreadId: string | null;
  doneIds: ReadonlySet<string>;
  /** Members of kept families that did not match the filters/search. */
  dimmedIds: ReadonlySet<string>;
  /** Raw parent → children map, used for the level-1 child +N chip. */
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  projectNameFor: (projectId: string) => string;
  repoBaseFor: (projectId: string) => string | null;
  statusFor?: (repo: string | null, number: number | undefined) =>
    | { kind: string; state: string }
    | undefined;
  onOpenThread: (threadId: string) => void;
  /** Close the open thread pane when the operator clicks empty board area. */
  onClosePane?: () => void;
  onNewTask: () => void;
  menuActionsFor: (thread: PluginSidebarThread) => readonly CardMenuAction[];
}

const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

function LaneStateDot({ thread }: { thread: PluginSidebarThread }) {
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

function ArchivedRider({
  child,
  dimmed,
  isActive,
  onOpenThread,
  menuActions,
}: {
  child: PluginSidebarThread;
  dimmed?: boolean;
  isActive?: boolean;
  onOpenThread: (threadId: string) => void;
  menuActions?: readonly CardMenuAction[];
}) {
  const anchor = (
    <a
      href={child.href}
      data-thread-card={child.id}
      draggable={false}
      aria-current={isActive ? "true" : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenThread(child.id);
      }}
      className={cn(
        "block rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-left",
        "transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "opacity-70 hover:opacity-100 saturate-50",
        dimmed && "opacity-50",
        isActive && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-center gap-1.5">
        <LaneStateDot thread={child} />
        <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
          <Icon name="Archive" className="size-3" aria-hidden />
          archived
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug">{child.displayTitle}</p>
    </a>
  );
  if (menuActions === undefined || menuActions.length === 0) return anchor;
  return (
    <ThreadCardMenu
      anchor={anchor}
      actions={menuActions}
      href={child.href}
      onOpen={() => onOpenThread(child.id)}
      title={child.displayTitle}
    />
  );
}

function LaneHeader({
  lane,
  doneIds,
  onOpenThread,
}: {
  lane: ParentLane;
  doneIds: ReadonlySet<string>;
  onOpenThread: (threadId: string) => void;
}) {
  const parent = lane.headerThread;
  const isDone = parent !== null && doneIds.has(parent.id);
  const content = (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1.5",
        parent !== null && "hover:bg-accent/50",
        isDone && "opacity-50 saturate-50",
      )}
    >
      {parent !== null ? <LaneStateDot thread={parent} /> : null}
      <span className="truncate text-[13px] font-medium leading-snug">{lane.label}</span>
      {lane.childCount > 0 ? (
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
          {lane.childCount}
        </span>
      ) : null}
    </div>
  );
  if (parent === null) return content;
  return (
    <button
      type="button"
      onClick={() => onOpenThread(parent.id)}
      className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${lane.label}`}
    >
      {content}
    </button>
  );
}

function LaneRow({
  row,
  doneIds,
  dimmedIds,
  childrenByParent,
  projectNameFor,
  repoBaseFor,
  statusFor,
  activeThreadId,
  onOpenThread,
  menuActionsFor,
}: {
  row: ParentLaneRow;
} & Omit<ParentLaneBoardProps, "lanes" | "onClosePane" | "onNewTask">) {
  return (
    <div className="min-h-24 border-b border-border/40 p-1.5 last:border-b-0">
      {row.threads.length === 0 ? null : (
        <ul className="flex flex-col gap-1.5">
          {row.threads.map((thread) => (
            <li key={thread.id}>
              <ThreadCard
                thread={thread}
                stateDot={<LaneStateDot thread={thread} />}
                isActive={thread.id === activeThreadId}
                isDone={doneIds.has(thread.id)}
                projectName={projectNameFor(thread.projectId)}
                repoHrefBase={repoBaseFor(thread.projectId) ?? undefined}
                statusFor={statusFor}
                menuActions={menuActionsFor(thread)}
                childCount={grandchildCountFor(thread, childrenByParent)}
                childrenByParent={childrenByParent}
                activeThreadId={activeThreadId}
                dimmed={dimmedIds.has(thread.id)}
                onOpen={() => onOpenThread(thread.id)}
                onOpenThread={onOpenThread}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ParentLaneBoard({
  lanes,
  activeThreadId,
  doneIds,
  dimmedIds,
  childrenByParent,
  projectNameFor,
  repoBaseFor,
  statusFor,
  onOpenThread,
  onClosePane,
  onNewTask,
  menuActionsFor,
}: ParentLaneBoardProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeLaneId = useMemo(() => {
    if (activeThreadId === null) return null;
    for (const lane of lanes) {
      if (lane.id === activeThreadId) return lane.id; // the parent header is the active thread
      for (const row of lane.rows) {
        if (row.threads.some((t) => t.id === activeThreadId)) return lane.id;
      }
      if (lane.archivedChildren.some((t) => t.id === activeThreadId)) return lane.id;
    }
    return null;
  }, [lanes, activeThreadId]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null || activeThreadId === null) return;
    const keepActiveLaneInView = () => {
      const laneEl = container.querySelector(`[data-lane-id="${CSS.escape(activeLaneId ?? "")}"]`);
      if (!(laneEl instanceof HTMLElement)) return;
      const laneRect = laneEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (laneRect.left < containerRect.left) {
        container.scrollLeft -= containerRect.left - laneRect.left;
      } else if (laneRect.right > containerRect.right) {
        container.scrollLeft += laneRect.right - containerRect.right;
      }
      // Also keep the active card vertically inside its lane if the lane is tall.
      const card = container.querySelector(`[data-thread-card="${CSS.escape(activeThreadId)}"]`);
      if (card instanceof HTMLElement) {
        const list = card.closest("[data-lane-rows]");
        if (list instanceof HTMLElement) {
          const cardRect = card.getBoundingClientRect();
          const listRect = list.getBoundingClientRect();
          if (cardRect.top < listRect.top) {
            list.scrollTop -= listRect.top - cardRect.top;
          } else if (cardRect.bottom > listRect.bottom) {
            list.scrollTop += cardRect.bottom - listRect.bottom;
          }
        }
      }
    };
    keepActiveLaneInView();
    const observer = new ResizeObserver(keepActiveLaneInView);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeThreadId, activeLaneId]);

  const handleBackgroundClick = (event: MouseEvent) => {
    if (activeThreadId === null || onClosePane === undefined) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      target.closest(
        "[data-thread-card], [data-lane-header], button, a, input, textarea, select, [role='menu'], [role='menuitem']",
      ) !== null
    )
      return;
    onClosePane();
  };

  if (lanes.length === 0) return null;
  const rowIds = lanes[0].rows.map((row) => row.id);
  const rowLabels = lanes[0].rows.map((row) => row.label);

  return (
    <div
      ref={scrollRef}
      onClick={handleBackgroundClick}
      className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-3 pb-3 pt-2"
    >
      <div className="flex h-full min-h-0 items-stretch gap-4">
        {/* Row rail: fixed left, labels aligned with each row cell. */}
        <div className="flex h-full w-28 shrink-0 flex-col">
          <div className="h-[52px] shrink-0" />
          <div data-lane-rows className="min-h-0 flex-1 overflow-hidden">
            {rowLabels.map((label, index) => (
              <div
                key={rowIds[index]}
                className="flex min-h-24 items-center border-b border-border/40 px-1 text-[11px] font-medium text-muted-foreground last:border-b-0"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
        {/* Lanes: scroll horizontally. */}
        <div className="flex h-full min-h-0 items-stretch gap-4">
          {lanes.map((lane) => (
            <section
              key={lane.id}
              data-lane-id={lane.id}
              aria-label={lane.label}
              className="flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg"
            >
              <div data-lane-header className="h-[52px] shrink-0 px-1 pb-1.5">
                <LaneHeader lane={lane} doneIds={doneIds} onOpenThread={onOpenThread} />
                {lane.archivedChildren.length > 0 ? (
                  <div className="mt-1 flex flex-col gap-1">
                    {lane.archivedChildren.map((child) => (
                      <ArchivedRider
                        key={child.id}
                        child={child}
                        dimmed={dimmedIds.has(child.id)}
                        isActive={child.id === activeThreadId}
                        onOpenThread={onOpenThread}
                        menuActions={menuActionsFor(child)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <div
                data-lane-rows
                className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted/30 p-1"
              >
                {lane.rows.map((row) => (
                  <LaneRow
                    key={row.id}
                    row={row}
                    doneIds={doneIds}
                    dimmedIds={dimmedIds}
                    childrenByParent={childrenByParent}
                    projectNameFor={projectNameFor}
                    repoBaseFor={repoBaseFor}
                    statusFor={statusFor}
                    activeThreadId={activeThreadId}
                    onOpenThread={onOpenThread}
                    menuActionsFor={menuActionsFor}
                  />
                ))}
              </div>
            </section>
          ))}
          {/* New-task affordance mirrors the Working column's button. */}
          <div className="flex h-full w-64 shrink-0 flex-col rounded-lg">
            <div className="h-[52px] shrink-0 px-1 pb-1.5" />
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
          </div>
        </div>
      </div>
    </div>
  );
}
