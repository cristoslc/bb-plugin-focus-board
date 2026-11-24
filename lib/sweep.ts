/**
 * Sweep eligibility and arm-then-confirm semantics — pure logic, `now`
 * injected. The sweep is a staged exit: Done-age threads archive; long-idle
 * threads are marked Done (they age into the archive through the Done arm).
 * Modeled on the two-click arm-then-confirm pattern from
 * docs/musings/2026-09-25-sweep.md; the idle arm's Done destination is the
 * operator's 2026-10-01 decision, reversing the musing's archive-everything
 * draft. The 2026-10-02 destination map covers every lane: Pinned sweeps to
 * Unpinned (the lane exit: unpin, pin parked), Unread sweeps to Read (the
 * catch-up gesture), every Idle bucket marks Done, and Needs You and Working
 * never sweep at all. The 2026-10-03 arming decision: only the aged-out
 * arms (Done, A-while-ago) pre-select their candidates — Pinned, Unread,
 * and the fresher idle buckets arm empty and are curated by clicking cards.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadState } from "../components/grouping";
import {
  DEFAULT_ARCHIVE_UNIT,
  DEFAULT_ARCHIVE_VALUE,
  archiveThresholdMs,
} from "./duration";

/**
 * Per-arm default thresholds: 2 days each (lib/duration owns the number).
 * Resolved once here so the pure core's `?? default` path and the
 * settings plumbing cannot drift.
 */
export const DEFAULT_DONE_ARCHIVE_MS = archiveThresholdMs(
  DEFAULT_ARCHIVE_VALUE,
  DEFAULT_ARCHIVE_UNIT,
);
export const DEFAULT_IDLE_ARCHIVE_MS = DEFAULT_DONE_ARCHIVE_MS;

/**
 * Where Done ages come from. The done-state musing's final lean is bb-native
 * thread plugin metadata (stamped `doneAt`, optional `keep`); until that
 * sashay lands, the board implements this over its own KV store with
 * first-seen stamps. Threads with no known stamp are never eligible — the
 * sweep does not guess at ages.
 */
export interface DoneAgeSource {
  /** Epoch ms the thread was marked Done, or null when unknown. */
  doneMarkedAt(threadId: string): number | null;
  /** Per-thread keep-past-threshold override. */
  kept(threadId: string): boolean;
}

export interface SweepConfig {
  /** Done-arm threshold in epoch ms (resolved from the value+unit settings). */
  doneArchiveMs?: number;
  /** Idle-arm threshold in epoch ms. */
  idleArchiveMs?: number;
  /** Idle-arm override lookup; the Done arm uses DoneAgeSource.kept. */
  kept?: (threadId: string) => boolean;
}

/**
 * Done-arm candidates: done threads whose done-marked age is >=
 * `doneArchiveMs` (default 2 days) and not overridden. Ordered newest-done
 * first so the gathered cards read most-recently-retired at the top.
 *
 * Sweep-family contract: `liveChildParents` lists thread ids that have at
 * least one live (non-archived) child; such a thread is never eligible in
 * either arm, regardless of its own age or keep flag.
 */
export function sweepCandidatesForDoneColumn(
  threads: readonly PluginSidebarThread[],
  doneIds: ReadonlySet<string>,
  doneSource: DoneAgeSource,
  config: SweepConfig,
  now: number,
  liveChildParents: ReadonlySet<string> = new Set(),
): string[] {
  const threshold = config.doneArchiveMs ?? DEFAULT_DONE_ARCHIVE_MS;
  return threads
    .filter((thread) => doneIds.has(thread.id))
    .map((thread) => ({ id: thread.id, doneAt: doneSource.doneMarkedAt(thread.id) }))
    .filter((entry): entry is { id: string; doneAt: number } => entry.doneAt !== null)
    .filter((entry) => !doneSource.kept(entry.id) && now - entry.doneAt >= threshold)
    // Children are eligible independently of their parent; the parent is not.
    .filter((entry) => !liveChildParents.has(entry.id))
    .sort((a, b) => b.doneAt - a.doneAt)
    .map((entry) => entry.id);
}

/**
 * Idle-arm candidates: idle-state (quiet, not done) threads whose last
 * activity is >= `idleArchiveMs` (default 2 days) ago, excluding pinned and
 * overridden threads. Ordered newest-activity first.
 *
 * Sweep-family contract: `liveChildParents` lists thread ids that have at
 * least one live (non-archived) child; those are never eligible here,
 * regardless of age.
 */
