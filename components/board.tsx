import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn, GroupBy } from "./grouping";
import { threadState } from "./grouping";
import {
  SWEEP_DESTINATION_LABELS,
  SWEEP_SETTLED_WORDS,
  sweepColumnKind,
  sweepDestination,
  sweepRangeIds,
  sweepRemovesThreads,
  type ArmedSweep,
  type SweepDestination,
  type SweepNotice,
  type SweepRunView,
} from "../lib/sweep";
import { ThreadCard } from "./thread-card";
import type { ThreadLink } from "../lib/link-metadata";
import { containerSlideX, listScrollY } from "./board-scroll";
import type { CardMenuAction } from "./thread-card-menu";
import type { BrowserRevealNotice } from "@/lib/browser-reveal";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  applyMoveVisible,
  columnIsRanked,
  columnRankKey,
  displayAfterMove,
  DRAG_ID_KEY,
  isLaneDrag,
  moveTargetFor,
  type RankStore,
} from "../lib/rank";
import { reparentRefusalFromParents } from "../lib/reparent";

/** The parent map absents itself when the caller has no nesting data. */
const EMPTY_PARENT_OF: ReadonlyMap<string, string> = new Map();

/**
 * The lane the drag came from is carried in the MIME **type name**, not in a
 * payload value. A real browser holds the drag payload write-only until the
 * drop: `getData` returns "" during `dragover`, so any handler that decides
 * from `getData` mid-drag silently sees nothing, never calls
 * `preventDefault`, and the browser then refuses the drop outright. `types`
 * stays readable for the whole drag, so the lane is discoverable exactly when
 * the drop has to be authorised. Reading the lane from the type name is the
 * difference between a reorder that works and one that does nothing.
 * (`DRAG_ID_KEY` comes from lib/rank, shared with the nested child rows,
 * which are drag sources too — dropping one on a floor detaches it.)
 */

/** How long a refusal banner stays on screen before auto-dismissing. */
const RANK_ERROR_AUTO_DISMISS_MS = 10_000;

/** Where an insertion line would land: before or after the hovered card. */
type Half = "before" | "after";
/**
 * Where a drop on a card lands. The before/after edges are the insertion
 * line the board always had; `onto` is the card's middle third — dropping
 * there nests the dragged card UNDER the hovered card instead of beside it.
 * The nest zone is offered only when the caller wired a re-parent write and
 * the guard allows the edge (never onto itself, never closing a family loop).
 */
type DropZone = Half | "onto";

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
  /**
   * Parent id → done children that render nested under the family's
   * projection card in the Done column. A live parent's card in the Done
   * column IS that projection: it shows the done portion of the family while
   * the active card keeps the live portion.
   */
  doneChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Family members that did not match the active filters; rendered dimmed. */
  dimmedIds: ReadonlySet<string>;
  /**
   * Parent ids whose nested rows are collapsed, persisted by the caller.
   * Absent → each card holds its own unpersisted collapse state.
   */
  collapsedFamilyIds?: ReadonlySet<string>;
  /** Reports a family card's collapse/expand gesture (parent id, new state). */
  onFamilyCollapsedChange?: (parentId: string, collapsed: boolean) => void;
  projectNameFor: (projectId: string) => string;
  /** GitHub repo base per project ("https://github.com/owner/repo"), when known. */
  repoBaseFor: (projectId: string) => string | null;
  /** GitHub cache status for a repo slug + number, when known. */
  statusFor?: (repo: string | null, number: number | undefined) =>
    | { kind: string; state: string }
    | undefined;
  /** The board's own GitHub links per thread id (metadata "linkedIssues"). */
  linkedIssuesFor?: (threadId: string) => ThreadLink[] | undefined;
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
  /**
   * Drop a card ONTO a card: make the dropped thread a child of the target.
   * The write goes to the caller (the RPC lives app-side); the board has
   * already refused the illegal edges — a drop onto itself or onto the
   * dropped card's own descendant. Optional: without it the card's middle
   * third is just another insertion edge, exactly as before nesting existed.
   */
  onReparent?: (childId: string, parentThreadId: string | null) => Promise<void>;
  /**
   * The RAW parent edges (child id → parent id), not the display index's
   * two-level flattened map: the nest guard must see real chains, so a
   * grandchild dropped onto its grandparent still counts as a change.
   * Absent → every nest-in-flight edge reads as allowed, because the board
   * cannot know; the caller (and the RPC handler) still re-check.
   */
  rawParentOf?: ReadonlyMap<string, string>;
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
  /**
   * One-shot lane-reveal request from a menu action that relocates a card
   * (see the reveal effect inside `Board`). Seq-numbered so the board can
   * consume each request exactly once; optional because only app.tsx issues
   * them today.
   */
  reveal?: { threadId: string; seq: number } | null;
  /** Right-click menu actions for one thread, sidebar-menu style. */
  menuActionsFor: (thread: PluginSidebarThread) => readonly CardMenuAction[];
  /**
   * Snooze wake lookup (lib/snooze): the wake epoch-ms for a snoozed thread,
   * null otherwise. Wired through to cards — dim in place, the wake chip,
   * and the card-level drag refusal.
   */
  snoozeFor?: (threadId: string) => number | null;
  /**
   * Sweep wiring: eligibility per column (empty when nothing is eligible),
   * and the armed lifecycle. Arming pre-selects the past-threshold
   * candidates; from there `armedSweep`'s list is LIVE — card clicks toggle
   * membership, and the list is what displays, gathers, and confirms.
   */
  sweepCandidatesFor?: (columnId: string) => readonly string[];
  armedSweep?: ArmedSweep | null;
  /**
   * A confirmed sweep in progress (null when idle). While it runs for a
   * column, that column's remaining candidates keep the armed highlight, the
   * active card carries the throbber, and the sweep button shows progress
   * and refuses clicks.
   */
  sweepRun?: SweepRunView | null;
  /** A finished sweep's failure summary; null hides the banner. */
  sweepNotice?: SweepNotice | null;
  onDismissSweepNotice?: () => void;
  /**
   * The browser-reveal gesture's honest outcome on the operator's board
   * surface (a thread with no controlled tab, a stuck-hidden tab, or a
   * listing failure); null hides the banner.
   */
  browserNotice?: BrowserRevealNotice | null;
  onDismissBrowserNotice?: () => void;
  /** Reverses a cancelled run's settled ids per their arm's destination. */
  onSweepUndo?: (
    threadIds: readonly string[],
    destination: SweepDestination,
  ) => void;
  /**
   * Flips a card's sweep-selection membership. Called only for cards in the
   * armed column; the board refuses ids in `sweepBlockedIds` itself.
   */
  onSweepToggle?: (threadId: string) => void;
  /**
   * Adds a shift-click's range to the live selection (union, never
   * subtractive). The board computes the ids — anchor through the clicked
   * card in display order, cards that may not join dropped — and reports
   * them; the caller applies them to `armedSweep`.
   */
  onSweepRangeSelect?: (threadIds: readonly string[]) => void;
  /**
   * Threads that may never join a sweep (live-child parents, the
   * sweep-family contract). Arm-scoped: only the arms whose action removes
   * the thread from the live board (Done → Archive, idle → Done) apply it;
   * Pinned and Unread sweeps leave threads live, so parents join there. In
   * a blocked arm their cards neither select nor carry the selectable ring,
   * and clicking one refuses on screen.
   */
  sweepBlockedIds?: ReadonlySet<string>;
  onSweepArm?: (columnId: string) => void;
  onSweepDisarm?: () => void;
  onSweepConfirm?: (columnId: string) => void;
  /**
   * The sweep's way out, whatever state it is in: an armed mode exits
   * (disarm), a running sweep stops before its next archive. The board
   * renders the button and labels it per state; the caller dispatches.
   */
  onSweepCancel?: () => void;
}

