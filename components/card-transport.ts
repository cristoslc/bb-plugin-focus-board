import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { GroupRunItem } from "./group-boxes";
import { columnRunItems } from "./group-boxes";
import type { GroupBoxMap } from "./group-boxes";

/**
 * The lane-transport dissolve (the Star Trek transporter wipe): when a card
 * relocates between two lanes in one commit it does not teleport-jump any
 * more. Its old lane keeps a ghost card in the exact old slot for the
 * wipe-out, then that slot's space collapses; at its new lane the card sits
 * in the flow from wipe-in's FIRST frame (neighbors reflow as the sweep
 * starts) and dissolves in top-down. Both wipes ease in slightly.
 */

/**
 * Wipe durations: the departure is 400ms; the arrival is deliberately slower
 * (520ms) — the dissolve-in's crawl keeps the arriving slot near-invisible
 * for its first half, and the amber beam needs that longer, visible second
 * half for its glints to read (operator: "maybe slow down arrival more?").
 */
export const TRANSPORT_WIPE_OUT_MS = 400;
export const TRANSPORT_WIPE_IN_MS = 520;
/** The old slot's reserved space closing after the wipe-out. */
export const TRANSPORT_COLLAPSE_MS = 200;

/**
 * "Ease-in", tuned longer at the operator's request: the sweep's first half
 * now crawls (y1 = 0), so the dissolve lingers where the card sat before
 * accelerating into its exit — a slower read than the original slight
 * curve, but still not a full ease-in cubic's hang.
 */
export const TRANSPORT_EASE = "cubic-bezier(0.5, 0, 0.6, 0.4)";

/**
 * The arrival slot's space opening, on its own clock: the operator retuned
 * it ("maybe expand faster than it dissolves in?") — a slow two-ramp read
 * where the slot trails the materialize felt wrong. The grow runs well
 * under the dissolve-in, so the lane's neighbors settle into place early
 * and the shimmer plays over an already-open space.
 */
export const TRANSPORT_GROW_MS = 180;

/**
 * The grow's own easing: ease-out shaped — the space pops open and settles
 * gently, the opposite of the sweeps' deliberate crawl.
 */
export const TRANSPORT_GROW_EASE = "cubic-bezier(0.3, 0.75, 0.4, 1)";

/**
 * Lane moves over this count in ONE commit (a grouping change re-deriving
 * every lane, a batch curation action) skip the dissolve entirely: a whole
 * board of wipe-outs is a view switch's reflow dressed up as an effect, and
 * reads as chaos. Small batches (a sweep confirm moving a handful of cards)
 * keep the effect.
 */
export const TRANSPORT_BATCH_CAP = 12;

// ── The zoom variant (shrink out / grow in) ───────────────────────────────
// A second lane-move animation alongside the transporter dissolve: a card
// leaving a lane zooms OUT (scales down like it is receding into a portal)
// while its old slot's reserved space collapses IN TIME WITH the shrink, and
// the arriving card zooms IN (scales up from small to full) with its new
// slot's space expanding on the SAME clock as the growth, so the space and
// the card land together. Additive by design: the dissolve stays the default
// and a variant is selected by name.

/** Which way a lane's card flow runs (the lane-direction setting's read). */
export type TransportAxis = "vertical" | "horizontal";

/** The lane-transport animation a board plays: the dissolve or the zoom. */
export type TransportVariantId = "dissolve" | "zoom";

/**
 * The variant the board plays until a caller picks one. Module-level so the
 * upcoming transition settings (user-facing selection, including a
 * reduced-motion option) dispatch on a single named value.
 */
export const TRANSPORT_VARIANT: TransportVariantId = "dissolve";

/**
 * The zoom's shrink-out clock: the ghost card recedes while the OLD slot's
 * space closes on the same tick (the dissolve's collapse runs AFTER its
 * wipe; the zoom's runs concurrently). Removed slot, gone transport.
 */
export const TRANSPORT_ZOOM_OUT_MS = 320;

