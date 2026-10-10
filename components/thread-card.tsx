import { type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { threadState, THREAD_STATE_LABELS } from "./grouping";
import { type TicketRef, resolveRepoSlug } from "@/lib/tickets";
import type { GitHubItemStatus } from "@/lib/tracker-status";

import { DRAG_ID_KEY, rankDragType } from "../lib/rank";
import { cardTicketRefs, type ThreadLink } from "../lib/link-metadata";
import { describeWakeAt } from "../lib/snooze";
import { ThreadCardMenu, type CardMenuAction } from "./thread-card-menu";

/**
 * The select-with-modifiers gesture on a sweep-mode card click, reduced to
 * what the board's semantics consume: Shift extends the selection from the
 * anchor through the clicked card; cmd/ctrl — and a plain click — toggle
 * just that one. Outside sweep mode modifiers mean browser navigation and
 * never reach here.
 */
export interface SweepClickGesture {
  shiftKey: boolean;
}

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
  /**
   * A confirmed sweep is archiving THIS card right now: a throbber on the
   * card while the highlight stays on, so a slow loop reads as progress,
   * not a frozen board.
   */
  isSweeping?: boolean;
  /**
   * Sweep mode is active in this card's column: clicks toggle the card in
   * or out of the sweep selection instead of opening the pane.
   */
  isSweepSelecting?: boolean;
  /**
   * In sweep mode but not selected: a quieter ring marks the card as
   * toggleable, distinct from the selected highlight.
   */
  isSweepSelectable?: boolean;
  /**
   * A sweep-mode card click, with the modifiers users select with: Shift
   * extends the selection from the anchor through this card, cmd/ctrl (and
   * a plain click) toggle just this one.
   */
  onSweepToggle?: (threadId: string, gesture: SweepClickGesture) => void;
  projectName: string;
  menuActions?: readonly CardMenuAction[];
  /** Children that render as nested rows beneath this card, in display order. */
  childThreads?: readonly PluginSidebarThread[];
  /**
   * The child-count chip's number: ALL visible children of this parent
   * (including ones rendering standalone), not just the nested rows.
   */
  childCount?: number;
  /** Reduced opacity for family members that did not match the filters. */
  dimmed?: boolean;
  /**
   * The lane this card's drag belongs to. Written into the drag type name so
   * the board can recognise a same-lane drag during `dragover`, which is the
   * only moment it can authorise the drop.
   */
  rankKey?: string;
  /**
   * Snooze wake lookup (lib/snooze): the wake epoch-ms for a snoozed thread,
   * null when it is not snoozed. A snoozed card dims in place, carries a
   * "Snoozed · wakes …" chip, and refuses drag so it cannot join the very
   * sweeps and lane moves its sleep is meant to skip. Applies to nested
   * child rows too, via the same lookup.
   */
  snoozeFor?: (threadId: string) => number | null;
  /** Reports the card a drag started on, so the board can hold it. */
  onRankDragStart?: (threadId: string | null) => void;
  onOpen: () => void;
  /** The currently open thread; a nested child row matching it is highlighted. */
  activeThreadId?: string | null;
  /** Open a (nested child) thread's pane. */
  onOpenThread?: (threadId: string) => void;
  /** Right-click menu actions for a nested child thread. */
  childMenuActions?: (thread: PluginSidebarThread) => readonly CardMenuAction[];
  /**
   * Controlled collapsed state for the nested rows: true hides the rows and
   * shows the collapsed "N child threads" summary in their place. Absent →
   * uncontrolled local state, so callers that do not persist still get a
   * working toggle.
   */
  isCollapsed?: boolean;
  /** Reports a collapse/expand gesture. Paired with `isCollapsed`. */
  onCollapsedChange?: (collapsed: boolean) => void;
  /** GitHub repo base for the thread's project, when it has one. */
  repoHrefBase?: string;
  /** GitHub cache status lookup (repo slug + number), when wired. */
  statusFor?: (repo: string | null, number: number | undefined) => GitHubItemStatus | undefined;
  /**
   * The board's own links for this thread (metadata key "linkedIssues"):
   * GitHub items a thread's text never names, from the link CLI / tool.
   * They join the chip row like text refs — see lib/link-metadata.ts.
   */
  linkedIssues?: ThreadLink[];
  /**
   * Hrefs the server's tracker_validate confirmed as existing (the chip
   * rule: a text ref chips only when something attached to the project can
   * validate it). Store links skip validation and always chip. Undefined =
   * caller not wired to validation → the pre-validation behavior (chips
   * render unfiltered), which keeps component-level previews sane.
   */
  validatedHrefs?: ReadonlySet<string>;
  // Ruler+wrap mini variant: fits the 136×92 context card grid.
  compact?: boolean;
}

