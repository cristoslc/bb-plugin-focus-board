/**
 * Sweep eligibility and arm-then-confirm semantics — pure logic, `now`
 * injected. The board's sweep is "archive old Done + long-idle", modeled on
 * the two-click arm-then-confirm pattern from docs/musings/2026-09-25-sweep.md.
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