/**
 * The zoom's grow-in clock: the arriving card scales up while its NEW
 * slot's space expands on the same tick, so the space and the card arrive
 * together instead of the space trailing (the dissolve's grow opens early
 * under its dissolve-in; the zoom's IS the arrival).
 */
export const TRANSPORT_ZOOM_IN_MS = 320;

/**
 * The recede's easing: accelerating-away, ease-in shaped — the card picks
 * up speed as it shrinks into the old slot, the opposite of the materialize.
 */
export const TRANSPORT_ZOOM_OUT_EASE = "cubic-bezier(0.45, 0, 0.85, 0.6)";

/**
 * The arrival's easing: ease-out shaped — the card grows in fast and
 * settles gently into its slot, the opposite of the recede's acceleration.
 */
export const TRANSPORT_ZOOM_IN_EASE = "cubic-bezier(0.2, 0.65, 0.3, 1)";

/**
 * The portal scale both directions meet at: the receding card shrinks
 * toward it, the arriving card grows from it — one opening read from both
 * sides. Never 0 (a card would fold through nothing) and never half (the
 * shrink would not read as receding).
 */
export const TRANSPORT_ZOOM_MIN_SCALE = 0.2;

/** A transport's phase timers, per variant — the board's state-machine clock. */
export interface TransportPhasePlan {
  /** The arrival finishes (its hiding styles drop) at this time. */
  settleMs: number;
  /** The old slot's space starts closing at this time (0 = concurrent with the shrink). */
  collapseStartMs: number;
  /** The ghost is removed entirely at this time. */
  removeMs: number;
}

/**
 * The dissolve's phases: wipe-in settles, THEN the wipe-out's end flips the
 * ghost to collapsing, then the collapse's end removes it (operators tuned
 * this order for the transporter read).
 */
export const DISSOLVE_PHASE_PLAN: TransportPhasePlan = {
  settleMs: TRANSPORT_WIPE_IN_MS,
  collapseStartMs: TRANSPORT_WIPE_OUT_MS,
  removeMs: TRANSPORT_WIPE_OUT_MS + TRANSPORT_COLLAPSE_MS,
};

/**
 * The zoom's phases: the slot close rides clock zero (in time with the
 * shrink), the arrival settles at the growth clock, and the shrink's end
 * removes the ghost — the space and the card change lanes together.
 */
export const ZOOM_PHASE_PLAN: TransportPhasePlan = {
  settleMs: TRANSPORT_ZOOM_IN_MS,
  collapseStartMs: 0,
  removeMs: TRANSPORT_ZOOM_OUT_MS,
};

/** The phase timers a variant plays. The board's selection seam. */
export function transportPhasePlan(variant: TransportVariantId): TransportPhasePlan {
  return variant === "zoom" ? ZOOM_PHASE_PLAN : DISSOLVE_PHASE_PLAN;
}

/** One relocated transport unit, planned from the previous commit's snapshot. */
export interface LaneTransport {
  /**
   * The unit id: a card's thread id, or a box run's group id (the dashed
   * container transported as one piece).
   */
  threadId: string;
  /**
   * The PREVIOUS thread snapshot, so the ghost renders pre-move visuals —
   * the unit's anchor card (a run's first member).
   */
  thread: PluginSidebarThread;
  fromColumnId: string;
  /** The unit's slot index in its old lane (a box run occupies member slots). */
  fromIndex: number;
  toColumnId: string;
  /**
   * A run transport's PRE-move member snapshots, in the old column's
   * display order. Absent for single-card transports.
   */
  members?: readonly PluginSidebarThread[];
  /** A run transport's previous box name — the ghost's label. */
  boxName?: string;
}

/** The old lane's ghost state: wiping, then its reserved space collapsing. */
export type TransportOutPhase = "wiping-out" | "collapsing";
/** The new lane's arrival state: the wipe, then the plain card. */
export type TransportArrivalPhase = "wiping-in" | "settled";

/** A `LaneTransport` as the board plays it: generation-stamped, phased. */
export interface TransportPlay extends LaneTransport {
  /** Bumped per plan, so a re-located card restarts its timers and its wipe. */
  gen: number;
  phase: TransportOutPhase;
  arrival: TransportArrivalPhase;
}

