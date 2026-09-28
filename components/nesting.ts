import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type {
  BoardColumn,
  FilterState,
  GroupBy,
  GroupingContext,
  ThreadState,
} from "./grouping";
import {
  STATUS_COLUMN_ORDER,
  buildColumns,
  columnFor,
  derivedCompare,
  matchesFilter,
  threadState,
} from "./grouping";
import {
  columnRankKey,
  compareByRank,
  orderForColumn,
  type RankStore,
} from "../lib/rank";

export interface FamilyIndex {
  /** Parent id → its visible children, in input order. */
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Child id → its parent's id; absent for roots (including cycle members and orphans). */
  parentOf: ReadonlyMap<string, string>;
  /** Visible threads that are not nested under any parent, in input order. */
  rootIds: ReadonlySet<string>;
}

export interface NestingResult {
  columns: BoardColumn[];
  /** Parent id → the live children that render nested under its card. */
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
}

export interface BoardAssembly {
  columns: BoardColumn[];
  /** Parent id → children that render as nested rows under the parent card. */
  nestedChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /**
   * Parent id → ALL its children (from the raw family index, archived
   * included). Drives the parent card's child-count chip (and chevron),
   * which counts every child even when some render standalone (promoted /
   * cross-axis). Empty when nesting is disabled — chips are meaningless on a
   * flat board.
   */
  childCountByParent: ReadonlyMap<string, number>;
}

export interface NestingOptions {
  /**
   * R3 "Nest child threads" toggle. `false` renders a fully flat board:
   * every visible (non-archived) thread is a standalone card in its own
   * column slot, no promotion logic, no nested rows, no chips, no `+N` —
   * and archived children do not render at all (they can never be
   * standalone). Default `true`.
   */
  nestingEnabled?: boolean;
  /**
   * Manual column orders, keyed by `columnRankKey`. Threaded into column
   * building AND the nested-sibling sort so a family reads in one order:
   * a parent that honours a rank with children that ignore it is a lie.
   */
  ranks?: RankStore;
}

/**
 * The full columns-plus-nesting assembly the board renders, in one call — the
 * composition app.tsx wires. `nestedChildrenByParent` (from
 * `nestUnderParents`, NOT the raw index) is what renders as child rows, so a
 * promoted or cross-axis child never appears both as a standalone card and as
 * a nested row. `childCountByParent` (from the raw index) is what the
 * child-count chip counts, so a parent still shows its family size when a
 * child stands alone.
 *
 * R2: archived children never take standalone column slots. They are
 * excluded from column building entirely and always nest under their parent
 * (archived overrides the promotion and axis-match rules), so an archived
 * child stays under its parent in every grouping. An archived child whose
 * parent is not in the input (archived or deleted parent) renders nowhere.
 */
export function assembleBoard(
  threads: readonly PluginSidebarThread[],
  groupBy: GroupBy,
  context: GroupingContext,
  frozenColumns: ReadonlyMap<string, { id: string; label: string }> = new Map(),
  doneIds: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
  options: NestingOptions = {},
): BoardAssembly {
  const nestingEnabled = options.nestingEnabled ?? true;
  const ranks = options.ranks ?? {};
  // Archived threads never take a column slot in either mode; when nesting
  // is OFF they render nowhere at all (matching bb's sidebar, where
  // archiving removes the thread from the list).
  const columnThreads = threads.filter((thread) => !thread.isArchived);
  if (!nestingEnabled) {
    return {
      columns: buildColumns(columnThreads, groupBy, context, frozenColumns, doneIds, now, ranks),
      nestedChildrenByParent: new Map(),
      childCountByParent: new Map(),
    };
  }
  // One family index serves both halves: the nesting pass and the chip
  // counts both read the same raw parent→children map (archived children
  // included — they stay under the parent).
  const familyIndex = buildFamilyIndex(threads);
  const nested = nestUnderParents(
    buildColumns(columnThreads, groupBy, context, frozenColumns, doneIds, now, ranks),
    threads,
    groupBy,
    context,
    now,
    familyIndex,
    options,
  );
  const childCountByParent = new Map<string, number>();
  for (const [parentId, children] of familyIndex.childrenByParent) {
    childCountByParent.set(parentId, children.length);
  }
  return {
    columns: nested.columns,
    nestedChildrenByParent: nested.childrenByParent,
    childCountByParent,
  };
}

export interface FamilyFilterResult {
  kept: PluginSidebarThread[];
  /** Members of kept families that do not themselves match the filters. */
  dimmedIds: ReadonlySet<string>;
}

/**
 * Build parent→children / child→parent maps from the non-hidden thread set.
 * The caller passes the already-filtered non-hidden set (app.tsx excludes
 * only hidden threads — archived threads are INCLUDED since R2, so archived
 * children stay under their parent). A `parentThreadId` that points at a
 * thread not in the set (deleted) leaves the child a root — flat fallback.
 * Corrupt parent cycles are treated as roots: cycle members keep their cards
 * instead of hanging the board.
 */
