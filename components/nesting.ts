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
  doneRecencyCompare,
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
  /** Parent id → its non-archived children, in input order. */
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Child id → its parent's id; absent for roots (including cycle members and orphans). */
  parentOf: ReadonlyMap<string, string>;
  /**
   * Child id → its RAW parent id — before the two-level display flattening
   * re-homes grandchildren onto roots. The re-parent guard must walk real
   * chains (a grandchild onto its grandparent is a change, not a no-op), so
   * the flattened map cannot serve there.
   */
  rawParentOf: ReadonlyMap<string, string>;
  /** Visible threads that are not nested under any parent, in input order. */
  rootIds: ReadonlySet<string>;
}

export interface NestingResult {
  columns: BoardColumn[];
  /** Parent id → the live children that render nested under its card. */
  childrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /**
   * Parent id → the done children that render nested under the family's
   * projection card in the Done column. Only live parents get entries: a
   * done parent's done children nest via `childrenByParent` under the
   * parent's own Done card.
   */
  doneChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
}

export interface BoardAssembly {
  columns: BoardColumn[];
  /** Parent id → children that render as nested rows under the parent card. */
  nestedChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /** Parent id → done children nested under the family's Done projection card. */
  doneChildrenByParent: ReadonlyMap<string, readonly PluginSidebarThread[]>;
  /**
   * Parent id → the number the card's child-count chip shows: the children
   * in the card's OWN space. A live parent counts its live children (nested
   * rows plus any that render standalone in the active space); a done parent
   * counts the rows its Done card carries. A family split across spaces — a
   * live card plus its Done projection — reads one count per card, and the
   * two sum to the family size. Empty when nesting is disabled — chips are
   * meaningless on a flat board.
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
  /**
   * Thread id → epoch-ms done stamp, for the done-children rows under a done
   * parent's Done card (newest done first). The Done column itself does not
   * read stamps: the idle sweep marks long-idle threads Done with a fresh
   * stamp, so a stamp-ordered column vaults quiet threads above recently
   * active ones.
   */
  doneTimes?: ReadonlyMap<string, number>;
  /**
   * Threads marked Done. `childPlacement` needs them: a Done parent stays in
   * the Done lane, so its live children still promote (raw-state
   * comparison); its done children nest under its Done card; a live
   * parent's done children project into the Done column.
   */
  doneIds?: ReadonlySet<string>;
}