export function sweepCandidatesForIdleColumn(
  threads: readonly PluginSidebarThread[],
  doneIds: ReadonlySet<string>,
  config: SweepConfig,
  now: number,
  liveChildParents: ReadonlySet<string> = new Set(),
  /** Clear-error acknowledgment ids (issue #157): acked error arms read idle. */
  errorAcks: ReadonlySet<string> = new Set<string>(),
): string[] {
  const threshold = config.idleArchiveMs ?? DEFAULT_IDLE_ARCHIVE_MS;
  return threads
    .filter((thread) => !doneIds.has(thread.id) && !thread.isPinned)
    .filter((thread) => threadState(thread, errorAcks) === "idle")
    .filter((thread) => !(config.kept?.(thread.id) ?? false))
    .filter((thread) => !liveChildParents.has(thread.id))
    .filter((thread) => now - thread.updatedAt >= threshold)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread) => thread.id);
}

/**
 * Pinned-arm and Unread-arm candidates: none. The 2026-10-03 operator
 * decision made those arms manual-only — arming enters sweep mode with
 * nothing selected and the operator curates the sweep by clicking cards,
 * so the pill never proposes a bulk unpin or bulk read-mark the operator
 * did not build by hand. There is deliberately no candidate function for
 * these arms: the dispatch returns an empty pre-selection for them.
 *
 * The same decision demoted the fresher idle buckets (`idle-today`,
 * `idle-recent`) to manual-only arming. `idle-earlier` was demoted with them
 * and came back by operator ruling on 2026-11-24 (dec_m34jysxr6ltv, corpus
 * `dl-20261124T154509-35ce`): the bucket
 * that holds the threads which actually aged out is the one whose bulk action
 * the operator needs, and the fresher two stay manual because their items are
 * hours old. The predicate below, not a candidate function, carries the split.
 */

/**
 * Whether arming this column's sweep pre-selects its candidates. Only the
 * arms whose whole point is "these aged out" start selected: the Done arm
 * (past the archive threshold), the A-while-ago arms (past the idle
 * threshold, both groupings' twins), and the Earlier bucket (the oldest idle
 * bucket, whose threads are past the same idle threshold by construction —
 * operator ruling 2026-11-24). The fresher two idle buckets, Pinned and
 * Unread enter sweep mode empty; the operator clicks cards to build those
 * sweeps. Non-sweepable columns return false.
 */
export function sweepArmPreselects(columnId: string): boolean {
  if (columnId === "done") return true;
  return (
    columnId === "idle-earlier" ||
    columnId === "idle-awhile" ||
    columnId === "awhile"
  );
}

export type SweepColumnKind = "done" | "idle-bucket" | "pinned" | "unread";

/**
 * Which sweep arm a column belongs to, or null when it is not sweepable.
 * Single source of truth used by Board (button placement), app.tsx
 * (eligibility dispatch), and armSweep. Needs You and Working return null:
 * attention is not the operator's to clear, and a running thread cannot be
 * swept out from under itself.
 */
export function sweepColumnKind(columnId: string): SweepColumnKind | null {
  if (columnId === "done") return "done";
  if (columnId === "pinned") return "pinned";
  if (columnId === "unread") return "unread";
  // The Attention board's idle buckets, all of them: every idle state
  // sweeps to Done. "awhile" is the Last-activity grouping's twin of
  // idle-awhile and keeps its pre-existing arm.
  if (
    columnId === "idle-awhile" ||
    columnId === "idle-earlier" ||
    columnId === "idle-today" ||
    columnId === "idle-recent" ||
    columnId === "awhile"
  ) {
    return "idle-bucket";
  }
  return null;
}

/** What a confirmed sweep does to its candidates. */
export type SweepDestination = "archive" | "done" | "unpinned" | "read";

/**
 * Where each sweepable column's candidates go on confirm: Done-age threads
 * archive (their exit is already staged); long-idle threads are marked Done
 * — a quiet thread should read as "you decided it's done", not vanish into
 * the archive (the Done stamp starts the archive clock, so a swept idle
 * thread resurfaces in the Done arm instead of disappearing); pinned
 * threads unpin through the lane exit, so the pin is parked and returns the
 * next time the thread calls for attention; unread threads are marked read,
 * the catch-up gesture. Null for columns that cannot sweep.
 */
export function sweepDestination(columnId: string): SweepDestination | null {
  const kind = sweepColumnKind(columnId);
  if (kind === null) return null;
  if (kind === "done") return "archive";
  if (kind === "pinned") return "unpinned";
  if (kind === "unread") return "read";
  return "done";
}

/**
 * Whether the column's sweep action removes the thread from the live board
 * (archive) or re-stamps it out of its lane (Done). Those are the arms
 * where the sweep-family contract applies: a parent with live children may
 * never join, because the action strands the family view. Unpinning and
 * marking read leave the thread live in place, so parents sweep freely in
 * the Pinned and Unread arms.
 */
export function sweepRemovesThreads(columnId: string): boolean {
  const destination = sweepDestination(columnId);
  return destination === "archive" || destination === "done";
}

export interface ArmedSweep {
  columnId: string;
  /** Frozen at arm time; late arrivals never join. */
  threadIds: readonly string[];
}