/** Chip kind-glyph colors by live state, mirroring the card's own state language. */
const STATUS_ICON_CLASS: Record<string, string> = {
  OPEN: "text-emerald-500",
  MERGED: "text-purple-500",
  CLOSED: "text-muted-foreground/50",
};

/**
 * More nested child rows than this and the list caps its height and scrolls
 * instead of stretching the family card (and its whole lane) toward the sky.
 */
export const NESTED_ROWS_SCROLL_THRESHOLD = 5;

/**
 * Small clickable ticket chip; inert (span) when the ref has no href.
 *
 * Two glyphs lead the ref text: the source's provider mark (GitHub's own
 * octocat; a generic ticket mark when the source cannot be named — PROJ-123
 * keys carry no provider signal), then the issue-vs-PR glyph drawn with
 * GitHub's own octicon shapes (the same language GitHub.com and VS Code
 * use). The kind glyph doubles as the state signal once live status lands —
 * open emerald, merged purple, closed muted — absorbing the old bare state
 * dot.
 */
function TicketChip({
  ticket,
  status,
}: {
  ticket: TicketRef;
  status: GitHubItemStatus | undefined;
}) {
  // Non-GitHub trackers show the site's favicon (forgejo bases, external
  // links — each carries its hostname; bb's app shell sets no CSP header,
  // verified 2026-10-08, so the browser may load it directly). A failed or
  // blocked load collapses to the plain text chip.
  const [faviconFailed, setFaviconFailed] = useState(false);
  const favicon =
    ticket.hostname !== undefined && !faviconFailed ? (
      <img
        src={`https://${ticket.hostname}/favicon.ico`}
        alt=""
        loading="lazy"
        className="size-3 shrink-0 rounded-[2px]"
        onError={() => setFaviconFailed(true)}
      />
    ) : null;
  const className = cn(
    "inline-flex h-5 items-center gap-1 rounded bg-muted px-1 font-mono text-[10px] leading-none text-muted-foreground",
    ticket.href && "hover:bg-accent hover:text-foreground",
  );
  // Issue vs PR: live status is exact; before it lands (or for refs the
  // status cache never covers) fall back to what the raw text implies,
  // defaulting plain "#N" refs to the issue glyph — the glyph self-corrects
  // the moment status arrives.
  const kind = status?.kind === "pull" ? "pull" : (ticket.kind ?? "issue");
  const kindIconName =
    kind === "pull"
      ? (status?.state === "MERGED"
          ? "Merge"
          : status?.state === "CLOSED"
            ? "PullRequestClosed"
            : "PullRequest")
      : (status?.state === "CLOSED" ? "IssueClosed" : "IssueOpen");
  const isGithub = ticket.tracker === "github";
  const provider =
    isGithub ? (
      <Icon name="GithubMark" className="size-3 shrink-0" aria-hidden />
    ) : favicon ?? (
      <Icon name="Ticket" className="size-3 shrink-0" aria-hidden />
    );
  // Only GitHub-shaped refs carry the issue-vs-PR glyph; external items
  // name their own tracker in the favicon instead.
  const kindGlyph = isGithub ? (
    <Icon
      name={kindIconName}
      className={cn(
        "size-3 shrink-0",
        status === undefined ? undefined : (STATUS_ICON_CLASS[status.state] ?? "text-muted-foreground/30"),
      )}
      aria-label={status === undefined ? undefined : `${kind} ${status.state}`}
    />
  ) : null;
  const body = (
    <>
      {provider}
      {kindGlyph}
      {ticket.raw}
    </>
  );
  return ticket.href ? (
    <a
      href={ticket.href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={className}
      data-ticket-chip=""
    >
      {body}
    </a>
  ) : (
    <span className={className} data-ticket-chip="">
      {body}
    </span>
  );
}

function ChildRow({
  child,
  dimmed,
  isActive,
  onOpenThread,
  menuActions,
  snoozeFor,
  rankKey,
  onRankDragStart,
}: {
  child: PluginSidebarThread;
  /** A done child row dims, as does any child of a done parent. */
  dimmed?: boolean;
  /** The open thread's row gets the same active ring a standalone card gets. */
  isActive?: boolean;
  onOpenThread: (threadId: string) => void;
  menuActions?: readonly CardMenuAction[];
  /** Snooze wake lookup, for the row's little clock marker. */
  snoozeFor?: (threadId: string) => number | null;
  /** The parent slot's lane rides along so dropping the child on any lane's
   * floor (its own via the same type, another via the lane mismatch) can
   * read the gesture. */
  rankKey?: string;
  onRankDragStart?: (threadId: string | null) => void;
}) {
  const now = Date.now();
  const childSnoozeWakeAt = snoozeFor?.(child.id) ?? null;
  const childSnoozed = childSnoozeWakeAt !== null;
  const row = (
    <a
      href={child.href}
      data-thread-card={child.id}
      data-snoozed={childSnoozeWakeAt !== null ? "" : undefined}
      draggable={!childSnoozed}
      aria-current={isActive ? "true" : undefined}
      onDragStart={(event) => {
        // A snoozed child refuses drag (`draggable={!childSnoozed}` above);
        // the guard keeps the refusal true even where the attribute is not
        // enforced, so nothing can drag a sleeping card anywhere.
        if (childSnoozed) {
          event.preventDefault();
          return;
        }
        // The un-parent gesture: the child row is a drag source, so dropping
        // it on a column floor detaches it (board.tsx's floor handlers).
        event.dataTransfer.setData(DRAG_ID_KEY, child.id);
        if (rankKey !== undefined) {
          event.dataTransfer.setData(rankDragType(rankKey), "");
          onRankDragStart?.(child.id);
        }
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => onRankDragStart?.(null)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onOpenThread(child.id);
      }}
      className={cn(
        // Fat row: a compact card-like container — the full title wraps over
        // up to 2 lines (parent cards use line-clamp-2; children match). No
        // branch line, no project line. The whole row is the drag handle:
        // dragging it off a family card and releasing over a column floor
        // un-nests it.
        "block rounded-md border border-border/50 bg-muted/40 px-2 py-1.5 text-left",
        "transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "opacity-70 hover:opacity-100",
        child.isArchived && "saturate-50",
        dimmed && "opacity-50",
        childSnoozeWakeAt !== null && "saturate-50",
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
        {childSnoozeWakeAt !== null ? (
          <span
            data-snooze-chip
            title={`Wakes ${describeWakeAt(childSnoozeWakeAt, now)}`}
            className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground/80"
          >
            <Icon name="Clock" className="size-3" aria-hidden />
            snoozed
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
  isSweeping = false,
  isSweepSelecting = false,
  isSweepSelectable = false,
  onSweepToggle,
  projectName,
  repoHrefBase,
  statusFor,
  linkedIssues,
  validatedHrefs,
  menuActions,
  childThreads,
  childCount,
  dimmed,
  rankKey,
  onRankDragStart,
  snoozeFor,
  onOpen,
  activeThreadId,
  onOpenThread,
  childMenuActions,
  isCollapsed,
  onCollapsedChange,
  // Ruler+wrap mini cards: tighter padding and type, no ticket chips.
  compact = false,
}: ThreadCardProps) {
  const now = Date.now();
  // Controlled when `isCollapsed` is supplied (the app persists the set);
  // otherwise local state preserves the pre-persistence toggle behavior.
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = isCollapsed ?? localCollapsed;
  const toggleCollapsed = () => {
    if (isCollapsed === undefined) setLocalCollapsed(!collapsed);
    else onCollapsedChange?.(!collapsed);
  };
  const branch = thread.environment?.branchName ?? thread.host?.name ?? "";
  const repo = repoHrefBase === undefined ? null : resolveRepoSlug(repoHrefBase);
  // The chip row: text refs after the chip gate + the board's store links
  // (lib/link-metadata's cardTicketRefs). The toolbar search matches this
  // exact set (app.tsx), so a "#38" query finds every card with a #38 chip.
  const ticketRefs = cardTicketRefs({
    title: thread.displayTitle,
    branch,
    ...(repoHrefBase !== undefined ? { repoHrefBase } : {}),
    linkedIssues,
    ...(validatedHrefs !== undefined ? { validatedHrefs } : {}),
  });
  const children = childThreads ?? [];
  // The chip counts every visible child (prop from the raw family index);
  // fall back to the nested rows when the caller does not supply it.
  const chipCount = childCount ?? children.length;
  // The toggle only makes sense when there are rows to hide; the chip still
  // counts children that render standalone (promoted / cross-axis).
  const hasRows = children.length > 0;

  // The card's own attention: a pending interaction or an unread error. A
  // nested child can no longer be the cause — attention children un-nest
  // (nesting.ts `childPlacement`) and demand attention from their own card.
  const familyNeedsAttention = threadState(thread) === "attention";

  // Snoozed state: the wake epoch-ms (null when not snoozed) drives the dim,
  // the chip, and the drag refusal all at once — one rule, no drift.
  const snoozeWakeAt = snoozeFor?.(thread.id) ?? null;
  const snoozed = snoozeWakeAt !== null;

  // The card is a container; the anchor (title/body) and the collapse toggle
  // are siblings inside it — a button inside an anchor would be invalid HTML.
  const card = (
    <div
      data-thread-card={thread.id}
      data-sweep-highlighted={isSweepHighlighted ? "" : undefined}
      data-sweep-active={isSweeping ? "" : undefined}
      data-snoozed={snoozed ? "" : undefined}
      className={cn(
        "relative overflow-hidden rounded-md bg-card transition-colors",
        "hover:bg-accent/50",
        // A card with a child section needs bottom padding beyond the body's
        // own 8px: the rows (or the folded strip) would otherwise sit flush
        // against the card's bottom edge.
        hasRows && (collapsed || onOpenThread !== undefined) && "pb-3",
        isActive
          ? "ring-2 ring-ring"
          : "ring-1 ring-transparent hover:ring-border",
        isDone && "opacity-50 saturate-50",
        dimmed && "opacity-50",
        snoozed && "opacity-50",
        isSweepHighlighted &&
          "ring-2 ring-amber-500 bg-amber-500/10 saturate-100 opacity-100",
        isSweepSelectable && "ring-1 ring-amber-500/40",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-0.5",
          ACCENT_CLASS[threadState(thread)] ?? "bg-transparent",
        )}
        aria-hidden
      />
      {familyNeedsAttention ? (
        // A border, not a ring: the ring paints outside the box and this
        // overlay sits inside the card's overflow-hidden — only the border
        // lands on visible pixels. The pulse moves the overlay's opacity, not
        // the card's, so the title never blinks with it.
        <span
          data-attention-pulse=""
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md border-2 border-amber-500 bg-amber-500/5 motion-safe:animate-pulse"
        />
      ) : null}
      <div className="flex items-stretch">
        <a
          href={thread.href}
          aria-current={isActive ? "true" : undefined}
          draggable={!snoozed}
          onDragStart={(event) => {
            // A snoozed card refuses drag (`draggable={!snoozed}` above);
            // this guard keeps the refusal true even where the attribute
            // is not enforced, so nothing can drag a sleeping card into a
            // lane move its sleep is meant to skip.
            if (snoozed) {
              event.preventDefault();
              return;
            }
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
            // Sweep mode is modal: the click curates the selection, it never
            // navigates — not even modifier-clicks, which would otherwise
            // open a new window from the href. The board reads the gesture:
            // shift extends the range from the anchor, cmd/ctrl and plain
            // clicks toggle this one card.
            if (isSweepSelecting) {
              event.preventDefault();
              onSweepToggle?.(thread.id, { shiftKey: event.shiftKey });
              return;
            }
            // Let modified clicks (middle-click handled natively, cmd/ctrl new
            // window) pass through; the host also routes plain clicks on href.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onOpen();
          }}
          className={cn(
            "relative min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "px-2 py-1" : "px-3 py-2",
          )}
        >
          <div className="flex items-center gap-1.5 pl-1.5">
            {stateDot}
            {thread.isPinned ? (
              <Icon name="Pin" className="size-3 text-muted-foreground/70" aria-hidden />
            ) : null}
            {thread.hasPendingInteraction || familyNeedsAttention ? (
              <Icon
                name="MessageQuestion"
                className="size-3 text-amber-500"
                aria-label={
                  thread.hasPendingInteraction
                    ? (thread.indicatorLabel ?? "Needs your input")
                    : "A subthread needs your input"
                }
              />
            ) : null}
            {isSweeping ? (
              <span
                data-sweep-spinner
                title="Archiving…"
                aria-label="Archiving"
                className="inline-flex shrink-0"
              >
                <Icon
                  name="Spinner"
                  className="size-3 animate-spin text-amber-600"
                  aria-hidden
                />
              </span>
            ) : null}
            {snoozed ? (
              <span
                data-snooze-chip
                title={`Wakes ${describeWakeAt(snoozeWakeAt, now)}`}
                className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[10px] text-muted-foreground"
              >
                <Icon name="Clock" className="size-3" aria-hidden />
                {compact ? "" : `Snoozed · wakes ${describeWakeAt(snoozeWakeAt, now)}`}
              </span>
            ) : null}
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
              {relativeTime(thread.updatedAt, now)}
            </span>
          </div>
          <p className={cn("mt-0.5 line-clamp-2 pl-1.5 leading-snug", compact ? "text-[11px]" : "text-[13px]")}>{thread.displayTitle}</p>
          <p className="mt-0.5 truncate pl-1.5 text-[11px] text-muted-foreground/70">
            {projectName}
            {branch === "" ? null : <span className="text-muted-foreground/40"> · {branch}</span>}
          </p>
          {ticketRefs.length === 0 || compact ? null : (
            <div className="mt-1 flex flex-wrap gap-1 pl-1.5">
              {ticketRefs.map((ticket) => (
                <TicketChip key={ticket.raw} ticket={ticket} status={statusFor?.(repo, ticket.number)} />
              ))}
            </div>
          )}
        </a>
        {chipCount > 0 ? (
          // Family-size metadata only: the collapsed rows' dot strip lives in
          // the child section below, directly under the "N child threads"
          // label it describes.
          <div className="flex shrink-0 items-start py-2 pr-1.5">
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
              {chipCount}
            </span>
          </div>
        ) : null}
      </div>
      {hasRows && (collapsed || onOpenThread !== undefined) ? (
        <div className="ml-3 mt-1">
          {/* The section toggle: one control, in one place, on the boundary
              of the content it controls — directly above the rows when
              expanded, and the header of the collapsed dot strip when
              folded. Clicking it never reaches the card's anchor, the pane,
              or the background closer. */}
          <button
            type="button"
            data-child-threads-toggle=""
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand subthreads" : "Collapse subthreads"}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleCollapsed();
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-sm py-0.5 pr-1.5 text-[11px] text-muted-foreground/70",
              "transition-colors hover:bg-accent/60 hover:text-foreground",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Icon
              name={collapsed ? "ChevronRight" : "ChevronDown"}
              className="size-3 shrink-0"
              aria-hidden
            />
            {children.length} {children.length === 1 ? "child thread" : "child threads"}
          </button>
          {collapsed ? (
            // The collapsed rows, immediately below their label: one
            // status-colored dot per nested child, in display order. The
            // strip answers "are there children, and does any of them want
            // me?" at a glance without expanding; hovering a dot names its
            // child, clicking the strip re-opens the rows.
            <button
              type="button"
              data-child-thread-dots=""
              aria-label="Expand subthreads"
              title="Show the nested child threads"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleCollapsed();
              }}
              className={cn(
                "ml-[18px] flex max-w-full flex-wrap items-center gap-1 rounded-sm py-0.5 pr-1",
                "transition-colors hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {children.map((child) => {
                const state = threadState(child);
                return (
                  <span
                    key={child.id}
                    title={`${child.displayTitle} · ${THREAD_STATE_LABELS[state] ?? state}`}
                    className={cn(
                      "size-1.5 rounded-full",
                      DOT_CLASS[state] ?? "bg-muted-foreground/30",
                      state === "attention" && "motion-safe:animate-pulse",
                    )}
                  />
                );
              })}
            </button>
          ) : null}
          {!collapsed && onOpenThread !== undefined ? (
            <div
              data-nested-rows=""
              className={cn(
                "mt-1 border-l border-border/70 pl-2",
                // A big family scrolls its rows inside the card; a small one
                // renders at natural height.
                children.length > NESTED_ROWS_SCROLL_THRESHOLD && "max-h-64 overflow-y-auto",
              )}
            >
              <ul className="flex flex-col gap-1">
                {children.map((child) => {
                  const childDone = doneIds?.has(child.id) ?? false;
                  return (
                    <li key={child.id}>
                      <ChildRow
                        child={child}
                        dimmed={isDone || childDone}
                        isActive={child.id === activeThreadId}
                        onOpenThread={onOpenThread}
                        menuActions={childMenuActions?.(child)}
                        snoozeFor={snoozeFor}
                        rankKey={rankKey}
                        onRankDragStart={onRankDragStart}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
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