export function buildFamilyIndex(threads: readonly PluginSidebarThread[]): FamilyIndex {
  const present = new Set(threads.map((thread) => thread.id));
  const parentOf = new Map<string, string>();

  for (const thread of threads) {
    const parentId = thread.parentThreadId;
    if (parentId === null || parentId === "" || !present.has(parentId)) continue;
    if (parentId === thread.id) continue; // self-parent is corrupt data
    parentOf.set(thread.id, parentId);
  }

  // Defensive cycle pass: a corrupt `parentThreadId` cycle must not hang the
  // board. Detect every member whose parent chain closes back on itself
  // (before any unlinking, so detection is order-independent), then unlink
  // them all so each renders as a root.
  const cyclic = new Set<string>();
  for (const thread of threads) {
    const start = thread.id;
    const walk = new Set<string>([start]);
    let cursor = parentOf.get(start);
    while (cursor !== undefined) {
      if (cursor === start) {
        cyclic.add(start);
        break;
      }
      if (walk.has(cursor)) break; // joins another walk's cycle; it handles itself
      walk.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
  for (const id of cyclic) parentOf.delete(id);

  const childrenByParent = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const parentId = parentOf.get(thread.id);
    if (parentId === undefined) continue;
    const siblings = childrenByParent.get(parentId);
    if (siblings === undefined) childrenByParent.set(parentId, [thread]);
    else siblings.push(thread);
  }

  const rootIds = new Set(
    threads.filter((thread) => !parentOf.has(thread.id)).map((thread) => thread.id),
  );
  return { childrenByParent, parentOf, rootIds };
}

/**
 * Does a child stay under its parent in this grouping? Returns `true` to
 * nest, `false` to keep the child flat.
 *
 * - R2: an archived child ALWAYS nests — it never takes a standalone column
 *   slot, in any grouping (archived overrides promotion and axis-match).
 * - Promotion (Attention grouping): a child whose state column strictly
 *   precedes its parent's stands alone in its own state column — never bury
 *   a Needs-you child. Done is the rightmost lane, so any live child of a
 *   Done parent promotes. Equal rank nests.
 * - Axis match (project/provider/machine): the child nests only when its
 *   axis key matches its parent's; otherwise it stays flat in its own axis
 *   column.
 * - Recency / None: columns are per-thread presentation, not grouping
 *   boundaries — always nest.
 */
function childNests(
  child: PluginSidebarThread,
  parent: PluginSidebarThread,
  groupBy: GroupBy,
  now: number,
): boolean {
  if (child.isArchived) return true; // R2: archived children always nest
  if (groupBy === "status") {
    return stateRank(threadState(child)) >= stateRank(threadState(parent));
  }
  if (groupBy === "project" || groupBy === "provider") {
    const key = groupBy === "project" ? child.projectId : child.providerId;
    const parentKey = groupBy === "project" ? parent.projectId : parent.providerId;
    return key === parentKey;
  }
  if (groupBy === "machine") {
    return (child.host?.id ?? "none") === (parent.host?.id ?? "none");
  }
  return true; // recency / none
}

function stateRank(state: ThreadState): number {
  const index = STATUS_COLUMN_ORDER.indexOf(state);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Pull nested children out of their column placement and attach them under
 * their parent's card. Applies two rules:
 *
 * - Promotion (Attention grouping): a child whose state column precedes its
 *   parent's stands alone in its own state column — never bury a Needs-you
 *   child. Done is the rightmost lane, so any live child of a Done parent
 *   promotes.
 * - Axis match (project/provider/machine): a child nests only when its axis
 *   key matches its parent's; otherwise it stays flat in its own column.
 *   Recency and None groupings always nest.
 *
 * `childrenByParent` holds each parent's nested children in the same sorted
 * order the columns use (pinned-first, newest-first). Grandchildren are
 * never placed: a child that itself has children surfaces them only through
 * the `+N more` count (`grandchildCountFor`).
 */
export function nestUnderParents(
  columns: readonly BoardColumn[],
  threads: readonly PluginSidebarThread[],
  groupBy: GroupBy,
  context: GroupingContext,
  now: number = Date.now(),
  familyIndex: FamilyIndex = buildFamilyIndex(threads),
  options: NestingOptions = {},
): NestingResult {
  const index = familyIndex;
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const ranks = options.ranks ?? {};

  // R3: nesting disabled — a fully flat board. Columns pass through
  // untouched (the caller has already kept archived threads out of them);
  // no child nests, no rows, no chips.
  if (options.nestingEnabled === false) {
    return { columns: [...columns], childrenByParent: new Map() };
  }

  // Decide, per child, nest vs. flat. Promoted/flat children keep their
  // column placement; nested children are removed from columns.
  const nested = new Map<string, PluginSidebarThread[]>();
  const flatIds = new Set<string>();
  for (const [childId, parentId] of index.parentOf) {
    const child = threadById.get(childId);
    const parent = threadById.get(parentId);
    if (child === undefined || parent === undefined) {
      flatIds.add(childId);
      continue;
    }
    if (childNests(child, parent, groupBy, now)) {
      const siblings = nested.get(parentId);
      if (siblings === undefined) nested.set(parentId, [child]);
      else siblings.push(child);
    } else {
      flatIds.add(childId);
    }
  }

  // A parent whose children all nest keeps its card; children leave the
  // column lists entirely. Only roots (and promoted/flat children) stay.
  const nestedKeyIds = nestedKeys(nested);
  sortNestedByColumnRank(nested, columns, groupBy, ranks);
  const outColumns: BoardColumn[] = columns.map((column) => {
    const kept = column.threads.filter(
      (thread) => !nestedKeyIds.has(thread.id) && (flatIds.has(thread.id) || index.rootIds.has(thread.id)),
    );
    return { ...column, threads: kept };
  });

  return { columns: outColumns, childrenByParent: nested };
}

/**
 * Sort each parent's nested children in the order of the column the PARENT
 * sits in. The family moves as one unit: a child's stored rank is an id in
 * that column's list, and the parent is the card the operator actually drags,
 * so the children follow the parent's column order rather than their own
 * (absent) ranks. With no ranks stored this is a no-op — the derived order
 * already matches what the columns produced.
 */
function sortNestedByColumnRank(
  nested: Map<string, PluginSidebarThread[]>,
  columns: readonly BoardColumn[],
  groupBy: GroupBy,
  ranks: RankStore,
): void {
  const columnOfThread = new Map<string, string>();
  for (const column of columns) {
    for (const thread of column.threads) columnOfThread.set(thread.id, column.id);
  }
  for (const [parentId, children] of nested) {
    const columnId = columnOfThread.get(parentId);
    if (columnId === undefined) continue;
    const order = orderForColumn(ranks, columnRankKey(groupBy, columnId));
    if (order.length === 0) continue;
    children.sort(compareByRank(order, derivedCompare));
  }
}

function nestedKeys(nested: ReadonlyMap<string, readonly PluginSidebarThread[]>): Set<string> {
  const ids = new Set<string>();
  for (const children of nested.values()) {
    for (const child of children) ids.add(child.id);
  }
  return ids;
}

/**
 * The `+N more` number for a level-1 child: how many visible grandchildren it
 * has, i.e. the size of the child's own nested-children entry. Zero means no
 * chip. (The parent card's own entry counts its level-1 children, not
 * grandchildren.)
 */
export function grandchildCountFor(
  child: PluginSidebarThread,
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): number {
  return childrenByParent.get(child.id)?.length ?? 0;
}

/**
 * Family-aware filtering: a family passes when ANY of its members passes the
 * filters or search; every member of a passing family is kept, with
 * non-matching members recorded in `dimmedIds` so the board can render them
 * at reduced opacity. A family where nothing matches is dropped whole.
 *
 * R2: archived members never contribute a match (an archived child matching
 * alone does not surface the family) — they ride along with a passing
 * family, dimmed, and render under the parent with their archived treatment.
 */
export function filterFamilies(
  threads: readonly PluginSidebarThread[],
  familyIndex: FamilyIndex,
  filter: FilterState,
  searchQuery: string,
): FamilyFilterResult {
  const passes = (thread: PluginSidebarThread): boolean =>
    threadPassesFilter(thread, filter, searchQuery);

  // Group visible threads into families by their root, so a parent and its
  // descendants pass or fail together.
  const families = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    let rootId = thread.id;
    let cursor = familyIndex.parentOf.get(thread.id);
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor);
      rootId = cursor;
      cursor = familyIndex.parentOf.get(cursor);
    }
    const family = families.get(rootId);
    if (family === undefined) families.set(rootId, [thread]);
    else family.push(thread);
  }

  const kept: PluginSidebarThread[] = [];
  const dimmedIds = new Set<string>();
  for (const family of families.values()) {
    const matching = family.filter(passes);
    if (matching.length === 0) continue;
    for (const thread of family) {
      kept.push(thread);
      if (!matching.includes(thread)) dimmedIds.add(thread.id);
    }
  }
  return { kept, dimmedIds };
}