/** The armed pill's destination word, per sweep destination. */
export const SWEEP_DESTINATION_LABELS: Record<SweepDestination, string> = {
  archive: "Archive",
  done: "Done",
  unpinned: "Unpinned",
  read: "Read",
};

/** The word a notice uses for what a sweep did to its candidates. */
export const SWEEP_SETTLED_WORDS: Record<SweepDestination, string> = {
  archive: "archived",
  done: "marked Done",
  unpinned: "unpinned",
  read: "marked read",
};

/**
 * Arm: enter sweep mode with the past-threshold threads pre-selected. The
 * selection stays live from here — card clicks toggle membership.
 */
export function armSweep(columnId: string, candidateIds: readonly string[]): ArmedSweep {
  return {
    columnId,
    threadIds: [...candidateIds],
  };
}

/**
 * Confirm: return exactly the captured list to archive. `false` (click-away,
 * Escape) disarms and archives nothing.
 */
export function confirmSweep(armed: ArmedSweep, confirmed: boolean): string[] {
  return confirmed ? [...armed.threadIds] : [];
}

/**
 * Toggle one thread's membership in the live sweep selection. Arming still
 * pre-selects the past-threshold candidates, but from there the operator
 * curates: clicking a card in sweep mode flips it in or out.
 */
export function toggleSweepSelection(armed: ArmedSweep, threadId: string): ArmedSweep {
  return armed.threadIds.includes(threadId)
    ? { ...armed, threadIds: armed.threadIds.filter((id) => id !== threadId) }
    : { ...armed, threadIds: [...armed.threadIds, threadId] };
}

/**
 * The ids a shift-click selects: the contiguous run from the anchor through
 * the clicked card, in the column's display order whichever end was clicked.
 * The ids are the run in display order; `mayJoin` drops cards that cannot
 * join a sweep (blocked live-child parents, Done projections) without
 * breaking the span. No anchor — or an anchor that has left the column —
 * falls back to the clicked card alone; a clicked card that itself may not
 * join selects nothing (the board refuses it loudly before calling here).
 */
export function sweepRangeIds(
  columnThreadIds: readonly string[],
  anchorId: string | null,
  clickedId: string,
  mayJoin: (threadId: string) => boolean = () => true,
): string[] {
  const clickedAt = columnThreadIds.indexOf(clickedId);
  if (clickedAt === -1) return [];
  if (!mayJoin(clickedId)) return [];
  const anchorAt = anchorId === null ? -1 : columnThreadIds.indexOf(anchorId);
  if (anchorAt === -1) return mayJoin(clickedId) ? [clickedId] : [];
  const from = Math.min(anchorAt, clickedAt);
  const to = Math.max(anchorAt, clickedAt);
  return columnThreadIds
    .slice(from, to + 1)
    .filter(mayJoin);
}

/**
 * Add ids to the live sweep selection without touching membership already
 * curated: the shift-click gesture is additive, never subtractive. Existing
 * ids keep their order; new ids append in the order given. When nothing is
 * new the same object returns, so a state updater can bail out of the
 * re-render.
 */
export function addSweepSelection(
  armed: ArmedSweep,
  threadIds: readonly string[],
): ArmedSweep {
  const selected = new Set(armed.threadIds);
  const added = threadIds.filter((id) => !selected.has(id));
  return added.length === 0
    ? armed
    : { ...armed, threadIds: [...armed.threadIds, ...added] };
}

export interface SweepRunFailure {
  threadId: string;
  message: string;
}

export interface SweepRunResult {
  failures: SweepRunFailure[];
  /** True when a cancel stopped the loop before every id was processed. */
  cancelled: boolean;
  /** Ids never attempted (all processed when `cancelled` is false). */
  remaining: string[];
  /** Ids whose sweep action resolved — the set an undo can reverse. */
  swept: string[];
}

/**
 * How many gestures the Done arm runs at once. Six is the measured knee, not
 * a guess: the sweep's per-card wall on a 1,394-card board (1,305 live Done
 * cards) is ~110ms in the production build, and almost all of it is the
 * board's own work per state write — one full reconciliation pass over every
 * card — plus one serialized bridge round trip. Overlapping six writes and
 * applying their `doneIds` mutations as ONE state write collapses six of
 * those passes into one, while a cancel still stops within a batch. Six also
 * keeps a lane of nine at two windows, and the batch's cost is one board pass
 * no matter how wide it is. Evidence and both measurements:
 * docs/perf/sweep-latency-2026-11-18.md.
 *
 * Only the Done arm may exceed 1: `done_set` is the board's own RPC, safe to
 * run concurrently (server.ts serializes the Done index behind its KV write
 * lock, and tests/board-kv-concurrent.test.ts pins interleaved marks). The
 * other arms drive the HOST's sidebar actions, which run one row at a time
 * (a new write aborts the previous in-flight one — a single-slot design), so
 * they stay strictly sequential.
 */
