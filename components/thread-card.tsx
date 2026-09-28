import { type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { threadState } from "./grouping";
import { findTicketRefs, resolveRepoSlug, type TicketRef } from "@/lib/tickets";
import type { GitHubItemStatus } from "@/lib/tracker-status";
import { grandchildCountFor } from "./nesting";
import { rankDragType } from "../lib/rank";
import { ThreadCardMenu, type CardMenuAction } from "./thread-card-menu";

function relativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ACCENT_CLASS: Record<string, string> = {
  working: "bg-blue-500/70",
  attention: "bg-amber-500/80",
  unread: "bg-emerald-500/70",
  idle: "bg-transparent",
};

const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

interface ThreadCardProps {
  thread: PluginSidebarThread;
  stateDot: ReactNode;
  isActive: boolean;
  isDone: boolean;
  /** Done ids; a done nested child (or a done parent's family) renders dimmed. */
  doneIds?: ReadonlySet<string>;
  /** Highlighted because a sweep armed in this column captured the card. */
  isSweepHighlighted?: boolean;
  projectName: string;
  menuActions?: readonly CardMenuAction[];
  /** Children that render as nested rows beneath this card, in display order. */
  childThreads?: readonly PluginSidebarThread[];
  /**
   * The child-count chip's number: ALL visible children of this parent
   * (including ones rendering standalone), not just the nested rows.
   */
  childCount?: number;
  /** Parent id → nested children; used for the per-child `+N more` count. */
  childrenByParent?: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Reduced opacity for family members that did not match the filters. */
  dimmed?: boolean;
  /**
   * The lane this card's drag belongs to. Written into the drag type name so
   * the board can recognise a same-lane drag during `dragover`, which is the
   * only moment it can authorise the drop.
   */
  rankKey?: string;
  /** Reports the card a drag started on, so the board can hold it. */
  onRankDragStart?: (threadId: string | null) => void;
  onOpen: () => void;
  /** The currently open thread; a nested child row matching it is highlighted. */
  activeThreadId?: string | null;
  /** Open a (nested child) thread's pane. */
  onOpenThread?: (threadId: string) => void;
  /** Right-click menu actions for a nested child thread. */
  childMenuActions?: (thread: PluginSidebarThread) => readonly CardMenuAction[];
  /** GitHub repo base for the thread's project, when it has one. */
  repoHrefBase?: string;
  /** GitHub cache status lookup (repo slug + number), when wired. */
  statusFor?: (repo: string | null, number: number | undefined) => GitHubItemStatus | undefined;
}

/** Chip state-dot colors, mirroring the card's own state language. */
const STATUS_DOT_CLASS: Record<string, string> = {
  OPEN: "bg-emerald-500",
  MERGED: "bg-purple-500",
  CLOSED: "bg-muted-foreground/50",
};

/** Small clickable ticket chip; inert (span) when the ref has no href. */
function TicketChip({
  ticket,
  status,
}: {
  ticket: TicketRef;
  status: GitHubItemStatus | undefined;
}) {
  const className = cn(
    "inline-flex h-4 items-center gap-1 rounded bg-muted px-1 font-mono text-[10px] leading-none text-muted-foreground",
    ticket.href && "hover:bg-accent hover:text-foreground",
  );
  const dot =
    status === undefined ? null : (
      <span
        className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT_CLASS[status.state] ?? "bg-muted-foreground/30")}
        aria-label={`${status.kind} ${status.state}`}
      />
    );
  return ticket.href ? (
    <a
      href={ticket.href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={className}
    >
      {dot}
      {ticket.raw}
    </a>
  ) : (
    <span className={className}>
      {dot}
      {ticket.raw}
    </span>
  );
}

function ChildRow({
  child,
  dimmed,
  isActive,
  onOpenThread,
  menuActions,
}: {
  child: PluginSidebarThread;
  /** A done child row dims, as does any child of a done parent. */
  dimmed?: boolean;
  /** The open thread's row gets the same active ring a standalone card gets. */
  isActive?: boolean;
  onOpenThread: (threadId: string) => void;
  menuActions?: readonly CardMenuAction[];
}) {
  const now = Date.now();
  const row = (
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
        // Fat row: a compact card-like container — the full title wraps over
        // up to 2 lines (parent cards use line-clamp-2; children match). No
        // branch line, no project line, no drag handle: children stay
        // visually subordinate to parent cards.
        "block rounded-md border border-border/50 bg-muted/40 px-2 py-1.5 text-left",
        "transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "opacity-70 hover:opacity-100",
        child.isArchived && "saturate-50",
        dimmed && "opacity-50",
        isActive && "ring-2 ring-ring",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block size-1.5 shrink-0 rounded-full",
            DOT_CLASS[threadState(child)] ?? "bg-muted-foreground/30",
          )}
          aria-hidden
        />
        {child.isArchived ? (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
            <Icon name="Archive" className="size-3" aria-hidden />
            archived
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
          {relativeTime(child.updatedAt, now)}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug">{child.displayTitle}</p>
    </a>
  );
  if (menuActions === undefined) return row;
  return (
    <ThreadCardMenu
      anchor={row}
      actions={menuActions}
      href={child.href}
      onOpen={() => onOpenThread(child.id)}
      title={child.displayTitle}
    />
  );
}