/**
 * The per-thread predicate shared by both filters: state/project/provider
 * filters plus search. R2: an archived thread NEVER passes — archived
 * members cannot contribute a match (family filtering) and cannot render
 * standalone (individual filtering).
 */
function threadPassesFilter(thread: PluginSidebarThread, filter: FilterState, searchQuery: string): boolean {
  if (thread.isArchived) return false;
  if (filter.projects.size > 0 && !filter.projects.has(thread.projectId)) return false;
  if (filter.providers.size > 0 && !filter.providers.has(thread.providerId)) return false;
  if (filter.states.size > 0 && !filter.states.has(threadState(thread))) return false;
  if (searchQuery.trim() !== "" && !matchesFilter(thread, searchQuery.trim())) return false;
  return true;
}

/**
 * R3: per-thread filtering for the flat board (nesting toggle OFF). No
 * family keep, no dimming — each thread passes or fails on its own, and
 * archived threads never render in flat mode.
 */
export function filterIndividually(
  threads: readonly PluginSidebarThread[],
  filter: FilterState,
  searchQuery: string,
): FamilyFilterResult {
  const kept: PluginSidebarThread[] = [];
  for (const thread of threads) {
    if (threadPassesFilter(thread, filter, searchQuery)) kept.push(thread);
  }
  return { kept, dimmedIds: new Set() };
}