export const SWEEP_BATCH_CONCURRENCY = 6;

export interface SweepRunCallbacks {
  /**
   * The sweep's per-thread gesture — archive, mark Done, unpin, or mark
   * read, per the arm's destination. The runner awaits each batch before
   * the next; within a batch up to `concurrency` gestures are in flight.
   */
  act: (threadId: string) => Promise<unknown>;
  /** Fired before each gesture starts: the throbber target. */
  onActive?: (threadId: string) => void;
  /** Fired after each gesture settles (success or failure). */
  onSettled?: (threadId: string) => void;
  /**
   * Fired once per batch with the ids whose gesture resolved, after
   * `onSettled` has run for every id in it. The place for a state write the
   * whole batch shares: one `doneIds` mutation per batch instead of one per
   * card, so the board recomputes its assembly once per batch.
   *
   * A failed id never appears here — failures ride the result's `failures`
   * and must not be counted as swept — and an empty batch is not fired at
   * all, so a caller cannot mistake "nothing landed" for a write.
   */
  onBatchSettled?: (settledIds: readonly string[]) => void;
  /**
   * Asked before every batch AFTER the first. False stops the run: the
   * gestures already in flight finish (cancel means "no more", not "yank
   * the current one"), the rest are reported as `remaining`.
   */
  shouldContinue?: () => boolean;
  /**
   * Gestures in flight at once (default 1 — strictly one at a time). See
   * SWEEP_BATCH_CONCURRENCY for which arm may raise it and why.
   */
  concurrency?: number;
}

/**
 * Apply the sweep's per-thread gesture to every captured candidate,
 * collecting failures instead of stopping.
 *
 * Sequential by default is a hard requirement, not a style choice: the
 * host's sidebar actions run one row at a time (a new write aborts the
 * previous in-flight one — a single-slot design), so firing the loop
 * without awaiting applies only the last candidate. A caller whose gesture
 * is safe to overlap (the Done arm's own `done_set` RPC) raises
 * `concurrency`, and the batch's resolved ids arrive in ONE
 * `onBatchSettled` call so a single state write covers them all.
 */
export async function runSweep(
  threadIds: readonly string[],
  callbacks: SweepRunCallbacks,
): Promise<SweepRunResult> {
  const failures: SweepRunFailure[] = [];
  const swept: string[] = [];
  const concurrency = Math.max(1, Math.floor(callbacks.concurrency ?? 1));
  let index = 0;
  while (index < threadIds.length) {
    if (
      index > 0 &&
      callbacks.shouldContinue !== undefined &&
      !callbacks.shouldContinue()
    ) {
      return {
        failures,
        cancelled: true,
        remaining: threadIds.slice(index),
        swept,
      };
    }
    const batch = threadIds.slice(index, index + concurrency);
    index += batch.length;
    for (const threadId of batch) callbacks.onActive?.(threadId);
    // allSettled, never all: one rejection inside a batch must not lose the
    // ids that DID settle, and must not reject the batch. The async wrapper
    // turns a SYNCHRONOUS throw from `act` into a rejection too, so a gesture
    // that throws before returning a promise is still collected (the
    // sequential runner's try/catch used to cover that).
    const outcomes = await Promise.allSettled(
      batch.map(async (threadId) => callbacks.act(threadId)),
    );
    const batchSettled: string[] = [];
    outcomes.forEach((outcome, at) => {
      const threadId = batch[at];
      if (outcome.status === "fulfilled") {
        swept.push(threadId);
        batchSettled.push(threadId);
      } else {
        failures.push({
          threadId,
          message:
            outcome.reason instanceof Error
              ? outcome.reason.message
              : String(outcome.reason),
        });
      }
      callbacks.onSettled?.(threadId);
    });
    if (batchSettled.length > 0) callbacks.onBatchSettled?.(batchSettled);
  }
  return { failures, cancelled: false, remaining: [], swept };
}

/** What the Board renders while a confirmed sweep is running. */
export interface SweepRunView {
  columnId: string;
  total: number;
  /** Archives settled so far, successful or not. */
  done: number;
  /** The card being archived right now; the throbber target. */
  activeId: string | null;
}

/** A finished sweep's on-screen summary. */
export interface SweepNotice {
  message: string;
  /**
   * Undo offer for a cancelled run: the ids the run settled and how to
   * reverse them (unarchive for the Done arm, unmark Done for the idle
   * arm, re-pin for the Pinned arm, mark unread for the Unread arm).
   * Present only after a cancel that actually settled something: undo is
   * offered, never automatic — cancel means "stop", undo is a deliberate
   * second click.
   */
  undo?: {
    ids: readonly string[];
    destination: SweepDestination;
  };
}
