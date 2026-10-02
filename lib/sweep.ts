/**
 * Sweep eligibility and arm-then-confirm semantics — pure logic, `now`
 * injected. The board's sweep is "archive old Done + long-idle", modeled on
 * the two-click arm-then-confirm pattern from docs/musings/2026-09-25-sweep.md.
 */
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadState } from "../components/grouping";

export const DEFAULT_DONE_ARCHIVE_DAYS = 7;
export const DEFAULT_IDLE_ARCHIVE_DAYS = 30;

const DAY = 24 * 60 * 60 * 1000;

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
  doneArchiveDays?: number;
  idleArchiveDays?: number;
  /** Idle-arm override lookup; the Done arm uses DoneAgeSource.kept. */
  kept?: (threadId: string) => boolean;
}

/**
 * Done-arm candidates: done threads whose done-marked age is >=
 * `doneArchiveDays` (default 7) and not overridden. Ordered newest-done
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
  const threshold = (config.doneArchiveDays ?? DEFAULT_DONE_ARCHIVE_DAYS) * DAY;
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
 * activity is >= `idleArchiveDays` (default 30) ago, excluding pinned and
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
  const threshold = (config.idleArchiveDays ?? DEFAULT_IDLE_ARCHIVE_DAYS) * DAY;
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

export interface ArmedSweep {
  columnId: string;
  /** Frozen at arm time; late arrivals never join. */
  threadIds: readonly string[];
}

/** Arm: capture the explicit, frozen list. Nothing moves until confirm. */
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

export interface SweepArchiveCallbacks {
  /** Archives one thread. The runner awaits it before the next. */
  archive: (threadId: string) => Promise<unknown>;
  /** Fired before each archive starts: the throbber target. */
  onActive?: (threadId: string) => void;
  /** Fired after each archive settles (success or failure). */
  onSettled?: (threadId: string) => void;
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
): Promise<SweepRunFailure[]> {
  const failures: SweepRunFailure[] = [];
  for (const threadId of threadIds) {
    callbacks.onActive?.(threadId);
    try {
      await callbacks.archive(threadId);
    } catch (error) {
      failures.push({
        threadId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    callbacks.onSettled?.(threadId);
  }
  return failures;
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