/** Tailwind's gap-1.5 on the card lists, in px (the static collapse end-state). */
export const TRANSPORT_ROW_GAP_PX = 6;

/** A rendered column slice. Shaped like BoardColumn, loose for test reuse. */
export interface TransportColumnLike {
  id: string;
  threads: readonly PluginSidebarThread[];
}

/**
 * One thread id → its lane signature. A thread can hold TWO cards (the Done
 * projection renders in Done while the live card stays where it was), so the
 * signature is the SORTED join of every lane holding the card ("done|unread");
 * lane sets that merely gain or lose a member are multiplicity changes, not
 * relocations, and the planner skips them.
 */
export function laneSignature(
  columns: readonly TransportColumnLike[],
): ReadonlyMap<string, string> {
  const byThread = new Map<string, string[]>();
  for (const column of columns) {
    for (const card of column.threads) {
      const lanes = byThread.get(card.id) ?? [];
      if (!lanes.includes(column.id)) lanes.push(column.id);
      byThread.set(card.id, lanes);
    }
  }
  const signature = new Map<string, string>();
  for (const [id, lanes] of byThread) signature.set(id, [...lanes].sort().join("|"));
  return signature;
}

/**
 * Diff the previous lane snapshot against the new columns and plan one
 * transport per card that moved exactly: one lane before, ONE after, different.
 * Vanishing cards (archive, filter), brand-new cards, and multiplicity
 * changes (projection cards appearing or clearing) are plain reflows — the
 * transporter effect is for relocation only.
 *
 * `prevColumns` (the PREVIOUS commit's columns) gives the card's TRUE old
 * slot: the moved card has already left its old lane in the NEXT columns,
 * so a lookup there would degrade every ghost slot to the lane top.
 */
export function planLaneTransports(
  prevLaneByThread: ReadonlyMap<string, string>,
  prevThreads: ReadonlyMap<string, PluginSidebarThread>,
  columns: readonly TransportColumnLike[],
  prevColumns?: readonly TransportColumnLike[],
  prevDisplayIds?: ReadonlyMap<string, readonly string[]>,
): readonly LaneTransport[] {
  const nextLaneByThread = laneSignature(columns);
  const moves: LaneTransport[] = [];
  for (const [threadId, nextLane] of nextLaneByThread) {
    const prevLane = prevLaneByThread.get(threadId);
    if (prevLane === undefined) continue; // brand-new card
    if (prevLane === nextLane) continue; // kept its lane
    if (prevLane.includes("|") || nextLane.includes("|")) continue; // multiplicity change
    const snapshot = prevThreads.get(threadId);
    if (snapshot === undefined) continue; // no ghost visuals available
    // The card's TRUE old slot: the moved card has already left its old
    // lane in the NEXT columns, so the lookup reads the PREVIOUS commit.
    // It reads the previous DISPLAYED order when the caller carries one:
    // the gather walk pulls a group's members together at the frame, so
    // the raw column order and the rendered order can differ, and the
    // ghost must weave against what the lane actually showed. A missing
    // id falls back to the raw slot, and an unfound card clamps to 0 the
    // way the old planner did (a ghost at the lane top beats every ghost
    // slot degrading).
    const prevColumn = (prevColumns ?? columns).find((candidate) => candidate.id === prevLane);
    const prevOrder = prevDisplayIds?.get(prevLane);
    const displayIndex = prevOrder?.indexOf(threadId) ?? -1;
    const fromIndex =
      displayIndex >= 0
        ? displayIndex
        : Math.max(prevColumn?.threads.findIndex((card) => card.id === threadId) ?? -1, 0);
    moves.push({
      threadId,
      thread: snapshot,
      fromColumnId: prevLane,
      fromIndex,
      toColumnId: nextLane,
    });
  }
  return moves;
}

/**
 * A box run as ONE transport unit: the unit the lane diff tracks, so a
 * whole dashed box relocating between lanes plans a single dissolve instead
 * of one per member. Keyed by group id.
 */
