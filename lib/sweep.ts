/**
 * Sweep eligibility and arm-then-confirm semantics — pure logic, `now`
 * injected. The sweep is a staged exit: Done-age threads archive; long-idle
 * threads are marked Done (they age into the archive through the Done arm).
 * Modeled on the two-click arm-then-confirm pattern from
 * docs/musings/2026-09-25-sweep.md; the idle arm's Done destination is the
 * operator's 2026-10-01 decision, reversing the musing's archive-everything
 * draft.
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
): string[] {
  const threshold = config.idleArchiveMs ?? DEFAULT_IDLE_ARCHIVE_MS;
  return threads
    .filter((thread) => !doneIds.has(thread.id) && !thread.isPinned)
    .filter((thread) => threadState(thread) === "idle")
    .filter((thread) => !(config.kept?.(thread.id) ?? false))
    .filter((thread) => !liveChildParents.has(thread.id))
    .filter((thread) => now - thread.updatedAt >= threshold)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((thread) => thread.id);
}

export type SweepColumnKind = "done" | "idle-bucket";

/**
 * Which sweep arm a column belongs to, or null when it is not sweepable.
 * Single source of truth used by Board (button placement), app.tsx
 * (eligibility dispatch), and armSweep.
 */
export function sweepColumnKind(columnId: string): SweepColumnKind | null {
  if (columnId === "done") return "done";
  if (columnId === "idle-awhile" || columnId === "awhile") return "idle-bucket";
  return null;
}

/** What a confirmed sweep does to its candidates. */
export type SweepDestination = "archive" | "done";

/**
 * Where each sweepable column's candidates go on confirm: Done-age threads
 * archive (their exit is already staged); long-idle threads are marked Done
 * — a quiet thread should read as "you decided it's done", not vanish into
 * the archive. The Done stamp starts the 7-day archive clock, so a swept
 * idle thread resurfaces in the Done arm instead of disappearing. Null for
 * columns that cannot sweep.
 */
export function sweepDestination(columnId: string): SweepDestination | null {
  const kind = sweepColumnKind(columnId);
  if (kind === null) return null;
  return kind === "done" ? "archive" : "done";
}

export interface ArmedSweep {
  columnId: string;
  /** Frozen at arm time; late arrivals never join. */
  threadIds: readonly string[];
}

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

export interface SweepArchiveCallbacks {
  /** Archives one thread. The runner awaits it before the next. */
  archive: (threadId: string) => Promise<unknown>;
  /** Fired before each archive starts: the throbber target. */
  onActive?: (threadId: string) => void;
  /** Fired after each archive settles (success or failure). */
  onSettled?: (threadId: string) => void;
  /**
   * Asked before every archive AFTER the first. False stops the run: the
   * archive already in flight finishes (cancel means "no more", not "yank
   * the current one"), the rest are reported as `remaining`.
   */
  shouldContinue?: () => boolean;
}

/**
 * Archive every captured candidate, strictly one at a time, collecting
 * failures instead of stopping.
 *
 * Sequential is a hard requirement, not a style choice: the host's sidebar
 * archive action aborts the previous in-flight archive when a new one starts
 * (a single-slot design for one row at a time), so firing the loop without
 * awaiting archives only the last candidate. Each await here gives the
 * previous archive the whole window to finish.
 */
export async function runSweepArchive(
  threadIds: readonly string[],
  callbacks: SweepArchiveCallbacks,
): Promise<SweepRunResult> {
  const failures: SweepRunFailure[] = [];
  const swept: string[] = [];
  for (const [index, threadId] of threadIds.entries()) {
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
    callbacks.onActive?.(threadId);
    try {
      await callbacks.archive(threadId);
      swept.push(threadId);
    } catch (error) {
      failures.push({
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    callbacks.onSettled?.(threadId);
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
   * arm). Present only after a cancel that actually settled something:
   * undo is offered, never automatic — cancel means "stop", undo is a
   * deliberate second click.
   */
  undo?: {
    ids: readonly string[];
    destination: SweepDestination;
  };
}
