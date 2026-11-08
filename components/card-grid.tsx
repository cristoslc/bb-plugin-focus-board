// The ungrouped view's card grid (issue #416): every card the board's filters
// pass, laid out in a responsive grid that fills the width, with NO lanes —
// no column containers, no headers, no lane menus, no drag order.
//
// Why its own module rather than a branch inside components/board: the lane
// board's whole vocabulary is lane-borne. Its card slot carries a rank key,
// a transport play, a box role, a sweep highlight and a lane id; none of
// those exist here, and threading a "grid" flag through every one of them
// would leave a lane board that is half grid. What the grid DOES share is the
// card itself (ThreadCard), so this component renders that same card with the
// lane-only wiring left off, and the board keeps one card component.
//
// The order is the operator's (components/grid-sort): the grid is a total,
// data-driven sort, so a card's place is recomputed from its own fields on
// every render, never from a stored hand order.
import { useMemo, type MouseEvent, type ReactNode, type Ref } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn } from "./grouping";
import { compareGridSort, type GridSort } from "./grid-sort";
import type { CardMenuAction } from "./thread-card-menu";
import type { ThreadLink } from "../lib/link-metadata";
import { ThreadCard } from "./thread-card";
import { StateDot } from "./state-dot";
import { cn } from "@/lib/utils";

export interface CardGridProps {
  /**
   * The grid's scroll container, owned by the caller so the board's own
   * "keep the open card in view" and reveal logic (components/board) works
   * on the grid exactly as it does on the lane scroller.
   */
  containerRef?: Ref<HTMLDivElement>;
  /**
   * The assembled board's columns. The grid does NOT render them as lanes:
   * it flattens them into one card list. The assembly still splits Pinned
   * and Done into their own columns (a live parent's Done projection is
   * built there), so flattening is how a grid takes every card without
   * re-deriving the assembly's family and projection rules.
   */
  columns: readonly BoardColumn[];
  /** The operator's chosen order (components/grid-sort). */
  gridSort: GridSort;
  /** The thread open in the pane; its card wears the focus marker. */
  activeThreadId: string | null;
  doneIds: ReadonlySet<string>;
  /** Clear-error acknowledgment ids (issue #157): acked error dots sit quiet. */
  errorAckIds?: ReadonlySet<string>;
  /** Parent id → children that render as nested rows under the parent card. */
  nestedChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /**
   * Parent id → ALL its visible children (raw family index): the child-count
   * chip counts children that render standalone too.
   */
  childCountByParent: ReadonlyMap<string, number>;
  /**
   * Parent id → the children marked done that the assembly moved into the
   * Done space. The lane board renders those under a second (projection)
   * card in the Done lane; the grid has no lane, so they ride the family's
   * own card (see `rowsFor`).
   */
  doneChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Family members that did not match the active filters; rendered dimmed. */
  dimmedIds: ReadonlySet<string>;
  /** Parent ids whose nested rows are collapsed, persisted by the caller. */
  collapsedFamilyIds?: ReadonlySet<string>;
  /** Reports a family card's collapse/expand gesture (parent id, new state). */
  onFamilyCollapsedChange?: (parentId: string, collapsed: boolean) => void;
  /** Parent ids whose families hide their idle children, persisted by the caller. */
  hideIdleFamilyIds?: ReadonlySet<string>;
  /** Reports a family card's idle-filter gesture (fold key, hidden state). */
  onFamilyHideIdleChange?: (parentId: string, hide: boolean) => void;
  projectNameFor: (projectId: string) => string;
  /** GitHub repo base per project ("https://github.com/owner/repo"), when known. */
  repoBaseFor: (projectId: string) => string | null;
  /** GitHub cache status for a repo slug + number, when known. */
  statusFor?: (repo: string | null, number: number | undefined) =>
    | { kind: string; state: string }
    | undefined;
  /** The board's own GitHub links per thread id (metadata "linkedIssues"). */
  linkedIssuesFor?: (threadId: string) => ThreadLink[] | undefined;
  /** Hrefs tracker_validate confirmed; text refs chip only for these. */
  validatedHrefs?: ReadonlySet<string>;
  onOpenThread: (threadId: string) => void;
  /**
   * The board's own background-click rule (components/board
   * `handleBackgroundClick`): a click on empty grid area closes the open
   * pane, while a click on a card, a control, or a menu never does. Passed
   * in rather than re-invented so the grid and the lane board share one
   * rule.
   */
  onBackgroundClick?: (event: MouseEvent<HTMLDivElement>) => void;
  /** Right-click menu actions for one thread, sidebar-menu style. */
  menuActionsFor: (thread: PluginSidebarThread) => readonly CardMenuAction[];
  /**
   * Snooze wake lookup (lib/snooze): the wake epoch-ms for a snoozed thread,
   * null otherwise. Wired through to cards — dim in place and the wake chip.
   */
  snoozeFor?: (threadId: string) => number | null;
  /**
   * Token burn rate lookup in tokens per second (issue #279), for the folded
   * family dot strip's `working` pulse.
   */
  pulseRateFor?: (threadId: string) => number | undefined;
  /**
   * Attention reporting (components/attention-freeze). The grid reports the
   * same enter/leave events the lane board does so the pane and chip paths
   * see one stream; the freeze's PLACEMENT pins are a lane affordance the
   * grid does not have (there is no lane to pin a card into), so what the
   * capture does with a grid card is nothing — the grid's order is the sort.
   */
  onAttentionEnter?: (threadId: string) => void;
  onAttentionLeave?: (threadId: string) => void;
}