export interface RunUnit {
  groupId: string;
  name: string;
  /** The column the unit's box renders in. */
  columnId: string;
  /** The members in the column's own display order (self-inclusive). */
  memberIds: readonly string[];
}

/**
 * The run units per commit, read off the columns' own display order via the
 * same walker the render path uses (one source of truth for what a box is).
 * Only a group that renders WHOLE in one column folds: a unit transport is
 * one dashed shape relocating. Under the split default the walker yields a
 * slice per column — the same box run item appearing in several lanes — and
 * a split group keeps its per-thread transports (each member relocates on
 * its own; one ghost, per lane, is the honest animation for that).
 */
export function runUnits(
  columns: readonly {
    id: string;
    threads: readonly PluginSidebarThread[];
  }[],
  groupBoxOf: GroupBoxMap,
): ReadonlyMap<string, RunUnit> {
  const units = new Map<string, RunUnit>();
  const byGroup = new Map<string, { columns: Set<string>; unit: RunUnit }>();
  for (const column of columns) {
    for (const item of columnRunItems(column, groupBoxOf)) {
      if (item.kind !== "box") continue;
      const groupId = item.box.groupId;
      const existing = byGroup.get(groupId);
      if (existing !== undefined) {
        existing.columns.add(column.id);
        continue;
      }
      const unit: RunUnit = {
        groupId,
        name: item.box.name,
        columnId: column.id,
        memberIds: item.box.members.map((member) => member.id),
      };
      byGroup.set(groupId, { columns: new Set([column.id]), unit });
    }
  }
  for (const [groupId, entry] of byGroup) {
    if (entry.columns.size !== 1) continue; // a split group: per-thread transports
    units.set(groupId, entry.unit);
  }
  return units;
}

/**
 * Fold the per-thread moves into run transports where a box moved cleanly:
 * every member moved, all between the same two lanes, and the membership
 * (ids AND order) unchanged. Anything else — a split, a member joining or
 * leaving while the box relanes, a reordered run — stays per-thread, the
 * same way multiplicity changes stay plain reflows.
 *
 * A folded transport's `threadId` is the group id: the unit the timers, the
 * ghost slot, and the arrival map key on. `members` carries the PRE-move
 * snapshots so the ghost renders the box the board had.
 */
export function collapseRunTransports(
  moves: readonly LaneTransport[],
  prevRunUnits: ReadonlyMap<string, RunUnit> = new Map(),
  nextRunUnits: ReadonlyMap<string, RunUnit> = new Map(),
  prevThreads: ReadonlyMap<string, PluginSidebarThread> = new Map(),
): readonly LaneTransport[] {
  let result = [...moves];
  for (const [groupId, unit] of nextRunUnits) {
    const prevUnit = prevRunUnits.get(groupId);
    if (prevUnit === undefined) continue;
    if (prevUnit.memberIds.join("\u0000") !== unit.memberIds.join("\u0000")) {
      continue; // membership or order changed: not a unit relocation
    }
    const memberMoves: (LaneTransport | undefined)[] = unit.memberIds.map(
      (memberId) => {
        const move = result.find((candidate) => candidate.threadId === memberId);
        if (move === undefined) return undefined;
        if (move.fromColumnId !== prevUnit.columnId || move.toColumnId !== unit.columnId) {
          return undefined;
        }
        return move;
      },
    );
    if (memberMoves.some((move) => move === undefined)) continue;
    const members: PluginSidebarThread[] = [];
    let snapshotsComplete = true;
    for (const memberId of unit.memberIds) {
      const snapshot = prevThreads.get(memberId);
      if (snapshot === undefined) {
        snapshotsComplete = false;
        break;
      }
      members.push(snapshot);
    }
    if (!snapshotsComplete) continue; // no ghost visuals, stay per-thread
    const removeIds = new Set(unit.memberIds);
    const kept = result.filter((candidate) => !removeIds.has(candidate.threadId));
    const anchor = memberMoves[0]!;
    kept.splice(
      result.findIndex((candidate) => removeIds.has(candidate.threadId)),
      0,
      {
        threadId: groupId,
        thread: members[0]!,
        members,
        boxName: prevUnit.name,
        fromColumnId: prevUnit.columnId,
        fromIndex: anchor.fromIndex,
        toColumnId: unit.columnId,
      },
    );
    result = kept;
  }
  return result;
}