/**
 * The full columns-plus-nesting assembly the board renders, in one call — the
 * composition app.tsx wires. `nestedChildrenByParent` (from
 * `nestUnderParents`, NOT the raw index) is what renders as child rows, so a
 * promoted (live child of a Done parent) or cross-axis child never appears
 * both as a standalone card and as a nested row. `doneChildrenByParent` is
 * what renders under a family's Done projection card. `childCountByParent`
 * counts each card's own space (see `BoardAssembly`).
 *
 * R4: under the status grouping, `familyColumnOverrides` places each family
 * in the column of its most attention-requiring live member, so the parent
 * card carries the family's urgency and its children nest under it.
 *
 * Archived children are hidden outright: `buildFamilyIndex` excludes
 * archived members, so an archived child renders nowhere and a child of an
 * archived parent re-roots and renders standalone. `buildColumns` also never
 * sees an archived thread.
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
  // Archived threads never take a column slot; the family index drops them
  // too (buildFamilyIndex is the single authoritative hide), so an archived
  // child renders nowhere at all — matching bb's sidebar, where archiving
  // removes the thread from the list.
  const visible = threads.filter((thread) => !thread.isArchived);
  if (!nestingEnabled) {
    return {
      columns: buildColumns(
        visible,
        groupBy,
        context,
        frozenColumns,
        doneIds,
        now,
        ranks,
      ),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map(),
    };
  }
  // One family index serves all the passes: the R4 column overrides, the
  // nesting pass, the Done projection, and the chip counts all read the same
  // parent→children map (archived members already excluded by the index).
  const familyIndex = buildFamilyIndex(visible);
  // R4: under the status grouping a family lands in the column of its most
  // attention-requiring live member, so the parent card carries the family's
  // urgency instead of splitting from its children.
  const columnOverrides = familyColumnOverrides(
    visible,
    familyIndex,
    groupBy,
    context,
    doneIds,
  );
  const nested = nestUnderParents(
    buildColumns(
      visible,
      groupBy,
      context,
      frozenColumns,
      doneIds,
      now,
      ranks,
      columnOverrides,
    ),
    visible,
    groupBy,
    context,
    now,
    familyIndex,
    // assembleBoard owns doneIds positionally; inject it so childPlacement
    // can keep the Done-lane promotion rule.
    { ...options, doneIds },
  );
  // The chip counts the children in the card's own space: a live parent
  // counts its live children; a done parent counts the rows its Done card
  // carries (done children plus any live child quiet enough to nest there).
  const threadById = new Map(visible.map((thread) => [thread.id, thread]));
  const childCountByParent = new Map<string, number>();
  for (const [parentId, children] of familyIndex.childrenByParent) {
    const parent = threadById.get(parentId);
    childCountByParent.set(
      parentId,
      parent !== undefined && doneIds.has(parent.id)
        ? (nested.childrenByParent.get(parentId)?.length ?? 0)
        : children.filter((child) => !doneIds.has(child.id)).length,
    );
  }
  return {
    columns: nested.columns,
    nestedChildrenByParent: nested.childrenByParent,
    doneChildrenByParent: nested.doneChildrenByParent,
    childCountByParent,
  };
}

export interface FamilyFilterResult {
  kept: PluginSidebarThread[];
  /** Members of kept families that do not themselves match the filters. */
  dimmedIds: ReadonlySet<string>;
}

/**
 * Build parent→children / child→parent maps from the thread set. This index
 * is the single authoritative place where archived members are hidden: an
 * archived child is indexed under nothing (it renders nowhere, in either
 * board view), and a child whose parent is archived re-roots — the parent is
 * not "present" — so it renders standalone instead of under a card that
 * never renders. A `parentThreadId` that points at a thread not in the set
 * (deleted) leaves the child a root — flat fallback. Corrupt parent cycles
 * are treated as roots: cycle members keep their cards instead of hanging
 * the board.
 *
 * Depth cap (two levels, everywhere): every family renders parent → children
 * only. A thread whose parent itself has a parent re-attaches to its family
 * root, so no member is ever multiple display tiers deep; the raw data is
 * untouched.
 */
