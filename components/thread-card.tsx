import { isValidElement, memo, type DragEvent, type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { threadState, THREAD_STATE_LABELS } from "./grouping";
import { resolveRepoSlug, type TicketRef } from "@/lib/tickets";
import {
  ticketChipRows,
  ticketChipIconHref,
  ticketChipIdText,
  ticketStatusRepo,
  type TicketChip,
  type TicketChipRow,
} from "@/lib/ticket-chips";
import type { GitHubItemStatus } from "@/lib/tracker-status";

import { DRAG_ID_KEY, childRankKey, rankDragType } from "../lib/rank";
import { cardTicketRefs, type ThreadLink } from "../lib/link-metadata";
import { describeWakeAt } from "../lib/snooze";
import { deriveCardStatus } from "./card-status";
import { ThreadCardMenu, type CardMenuAction } from "./thread-card-menu";
import { useWallpaperActive } from "./wallpaper-contrast";

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

export interface ThreadCardProps {
  thread: PluginSidebarThread;
  stateDot: ReactNode;
  isActive: boolean;
  isDone: boolean;
  /** Done ids; a done nested child (or a done parent's family) renders dimmed. */
  doneIds?: ReadonlySet<string>;
  /**
   * Clear-error acknowledgment ids (issue #157): an acked error arm reads
   * quiet — the card's accent, its dot and its nested child dots alike, so
   * an acknowledged card settles out of Needs you and the family strip
   * stops pulsing for it.
   */
  errorAckIds?: ReadonlySet<string>;
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
  /**
   * The title-row checkbox's write, wired both ways: the "done" menu
   * action's run, which marks a not-done thread done and a done thread not
   * done (the card mirrors: an empty box on not-done cards, a checked one
   * on done). The first click arms, the second fires this. Absent → no
   * checkbox renders (unwired surfaces: compact context minis). The board
   * passes the menu action's run, so the checkbox shares the menu's full
   * done recipe with no second source of truth.
   */
  onMarkDone?: () => void;
  projectName: string;
  menuActions?: readonly CardMenuAction[];
  /** Children that render as nested rows beneath this card, in display order. */
  childThreads?: readonly PluginSidebarThread[];
  /**
   * The sub-row tier: parent id → that parent's nested children, for the
   * rows themselves (a child row nests its own children as sub-rows — issue
   * #120). The same map the board passes for the card tier, so a child row
   * and a standalone card draw from one source; absent → rows render childless.
   */
  grandchildThreadsByParent?: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /**
   * The same-family nested-row reorder gesture (the board owns every
   * decision — target, guard, write). Wired only when the rows can actually
   * reorder: ranking on, the write available, and the family renders more
   * than one row. Absent → the rows keep their plain drag-out behavior.
   */
  childRankDrag?: {
    onDragOver: (hoverChildId: string, event: DragEvent) => void;
    onDrop: (hoverChildId: string, event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    /** The row currently carrying the insertion line, and its half. */
    line?: { childId: string; zone: "before" | "after" };
  };
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
  /**
   * The dissolve slot's old-lane copy of the card (a transport ghost): the
   * slot li is already aria-hidden and inert, so the anchor never reports
   * `aria-current` either — the live card owns the marker. A ghost that
   * claims current makes the board's active-card locator resolve DOM-first
   * in the OLD lane, and once the destination scroll moves that lane
   * offscreen the marker reads a card that is not where the board followed
   * (issue #105). Decorative marking only: the active ring and slot visuals
   * are untouched.
   */
  isTransportGhost?: boolean;
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
  /**
   * Controlled idle-children filter: true hides the family's idle children in
   * BOTH views — the nested rows and the collapsed dot strip. Absent →
   * uncontrolled local state, so callers that do not persist still get a
   * working toggle (the same fallback as the fold above).
   */
  hideIdleChildren?: boolean;
  /** Reports an idle-filter gesture. Paired with `hideIdleChildren`. */
  onHideIdleChildrenChange?: (hide: boolean) => void;
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
  /**
   * Attention reporting (components/attention-freeze): the caller captures
   * the card's rendered placement when the pointer enters it and releases
   * the pin on leave — the freeze that keeps an attended card from moving.
   * Nested child rows report too, with their own id.
   */
  onAttentionEnter?: (threadId: string) => void;
  onAttentionLeave?: (threadId: string) => void;
}

/** Glyph shapes' colors: open is the one colored state; merged and closed read plain. */
const STATUS_ICON_CLASS: Record<string, string> = {
  OPEN: "text-emerald-500",
  CLOSED: "text-muted-foreground/50",
};

/**
 * More nested child rows than this and the list caps its height and scrolls
 * instead of stretching the family card (and its whole lane) toward the sky.
 */
export const NESTED_ROWS_SCROLL_THRESHOLD = 5;

/**
 * The card spotlight (issue #123): while ONE card is under the pointer, the
 * other cards recede a step and the hovered one never does. The rule is
 * hand-written and injected once by components/card-spotlight.ts — one block,
 * one exemption list (the hovered card, plus the `data-spotlight-immune`
 * marker components/card-status.ts computes). Pure CSS; the card just wears
 * the marker.
 */
/** The hovered card's surface, one source of truth: the card token mixed
 *  toward BLACK — an OPAQUE surface DARKER than the rest state in both themes
 *  (issue #123 and its follow-up). `accent` was the first cut: it reads
 *  ink-ward, so on the dark canvas it LIGHTENED the hovered card (27.5% over
 *  19.5%), the opposite of the prominence the operator asked for. The 80%
 *  share is the "a bit darker" step; the ring hover emphasis rides along. */
export const HOVER_SURFACE =
  "hover:bg-[color-mix(in_oklab,var(--card)_80%,black)]";

/**
 * One provider-grouped chip (lib/ticket-chips.ts): all the provider's IDs of
 * one kind (issue or pull) inside a single chip shell — the provider mark
 * leading, the kind glyph naming the chip's kind, then one link per ID.
 *
 * The mark links to that kind's list page: the repo's filtered page where
 * the group's base is known, GitHub's own global page otherwise; an unknown
 * external tracker's mark stays inert. Each ID keeps its own href, and the
 * kind glyph carries the state color — read from the group's primary (first)
 * ref's status — while ID text stays neutral and each ID's state survives on
 * its hover title. The chip's id flow wraps, so a long ID list reflows onto
 * extra lines instead of overflowing the card.
 */
function ProviderTicketChip({
  row,
  chip,
  statusFor,
  projectRepo,
}: {
  row: TicketChipRow;
  chip: TicketChip;
  statusFor?: (repo: string | null, number: number | undefined) => GitHubItemStatus | undefined;
  projectRepo: string | null;
}) {
  // External providers show the site's favicon (forgejo bases, external
  // links — each carries its hostname; bb's app shell sets no CSP header,
  // verified 2026-10-08, so the browser may load it directly). A failed or
  // blocked load collapses to the plain text chip.
  const [faviconFailed, setFaviconFailed] = useState(false);
  const isGithub = row.provider === "github";
  const markHref = ticketChipIconHref(row, chip.kind);
  // The ids' vertical anchor: a chip whose ids all fit one line centers its
  // content vertically (the shell's min-height would otherwise leave the
  // mark, glyph, and ids hugging the top); a many-id chip keeps them
  // top-anchored so the mark and glyph stay pinned at the top-left corner
  // beside the first id line. The ref count stands in for "fits one line"
  // — short ids do for three or fewer; very long external labels that wrap
  // stay centered, a harmless cosmetic drift.
  const singleRow = chip.refs.length <= 3;
  const className = cn(
    "inline-flex min-h-5 gap-x-1 rounded bg-muted px-1 py-0.5 font-mono text-[10px] leading-none text-muted-foreground",
    singleRow ? "items-center" : "items-start",
  );
  const mark =
    isGithub ? (
      <Icon name="GithubMark" className="size-3 shrink-0" aria-hidden />
    ) : row.hostname !== undefined && !faviconFailed ? (
      <img
        src={`https://${row.hostname}/favicon.ico`}
        alt=""
        loading="lazy"
        className="size-3 shrink-0 rounded-[2px]"
        onError={() => setFaviconFailed(true)}
      />
    ) : (
      <Icon name="Ticket" className="size-3 shrink-0" aria-hidden />
    );
  const markElement = markHref ? (
    <a
      href={markHref}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={chip.kind === "pull" ? "Pull requests list" : "Issues list"}
      className="inline-flex shrink-0"
      data-ticket-chip-mark=""
    >
      {mark}
    </a>
  ) : (
    <span className="inline-flex shrink-0" data-ticket-chip-mark="">
      {mark}
    </span>
  );
  // The kind glyph self-corrects the moment status arrives: the primary
  // ref's live state names it (merged PR → merge glyph, closed → closed
  // glyph), defaulting to the open shapes before status lands. Status kind
  // overrides the chip's structural kind too — a kindless "#N" that turns
  // out to be a merged PR swaps to the pull shapes.
  const primary = chip.refs[0];
  const primaryStatus =
    isGithub && primary !== undefined
      ? statusFor?.(ticketStatusRepo(primary, projectRepo), primary.number)
      : undefined;
  const kind = primaryStatus?.kind === "pull" ? "pull" : chip.kind;
  const kindGlyph = isGithub ? (
    <Icon
      name={
        kind === "pull"
          ? (primaryStatus?.state === "MERGED"
              ? "Merge"
              : primaryStatus?.state === "CLOSED"
                ? "PullRequestClosed"
                : "PullRequest")
          : (primaryStatus?.state === "CLOSED" ? "IssueClosed" : "IssueOpen")
      }
      className={cn(
        "size-3 shrink-0",
        primaryStatus === undefined
          ? undefined
          : STATUS_ICON_CLASS[primaryStatus.state],
      )}
      aria-label={primaryStatus === undefined ? undefined : `${kind} ${primaryStatus.state}`}
    />
  ) : null;
  // External items name their own tracker in the favicon and carry no
  // GitHub kind glyph.
  const ids = chip.refs.map((ref, index) => {
    // The kind glyph keeps the state shape (and open's emerald); merged and
    // closed glyphs and all id text read plain. A merged id dims grey and
    // strikes through so it reads as done, with no color on hover. Each id
    // enlarges on hover by transform — never a layout change, so no id ever
    // bumps a neighbor.
    const status =
      isGithub && ref.number !== undefined
        ? statusFor?.(ticketStatusRepo(ref, projectRepo), ref.number)
        : undefined;
    const title = status === undefined ? undefined : `${status.kind} ${status.state}`;
    const text = ticketChipIdText(ref);
    // The bubble repeats the id above the cell — a native title tooltip
    // draws under the pointer and gets hidden by it, so the id gets its own
    // bubble that the cursor cannot cover. The hover title keeps its state
    // role; the id itself rides an aria-label for keyboard and screen
    // readers.
    const cell = "group/id relative inline-flex origin-left transition-transform hover:scale-110";
    const bubble = (
      <span
        data-ticket-tip=""
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 font-mono text-[10px] leading-none text-popover-foreground shadow-md group-hover/id:block"
      >
        {text}
      </span>
    );
    const body = (
      <span className={status?.state === "MERGED" ? "line-through opacity-60" : undefined}>
        {text}
      </span>
    );
    return ref.href === undefined ? (
      <span key={index} title={title} aria-label={text} className={cell}>
        {body}
        {bubble}
      </span>
    ) : (
      <a
        key={index}
        href={ref.href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        title={title}
        aria-label={text}
        className={cell}
        data-ticket-id={text}
      >
        {body}
        {bubble}
      </a>
    );
  });
  return (
    <span className={className} data-ticket-chip="">
      {markElement}
      {kindGlyph}
      {/* The ids sit in a wrapping flex flow: no fixed tracks, so a short
          list reserves no phantom width (the empty-column-gap trap of the
          old three-track grid) and a long list of wide external labels
          wraps onto extra lines instead of overflowing the card. min-w-0
          lets the shell shrink with the row so this flow, not the shell,
          does the wrapping; the mark and glyph never join the id flow. */}
      <span data-ticket-ids className="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
        {ids}
      </span>
    </span>
  );
}

function ChildRow({
  child,
  dimmed,
  errorAcks = new Set<string>(),
  isActive,
  isTransportGhost = false,
  onOpenThread,
  menuActions,
  snoozeFor,
  rankKey,
  onRankDragStart,
  rankDrag,
  onAttentionEnter,
  onAttentionLeave,
}: {
  child: PluginSidebarThread;
  /** A done child row dims, as does any child of a done parent. */
  dimmed?: boolean;
  /** Clear-error acknowledgment ids (issue #157): an acked error row dot sits quiet. */
  errorAcks?: ReadonlySet<string>;
  /** The open thread's row gets the same active ring a standalone card gets. */
  isActive?: boolean;
  /** The dissolve slot's old-lane copy: never reports aria-current (see ThreadCard's contract). */
  isTransportGhost?: boolean;
  onOpenThread: (threadId: string) => void;
  menuActions?: readonly CardMenuAction[];
  /** Snooze wake lookup, for the row's little clock marker. */
  snoozeFor?: (threadId: string) => number | null;
  /** The parent slot's lane rides along so dropping the child on any lane's
   * floor (its own via the same type, another via the lane mismatch) can
   * read the gesture. */
  rankKey?: string;
  onRankDragStart?: (threadId: string | null) => void;
  /**
   * The same-family reorder gesture from the board (targeting, guards, and
   * the write all live there). Only the row's events and its insertion line
   * live here. Absent → the row stays a drag SOURCE only.
   */
  rankDrag?: {
    onDragOver: (hoverChildId: string, event: DragEvent) => void;
    onDrop: (hoverChildId: string, event: DragEvent) => void;
    onDragLeave: (event: DragEvent) => void;
    line?: { childId: string; zone: "before" | "after" };
  };
  /** Attention reporting for the row itself (nested rows pin their slots). */
  onAttentionEnter?: (threadId: string) => void;
  onAttentionLeave?: (threadId: string) => void;
}) {
  const now = Date.now();
  const childSnoozeWakeAt = snoozeFor?.(child.id) ?? null;
  const childSnoozed = childSnoozeWakeAt !== null;
  // This row's insertion line (the same-family reorder promise): "before"
  // draws above the row, "after" below — the same affordance card slots get.
  const rowLine =
    rankDrag?.line?.childId === child.id ? (rankDrag.line ? rankDrag.line.zone : undefined) : undefined;
  const row = (
    <a
      href={child.href}
      data-thread-card={child.id}
      data-snoozed={childSnoozeWakeAt !== null ? "" : undefined}
      draggable={!childSnoozed}
      onMouseEnter={onAttentionEnter === undefined ? undefined : () => onAttentionEnter(child.id)}
      onMouseOut={
        onAttentionLeave === undefined
          ? undefined
          : (event) => {
              const from = event.relatedTarget;
              if (from instanceof Node && event.currentTarget.contains(from)) return;
              onAttentionLeave(child.id);
            }
      }
      onDragOver={
        rankDrag === undefined
          ? undefined
          : (event) => rankDrag.onDragOver(child.id, event)
      }
      onDrop={
        rankDrag === undefined ? undefined : (event) => rankDrag.onDrop(child.id, event)
      }
      onDragLeave={(event) => {
        // The line dies only when the pointer truly leaves the row —
        // crossing a span inside it must not flicker the promise away.
        const into = event.relatedTarget;
        if (into instanceof Node && event.currentTarget.contains(into)) return;
        rankDrag?.onDragLeave(event);
      }}
      aria-current={isActive && !isTransportGhost ? "true" : undefined}
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
        "relative block rounded-md border border-border/50 bg-muted/40 px-2 py-1.5 text-left",
        "transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "opacity-70 hover:opacity-100",
        child.isArchived && "saturate-50",
        dimmed && "opacity-50",
        childSnoozeWakeAt !== null && "saturate-50",
        isActive && "ring-2 ring-ring",
        rowLine === "before" &&
          "before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-ring",
        rowLine === "after" &&
          "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-ring",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block size-1.5 shrink-0 rounded-full",
            DOT_CLASS[threadState(child, errorAcks)] ?? "bg-muted-foreground/30",
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
      onOpenChange={(open) =>
        open ? onAttentionEnter?.(child.id) : onAttentionLeave?.(child.id)
      }
    />
  );
}

export function ThreadCardImpl({
  thread,
  stateDot,
  isActive,
  isDone,
  doneIds,
  errorAckIds,
  isSweepHighlighted = false,
  isSweeping = false,
  isSweepSelecting = false,
  isSweepSelectable = false,
  onSweepToggle,
  onMarkDone,
  projectName,
  repoHrefBase,
  statusFor,
  linkedIssues,
  validatedHrefs,
  menuActions,
  childThreads,
  grandchildThreadsByParent,
  childCount,
  dimmed,
  rankKey,
  onRankDragStart,
  snoozeFor,
  onOpen,
  activeThreadId,
  isTransportGhost = false,
  onOpenThread,
  childMenuActions,
  childRankDrag,
  isCollapsed,
  onCollapsedChange,
  hideIdleChildren,
  onHideIdleChildrenChange,
  // Ruler+wrap mini cards: tighter padding and type, no ticket chips.
  compact = false,
  onAttentionEnter,
  onAttentionLeave,
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
  // The idle-children filter mirrors the fold's controlled/uncontrolled
  // split exactly: persisted by the app when supplied, local otherwise.
  const [localHideIdle, setLocalHideIdle] = useState(false);
  const hideIdle = hideIdleChildren ?? localHideIdle;
  const toggleHideIdle = () => {
    if (hideIdleChildren === undefined) setLocalHideIdle(!hideIdle);
    else onHideIdleChildrenChange?.(!hideIdle);
  };
  const branch = thread.environment?.branchName ?? thread.host?.name ?? "";
  const repo = repoHrefBase === undefined ? null : resolveRepoSlug(repoHrefBase);
  // The chip rows: text refs after the chip gate + the board's store links
  // (lib/link-metadata's cardTicketRefs), grouped by provider into rows —
  // one row per provider, at most two chips per row (issues left, pulls
  // right), lib/ticket-chips.ts. The toolbar search matches the flat ref
  // set (app.tsx), so a "#38" query still finds every card with a #38 chip.
  const ticketRefs = cardTicketRefs({
    title: thread.displayTitle,
    branch,
    ...(repoHrefBase !== undefined ? { repoHrefBase } : {}),
    linkedIssues,
    ...(validatedHrefs !== undefined ? { validatedHrefs } : {}),
  });
  const chipRows = ticketRefs.length === 0 || compact ? [] : ticketChipRows(ticketRefs);
  const children = childThreads ?? [];
  // The fold's count names what folding hides: the rows plus their sub-rows
  // (the toggle's summary and the "N child threads" label both fold the tier
  // the card's rows region carries — a child row's own children hide with
  // it). A child whose members ride the Done space renders none here, so
  // none count.
  const grandchildRowCount = grandchildThreadsByParent === undefined
    ? 0
    : children.reduce(
        (count, child) => count + (grandchildThreadsByParent.get(child.id)?.length ?? 0),
        0,
      );
  // The chip counts every visible child (prop from the raw family index);
  // fall back to the nested rows when the caller does not supply it.
  const chipCount = childCount ?? children.length;
  // The toggle only makes sense when there are rows to hide; the chip still
  // counts children that render standalone (promoted / cross-axis).
  const hasRows = children.length > 0;

  // Issue #174: with the rows folded, the family's open child still lists
  // itself — a single row below the dot strip, so the active thread keeps an
  // anchor in its family card. Null when the rows are unfolded (the rows
  // list the whole family), when nothing in the family is open, or when the
  // open thread is some other thread on the board.
  const activeCollapsedChild =
    collapsed && activeThreadId !== null && activeThreadId !== undefined
      ? children.find((child) => child.id === activeThreadId) ?? null
      : null;

  // The idle-children filter (issue #172): one control on the child section
  // hides every idle child in BOTH views — the expanded rows and the
  // collapsed dot strip. Non-idle states (attention, working, unread) never
  // filter, so the control can never hide a child that wants the operator.
  const isIdleChild = (child: PluginSidebarThread) =>
    threadState(child, errorAckIds) === "idle";
  const visibleChildren = hideIdle
    ? children.filter((child) => !isIdleChild(child))
    : children;
  // A hidden child's sub-rows go with it; a visible child's own idle
  // sub-rows filter out too, so the fold's count names what the section
  // shows, not what the family stores.
  const visibleSubRowCount = hideIdle
    ? visibleChildren.reduce(
        (count, child) =>
          count +
          (grandchildThreadsByParent === undefined
            ? 0
            : (grandchildThreadsByParent.get(child.id) ?? []).filter(
                (sub) => !isIdleChild(sub),
              ).length),
        0,
      )
    : grandchildRowCount;
  const visibleRowCount = visibleChildren.length + visibleSubRowCount;

  // The card's own attention: a pending interaction or an unread error. A
  // nested child can no longer be the cause — attention children un-nest
  // (nesting.ts `childPlacement`) and demand attention from their own card.
  const familyNeedsAttention = threadState(thread, errorAckIds) === "attention";

  // Snoozed state: the wake epoch-ms (null when not snoozed) drives the dim,
  // the chip, and the drag refusal all at once — one rule, no drift.
  const snoozeWakeAt = snoozeFor?.(thread.id) ?? null;
  const snoozed = snoozeWakeAt !== null;

  // Surface contrast floor (wallpaper on): muting the WHOLE card with
  // opacity makes its bg-card surface translucent, so a busy wallpaper
  // bleeds through the muted text. With a wallpaper active the card keeps
  // its opaque surface and fades through an under-scrim instead. The one
  // card that beats the scrim is the sweep-picked one: its amber tint
  // overlay paints the wash on a full-opacity card, so the scrim would
  // stack under it. A pane-open faded card keeps the scrim — the scrim dims
  // the content without ever making the surface transparent, so it is not
  // a transparency rule and focus never has to beat it.
  const wallpaperActive = useWallpaperActive();
  // The card statuses in one object (components/card-status.ts); the fade
  // systems consume `status.faded` and `status.spotlightImmune` (the marker
  // below). Parenting status is not modeled here: it expresses itself
  // structurally (which component renders this thread), and no fade
  // decision branches on it.
  const status = deriveCardStatus({
    isActive,
    isSweepHighlighted,
    needsAttention: familyNeedsAttention,
    isDone,
    dimmed: dimmed ?? false,
    snoozed,
  });
  const dimsByScrim = wallpaperActive && status.faded && !isSweepHighlighted;

  // The two-click Mark Done checkbox, swapped INTO THE STATE DOT'S SLOT: on
  // hover the dot fades and the checkbox centers over its exact pixels —
  // empty on not-done cards, checked on done — so the reveal moves nothing
  // on the card. Arming joins the label ("Mark Done" / "Mark Not Done")
  // inline in the header row, right of the slot. The first click arms, the
  // second fires `onMarkDone`; hovering away disarms, so an armed card
  // never survives a stray pointer into a later accidental settle. Sweeps
  // are modal: while this card's column curates a sweep the dot stays a
  // dot and every click stays with the selection gesture.
  const [armedDone, setArmedDone] = useState(false);
  const showDoneCheckbox = onMarkDone !== undefined && !isSweepSelecting;
  const doneLabel = isDone ? "Mark Not Done" : "Mark Done";
  const doneDotSlot = showDoneCheckbox ? (
    <span className="relative flex size-1.5 shrink-0 items-center justify-center">
      <span
        className={cn(
          "flex items-center transition-opacity",
          armedDone
            ? "opacity-0"
            : "opacity-100 group-hover:opacity-0 group-focus-within:opacity-0",
        )}
      >
        {stateDot}
      </span>
      <button
        type="button"
        data-done-checkbox=""
        data-done-armed={armedDone ? "" : undefined}
        aria-label={armedDone ? doneLabel : `Arm ${doneLabel}`}
        title={armedDone ? "Click again to confirm" : "Click to arm"}
        onClick={(event) => {
          // The stop keeps the anchor's own activation (open the pane, the
          // sweep toggle, the native href) from firing under the checkbox's
          // click.
          event.preventDefault();
          event.stopPropagation();
          if (armedDone) {
            setArmedDone(false);
            onMarkDone();
          } else {
            setArmedDone(true);
          }
        }}
        className={cn(
          "absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-sm p-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          armedDone
            ? "text-amber-600 opacity-100"
            : "text-muted-foreground/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        <Icon
          name={armedDone || isDone ? "CheckboxChecked" : "Checkbox"}
          className="size-3.5 shrink-0"
          aria-hidden
        />
      </button>
    </span>
  ) : stateDot;

  // The card is a container; the anchor (title/body), the chip rows, and the
  // collapse toggle stay out of each other's interactive scope — a button or
  // an <a> inside an anchor would be invalid HTML (issue #171 for the chips).
  const card = (
    <div
      data-thread-card={thread.id}
      data-sweep-highlighted={isSweepHighlighted ? "" : undefined}
      data-sweep-active={isSweeping ? "" : undefined}
      data-snoozed={snoozed ? "" : undefined}
      // The spotlight's exemption marker (see components/card-status.ts): a
      // card with user focus (pane open, sweep-highlighted, needs-attention)
      // or a life of its own that already fades it (done / dimmed / snoozed,
      // by whole-card opacity or the under-scrim) is marked, so the spotlight
      // recede never stacks a second dim on top and never fades what the
      // operator is focused on.
      data-spotlight-immune={status.spotlightImmune ? "" : undefined}
      // `group` drives the hover-revealed done checkbox below.
      onPointerLeave={armedDone ? () => setArmedDone(false) : undefined}
      onMouseEnter={
        onAttentionEnter === undefined ? undefined : () => onAttentionEnter(thread.id)
      }
      onMouseOut={
        onAttentionLeave === undefined
          ? undefined
          : (event) => {
              // Only a TRUE exit (the pointer passing above/outside the
              // card) releases the pin: entering a nested child row — a
              // descendant of this div — must not, or the card could move
              // while the pointer is still inside it.
              const from = event.relatedTarget;
              const current = event.currentTarget;
              if (from instanceof Node && current.contains(from)) return;
              onAttentionLeave(thread.id);
            }
      }
      className={cn(
        "group relative overflow-hidden rounded-md bg-card",
        // Colors AND opacity both ease: the spotlight rule
        // (components/card-spotlight.ts) dims and un-dims sibling cards from a
        // board-root rule, so the
        // opacity transition must live on the card itself — `transition-colors`
        // alone has no opacity to animate, and an armed-rule transition would
        // vanish in the same recalc as the dim it eases. The dim's onset
        // overrides this ease with its own armed rest (300ms) and sweep (300ms);
        // the un-dim always rides this base 150ms.
        "transition-[color,background-color,border-color,outline-color,text-decoration-color,opacity,fill,stroke]",
        // Hover = MORE prominence, never less (issue #123): an OPAQUE surface
        // DARKER than the rest state (`--card` mixed toward black), never a
        // translucent background-color on the card itself — card-level
        // transparency lets the lane background / wallpaper bleed through
        // (the lesson the wallpaper-contrast under-scrim already teaches).
        // The ring below carries the emphasis along with it.
        HOVER_SURFACE,
        // A card with a child section needs bottom padding beyond the body's
        // own 8px: the rows (or the folded strip) would otherwise sit flush
        // against the card's bottom edge.
        hasRows && (collapsed || onOpenThread !== undefined) && "pb-3",
        isActive
          ? "ring-2 ring-ring"
          : "ring-1 ring-transparent hover:ring-border",
        isDone && (dimsByScrim ? "saturate-50" : "opacity-50 saturate-50"),
        dimmed && !dimsByScrim && "opacity-50",
        snoozed && !dimsByScrim && "opacity-50",
        // The amber wash is NOT a card background: a translucent bg here
        // loses tailwind-merge's conflict against `bg-card` and REPLACES the
        // opaque surface, so a selected card went transparent (the lane /
        // wallpaper bled through — exactly the failure the HOVER_SURFACE
        // note below forbids). The wash lives on the [data-sweep-tint]
        // overlay further down; the card keeps its own opaque surface.
        isSweepHighlighted && "ring-2 ring-amber-500 saturate-100 opacity-100",
        isSweepSelectable && "ring-1 ring-amber-500/40",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-0.5",
          ACCENT_CLASS[threadState(thread, errorAckIds)] ?? "bg-transparent",
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
      {dimsByScrim ? (
        // The wallpaper-on contrast floor: a wash of the card's own surface
        // color over the content, so the faded look never drops the card's
        // opacity (the wallpaper would bleed through the muted surface).
        // Plain background paint — no backdrop-filter, mobile-safe, and
        // pointer-events pass straight through to the content.
        <span
          data-card-dim-scrim=""
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-md bg-card/50"
        />
      ) : null}
      {isSweepHighlighted ? (
        // The selection's amber wash sits ON the card as an overlay, the dim
        // scrim's pattern: the card's own surface stays opaque, only the
        // wash moves. See the highlight class note above for why this is
        // not `bg-amber-500/10` on the card itself.
        <span
          data-sweep-tint=""
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-md bg-amber-500/10"
        />
      ) : null}
      <div className="flex items-stretch">
        {/* The chip rows live OUTSIDE the card's anchor: the chips carry
            anchors of their own (the mark's list page, each id's item), and
            HTML forbids an <a> inside an <a> (issue #171). The column keeps
            the anchor and the rows stacked while the family-size strip stays
            a sibling of the column. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <a
            href={thread.href}
            aria-current={isActive && !isTransportGhost ? "true" : undefined}
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
              // open a browser tab from the href. The board reads the gesture:
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
              "relative focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              compact ? "px-2 py-1" : chipRows.length === 0 ? "px-3 py-2" : "px-3 pt-2",
            )}
          >
            <div className="flex items-center gap-1.5 pl-1.5">
              {doneDotSlot}
              {showDoneCheckbox && armedDone ? (
                <span
                  data-done-armed-tag=""
                  aria-hidden
                  className="whitespace-nowrap text-[10px] font-medium leading-none text-amber-600"
                >
                  {doneLabel}
                </span>
              ) : null}
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
            <p data-title="" className={cn("mt-0.5 line-clamp-2 pl-1.5 leading-snug", compact ? "text-[11px]" : "text-[13px]")}>{thread.displayTitle}</p>
            <p className="mt-0.5 truncate pl-1.5 text-[11px] text-muted-foreground/70">
              {projectName}
              {branch === "" ? null : <span className="text-muted-foreground/40"> · {branch}</span>}
            </p>
          </a>
          {chipRows.length === 0 ? null : (
            <div className="mt-1 flex flex-col gap-1 px-3 pb-2 pl-1.5">
              {chipRows.map((row) => (
                // One provider per row; issues chip first and the PRs chip
                // after it. justify-between spreads the pair — issues left,
                // PRs right — while flex-wrap reflows the right chip onto
                // the row's next line when the labels run long (a PRs-only
                // row places its single chip left).
                <div
                  key={row.key}
                  data-provider-row={row.key}
                  className="flex flex-wrap justify-between gap-1"
                >
                  {row.issues === undefined ? null : (
                    <ProviderTicketChip row={row} chip={row.issues} statusFor={statusFor} projectRepo={repo} />
                  )}
                  {row.pulls === undefined ? null : (
                    <ProviderTicketChip row={row} chip={row.pulls} statusFor={statusFor} projectRepo={repo} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
        <div className="ml-3 mt-1" data-child-thread-section="">
          {/* The section's header row: the fold toggle, plus the
              idle-children filter (issue #172) beside it. One control in one
              place, on the boundary of the content it controls — directly
              above the rows when expanded, and the header of the collapsed
              dot strip when folded. Clicking them never reaches the card's
              anchor, the pane, or the background closer. */}
          <div className="flex items-center gap-0.5">
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
              {visibleRowCount} {visibleRowCount === 1 ? "child thread" : "child threads"}
            </button>
            <button
              type="button"
              data-idle-children-toggle=""
              aria-pressed={hideIdle}
              aria-label={hideIdle ? "Show idle child threads" : "Hide idle child threads"}
              title={hideIdle ? "Show the idle child threads" : "Hide the idle child threads"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleHideIdle();
              }}
              className={cn(
                "rounded-sm p-0.5 text-muted-foreground/70",
                "transition-colors hover:bg-accent/60 hover:text-foreground",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <Icon
                name={hideIdle ? "View" : "ViewOff"}
                className="size-3 shrink-0"
                aria-hidden
              />
            </button>
          </div>
          {collapsed && visibleChildren.length > 0 ? (
            // The collapsed rows, immediately below their label: one dot
            // PER CHILD now, each its own control (issue #174), and the
            // idle-children filter (issue #172) hides an idle child's dot
            // with its row. Hovering a dot previews that child — its title
            // plus what the SDK exposes of it (state label, last-activity
            // age, indicator label; the SDK does not expose a thread's
            // messages). Clicking a dot opens that child's pane and leaves
            // the rows folded. The strip's background keeps the strip's
            // expand role, and the section toggle above stays the keyboard
            // path.
            <div
              data-child-thread-dots=""
              title="Show the nested child threads"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleCollapsed();
              }}
              className={cn(
                // The strip's first dot sits in the rows' dot column: the
                // 12px indent plus the glyph's centered position inside its
                // 16px button land the 6px dot's left edge at 17px, the
                // same x the expanded and active rows' dots start at (1px
                // border + 8px padding + the row anchor's 8px). The strip,
                // the grid it wraps into, and the rows read one grid.
                "ml-3 flex max-w-full flex-wrap items-center gap-1.5 rounded-sm py-0.5 pr-1",
                "transition-colors hover:bg-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {visibleChildren.map((child) => {
                const state = threadState(child, errorAckIds);
                return (
                  <button
                    key={child.id}
                    type="button"
                    data-child-dot={child.id}
                    aria-label={`Open child thread: ${child.displayTitle}`}
                    onClick={(event) => {
                      // The dot's click belongs to the dot alone: it opens
                      // its child and never reaches the strip's expand
                      // surface beneath it.
                      event.preventDefault();
                      event.stopPropagation();
                      if (onOpenThread === undefined) {
                        toggleCollapsed();
                        return;
                      }
                      onOpenThread(child.id);
                    }}
                    className="group/dot relative flex size-4 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      data-child-dot-glyph=""
                      className={cn(
                        "size-1.5 rounded-full",
                        DOT_CLASS[state] ?? "bg-muted-foreground/30",
                        state === "attention" && "motion-safe:animate-pulse",
                      )}
                    />
                    {/* The hover preview (issue #174): bb's sidebar thread
                        preview shape — the title above, a supporting line
                        under it. Decorative only (aria-hidden); the dot's
                        aria-label names the child for screen readers. It
                        shows while the dot is hovered or keyboard-focused. */}
                    <span
                      aria-hidden
                      data-child-dot-preview=""
                      className={cn(
                        "pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden max-w-56 -translate-x-1/2",
                        "rounded border border-border bg-popover px-2 py-1 text-left shadow-md",
                        "group-hover/dot:block group-focus-within/dot:block",
                      )}
                    >
                      <span className="block text-[11px] font-medium leading-tight text-popover-foreground">
                        {child.displayTitle}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-tight text-popover-foreground/70">
                        {THREAD_STATE_LABELS[state] ?? state} · {relativeTime(child.updatedAt, now)}
                        {child.indicatorLabel === null ? null : ` · ${child.indicatorLabel}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {activeCollapsedChild !== null && onOpenThread !== undefined ? (
            // Issue #174: the family's open child keeps a single row below
            // the strip while everything else stays a dot. No sub-rows and
            // no reorder line: a one-row list has nothing to rank.
            <div data-child-active-row="" className="mt-1 border-l border-border/70 pl-2">
              <ul className="flex flex-col gap-1">
                <li>
                  <ChildRow
                    child={activeCollapsedChild}
                    dimmed={isDone}
                    errorAcks={errorAckIds}
                    isActive
                    isTransportGhost={isTransportGhost}
                    onOpenThread={onOpenThread}
                    menuActions={childMenuActions?.(activeCollapsedChild)}
                    snoozeFor={snoozeFor}
                    onAttentionEnter={onAttentionEnter}
                    onAttentionLeave={onAttentionLeave}
                  />
                </li>
              </ul>
            </div>
          ) : null}
          {!collapsed && onOpenThread !== undefined && visibleChildren.length > 0 ? (
            <div
              data-nested-rows=""
              className={cn(
                "mt-1 border-l border-border/70 pl-2",
                // A big family scrolls its rows inside the card; a small one
                // renders at natural height.
                visibleChildren.length > NESTED_ROWS_SCROLL_THRESHOLD && "max-h-64 overflow-y-auto",
              )}
            >
              <ul className="flex flex-col gap-1">
                {visibleChildren.map((child) => {
                  const childDone = doneIds?.has(child.id) ?? false;
                  // The sub-row tier (issue #120): a child row nests its own
                  // children, indenting one tier under its indented list.
                  // Rows' rows render childless themselves — the display
                  // index caps every display chain at two row levels, so no
                  // deeper tier ever arrives here.
                  const subRowsRaw = grandchildThreadsByParent?.get(child.id) ?? [];
                  // The idle filter treats the sub-row tier like the row
                  // tier: a visible child's own idle sub-rows hide too.
                  const subRows = hideIdle
                    ? subRowsRaw.filter((sub) => !isIdleChild(sub))
                    : subRowsRaw;
                  const subRankKey = childRankKey(child.id);
                  return (
                    <li key={child.id}>
                      <ChildRow
                        child={child}
                        dimmed={isDone || childDone}
                        errorAcks={errorAckIds}
                        isActive={child.id === activeThreadId}
                        isTransportGhost={isTransportGhost}
                        onOpenThread={onOpenThread}
                        menuActions={childMenuActions?.(child)}
                        snoozeFor={snoozeFor}
                        rankKey={rankKey}
                        onRankDragStart={onRankDragStart}
                        rankDrag={childRankDrag}
                        onAttentionEnter={onAttentionEnter}
                        onAttentionLeave={onAttentionLeave}
                      />
                      {subRows.length > 0 ? (
                        <ul
                          data-child-sub-rows=""
                          className={cn(
                            // One narrower indent step than the card's
                            // own rows list, so the tier reads as depth.
                            "mt-1 flex flex-col gap-1 border-l border-border/50 pl-2 ml-1",
                            subRows.length > NESTED_ROWS_SCROLL_THRESHOLD &&
                              "max-h-64 overflow-y-auto",
                          )}
                        >
                          {subRows.map((sub) => (
                            <li key={sub.id}>
                              <ChildRow
                                child={sub}
                                dimmed={isDone || childDone || doneIds?.has(sub.id) === true}
                                errorAcks={errorAckIds}
                                isActive={sub.id === activeThreadId}
                                onOpenThread={onOpenThread}
                                menuActions={childMenuActions?.(sub)}
                                snoozeFor={snoozeFor}
                                rankKey={subRankKey}
                                onRankDragStart={onRankDragStart}
                                onAttentionEnter={onAttentionEnter}
                                onAttentionLeave={onAttentionLeave}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : null}
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
      onOpenChange={(open) =>
        open ? onAttentionEnter?.(thread.id) : onAttentionLeave?.(thread.id)
      }
    />
  );
}

/**
 * The ids whose membership in a set-state this card consumes directly: its
 * own row(s) — the dot, the accent, the dim — plus every nested child row
 * and sub-row it renders (their dots and done-dimming read the same sets).
 * A state-set's content changing without any of these memberships changing
 * is invisible to this card; the memo comparator treats the props equal
 * (issue #186).
 */
function cardSetIds(props: ThreadCardProps): string[] {
  const ids = [props.thread.id];
  const children = props.childThreads;
  if (children !== undefined) {
    for (const child of children) {
      ids.push(child.id);
      for (const sub of props.grandchildThreadsByParent?.get(child.id) ?? []) {
        ids.push(sub.id);
      }
    }
  }
  return ids;
}

/** Membership equality for the ids a card renders: identity-equal sets
 * short-circuit; otherwise every relevant id's membership must match. */
function sameSetMembership(
  prev: ReadonlySet<string> | undefined,
  next: ReadonlySet<string> | undefined,
  ids: readonly string[],
): boolean {
  if (prev === next) return true;
  for (const id of ids) {
    if ((prev?.has(id) ?? false) !== (next?.has(id) ?? false)) return false;
  }
  return true;
}

/**
 * The done checkbox's run and each menu entry's run are closure-built per
 * board render, so their identity churns with the board's render loop;
 * only the card's OWN observable state (its flags, baked into the array at
 * build time) can make a stale run act on wrong state — and when that
 * state changes, a compared primitive or the menu's id/label content
 * changes with it (a card whose flags changed re-renders and gets a fresh
 * menu; a card whose menu content matches the fresh build acts correctly).
 * The comparator therefore compares ACTIONS BY CONTENT — id, label, icon,
 * danger, divider — never by closure identity.
 */
function sameMenuActions(
  prev: readonly CardMenuAction[] | undefined,
  next: readonly CardMenuAction[] | undefined,
): boolean {
  if (prev === next) return true;
  if (prev === undefined || next === undefined) return false;
  if (prev.length !== next.length) return false;
  return prev.every((action, index) => {
    const other = next[index];
    if (other === undefined) return false;
    return (
      action.id === other.id &&
      action.label === other.label &&
      action.icon === other.icon &&
      action.danger === other.danger &&
      action.dividerAbove === other.dividerAbove
    );
  });
}

/**
 * The board's StateDot is a pure function of (thread, errorAcks), but it
 * arrives as a freshly-built element each render (identity churn). The
 * comparator sees through it when it is the known shape — a StateDot-like
 * element whose props are exactly { thread } and/or { errorAcks }:
 * otherwise it must not guess, and re-renders.
 */
function sameStateDot(
  prev: ReactNode,
  next: ReactNode,
  ids: readonly string[],
): boolean {
  if (prev === next) return true;
  if (!isValidElement(prev) || !isValidElement(next)) return false;
  if (prev.type !== next.type) return false;
  const prevDotProps = prev.props as Record<string, unknown>;
  const nextDotProps = next.props as Record<string, unknown>;
  const keys = Object.keys(nextDotProps);
  if (keys.length === 0) return Object.keys(prevDotProps).length === 0;
  if (!keys.every((key) => key === "thread" || key === "errorAcks")) return false;
  if (keys.length !== Object.keys(prevDotProps).length) return false;
  if (prevDotProps.thread !== nextDotProps.thread) return false;
  if (nextDotProps.errorAcks === undefined && prevDotProps.errorAcks === undefined) return true;
  return sameSetMembership(
    prevDotProps.errorAcks as ReadonlySet<string> | undefined,
    nextDotProps.errorAcks as ReadonlySet<string> | undefined,
    ids,
  );
}

/** The card's ticket refs, re-derived straight from the props (the same
 * inputs the card body uses; `gated` off skips the validation filter —
 * the RAW refs the membership probes need). */
function cardRefsOf(
  props: ThreadCardProps,
  gated: boolean,
): readonly TicketRef[] {
  const branch = props.thread.environment?.branchName ?? props.thread.host?.name ?? "";
  return cardTicketRefs({
    title: props.thread.displayTitle,
    branch,
    ...(props.repoHrefBase !== undefined ? { repoHrefBase: props.repoHrefBase } : {}),
    linkedIssues: props.linkedIssues,
    ...(gated && props.validatedHrefs !== undefined ? { validatedHrefs: props.validatedHrefs } : {}),
  });
}

/**
 * issue #186's memo: the board renders ~500 cards through this one
 * component; a state change (an echo's refetch, an optimistic write) used
 * to re-render every mounted card because the call site rebuilds every
 * prop per render. The comparator is SEMANTIC, not identity-based:
 *
 * - the thread and every primitive flag compare by identity/value;
 * - the state-set props (done, acks) compare by the memberships THIS card
 *   renders (own ids + nested rows), not by set identity;
 * - the dot element and the menu arrays compare by content;
 * - the per-item lookups (snooze, ticket status) compare by their results;
 * - the closures (drag gestures, open handlers, attention reports) compare
 *   never — their captured per-card state cannot go stale without a
 *   compared prop changing with it, and the board-scoped closures they
 *   reach into (sweep anchor, pins) read refs.
 */
export function sameCardProps(prev: ThreadCardProps, next: ThreadCardProps): boolean {
  if (prev.thread !== next.thread) return false;
  if (prev.stateDot !== next.stateDot) {
    if (!sameStateDot(prev.stateDot, next.stateDot, cardSetIds(next))) return false;
  }
  // Primitive surface: every flag the card's render branches on.
  for (const key of [
    "isActive",
    "isDone",
    "isSweepHighlighted",
    "isSweeping",
    "isSweepSelecting",
    "isSweepSelectable",
    "projectName",
    "repoHrefBase",
    "childCount",
    "dimmed",
    "rankKey",
    "activeThreadId",
    "isTransportGhost",
    "compact",
    "isCollapsed",
  ] as const) {
    if (prev[key] !== next[key]) return false;
  }
  const ids = cardSetIds(next);
  if (!sameSetMembership(prev.doneIds, next.doneIds, ids)) return false;
  if (!sameSetMembership(prev.errorAckIds, next.errorAckIds, ids)) return false;
  // Whole-card content that is not a flag: the chip inputs and the maps.
  const prevLinks = prev.linkedIssues;
  const nextLinks = next.linkedIssues;
  if (prevLinks !== nextLinks) {
    if (prevLinks === undefined || nextLinks === undefined) return false;
    if (prevLinks.length !== nextLinks.length) return false;
    for (let index = 0; index < prevLinks.length; index++) {
      if (!sameThreadLink(prevLinks[index], nextLinks[index])) return false;
    }
  }
  if (prev.validatedHrefs !== next.validatedHrefs) {
    // The raw (ungated) ref urls: identical whenever this comparison has
    // reached here — the thread and the link list are already content-equal.
    const hrefs = cardRefsOf(next, false).map((ref) => ref.href ?? "").filter(Boolean);
    if (!sameSetMembership(prev.validatedHrefs, next.validatedHrefs, hrefs)) return false;
  }
  if (prev.statusFor !== next.statusFor) {
    const repo = next.repoHrefBase === undefined ? null : resolveRepoSlug(next.repoHrefBase);
    for (const ref of cardRefsOf(next, true)) {
      if (ref.tracker !== "github" || ref.number === undefined) continue;
      const statusRepo = ticketStatusRepo(ref, repo);
      const before = prev.statusFor?.(statusRepo, ref.number);
      const after = next.statusFor?.(statusRepo, ref.number);
      if (before?.kind !== after?.kind || before?.state !== after?.state) return false;
    }
  }
  if (prev.childThreads !== next.childThreads) return false;
  if (prev.grandchildThreadsByParent !== next.grandchildThreadsByParent) return false;
  if (prev.childRankDrag?.line?.childId !== next.childRankDrag?.line?.childId) return false;
  if (prev.childRankDrag?.line?.zone !== next.childRankDrag?.line?.zone) return false;
  // Menus: content-equal is the bar (closures churn by design).
  if (!sameMenuActions(prev.menuActions, next.menuActions)) return false;
  const prevChildMenus = prev.childMenuActions;
  const nextChildMenus = next.childMenuActions;
  if (prevChildMenus !== nextChildMenus) {
    if (prevChildMenus === undefined || nextChildMenus === undefined) return false;
    for (const child of next.childThreads ?? []) {
      if (!sameMenuActions(prevChildMenus(child), nextChildMenus(child))) return false;
    }
  }
  // Per-id lookups the card consumes as results: compare results, not
  // lookup identity.
  if (prev.snoozeFor !== next.snoozeFor) {
    if (prev.snoozeFor === undefined || next.snoozeFor === undefined) return false;
    for (const id of ids) {
      if (prev.snoozeFor(id) !== next.snoozeFor(id)) return false;
    }
  }
  return true;
}

export const ThreadCard = memo(ThreadCardImpl, sameCardProps);

/** Content equality of one stored link (lib/link-metadata's discriminated
 * union): the fields the chip row renders, never the object identity the
 * per-refetch parsing rebuilds. */
function sameThreadLink(a: ThreadLink | undefined, b: ThreadLink | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.tracker !== b.tracker) return false;
  if (a.createdAt !== b.createdAt || a.source !== b.source) return false;
  if (a.tracker === "github" && b.tracker === "github") {
    return a.repo === b.repo && a.issue === b.issue && a.kind === b.kind && a.href === b.href;
  }
  if (a.tracker === "external" && b.tracker === "external") {
    return a.url === b.url && a.hostname === b.hostname && (a.label ?? null) === (b.label ?? null);
  }
  return false;
}