/** One render entry in a lane's card list: a display run or an injected ghost. */
export type GhostSlotEntry<T extends LaneTransport = LaneTransport> =
  | { kind: "run"; run: GroupRunItem }
  | { kind: "ghost"; ghost: T };

/**
 * Weave the old lane's ghost cards into its run list at their old card-slot
 * positions. `fromIndex` counts card slots (a box run spends one slot per
 * member); ghosts inject BEFORE the run that swallows their index, clamped
 * to the lane's end when the old lane reflowed in the meantime.
 */
export function insertGhostSlots<T extends LaneTransport>(
  columnRuns: readonly GroupRunItem[],
  ghosts: readonly T[],
): readonly GhostSlotEntry<T>[] {
  const sorted = [...ghosts].sort((a, b) => a.fromIndex - b.fromIndex);
  const entries: GhostSlotEntry<T>[] = [];
  let slot = 0;
  let next = 0;
  for (const run of columnRuns) {
    const runSlots = run.kind === "single" ? 1 : run.box.members.length;
    while (next < sorted.length && sorted[next].fromIndex <= slot) {
      entries.push({ kind: "ghost", ghost: sorted[next] });
      next += 1;
    }
    entries.push({ kind: "run", run });
    slot += runSlots;
  }
  while (next < sorted.length) {
    entries.push({ kind: "ghost", ghost: sorted[next] });
    next += 1;
  }
  return entries;
}

/**
 * The reveal and keep-in-view effects look cards up by `data-thread-card`;
 * a transport ghost renders that attribute too (it renders a real card), and
 * it sits in the OLD lane — for a forward move the ghost is DOM-first and a
 * bare `querySelector` would hand the effects a dissolving ghost instead of
 * the live card. Ghost subtrees never satisfy a lookup.
 */
export function firstRealCard(
  root: Element | null,
  threadId: string,
): HTMLElement | null {
  if (root === null) return null;
  const matches = root.querySelectorAll(`[data-thread-card]`);
  for (let index = 0; index < matches.length; index += 1) {
    const candidate = matches[index];
    if (candidate.getAttribute("data-thread-card") !== threadId) continue;
    if (candidate.closest("[data-transport-ghost]") !== null) continue;
    return candidate as HTMLElement;
  }
  return null;
}

/** Dissolve-out frames: the card fades away where it stands, blooming as it goes — no directional wipe. */
export function wipeOutKeyframes(): Keyframe[] {
  return [
    { opacity: 1, filter: "none", offset: 0 },
    {
      opacity: 0.8,
      filter: "blur(3px) brightness(1.45)",
      offset: 0.55,
    },
    {
      opacity: 0,
      filter: "blur(10px) brightness(2.1)",
    },
  ];
}

/** Dissolve-in frames: the card materializes where it lands, out of the beam's bloom — no directional wipe. */
export function wipeInKeyframes(): Keyframe[] {
  return [
    {
      opacity: 0,
      filter: "blur(7px) brightness(1.75)",
      offset: 0,
    },
    {
      opacity: 0.9,
      filter: "blur(1.5px) brightness(1.25)",
      offset: 0.6,
    },
    { opacity: 1, filter: "none" },
  ];
}

/**
 * The arrival's growth frames: the NEW slot's space itself opens from
 * nothing to the card's measured size, so the lane's neighbors slide as the
 * card materializes instead of jumping to a fixed-size reveal. The card's
 * own rest margins are never touched — the end frame equals the slot's
 * natural layout exactly (the flex gap supplies the spacing). The measured
 * axis is the lane flow's: a vertical lane's slot grows its height, a
 * horizontal lane's its width.
 */