/**
 * A family card's rows in the grid: its live nested children, then the
 * children that were marked done. The lane board splits those two halves
 * across the live card and a second card in the Done lane (the projection);
 * the grid has no Done lane, so ONE card carries the whole family and the
 * done rows read dimmed at the end of the list, exactly as a done child row
 * always reads. Both halves arrive already ordered by the assembly.
 */
function rowsFor(
  thread: PluginSidebarThread,
  nestedChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>,
  doneChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): readonly PluginSidebarThread[] {
  const live = nestedChildrenByParent.get(thread.id) ?? [];
  const done = doneChildrenByParent.get(thread.id) ?? [];
  return done.length === 0 ? live : [...live, ...done];
}

/**
 * The done rows a card now shows, counted the way the card's chip counts
 * them: each done child plus everything nesting under it.
 */
function countDoneRows(
  doneRowsByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>,
  nestedRowsByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>,
  parentId: string,
): number {
  let count = 0;
  for (const row of doneRowsByParent.get(parentId) ?? []) {
    count += 1;
    for (const sub of nestedRowsByParent.get(row.id) ?? []) {
      count += 1 + nestedRowCount(nestedRowsByParent, sub.id);
    }
  }
  return count;
}

function nestedRowCount(
  nestedRowsByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>,
  parentId: string,
): number {
  let count = 0;
  for (const row of nestedRowsByParent.get(parentId) ?? []) {
    count += 1 + nestedRowCount(nestedRowsByParent, row.id);
  }
  return count;
}