const DOT_CLASS: Record<string, string> = {
  working: "bg-blue-500",
  attention: "bg-amber-500",
  unread: "bg-emerald-500",
  idle: "bg-muted-foreground/30",
};

/** The running pill's aria-label word: what the sweep has done so far. */
const settledSoFar = (destination: SweepDestination): string =>
  `${SWEEP_SETTLED_WORDS[destination]} so far`;

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
  run,
  destination,
  onArm,
  onConfirm,
}: {
  /** Threads past the threshold — the pre-selection a new sweep mode starts with. */
  eligibleCount: number;
  isArmed: boolean;
  run: { done: number; total: number } | null;
  /** Where a confirmed sweep sends this column's candidates. */
  destination: SweepDestination;
  onArm: () => void;
  onConfirm: () => void;
}) {
  const destinationLabel = SWEEP_DESTINATION_LABELS[destination];
  const settledWord = settledSoFar(destination);
  if (run !== null) {
    return (
      <button
        type="button"
        data-sweep-button=""
        disabled
        aria-label={`Sweeping: ${run.done} of ${run.total} threads ${settledWord}`}
        className="inline-flex h-5 shrink-0 cursor-default items-center gap-1 whitespace-nowrap rounded bg-amber-500/90 px-1.5 text-[10px] font-medium text-amber-950"
      >
        <Icon name="Spinner" className="size-3 animate-spin" aria-hidden />
        {run.done} of {run.total}
      </button>
    );
  }
  // Always present on a sweepable column: sweep mode is enterable on
  // demand, even when nothing is past the threshold yet. With no
  // pre-selection the button is icon-only; armed, it confirms whatever the
  // operator's live selection holds, and an empty selection cannot confirm.
  // The broom is the pill's only glyph and the word "Sweep" appears
  // nowhere: the word repeated on every column header read as noise, and
  // the broom plus the count (plus the destination, armed) carries the
  // meaning at a glance.
  const inert = isArmed && eligibleCount === 0;
  return (
    <button
      type="button"
      data-sweep-button=""
      aria-pressed={isArmed}
      disabled={inert}
      aria-label={
        isArmed
          ? inert
            ? "Confirm sweep: no threads selected; click cards to add them"
            : `Confirm sweep of ${eligibleCount} threads from this column to ${destinationLabel}; click away to disarm`
          : eligibleCount > 0
            ? `Arm sweep for this column: ${eligibleCount} eligible threads`
            : "Enter sweep mode: click cards to select threads to sweep"
      }
      onClick={(event) => {
        event.stopPropagation();
        if (isArmed) onConfirm();
        else onArm();
      }}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isArmed
          ? "bg-amber-500/90 text-amber-950 hover:bg-amber-500"
          : "text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground",
        inert && "cursor-default opacity-60",
      )}
    >
      <Icon name="Broom" className="size-3" aria-hidden />
      {isArmed ? `${eligibleCount} → ${destinationLabel}` : eligibleCount > 0 ? eligibleCount : null}
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
  doneChildrenByParent,
  dimmedIds,
  collapsedFamilyIds,
  onFamilyCollapsedChange,
  projectNameFor,
  repoBaseFor,
  statusFor,
  linkedIssuesFor,
  onOpenThread,
  onNewTask,
  onClosePane,
  rankStore,
  onRankMove,
  onReparent,
  rawParentOf,
  onDropDone,
  onDropUnread,
  onDropPinned,
  reveal = null,
  menuActionsFor,
  snoozeFor,
  sweepCandidatesFor,
  armedSweep = null,
  sweepRun = null,
  sweepNotice = null,
  onDismissSweepNotice,
  browserNotice = null,
  onDismissBrowserNotice,
  onSweepUndo,
  onSweepToggle,
  onSweepRangeSelect,
  sweepBlockedIds,
  onSweepArm,
  onSweepDisarm,
  onSweepConfirm,
  onSweepCancel,
}: BoardProps) {
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  // The column floor an UNNEST hover lights up (amber). Kept separate from
  // dragOverColumn so the two affordances cannot argue over ring color: the
  // family write wins wherever both apply, because the drop's family effect
  // is the surprising half.
  const [familyFloorColumn, setFamilyFloorColumn] = useState<string | null>(null);
  // The column HEADER a family hover lights up (amber), next to the floor:
  // the header sits inside the section so a drop on it bubbles to the
  // section's handlers for free — this state is the hover affordance only.
  const [familyHeaderColumn, setFamilyHeaderColumn] = useState<string | null>(null);
  // True while any card or child-row drag is in flight: headers grow a few
  // pixels so the small title strip is easier to hit as a detach target.
  const [dragInFlight, setDragInFlight] = useState(false);
  // { columnId, threadId, zone } for the drop the cursor is over while a
  // ranked card is dragged over a ranked column. `zone` is an insertion edge
  // ("before"/"after") or the nest zone ("onto") — a drop in the hovered
  // card's middle third that nests the dragged card under it. Null when no
  // drop is in flight.
  const [rankDrop, setRankDrop] = useState<{
    columnId: string;
    threadId: string;
    zone: DropZone;
  } | null>(null);

  // The shift-click anchor: the last card clicked without Shift in the armed
  // column. Shift extends the selection from it (it stays put — standard
  // list semantics); plain and cmd/ctrl clicks move it. Reset whenever the
  // armed column changes or sweep mode ends, so a re-arm never inherits an
  // old anchor from a previous session.
  const sweepAnchorRef = useRef<{ columnId: string; threadId: string } | null>(null);
  const armedColumnId = armedSweep?.columnId ?? null;
  useEffect(() => {
    sweepAnchorRef.current = null;
  }, [armedColumnId]);

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
      // Horizontal: the pane opening (or a drag resize) narrows the visible
      // range; slide the card back inside it. Vertical: a lane taller than
      // the board scrolls its own list, and a card that history just restored
      // (deep link, back/forward — no click preceded it) can sit below the
      // fold; the list is adjusted directly — never scrollIntoView, which
      // would scroll every ancestor including the host page.
      const cardRect = card.getBoundingClientRect();
      container.scrollLeft += containerSlideX(container.getBoundingClientRect(), cardRect);
      const list = card.closest("[data-card-list]");
      if (list instanceof HTMLElement) {
        list.scrollTop += listScrollY(list.getBoundingClientRect(), cardRect);
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

  // One-shot, intent-scoped bring-into-view (`revealRequest` from app.tsx):
  // every menu action that relocates a card — Pin/Unpin into or out of the
  // far-left Pinned lane, Mark Done/Not Done into or out of the far-right
  // Done lane, Mark Read/Unread out of the Unread column — moves a card the
  // pane never opened, so the keep-in-view effect above (which follows the
  // ACTIVE card) has no key on it, and in a scrolled board the destination
  // lane can be offscreen: the menu action reads as the card silently
  // vanishing from where it was.
  //
  // The request is a CLAIM, not a scroll order. The relocation of an async
  // action (Pin/Unpin/Read go through the host bridge) lands in a LATER
  // render than the click, so a reveal fired at click time would scroll to
  // the card's OLD lane — or, worse, race the data. So the claim survives
  // renders until this effect first sees the card and can bring it into
  // view; app.tsx only issues the claim at the commit the relocation rides
  // (or when the host-applied state it was waiting on lands). Consumed
  // exactly once (seq-gated, key = last-seen seq), so data refreshes and
  // passive state changes never yank the user's scroll.
  const revealClaimRef = useRef<{ seq: number; threadId: string } | null>(null);
  useLayoutEffect(() => {
    if (reveal !== null && reveal.seq !== revealClaimRef.current?.seq) {
      revealClaimRef.current = { seq: reveal.seq, threadId: reveal.threadId };
    }
    const claim = revealClaimRef.current;
    const container = scrollRef.current;
    if (claim === null || container === null) return;
    const card = container.querySelector(`[data-thread-card="${CSS.escape(claim.threadId)}"]`);
    if (!(card instanceof HTMLElement)) {
      // Not on the board in this commit (a filter may hide the card, or the
      // host state has not landed yet): keep the claim and re-check on the
      // next board change, so the intent is honoured late rather than lost.
      return;
    }
    const cardRect = card.getBoundingClientRect();
    container.scrollLeft += containerSlideX(container.getBoundingClientRect(), cardRect);
    const list = card.closest("[data-card-list]");
    if (list instanceof HTMLElement) {
      list.scrollTop += listScrollY(list.getBoundingClientRect(), cardRect);
    }
    revealClaimRef.current = null;
  }, [reveal, columns]);

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

  // A sweep that partially failed says so on screen, the same way a refused
  // reorder does: the failed candidates stay highlighted (re-armed), but the
  // highlight alone does not say why the sweep stopped short.
  useEffect(() => {
    if (sweepNotice === null) return;
    const timer = setTimeout(
      () => onDismissSweepNotice?.(),
      RANK_ERROR_AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [sweepNotice, onDismissSweepNotice]);

  // The browser reveal's report expires the same way: a dead notice that
  // squats on the board would be the same "ignoring the operator" look.
  useEffect(() => {
    if (browserNotice === null || browserNotice === undefined) return;
    const timer = setTimeout(
      () => onDismissBrowserNotice?.(),
      RANK_ERROR_AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [browserNotice, onDismissBrowserNotice]);

  // A sweep-mode click on a thread that may not join a sweep (live-child
  // parent) refuses on screen: a click that silently does nothing reads as
  // a board ignoring the operator, the exact failure this board shipped
  // twice in the drag path.
  const [sweepRefusal, setSweepRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (sweepRefusal === null) return;
    const timer = setTimeout(() => setSweepRefusal(null), RANK_ERROR_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [sweepRefusal]);

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

  /**
   * Where does a hover or drop over this card land? The before/after halves
   * are the insertion edges the board always had; the middle third nests the
   * dragged card UNDER this card — offered only when a re-parent write is
   * wired and the guard permits this pair (never onto itself, never closing
   * a family loop), so a refused nest falls back to the edge split instead
   * of advertising a drop that would refuse.
   *
   * `childId` is the dragged card: the live ref mid-drag (the payload is
   * write-only until the drop), the payload at drop time.
   */
  function dropZoneFor(
    event: React.DragEvent,
    childId: string | null,
    targetId: string,
  ): DropZone {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const edge: Half = y < rect.height / 2 ? "before" : "after";
    if (
      onReparent === undefined ||
      childId === null ||
      childId === "" ||
      childId === targetId ||
      reparentRefusalFromParents(rawParentOf ?? EMPTY_PARENT_OF, childId, targetId) !== null
    ) {
      return edge;
    }
    if (y < rect.height / 3) return "before";
    if (y > (rect.height * 2) / 3) return "after";
    return "onto";
  }

  /**
   * The nest drop: hand the pair to the caller's write. The guard ran twice
   * already (at dragover, and again in the RPC handler against its own fresh
   * rows); a rejected write still reports on screen — the board must not
   * silently eat a gesture, the same failure mode the drag path shipped
   * twice before this.
   */
  function commitNest(childId: string, target: PluginSidebarThread): void {
    const write = onReparent;
    if (write === undefined) return;
    void write(childId, target.id).then(
      () => setAnnouncement(`Nested as a child of "${target.displayTitle}".`),
      (error: unknown) =>
        reportRefusal(
          error instanceof Error ? error.message : "the re-parent write failed.",
        ),
    );
  }

  /**
   * The detach drop: releasing a nested child on a column floor un-nests it.
   * The inverse gesture exists by construction — dragging the card back onto
   * its former parent re-nests — and the announcement says so, because an
   * undo nobody can find is not an undo.
   */
  function commitUnnest(childId: string): void {
    const write = onReparent;
    if (write === undefined) return;
    void write(childId, null).then(
      () =>
        setAnnouncement(
          "Top-level again — it is no longer nested as a child. Drag it onto a card to nest it back.",
        ),
      (error: unknown) =>
        reportRefusal(
          error instanceof Error ? error.message : "the re-parent write failed.",
        ),
    );
  }

  /** The live parent of `threadId`, or null for a top-level card. */
  const liveParentOf = (threadId: string): string | null =>
    rawParentOf?.get(threadId) ?? null;
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
      data-columns-board
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
      {sweepNotice !== null ? (
        <div
          role="status"
          data-testid="sweep-notice"
          className="mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400"
        >
          <p className="min-w-0">{sweepNotice.message}</p>
          <span className="flex shrink-0 items-center gap-0.5">
            {sweepNotice.undo !== undefined && sweepNotice.undo.ids.length > 0 ? (
              <button
                type="button"
                data-sweep-undo=""
                onClick={() => {
                  const undo = sweepNotice.undo;
                  if (undo !== undefined) onSweepUndo?.(undo.ids, undo.destination);
                }}
                aria-label={
                  sweepNotice.undo.destination === "done"
                    ? `Undo the sweep: mark ${sweepNotice.undo.ids.length} threads not Done again`
                    : `Undo the sweep: restore ${sweepNotice.undo.ids.length} archived threads`
                }
                className="rounded px-1.5 py-0.5 font-medium underline decoration-dotted underline-offset-2 transition-colors hover:bg-amber-500/10 hover:text-amber-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-600 dark:hover:text-amber-400"
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onDismissSweepNotice?.()}
              aria-label="Dismiss sweep notice"
              title="Dismiss"
              className="rounded p-0.5 text-amber-700/70 transition-colors hover:bg-amber-500/10 hover:text-amber-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-600 dark:text-amber-400/70 dark:hover:text-amber-400"
            >
              <Icon name="X" className="size-3" aria-hidden />
            </button>
          </span>
        </div>
      ) : null}
      {browserNotice !== null ? (
        <div
          role="status"
          data-testid="browser-reveal-notice"
          className="mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400"
        >
          <p className="min-w-0">{browserNotice.message}</p>
          <button
            type="button"
            onClick={() => onDismissBrowserNotice?.()}
            aria-label="Dismiss browser notice"
            title="Dismiss"
            className="rounded p-0.5 text-amber-700/70 transition-colors hover:bg-amber-500/10 hover:text-amber-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-600 dark:text-amber-400/70 dark:hover:text-amber-400"
          >
            <Icon name="X" className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}
      {sweepRefusal !== null ? (
        <div
          role="status"
          data-testid="sweep-refusal"
          className="mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
        >
          <p className="min-w-0">{sweepRefusal}</p>
          <button
            type="button"
            onClick={() => setSweepRefusal(null)}
            aria-label="Dismiss sweep refusal"
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
          // The sweep-family contract is arm-scoped: only the arms whose
          // action removes the thread from the live board (archive, Done)
          // refuse live-child parents. Unpinning and marking read leave the
          // thread live, so Pinned and Unread sweeps take parents too.
          const blockedIds = sweepRemovesThreads(column.id) ? sweepBlockedIds : undefined;
          const isArmed = armedSweep !== null && armedSweep.columnId === column.id;
          // A run is bound to its column: only that column's button shows
          // progress, and only its cards can carry the throbber.
          const runHere = sweepRun !== null && sweepRun.columnId === column.id ? sweepRun : null;
          // While armed, the LIVE selection drives count, gather, and
          // highlight — card clicks toggle it via onSweepToggle. Before
          // arming, the past-threshold set is what the button proposes.
          const eligible = isArmed
            ? (armedSweep?.threadIds ?? [])
            : sweepActive && sweepKind !== null
              ? (sweepCandidatesFor?.(column.id) ?? [])
              : [];
          // Selection never reorders the column: highlighted cards stay
          // where they are and the operator scrolls to see the blast
          // radius. Reordering on every toggle made deselecting feel like
          // the board was shuffling a deck (observed 2026-10-01).
          const shownThreads = column.threads;
          const armedSet = isArmed ? new Set(eligible) : null;
          // May this card join the armed selection? Blocked ids never join
          // in a removing arm, and a Done column's family projection card
          // is not a done thread. A direct click on a refused card refuses
          // loudly (below); inside a shift-range they are skipped silently.
          const cardMayJoinSweep = (threadId: string): boolean =>
            !(blockedIds?.has(threadId) ?? false) &&
            !(column.id === "done" && !doneIds.has(threadId));
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
                // A nested child dragged over THIS floor is a detach hover: the
                // family write rides any column, state gate or not — the same
                // rule the card nest zone follows in non-state lanes.
                const draggedId = draggingIdRef.current;
                const childOf =
                  draggedId !== null && draggedId !== "" ? liveParentOf(draggedId) : null;
                if (ranking && isLaneDrag(event.dataTransfer.types, rankKey)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (childOf !== null && onReparent !== undefined) {
                    setFamilyFloorColumn(column.id);
                  }
                  return;
                }
                if (!isDropTarget) {
                  if (childOf !== null && onReparent !== undefined) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setFamilyFloorColumn(column.id);
                  }
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverColumn(column.id);
                if (childOf !== null && onReparent !== undefined) {
                  setFamilyFloorColumn(column.id);
                }
              }}
              onDragLeave={
                isDropTarget || onReparent !== undefined
                  ? () => {
                      setDragOverColumn((c) => (c === column.id ? null : c));
                      setFamilyFloorColumn((c) => (c === column.id ? null : c));
                    }
                  : undefined
              }
              onDrop={(event) => {
                const threadId = draggedIdFor(event, draggingIdRef.current);
                const childOf = threadId === "" ? null : liveParentOf(threadId);
                const releaseFloor = () => {
                  setDragOverColumn(null);
                  setFamilyFloorColumn(null);
                  // The header's amber dies with any successful drop (a
                  // header drop bubbles into this very handler).
                  setFamilyHeaderColumn(null);
                };
                if (ranking && isLaneDrag(event.dataTransfer.types, rankKey)) {
                  // Released over the lane's empty space below the last card:
                  // append. A drop ON a card was already claimed by that
                  // card's own handler, which stops propagation.
                  event.preventDefault();
                  clearRankDrop();
                  releaseFloor();
                  if (threadId !== "") {
                    if (childOf !== null && onReparent !== undefined) {
                      // A child released on a floor never keeps its family:
                      // the whole point of dragging it out is leaving it. The
                      // child was no visible slot in this lane, so there is
                      // no rank to move either — the detach IS the write.
                      commitUnnest(threadId);
                    } else {
                      commitMove(
                        column,
                        threadId,
                        null,
                        true,
                        shownThreads.map((candidate) => candidate.id),
                      );
                    }
                  }
                  return;
                }
                if (!isDropTarget) {
                  // The floor still takes a nested child — the detach — even
                  // where no lane write exists, so the gesture works in the
                  // project/provider/machine views too.
                  if (childOf !== null && onReparent !== undefined && threadId !== "") {
                    event.preventDefault();
                    releaseFloor();
                    commitUnnest(threadId);
                  }
                  return;
                }
                event.preventDefault();
                releaseFloor();
                if (threadId === "") return;
                dropHandler(threadId);
                if (childOf !== null && onReparent !== undefined) commitUnnest(threadId);
              }}
              className={cn(
                "flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg transition-colors",
                familyFloorColumn === column.id
                  // Amber is the family drop color — the same signal the nest
                  // ring on cards gives — so "un-nests on release" is legible
                  // before the drop happens.
                  ? "bg-accent/60 ring-2 ring-amber-500"
                  : dragOverColumn === column.id && "bg-accent/60 ring-2 ring-ring",
              )}
            >
              <header
                className={cn(
                  "flex items-baseline gap-1.5 px-1 pb-1.5 transition-colors",
                  // Grow the hit strip only while a drag flies, and grow it
                  // with negated margins so no card moves beneath the cursor:
                  // +4px each side here, -4px back from the content flow.
                  dragInFlight && "px-2 pb-2.5 -mx-1 -mb-1",
                  familyHeaderColumn === column.id
                    ? "rounded-md ring-2 ring-amber-500 bg-accent/40"
                    : null,
                )}
                onDragOver={(event) => {
                  // Hover affordance only: the section's own onDragOver
                  // already preventDefaults a child drag and will accept the
                  // drop (the header is inside it), so nothing semantic
                  // happens here — the amber just follows the cursor up to
                  // the small element under it.
                  const draggedId = draggingIdRef.current;
                  if (draggedId === null || draggedId === "") return;
                  if (onReparent === undefined || liveParentOf(draggedId) === null) return;
                  setFamilyHeaderColumn(column.id);
                  setFamilyFloorColumn(column.id);
                }}
                onDragLeave={() => {
                  setFamilyHeaderColumn((c) => (c === column.id ? null : c));
                  setFamilyFloorColumn((c) => (c === column.id ? null : c));
                }}
                onDrop={(event) => {
                  // A release on the TITLE is not a placement: no rank move,
                  // no floor append. stopPropagation keeps the section's
                  // floor handler (state + rank in one gesture) out of it —
                  // dropping beside the cards (insertion line) stays the way
                  // to both change state AND place the card.
                  const threadId = draggedIdFor(event, draggingIdRef.current);
                  const childOf = threadId === "" ? null : liveParentOf(threadId);
                  const releaseFloor = () => {
                    setDragOverColumn(null);
                    setFamilyFloorColumn(null);
                    setFamilyHeaderColumn(null);
                  };
                  event.preventDefault();
                  event.stopPropagation();
                  releaseFloor();
                  if (threadId === "") return;
                  if (childOf !== null && onReparent !== undefined) {
                    commitUnnest(threadId);
                    return;
                  }
                  if (isDropTarget && !isLaneDrag(event.dataTransfer.types, rankKey)) {
                    // Cross-lane release on the title: the state change only
                    // — the card keeps its lane membership, so the operator
                    // drags it beside a card when placement matters.
                    dropHandler(threadId);
                  }
                  // Same-lane top-level: a deliberate no-op.
                }}
              >
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
                {sweepActive && sweepKind !== null ? (
                  <span className="ml-auto flex items-center gap-0.5">
                    <SweepButton
                      eligibleCount={eligible.length}
                      isArmed={isArmed}
                      run={
                        runHere === null
                          ? null
                          : { done: runHere.done, total: runHere.total }
                      }
                      destination={sweepDestination(column.id) ?? "archive"}
                      onArm={() => onSweepArm?.(column.id)}
                      onConfirm={() => onSweepConfirm?.(column.id)}
                    />
                    {isArmed || runHere !== null ? (
                      <button
                        type="button"
                        data-sweep-cancel=""
                        aria-label={runHere !== null ? "Cancel sweep" : "Exit sweep mode"}
                        title={
                          runHere !== null
                            ? "Cancel: the current thread finishes, nothing else is swept"
                            : "Exit sweep mode"
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          onSweepCancel?.();
                        }}
                        className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Icon name="X" className="size-3" aria-hidden />
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </header>
              <div
                data-card-list
                className="min-h-0 flex-1 overflow-y-auto rounded-lg bg-muted/30 p-1.5"
              >
                {column.threads.length === 0 && dragOverColumn !== column.id ? (
                  column.id === "working" ? (
                    // The ever-present Working lane answers the obvious
                    // question — is anything running? — with words.
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground/60">
                      No work in progress
                    </p>
                  ) : isDropTarget ? (
                    <p className="px-1 py-3 text-center text-xs text-muted-foreground/60">
                      Drop to {column.id === "done" ? "mark done" : "mark unread"}
                    </p>
                  ) : null
                ) : null}
                {column.threads.length === 0 ? null : (
                  <ul className="flex flex-col gap-1.5">
                    {shownThreads.map((thread) => {
                      // A live thread sitting in the Done column is a family's
                      // projection card: it renders the done portion of the
                      // family (done children nested under it) while the
                      // active card keeps the live portion. It is not a done
                      // thread — it carries the Done treatment and refuses
                      // sweep selection.
                      const isDoneProjection =
                        column.id === "done" && !doneIds.has(thread.id);
                      const projectionChildren = doneChildrenByParent.get(thread.id);
                      return (
                      <li
                        key={thread.id}
                        data-rank-slot={ranking ? thread.id : undefined}
                        // Every card is a drop target for its own lane's
                        // drag; the hovered card decides which of its two
                        // edges the insertion line lands on, or whether the
                        // middle third offers nesting instead.
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
                              // The nest zone is the one exception to the
                              // state-change gate: nesting is a family
                              // write, not lane membership, so it is
                              // offered over any card.
                              const zone = dropZoneFor(
                                event,
                                draggingIdRef.current,
                                thread.id,
                              );
                              if (zone !== "onto" && (draggingIdRef.current === null || !isDropTarget)) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setRankDrop((current) =>
                                current?.columnId === column.id &&
                                current?.threadId === thread.id &&
                                current?.zone === zone
                                  ? current
                                  : { columnId: column.id, threadId: thread.id, zone },
                              );
                              return;
                            }
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            const zone = dropZoneFor(event, draggingIdRef.current, thread.id);
                            if (draggingIdRef.current === thread.id) {
                              clearRankDrop();
                              return;
                            }
                            setRankDrop((current) =>
                              current?.columnId === column.id &&
                              current?.threadId === thread.id &&
                              current?.zone === zone
                                ? current
                                : { columnId: column.id, threadId: thread.id, zone },
                            );
                          }
                        }
                        onDrop={
                          (event) => {
                            if (!ranking) return;
                            // The payload is readable only here; zone math
                            // re-reads the live position (the last dragover
                            // can land on a different card than the one the
                            // state was set on) and re-runs the guard on the
                            // real dropped id — the ref the dragover used can
                            // name a card the payload contradicts.
                            const droppedId = draggedIdFor(event, draggingIdRef.current);
                            const zone = dropZoneFor(event, droppedId, thread.id);
                            if (zone === "onto") {
                              event.preventDefault();
                              // Claim the event so the column's own handler
                              // — the append or state-change path — does not
                              // also fire for this drop.
                              event.stopPropagation();
                              clearRankDrop();
                              commitNest(droppedId, thread);
                              return;
                            }
                            const edge: Half = zone;
                            if (!isLaneDrag(event.dataTransfer.types, rankKey)) {
                              // A cross-lane drop ON a card: the state change
                              // and the ranked position the line showed happen
                              // in the one drop — no second drag to place the
                              // card after it lands. Guards mirror dragover
                              // above: only state-change lanes, only lane
                              // drags, or a foreign drag could write an order
                              // for a card the lane never held.
                              if (draggingIdRef.current === null || !isDropTarget) return;
                              event.preventDefault();
                              // Claim the event so the column's own handler —
                              // the unpositioned state-change path — does not
                              // also fire for this drop.
                              event.stopPropagation();
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
                            // The drop bubbles to the column's own handler,
                            // which treats a same-lane drag as "append". Claim
                            // the event so one drop is one move, not an
                            // insert plus an append.
                            event.stopPropagation();
                            clearRankDrop();
                            if (droppedId === "") return;
                            const target = moveTargetFor(
                              shownThreads.map((candidate) => candidate.id),
                              thread.id,
                              edge,
                              droppedId,
                            );
                            if (target === null) {
                              reportRefusal(
                                `the drop position in ${column.label} resolved to no move.`,
                              );
                              return;
                            }
                            commitMove(
                              column,
                              droppedId,
                              target.beforeId,
                              target.toEnd,
                              shownThreads.map((candidate) => candidate.id),
                            );
                          }
                        }
                        onDragLeave={
                          ranking
                            ? (event) => {
                                // The marker is the hover's promise. The
                                // browser fires dragleave on the slot the
                                // moment the pointer crosses out of it — up
                                // to the title strip, into the floor gap,
                                // across to another column — and the promise
                                // must die with the hover: a drop on the
                                // title writes no placement, so a line parked
                                // there lies about where the card would land.
                                const into = event.relatedTarget;
                                if (into instanceof Node && event.currentTarget.contains(into)) {
                                  return;
                                }
                                clearRankDrop();
                              }
                            : undefined
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
                            rankDrop.zone === "onto"
                              // The nest zone: a ring around the whole card,
                              // not an insertion line — the drop is "into"
                              // this card, not beside it. Amber marks the
                              // family write so it reads differently from the
                              // insertion line's lane-color affordance.
                              ? "after:absolute after:inset-0 after:rounded-lg after:ring-2 after:ring-amber-500 after:bg-amber-500/10"
                              : rankDrop.zone === "before"
                                ? "before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-ring"
                                : "after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-ring"
                          ),
                        )}
                      >
                        <ThreadCard
                          thread={thread}
                          stateDot={<StateDot thread={thread} />}
                          isActive={thread.id === activeThreadId}
                          isDone={doneIds.has(thread.id) || isDoneProjection}
                          isSweepHighlighted={armedSet?.has(thread.id) ?? false}
                          isSweeping={runHere !== null && runHere.activeId === thread.id}
                          isSweepSelecting={isArmed}
                          isSweepSelectable={
                            isArmed &&
                            !isDoneProjection &&
                            !(armedSet?.has(thread.id) ?? false) &&
                            !(blockedIds?.has(thread.id) ?? false)
                          }
                          onSweepToggle={(toggledId, gesture) => {
                            if (blockedIds?.has(toggledId) ?? false) {
                              setSweepRefusal(
                                `"${thread.displayTitle}" still has live children, so it cannot join a sweep.`,
                              );
                              return;
                            }
                            if (isDoneProjection) {
                              setSweepRefusal(
                                `"${thread.displayTitle}" is a family's Done card, not a done thread.`,
                              );
                              return;
                            }
                            if (gesture.shiftKey) {
                              // Shift extends: anchor through this card in
                              // display order, ids that may not join skipped.
                              // The anchor itself stays put — only non-shift
                              // clicks move it.
                              const anchor =
                                sweepAnchorRef.current?.columnId === column.id
                                  ? sweepAnchorRef.current.threadId
                                  : null;
                              onSweepRangeSelect?.(
                                sweepRangeIds(
                                  shownThreads.map((candidate) => candidate.id),
                                  anchor,
                                  toggledId,
                                  cardMayJoinSweep,
                                ),
                              );
                              return;
                            }
                            // Plain and cmd/ctrl clicks toggle one card —
                            // the mode's curation gesture — and become the
                            // next shift-click's anchor.
                            sweepAnchorRef.current = {
                              columnId: column.id,
                              threadId: toggledId,
                            };
                            onSweepToggle?.(toggledId);
                          }}
                          projectName={projectNameFor(thread.projectId)}
                          repoHrefBase={repoBaseFor(thread.projectId) ?? undefined}
                          statusFor={statusFor}
                          linkedIssues={linkedIssuesFor?.(thread.id)}
                          menuActions={menuActionsFor(thread)}
                          childThreads={
                            isDoneProjection
                              ? projectionChildren
                              : nestedChildrenByParent.get(thread.id)
                          }
                          childCount={
                            isDoneProjection
                              ? (projectionChildren?.length ?? 0)
                              : (childCountByParent.get(thread.id) ?? 0)
                          }
                          isCollapsed={collapsedFamilyIds?.has(thread.id)}
                          onCollapsedChange={(collapsed) =>
                            onFamilyCollapsedChange?.(thread.id, collapsed)
                          }
                          snoozeFor={snoozeFor}
                          doneIds={doneIds}
                          activeThreadId={activeThreadId}
                          dimmed={dimmedIds.has(thread.id)}
                          onOpen={() => onOpenThread(thread.id)}
                          onOpenThread={onOpenThread}
                          childMenuActions={menuActionsFor}
                          rankKey={ranking ? rankKey : undefined}
                          onRankDragStart={(id) => {
                            draggingIdRef.current = id;
                            // Any drag in flight is the board's signal to grow
                            // the column headers (they are detach targets the
                            // whole time a family drag lives).
                            setDragInFlight(id !== null);
                            // A drag that ends anywhere but a successful drop
                            // (Escape, a refused target) must not leave its
                            // insertion line on screen.
                            if (id === null) clearRankDrop();
                          }}
                        />
                      </li>
                      );
                    })}
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

/**
 * jsdom (the test environment) does not implement `CSS.escape`; real
 * browsers do. Column ids are code constants (done, awhile), so the
 * fallback is exact for them and safe for anything else.
 */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

/**
 * Disarm an armed sweep when the operator clicks anywhere else. Clicks on
 * cards inside the armed column do NOT disarm: in sweep mode those clicks
 * toggle the card's selection. The sweep button, the cancel button, the
 * armed column's cards, and Escape are the only surfaces that keep the mode
 * alive; anything else (empty board area, another column, a header) ends it.
 */
export function useSweepClickAway(
  armedColumnId: string | null,
  onDisarm: () => void,
): void {
  useEffect(() => {
    if (armedColumnId === null) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-sweep-button], [data-sweep-cancel]")) return;
      if (
        target.closest(
          `[data-column-id="${cssEscape(armedColumnId)}"] [data-thread-card]`,
        )
      ) {
        return;
      }
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
  }, [armedColumnId, onDisarm]);
}