export function buildFamilyIndex(threads: readonly PluginSidebarThread[]): FamilyIndex {
  // Archived members are dropped at the door: archived children are hidden
  // outright, and archived parents leave their children rootless.
  const visible = threads.filter((thread) => !thread.isArchived);
  const present = new Set(visible.map((thread) => thread.id));
  const parentOf = new Map<string, string>();

  for (const thread of visible) {
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
  for (const thread of visible) {
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
  // Depth cap (two levels, everywhere): a thread whose parent itself has a
  // parent re-attaches to its family root, so every descendant renders as a
  // real child of the root — never hidden behind a `+N more` chip. Chains
  // were flattened before this walk; every edge now points at a root.
  const displayParentOf = new Map(parentOf);
  for (const thread of visible) {
    const chain: string[] = [];
    let cursor = thread.id;
    while (displayParentOf.has(cursor)) {
      chain.push(cursor);
      cursor = displayParentOf.get(cursor) as string;
    }
    for (const id of chain) displayParentOf.set(id, cursor);
  }

  for (const thread of visible) {
    const parentId = displayParentOf.get(thread.id);
    if (parentId === undefined) continue;
    const siblings = childrenByParent.get(parentId);
    if (siblings === undefined) childrenByParent.set(parentId, [thread]);
    else siblings.push(thread);
  }

  const rootIds = new Set(
    visible.filter((thread) => !displayParentOf.has(thread.id)).map((thread) => thread.id),
  );
  return { childrenByParent, parentOf: displayParentOf, rawParentOf: parentOf, rootIds };
}

/**
 * Where does a child render relative to its parent in this grouping? Returns
 * `"nest"` (rows under the parent's own card), `"done"` (rows under the
 * family's projection card in the Done column), or `"flat"` (the child keeps
 * its standalone column placement).
 *
 * - Done children live in the Done space, under the family's card there:
 *   under the parent's own card when the parent is done, otherwise under the
 *   family's projection card — regardless of grouping or axis. Done is its
 *   own space, and the family is a projection: its active card and its Done
 *   card can exist at once.
 * - Attention children (a pending interaction or an unread error) never
 *   nest, in any grouping: they stand alone as their own cards, so a
 *   collapsed family card stays folded while the child that needs the
 *   operator surfaces in its own right. When the attention resolves the
 *   child returns to the nest — the rule reads live state, not history.
 * - R4 (status grouping): the live family moves as one unit into the column
 *   of its most attention-requiring nested member (`familyColumnOverrides`
 *   lifts the parent card there), so every live child of a live parent
 *   nests. The promotion rule survives only where the family cannot
 *   relocate: a Done parent keeps its Done-lane card, and a live child
 *   promotes when its raw state demands more attention than the parent's.
 * - Axis match (project/provider/machine): a live child nests only when its
 *   axis key matches its parent's; otherwise it stays flat in its own axis
 *   column.
 * - Recency / None: columns are per-thread presentation, not grouping
 *   boundaries — always nest.
 */
type ChildPlacement = "nest" | "done" | "flat";

function childPlacement(
  child: PluginSidebarThread,
  parent: PluginSidebarThread,
  groupBy: GroupBy,
  doneIds: ReadonlySet<string>,
): ChildPlacement {
  if (doneIds.has(child.id)) {
    return doneIds.has(parent.id) ? "nest" : "done";
  }
  // Attention children stand alone, ahead of every nesting rule: the family
  // card may be collapsed (a persisted fold), and a child that needs the
  // operator must surface as its own actionable card, not hide behind a
  // fold. The rest of the rows stay collapsed under the parent.
  if (threadState(child) === "attention") {
    return "flat";
  }
  if (groupBy === "status") {
    if (doneIds.has(parent.id)) {
      // Done parent: the family stays in the Done lane; keep the raw-state
      // comparison so an attention-hungry live child promotes.
      return stateRank(threadState(child)) >= stateRank(threadState(parent)) ? "nest" : "flat";
    }
    // R4: live parent — the family moves as one unit, every live child nests.
    return "nest";
  }
  if (groupBy === "project" || groupBy === "provider") {
    const key = groupBy === "project" ? child.projectId : child.providerId;
    const parentKey = groupBy === "project" ? parent.projectId : parent.providerId;
    return key === parentKey ? "nest" : "flat";
  }
  if (groupBy === "machine") {
    return (child.host?.id ?? "none") === (parent.host?.id ?? "none") ? "nest" : "flat";
  }
  return "nest"; // recency / none
}

function stateRank(state: ThreadState): number {
  const index = STATUS_COLUMN_ORDER.indexOf(state);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * R4: under the status grouping, where should each family land? The family
 * (a root and its nested descendants) appears in the column of its most
 * attention-requiring NESTED member — the smallest state rank across members
 * that are neither archived (stale status must not demand attention), done
 * (the Done lane is a placement of its own), nor attention (a child that
 * needs the operator un-nests and demands it from its own card — it must not
 * drag the quiet family out of its own lane with it). The root's OWN
 * attention still lifts: the family belongs where the parent card already
 * points. The returned map is keyed by family ROOT id, so only roots — the
 * cards that take column slots — read it; promoted children of Done parents
 * and axis-flat children keep their own placements.
 *
 * An all-idle family gets no entry: `threadState` collapses idle to one
 * value, so every idle member ties — the family keeps the parent's own
 * bucket. The parent card's raw state badge is untouched: this is a
 * placement rule, not a state rewrite.
 */
export function familyColumnOverrides(
  threads: readonly PluginSidebarThread[],
  familyIndex: FamilyIndex,
  groupBy: GroupBy,
  context: GroupingContext,
  doneIds: ReadonlySet<string>,
): ReadonlyMap<string, { id: string; label: string }> {
  if (groupBy !== "status") return new Map();
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const overrides = new Map<string, { id: string; label: string }>();
  for (const rootId of familyIndex.rootIds) {
    const root = byId.get(rootId);
    if (root === undefined || root.isArchived || doneIds.has(rootId)) continue;
    // Walk the whole family (root + descendants); only members that stay in
    // the nest lift it — the root's own attention included.
    const live: PluginSidebarThread[] = [];
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const member = byId.get(id);
      if (member === undefined) continue;
      if (
        !member.isArchived &&
        !doneIds.has(member.id) &&
        (member.id === rootId || threadState(member) !== "attention")
      ) {
        live.push(member);
      }
      for (const grandchild of familyIndex.childrenByParent.get(id) ?? []) {
        stack.push(grandchild.id);
      }
    }
    let best: PluginSidebarThread | undefined;
    let bestRank = Number.MAX_SAFE_INTEGER;
    for (const member of live) {
      const rank = stateRank(threadState(member));
      if (rank < bestRank) {
        bestRank = rank;
        best = member;
      }
    }
    if (best === undefined || bestRank === Number.MAX_SAFE_INTEGER) continue;
    overrides.set(rootId, columnFor(best, "status", context));
  }
  return overrides;
}

/**
 * Pull nested children out of their column placement and attach them under
 * their parent's card. Applies these rules (see `childPlacement`):
 *
 * - Done children project into the Done space: a live parent's done children
 *   move under the family's projection card in the Done column — a second
 *   rendering of the parent's card, because the family is a projection and
 *   can exist in both spaces at once — while a done parent's done children
 *   nest under the parent's own Done card.
 * - R4 (status grouping): the live family moves as one unit into the column
 *   of its most attention-requiring live member (see `familyColumnOverrides`),
 *   and every live child of a live parent nests. Live children of a Done
 *   parent still promote when their state demands attention (the Done lane
 *   cannot relocate).
 * - Axis match (project/provider/machine): a live child nests only when its
 *   axis key matches its parent's; otherwise it stays flat in its own column.
 *   Recency and None groupings always nest.
 *
 * `childrenByParent` holds each parent's live nested children sorted
 * urgent-first, then in the same order the columns use (pinned-first,
 * newest-first; manual ranks within each tier) — see `sortNestedByColumnRank`;
 * a done parent's rows sort by done recency (the Done column itself orders
 * by activity recency).
 * `doneChildrenByParent` holds each projection's done children sorted newest
 * done first. Grandchildren are never placed separately: the family index
 * flattens every descendant onto the root, so a child that itself has
 * children surfaces as real sibling rows.
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
  const doneIds = options.doneIds ?? new Set<string>();
  const doneTimes = options.doneTimes ?? new Map<string, number>();

  // R3: nesting disabled — a fully flat board. Columns pass through
  // untouched (the caller has already kept archived threads out of them);
  // no child nests, no rows, no chips, no projections.
  if (options.nestingEnabled === false) {
    return { columns: [...columns], childrenByParent: new Map(), doneChildrenByParent: new Map() };
  }

  // Decide, per child, where it renders: rows under the parent's own card,
  // rows under the family's Done projection card, or standalone. Flat
  // children keep their column placement; the other two leave the column
  // lists entirely. The family index has already dropped archived members,
  // so neither side of an edge is archived (the guards below are defense for
  // a caller whose threads array disagrees with the index it passed).
  const nested = new Map<string, PluginSidebarThread[]>();
  const doneNested = new Map<string, PluginSidebarThread[]>();
  const flatIds = new Set<string>();
  for (const [childId, parentId] of index.parentOf) {
    const child = threadById.get(childId);
    const parent = threadById.get(parentId);
    if (child === undefined) continue; // hidden outright (archived children render nowhere)
    if (parent === undefined || parent.isArchived) {
      flatIds.add(childId);
      continue;
    }
    const placement = childPlacement(child, parent, groupBy, doneIds);
    if (placement === "flat") {
      flatIds.add(childId);
      continue;
    }
    const target = placement === "nest" ? nested : doneNested;
    const siblings = target.get(parentId);
    if (siblings === undefined) target.set(parentId, [child]);
    else siblings.push(child);
  }

  // A parent whose children all nest keeps its card; children leave the
  // column lists entirely. Only roots (and promoted/flat children) stay.
  const nestedKeyIds = nestedKeys(nested);
  const doneNestedKeyIds = nestedKeys(doneNested);
  sortNestedByColumnRank(nested, columns, groupBy, ranks, doneTimes);
  // Done-space rows read in the Done column's own order: newest done first.
  for (const children of doneNested.values()) {
    children.sort(doneRecencyCompare(doneTimes));
  }
  // Pinned-lane attention lift: a pinned card whose OWN state needs the
  // operator rises to the top of the lane (a pinned attention child un-nests
  // and surfaces in Needs you instead — see `pinnedAttentionIds`).
  const pinnedAttention = pinnedAttentionIds(columns);

  // The Done projection: each live parent whose done children moved to the
  // Done space also renders a second card there — the family's projection
  // card — with those children nested under it. A done parent needs no
  // projection; its own card already sits in the Done column. Like every
  // card in the Done column, projections order by activity recency, not the
  // done stamp: a projection's recency is its family's most recent touch
  // (max updatedAt over the parent and its done children), so the idle
  // sweep's fresh stamps on long-idle children cannot vault the family.
  const projectionThreads = [...doneNested.keys()]
    .map((id) => threadById.get(id))
    .filter((thread): thread is PluginSidebarThread => thread !== undefined);
  const familyRecency = new Map<string, number>();
  for (const [parentId, children] of doneNested) {
    let recency = threadById.get(parentId)?.updatedAt ?? 0;
    for (const child of children) recency = Math.max(recency, child.updatedAt);
    familyRecency.set(parentId, recency);
  }
  const recencyOf = (thread: PluginSidebarThread): number =>
    familyRecency.get(thread.id) ?? thread.updatedAt;
  const doneRankOrder = orderForColumn(ranks, columnRankKey(groupBy, "done"));
  const withProjections = (cards: readonly PluginSidebarThread[]): PluginSidebarThread[] =>
    [...cards, ...projectionThreads].sort(
      compareByRank(doneRankOrder, (a, b) => {
        const aPinned = a.isPinned ? 0 : 1;
        const bPinned = b.isPinned ? 0 : 1;
        if (aPinned !== bPinned) return aPinned - bPinned;
        return recencyOf(b) - recencyOf(a);
      }),
    );

  const outColumns: BoardColumn[] = columns
    .map((column) => {
      const kept = column.threads.filter(
        (thread) =>
          !nestedKeyIds.has(thread.id) &&
          !doneNestedKeyIds.has(thread.id) &&
          (flatIds.has(thread.id) || index.rootIds.has(thread.id)),
      );
      if (column.id === "pinned") {
        return { ...column, threads: withAttentionFirst(kept, pinnedAttention) };
      }
      if (column.id === "done") {
        return { ...column, threads: withProjections(kept) };
      }
      return { ...column, threads: kept };
    })
    // Nesting drains a column when its every card is a nested child (a live
    // parent carries its whole family into the family column — R4 — and the
    // card itself takes a slot elsewhere). buildColumns never yields an
    // empty bucket: “columns exist only while they hold cards” is the rule
    // that keeps the board readable and that hides Idle·buckets that have
    // aged out or emptied. A lane drained to zero violates it — the board
    // would park an empty lane (header, count 0, maybe a stale drop hint)
    // beside columns that all earn their place. Hide the drained column
    // entirely; if a card leaves the nest it returns to its own column and
    // the lane reappears with it.
    .filter((column) => column.threads.length > 0);
  // A Done column assembled from nothing but projections still earns its
  // place (buildColumns only creates the lane when a done thread exists, and
  // drained done children are its projections' rows — this guards a
  // caller-built column list without one).
  if (projectionThreads.length > 0 && !outColumns.some((column) => column.id === "done")) {
    outColumns.push({ id: "done", label: "Done", threads: withProjections([]) });
  }

  return {
    columns: outColumns,
    childrenByParent: nested,
    doneChildrenByParent: doneNested,
  };
}

/**
 * Which Pinned-lane cards currently need the operator by their OWN state —
 * a pending interaction or an unread error on the pinned thread itself. A
 * pinned card cannot relocate to a Needs-you lane (the state column overrides
 * apply to unpinned roots only), so the attention surfaces where the card
 * already sits: the lane lifts these cards to the top (`withAttentionFirst`)
 * and the card pulses (`ThreadCard`'s attention overlay reads the same
 * state). An attention CHILD of a pinned family is not in this set — it
 * un-nests (`childPlacement`) and demands attention from its own card in
 * Needs you.
 */
export function pinnedAttentionIds(
  columns: readonly BoardColumn[],
): ReadonlySet<string> {
  const pinned = columns.find((column) => column.id === "pinned");
  const ids = new Set<string>();
  if (pinned === undefined) return ids;
  for (const thread of pinned.threads) {
    if (threadState(thread) === "attention") ids.add(thread.id);
  }
  return ids;
}

/**
 * Insert an attention tier above the Pinned lane's own order: attention
 * cards lead; the rest keep their relative order (the stable sort preserves
 * manual ranks underneath).
 */
function withAttentionFirst(
  threads: readonly PluginSidebarThread[],
  attentionIds: ReadonlySet<string>,
): PluginSidebarThread[] {
  return [...threads].sort(
    (a, b) => (attentionIds.has(a.id) ? 0 : 1) - (attentionIds.has(b.id) ? 0 : 1),
  );
}

/**
 * The collapsed-family auto-expand helpers were removed with the un-nest
 * rule: an attention child now leaves the nest entirely (`childPlacement`)
 * instead of expanding the card it hides in, so there is no source set to
 * diff and no transition to fire.
 */

/**
 * Sort each parent's nested children in the order of the column the PARENT
 * sits in. The family moves as one unit: a child's stored rank is an id in
 * that column's list, and the parent is the card the operator actually drags,
 * so the children follow the parent's column order rather than their own
 * (absent) ranks.
 *
 * There is no urgent-first tier: an attention child un-nests
 * (`childPlacement`) and never appears in these rows, so every nested child
 * is quiet and the parent column's own order applies unchanged. An unranked
 * column (or a parent not found in any column) sorts purely by the board's
 * derived order.
 *
 * Rows under a card in the Done column (a done parent's card) read in
 * done-recency order instead: newest done first. The Done column itself
 * orders by activity recency; only these rows keep the done-stamp order.
 */
function sortNestedByColumnRank(
  nested: Map<string, PluginSidebarThread[]>,
  columns: readonly BoardColumn[],
  groupBy: GroupBy,
  ranks: RankStore,
  doneTimes: ReadonlyMap<string, number>,
): void {
  const columnOfThread = new Map<string, string>();
  for (const column of columns) {
    for (const thread of column.threads) columnOfThread.set(thread.id, column.id);
  }
  for (const [parentId, children] of nested) {
    const columnId = columnOfThread.get(parentId);
    if (columnId === "done") {
      children.sort(doneRecencyCompare(doneTimes));
      continue;
    }
    const order =
      columnId === undefined
        ? []
        : orderForColumn(ranks, columnRankKey(groupBy, columnId));
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
 * Family-aware filtering: a family passes when ANY of its members passes the
 * filters or search; every member of a passing family is kept, with
 * non-matching members recorded in `dimmedIds` so the board can render them
 * at reduced opacity. A family where nothing matches is dropped whole.
 *
 * Archived members are hidden outright: the family index carries none of
 * them, so an archived thread in the input forms its own (parentless)
 * family, and since an archived thread never passes the filters its family
 * drops whole — an archived child can neither ride along nor surface its
 * family.
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