export function arrivalGrowKeyframes(sizePx: number, axis: TransportAxis = "vertical"): Keyframe[] {
  const prop = axis === "horizontal" ? "maxWidth" : "maxHeight";
  return [{ [prop]: "0px", offset: 0 }, { [prop]: `${sizePx}px` }];
}

/**
 * The collapse frames: the emptied slot's reserved space closes to EXACTLY
 * the no-ghost layout. Flex `gap` still reserves spacing around a zero-size
 * item, so the margins borrow half the flow gap on each side — the final
 * frame is pixel-identical to the ghost's removal, and removing the node
 * after the animation lands without a pop. The flow gap rides the two
 * margins across the flow (top/bottom in a vertical lane, left/right in a
 * horizontal one), matching the caller's measured start margins.
 */
export function ghostCollapseKeyframes(
  sizePx: number,
  rowGapPx: number,
  startMarginStartPx: string = "0px",
  startMarginEndPx: string = "0px",
  axis: TransportAxis = "vertical",
): Keyframe[] {
  const prop = axis === "horizontal" ? "maxWidth" : "maxHeight";
  const gapHalf = `${-(rowGapPx / 2)}px`;
  return [
    {
      [prop]: `${sizePx}px`,
      [`margin${axis === "horizontal" ? "Left" : "Top"}`]: startMarginStartPx,
      [`margin${axis === "horizontal" ? "Right" : "Bottom"}`]: startMarginEndPx,
      offset: 0,
    },
    { [prop]: "0px", [`margin${axis === "horizontal" ? "Left" : "Top"}`]: gapHalf, [`margin${axis === "horizontal" ? "Right" : "Bottom"}`]: gapHalf },
  ];
}

/**
 * Zoom-out frames: the card recedes into its old slot's portal — it scales
 * down toward the shared portal scale while fading, no directional clip and
 * no beam bloom (that read belongs to the dissolve). The slot's own space
 * closes concurrently via the collapse keyframes; the transform here makes
 * the card shrink WITH the closing window instead of being clipped away.
 */
export function zoomOutKeyframes(): Keyframe[] {
  return [
    { opacity: 1, transform: "scale(1)", offset: 0 },
    { opacity: 0.6, transform: "scale(0.6)", offset: 0.6 },
    { opacity: 0, transform: `scale(${TRANSPORT_ZOOM_MIN_SCALE})` },
  ];
}

/**
 * Zoom-in frames: the arriving card grows from the shared portal scale to
 * full size and lands opaque — the mirror of the recede. Its slot's space
 * expands on the same clock (the grow keyframes run a TRANSPORT_ZOOM_IN_MS
 * window in the board), so the space and the card come into being together.
 */
export function zoomInKeyframes(): Keyframe[] {
  return [
    { opacity: 0, transform: `scale(${TRANSPORT_ZOOM_MIN_SCALE})`, offset: 0 },
    { opacity: 0.9, transform: "scale(0.85)", offset: 0.6 },
    { opacity: 1, transform: "scale(1)" },
  ];
}

/**
 * The shimmer's glint field: a transporter's beam does not wipe alone — a
 * field of glints rides the sweep, twinkling in and fading as they travel,
 * and their travel carries the transport's own grammar: departing is up
 * (glints rise from the bottom of the slot), arriving is down (glints
 * descend from the top). Deterministic per (seed, direction), so a
 * re-render mid-sweep never reshuffles the sparkle, and every glint's whole
 * life (delay + duration) fits inside its phase, so nothing keeps
 * sparkling after the transport machine moved on.
 */
export const TRANSPORT_SPARK_COUNT = 14;

/** Which way a phase's glint field travels. */
export type TransportSparkDirection = "up" | "down";