export function ThreadCard({
  thread,
  stateDot,
  isActive,
  isDone,
  doneIds,
  isSweepHighlighted = false,
  projectName,
  repoHrefBase,
  statusFor,
  menuActions,
  childThreads,
  childCount,
  childrenByParent,
  dimmed,
  rankKey,
  onRankDragStart,
  onOpen,
  activeThreadId,
  onOpenThread,
  childMenuActions,
}: ThreadCardProps) {
  const now = Date.now();
  const [collapsed, setCollapsed] = useState(false);
  const branch = thread.environment?.branchName ?? thread.host?.name ?? "";
  const repo = repoHrefBase === undefined ? null : resolveRepoSlug(repoHrefBase);
  const ticketRefs = findTicketRefs(thread.displayTitle, {
    extraText: branch,
    repoHrefBase,
  });
  const children = childThreads ?? [];
  // The chip counts every visible child (prop from the raw family index);
  // fall back to the nested rows when the caller does not supply it.
  const chipCount = childCount ?? children.length;
  // The toggle only makes sense when there are rows to hide; the chip still
  // counts children that render standalone (promoted / cross-axis).
  const hasRows = children.length > 0;

  // The card is a container; the anchor (title/body) and the collapse toggle
  // are siblings inside it — a button inside an anchor would be invalid HTML.
  const card = (
    <div
      data-thread-card={thread.id}
      className={cn(
        "relative overflow-hidden rounded-md bg-card transition-colors",
        "hover:bg-accent/50",
        isActive
          ? "ring-2 ring-ring"
          : "ring-1 ring-transparent hover:ring-border",
        isDone && "opacity-50 saturate-50",
        dimmed && "opacity-50",
        isSweepHighlighted &&
          "ring-2 ring-amber-500 bg-amber-500/10 saturate-100 opacity-100",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-0.5",
          ACCENT_CLASS[threadState(thread)] ?? "bg-transparent",
        )}
        aria-hidden
      />
      <div className="flex items-stretch">
        <a
          href={thread.href}
          aria-current={isActive ? "true" : undefined}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/focus-board-id", thread.id);
            if (rankKey !== undefined) {
              // The lane rides in the drag TYPE, not a payload value: the
              // payload is unreadable until the drop, and dragover is
              // exactly when the drop has to be authorised.
              event.dataTransfer.setData(rankDragType(rankKey), "");
              onRankDragStart?.(thread.id);
            }
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => onRankDragStart?.(null)}
          onClick={(event) => {
            // Let modified clicks (middle-click handled natively, cmd/ctrl new
            // window) pass through; the host also routes plain clicks on href.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpen();
          }}
          className="relative min-w-0 flex-1 px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-1.5 pl-1.5">
            {stateDot}
            {thread.isPinned ? (
              <Icon name="Pin" className="size-3 text-muted-foreground/70" aria-hidden />
            ) : null}
            {thread.hasPendingInteraction ? (
              <Icon
                name="MessageQuestion"
                className="size-3 text-amber-500"
                aria-label={thread.indicatorLabel ?? "Needs your input"}
              />
            ) : null}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
              {relativeTime(thread.updatedAt, now)}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-2 pl-1.5 text-[13px] leading-snug">{thread.displayTitle}</p>
          <p className="mt-0.5 truncate pl-1.5 text-[11px] text-muted-foreground/70">
            {projectName}
            {branch === "" ? null : <span className="text-muted-foreground/40"> · {branch}</span>}
          </p>
          {ticketRefs.length === 0 ? null : (
            <div className="mt-1 flex flex-wrap gap-1 pl-1.5">
              {ticketRefs.map((ticket) => (
                <TicketChip key={ticket.raw} ticket={ticket} status={statusFor?.(repo, ticket.number)} />
              ))}
            </div>
          )}
        </a>
        {chipCount > 0 ? (
          <div className="flex shrink-0 items-start gap-0.5 py-2 pr-1.5">
            {hasRows ? (
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-label={collapsed ? "Expand subthreads" : "Collapse subthreads"}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCollapsed((value) => !value);
                }}
                className={cn(
                  "flex items-center gap-0.5 rounded-sm text-muted-foreground/70",
                  "transition-colors hover:bg-accent hover:text-foreground",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <Icon
                  name={collapsed ? "ChevronRight" : "ChevronDown"}
                  className="size-3"
                  aria-hidden
                />
              </button>
            ) : null}
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {chipCount}
            </span>
          </div>
        ) : null}
      </div>
      {hasRows && !collapsed && onOpenThread !== undefined ? (
        <div className="ml-3 mt-1 border-l border-border/70 pl-2">
          <ul className="flex flex-col gap-1">
            {children.map((child) => {
              const childDone = doneIds?.has(child.id) ?? false;
              const grandchildCount = grandchildCountFor(child, childrenByParent ?? new Map());
              return (
                <li key={child.id}>
                  <ChildRow
                    child={child}
                    dimmed={isDone || childDone}
                    isActive={child.id === activeThreadId}
                    onOpenThread={onOpenThread}
                    menuActions={childMenuActions?.(child)}
                  />
                  {grandchildCount > 0 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpenThread(child.id);
                      }}
                      className={cn(
                        "ml-1.5 flex items-center rounded-sm px-1.5 py-0.5 text-left text-[10px] text-muted-foreground/70",
                        "transition-colors hover:bg-accent/50 hover:text-foreground",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      )}
                    >
                      +{grandchildCount} more
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
  if (menuActions === undefined) return card;
  return (
    <ThreadCardMenu
      anchor={card}
      actions={menuActions}
      href={thread.href}
      onOpen={onOpen}
      title={thread.displayTitle}
    />
  );
}