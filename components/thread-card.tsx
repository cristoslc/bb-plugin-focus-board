import { type DragEvent, type ReactNode, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { threadState, THREAD_STATE_LABELS } from "./grouping";
import { resolveRepoSlug } from "@/lib/tickets";
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
 * other cards recede a step and the hovered one never does. Pure CSS — a
 * board root (`[data-columns-board]` / `[data-parent-board]`) arms once it
 * `:has` a hovered card div, and only card divs that are NOT the hovered one
 * take the dim; child rows are anchors, so a family's rows never dim with
 * their parent. The dim is debounced (a 300ms rest before a 300ms ease-in,
 * armed in the rule itself, so a sweeping pointer never strobes it) and
 * eases out through the card's own persistent
 * color+opacity transition. The exemptions keep the existing dim systems in
 * charge: sweep-highlighted cards (a selection the pointer reads) and cards
 * wearing `data-card-faded` (done / dimmed / snoozed, whose own opacity or
 * under-scrim already fades them — a second dim on top would fight it).
 */
/** The hovered card's surface, one source of truth: the card token mixed
 *  toward BLACK — an OPAQUE surface DARKER than the rest state in both themes
 *  (issue #123 and its follow-up). `accent` was the first cut: it reads
 *  ink-ward, so on the dark canvas it LIGHTENED the hovered card (27.5% over
 *  19.5%), the opposite of the prominence the operator asked for. The 80%
 *  share is the "a bit darker" step; the ring hover emphasis rides along. */
export const HOVER_SURFACE =
  "hover:bg-[color-mix(in_oklab,var(--card)_80%,black)]";

export const CARD_SPOTLIGHT_CLASSES = [
  "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:opacity-70",
  // The recede dim's debounce: the same arm and target chain, but arming the
  // dim's transition-delay and its own longer ease INSTEAD of a property. A
  // pointer that rests 300ms starts the dim, which then eases in over 300ms;
  // a pointer sweeping across never holds the rule long enough for the dim
  // to show. Both exist only while the rule holds — targets shed them the
  // moment they stop matching (hovered, or the root disarmed) — so every
  // un-dim keeps the card's own snappy zero-delay 150ms ease.
  "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:delay-300",
  "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:duration-300",
].join(" ");

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
 * its hover title. The chip shell wraps, so a long ID list reflows onto
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
  // The ids' grid row count: one grid line holds up to three ids. A chip
  // whose ids all fit one line centers its content vertically (the shell's
  // min-height would otherwise leave the mark, glyph, and ids hugging the
  // top); a wrapped chip keeps them top-anchored so the mark and glyph
  // stay pinned at the top-left corner beside the first id line.
  const singleRow = chip.refs.length <= 3;
  const columnClass =
    chip.refs.length === 1
      ? "grid-cols-[max-content]"
      : chip.refs.length === 2
        ? "grid-cols-[repeat(2,max-content)]"
        : "grid-cols-[repeat(3,max-content)]";
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
      {/* The ids sit in a real grid, left-aligned max-content tracks (one
          per id, capped at three per line) so every wrapped line shares the
          same columns — and so a short list reserves no empty tracks, whose
          column gaps would hold phantom width past the last id (the mark
          and glyph anchor the top-left corner and never join the id flow
          to shorten the first line). */}
      <span className={cn("grid justify-items-start gap-x-2 gap-y-0.5", columnClass)}>
        {ids}
      </span>
    </span>
  );
}

function ChildRow({
  child,
  dimmed,
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
      onOpenChange={(open) =>
        open ? onAttentionEnter?.(child.id) : onAttentionLeave?.(child.id)
      }
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

  // The card's own attention: a pending interaction or an unread error. A
  // nested child can no longer be the cause — attention children un-nest
  // (nesting.ts `childPlacement`) and demand attention from their own card.
  const familyNeedsAttention = threadState(thread) === "attention";

  // Snoozed state: the wake epoch-ms (null when not snoozed) drives the dim,
  // the chip, and the drag refusal all at once — one rule, no drift.
  const snoozeWakeAt = snoozeFor?.(thread.id) ?? null;
  const snoozed = snoozeWakeAt !== null;

  // Surface contrast floor (wallpaper on): muting the WHOLE card with
  // opacity makes its bg-card surface translucent, so a busy wallpaper
  // bleeds through the muted text. With a wallpaper active the card keeps
  // its opaque surface and fades through an under-scrim instead; a
  // sweep-highlighted card is read by the operator, so it never dims.
  const wallpaperActive = useWallpaperActive();
  const fades = isDone || dimmed || snoozed;
  const dimsByScrim = wallpaperActive && fades && !isSweepHighlighted;

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
          // The checkbox lives inside the card's anchor — the ticket-chip
          // precedent (interactive content in the anchor's flow). The stop
          // keeps the anchor's own activation (open the pane, the sweep
          // toggle, the native href) from firing under the checkbox's click.
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

  // The card is a container; the anchor (title/body) and the collapse toggle
  // are siblings inside it — a button inside an anchor would be invalid HTML.
  const card = (
    <div
      data-thread-card={thread.id}
      data-sweep-highlighted={isSweepHighlighted ? "" : undefined}
      data-sweep-active={isSweeping ? "" : undefined}
      data-snoozed={snoozed ? "" : undefined}
      // The spotlight's exemption marker (see CARD_SPOTLIGHT_CLASSES): a card
      // whose life already fades it (done / dimmed / snoozed, by whole-card
      // opacity or the under-scrim) is marked, so the spotlight recede never
      // stacks a second dim on top of its own.
      data-card-faded={fades ? "" : undefined}
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
        // Colors AND opacity both ease: the spotlight (CARD_SPOTLIGHT_CLASSES)
        // dims and un-dims sibling cards from a board-root rule, so the
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
            "relative min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "px-2 py-1" : "px-3 py-2",
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
          {chipRows.length === 0 ? null : (
            <div className="mt-1 flex flex-col gap-1 pl-1.5">
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
            {children.length + grandchildRowCount}{" "}
            {children.length + grandchildRowCount === 1 ? "child thread" : "child threads"}
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
                  // The sub-row tier (issue #120): a child row nests its own
                  // children, indenting one tier under its indented list.
                  // Rows' rows render childless themselves — the display
                  // index caps every display chain at two row levels, so no
                  // deeper tier ever arrives here.
                  const subRows = grandchildThreadsByParent?.get(child.id) ?? [];
                  const subRankKey = childRankKey(child.id);
                  return (
                    <li key={child.id}>
                      <ChildRow
                        child={child}
                        dimmed={isDone || childDone}
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