/** One glint's place and life inside a phase's shimmer. */
export interface TransportSpark {
  /** Across the slot's width, in % (0..100). */
  leftPct: number;
  /** Down the slot's height, in % (0..100) — the glint's start line. */
  topPct: number;
  delayMs: number;
  durationMs: number;
  /** The drift in px: a glint travels as it twinkles out. */
  driftPx: number;
  widthPx: number;
  heightPx: number;
  /** The twinkle's peak opacity. */
  peak: number;
  /**
   * The field's travel direction: departing glints rise up from the bottom,
   * arriving glints descend from the top (operator: "departing is up, and
   * arriving is down").
   */
  direction: "up" | "down";
}

/** A tiny seeded LCG: the field must be identical across re-renders. */
function sparkRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shimmerSparks(
  phaseMs: number,
  count: number = TRANSPORT_SPARK_COUNT,
  seed: number = 20126,
  direction: TransportSparkDirection = "up",
): TransportSpark[] {
  const rng = sparkRng(seed);
  const sparks: TransportSpark[] = [];
  for (let index = 0; index < count; index += 1) {
    const durationMs = Math.max(80, Math.round(phaseMs * (0.25 + rng() * 0.3)));
    // Start late enough that the whole life ends inside the phase: a glint
    // fades out before the sweep's final frame, never after it. Both
    // directions schedule the same way — the arrival's glide layer is
    // decoupled from the card's fade (it rides the slot), so its glints
    // twinkle across the WHOLE sweep.
    const delayMs = Math.min(
      Math.round(rng() * phaseMs * 0.55),
      Math.max(0, phaseMs - durationMs),
    );
    // The field anchors where the travel starts: a rising field sits low
    // (departing from the bottom), a descending field sits high (arriving
    // from the top) — direction the eye can read in one glance.
    const topPct = direction === "up" ? 30 + rng() * 65 : 5 + rng() * 50;
    sparks.push({
      leftPct: 4 + rng() * 92,
      topPct,
      delayMs,
      durationMs,
      driftPx: 6 + rng() * 8,
      widthPx: 1.5 + rng() * 1.5,
      heightPx: 5 + rng() * 7,
      peak: 0.55 + rng() * 0.4,
      direction,
    });
  }
  return sparks;
}

/**
 * One glint's twinkle: rise to its peak, then fade while traveling on —
 * energy leaving or entering the slot. The travel direction matches the
 * field's: "up" departs from below the peak and exits above it, "down"
 * enters from above and exits below.
 */
export function sparkKeyframes(spark: TransportSpark): Keyframe[] {
  const drift = `${spark.driftPx.toFixed(1)}px`;
  const [startOffset, endOffset] =
    spark.direction === "up" ? [drift, `-${drift}`] : [`-${drift}`, drift];
  return [
    {
      opacity: 0,
      transform: `translateY(${startOffset}) scaleY(0.4)`,
      offset: 0,
    },
    { opacity: spark.peak, transform: "translateY(0px) scaleY(1)", offset: 0.45 },
    { opacity: 0, transform: `translateY(${endOffset}) scaleY(0.5)` },
  ];
}

/**
 * The row gap of a lane's card list in px (Tailwind's gap-1.5 = 6px; jsdom
 * computes it empty). Measured, not assumed, so a theme change to the gap
 * keeps the collapse seamless. The gap rides the lane flow: the list's
 * `columnGap` in a horizontal lane (its slots lay in a row), the `rowGap`
 * otherwise.
 */
export function cardRowGapPx(list: Element | null, axis: TransportAxis = "vertical"): number {
  if (list === null) return 6;
  const gap = getComputedStyle(list)[axis === "horizontal" ? "columnGap" : "rowGap"];
  const parsed = Number.parseFloat(gap);
  return Number.isFinite(parsed) ? parsed : 6;
}

/**
 * One computed margin in px. The collapse must START from the ghost's real
 * margins: the collapsing phase's static styles are already applied when
 * the animation claims the element, and a keyframe starting at 0 would
 * jump the invisible ghost's neighbors before the smooth close begins.
 * An unreadable computed value reads as 0px (a ghost with no own margin).
 */
export function computedMarginPx(element: Element, side: "Left" | "Right" | "Top" | "Bottom"): string {
  const raw = getComputedStyle(element)[`margin${side}`];
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? `${parsed}px` : "0px";
}