export function CardGrid({
  containerRef,
  columns,
  gridSort,
  activeThreadId,
  doneIds,
  errorAckIds,
  nestedChildrenByParent,
  childCountByParent,
  doneChildrenByParent,
  dimmedIds,
  collapsedFamilyIds,
  onFamilyCollapsedChange,
  hideIdleFamilyIds,
  onFamilyHideIdleChange,
  projectNameFor,
  repoBaseFor,
  statusFor,
  linkedIssuesFor,
  validatedHrefs,
  onOpenThread,
  onBackgroundClick,
  menuActionsFor,
  snoozeFor,
  pulseRateFor,
  onAttentionEnter,
  onAttentionLeave,
}: CardGridProps) {
  // Pinned and Done come back from the assembly as their own columns. The
  // grid draws them as cards like any other: no pinned section, no done
  // section, no lane. The pin and the done dimming are card-level facts and
  // survive the flatten.
  //
  // A family's Done PROJECTION card is skipped: it is the Done lane's half of
  // a live parent (the parent's done children, carried under their own card
  // in that lane). With no lane there is nothing to project, and rendering it
  // would show one thread twice under the same title. The live card carries
  // those done rows itself (`rowsFor`), so no child goes missing.
  const cards = useMemo<readonly PluginSidebarThread[]>(() => {
    const out: PluginSidebarThread[] = [];
    for (const column of columns) {
      for (const thread of column.threads) {
        if (column.id === "done" && !doneIds.has(thread.id)) continue;
        out.push(thread);
      }
    }
    return out;
  }, [columns, doneIds]);

  const ordered = useMemo<readonly PluginSidebarThread[]>(
    () => [...cards].sort((a, b) => compareGridSort(a, b, gridSort)),
    [cards, gridSort],
  );

  return (
    <div
      ref={containerRef}
      // The grid's own scroll surface: the board's height, scrolling
      // vertically as the rows multiply. Clicking empty space closes the
      // pane through the board's own rule, exactly as it does between lanes.
      onClick={onBackgroundClick}
      data-card-grid-board=""
      className={cn(
        "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-2",
        // A touch on the grid is a PAN: both axes stay with the scroller,
        // and the double-tap-zoom guess is dropped (issue #328's rule for
        // every board surface).
        "touch-manipulation overscroll-contain",
      )}
    >
      <ul
        data-card-grid=""
        // The grid's geometry: as many fixed-minimum tracks as the width
        // affords, each stretching to fill the leftover. `auto-fill` (never
        // `auto-fit`) so a two-card board does not stretch those two cards
        // across the window as though the board were that empty on purpose.
        className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] items-start gap-2"
      >
        {ordered.map((thread) => (
          <li key={thread.id} data-grid-card={thread.id} className="min-w-0">
            <GridCard
              thread={thread}
              activeThreadId={activeThreadId}
              doneIds={doneIds}
              errorAckIds={errorAckIds}
              nestedChildrenByParent={nestedChildrenByParent}
              childCountByParent={childCountByParent}
              doneChildrenByParent={doneChildrenByParent}
              dimmedIds={dimmedIds}
              collapsedFamilyIds={collapsedFamilyIds}
              onFamilyCollapsedChange={onFamilyCollapsedChange}
              hideIdleFamilyIds={hideIdleFamilyIds}
              onFamilyHideIdleChange={onFamilyHideIdleChange}
              projectNameFor={projectNameFor}
              repoBaseFor={repoBaseFor}
              statusFor={statusFor}
              linkedIssuesFor={linkedIssuesFor}
              validatedHrefs={validatedHrefs}
              onOpenThread={onOpenThread}
              menuActionsFor={menuActionsFor}
              snoozeFor={snoozeFor}
              pulseRateFor={pulseRateFor}
              onAttentionEnter={onAttentionEnter}
              onAttentionLeave={onAttentionLeave}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One grid card. Everything the lane board wires per card that is NOT lane
 * mechanics: the pane-open click, the context menu, done/pin/attention
 * visuals, the family rows and their fold, snooze and the ticket chips. The
 * lane-only wiring — rank key, drag lifecycle, sweep selection, transport
 * play, group-box role — is absent by design: dragging a card in a grid has
 * no order to write, and a sweep is armed per lane.
 */
function GridCard({
  thread,
  ...rest
}: { thread: PluginSidebarThread } & Omit<
  CardGridProps,
  "containerRef" | "columns" | "gridSort" | "onBackgroundClick"
>): ReactNode {
  const {
    activeThreadId,
    doneIds,
    errorAckIds,
    nestedChildrenByParent,
    childCountByParent,
    doneChildrenByParent,
    dimmedIds,
    collapsedFamilyIds,
    onFamilyCollapsedChange,
    hideIdleFamilyIds,
    onFamilyHideIdleChange,
    projectNameFor,
    repoBaseFor,
    statusFor,
    linkedIssuesFor,
    validatedHrefs,
    onOpenThread,
    menuActionsFor,
    snoozeFor,
    pulseRateFor,
    onAttentionEnter,
    onAttentionLeave,
  } = rest;
  const actions = menuActionsFor(thread);
  // The family's size as THIS card shows it: its live nested children (the
  // assembly's chip count) plus the done children the grid moved onto the
  // same card, so the chip never names fewer rows than the card renders.
  const childCount =
    (childCountByParent.get(thread.id) ?? 0) +
    countDoneRows(doneChildrenByParent, nestedChildrenByParent, thread.id);
  return (
    <ThreadCard
      thread={thread}
      stateDot={<StateDot thread={thread} errorAcks={errorAckIds} />}
      isActive={thread.id === activeThreadId}
      isDone={doneIds.has(thread.id)}
      onAttentionEnter={onAttentionEnter}
      onAttentionLeave={onAttentionLeave}
      projectName={projectNameFor(thread.projectId)}
      repoHrefBase={repoBaseFor(thread.projectId) ?? undefined}
      statusFor={statusFor}
      linkedIssues={linkedIssuesFor?.(thread.id)}
      childLinkedIssuesFor={linkedIssuesFor}
      validatedHrefs={validatedHrefs}
      menuActions={actions}
      // The hover checkbox shares the menu's done recipe (one source of
      // truth), in both directions.
      onMarkDone={actions.find((action) => action.id === "done")?.run}
      childThreads={rowsFor(thread, nestedChildrenByParent, doneChildrenByParent)}
      grandchildThreadsByParent={nestedChildrenByParent}
      childCount={childCount}
      // One card per thread, so the fold is keyed by the thread itself — the
      // same key the lane board's LIVE card uses (only its Done projection
      // carries the separate `done:` key).
      isCollapsed={collapsedFamilyIds?.has(thread.id)}
      onCollapsedChange={(collapsed) => onFamilyCollapsedChange?.(thread.id, collapsed)}
      hideIdleChildren={hideIdleFamilyIds?.has(thread.id)}
      onHideIdleChildrenChange={(hide) => onFamilyHideIdleChange?.(thread.id, hide)}
      snoozeFor={snoozeFor}
      pulseRateFor={pulseRateFor}
      doneIds={doneIds}
      activeThreadId={activeThreadId}
      dimmed={dimmedIds.has(thread.id)}
      onOpen={() => onOpenThread(thread.id)}
      onOpenThread={onOpenThread}
      childMenuActions={menuActionsFor}
      // No drag in the grid: a card is not a drag source, so no lift appears
      // promising a reorder or a nest write the grid cannot honour.
      dragEnabled={false}
    />
  );
}
