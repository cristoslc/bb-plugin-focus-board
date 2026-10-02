// CLI-side sweep eligibility: the pure core of `bb focus-board sweep`.
//
// The board's own sweep logic (lib/sweep.ts) works on the sidebar's live
// thread view (PluginSidebarThread + threadState) and is not reusable
// server-side; the CLI works from the server-side thread rows and the
// board's Done records. Same semantics, different inputs:
//
// - Done arm: a thread whose done stamp is older than `doneArchiveMs`
//   and not kept (metadata keep OR the KV keep store) is eligible.
// - Idle arm: a thread with no Done record, not archived, not pinned, not
//   kept, not running, not unread, without a live child, whose last
//   activity is older than `idleArchiveMs` is eligible — the server-side
//   mirror of the board's `threadState === "idle"` rule for everything a
//   raw thread row can see.
// - Sweep-family contract: a thread with ≥1 live (non-archived) child is
//   never eligible in either arm, regardless of its own age or keep flag;
//   children are eligible independently of their parent.
// - Already-archived threads are never eligible; a Done thread below the
//   Done threshold is not claimed by the idle arm (Done threads are only
//   Done-arm candidates).
//
// `now` is always injected — no Date.now() here — so tests can pin time.

/** Resolved thresholds in epoch ms (from the value+unit settings). */
export interface SweepThresholds {
  doneArchiveMs: number;
  idleArchiveMs: number;
}

/** One server-side thread row, resolved against the board's own state. */
export interface SweepFact {
  id: string;
  /** True when bb has already archived the thread. */
  archived: boolean;
  /** True when the thread is pinned (the idle arm never touches pins). */
  pinned: boolean;
  /** Last activity, epoch ms. */
  updatedAt: number;
  /** Done stamp, epoch ms — null when the thread is not marked Done. */
  doneAt: number | null;
  /** Merged keep override: metadata keep OR the KV keep store. */
  keep: boolean;
  /** The thread's own status, as reported by the server row. */
  status: string;
  /** The operator has not seen the latest activity in the thread. */
  unread: boolean;
  /** True when at least one live (non-archived) child hangs off this id. */
  hasLiveChildren: boolean;
}

export type SweepReason = "done" | "idle";

export interface SweepEligible {
  id: string;
  reason: SweepReason;
}

/** Statuses whose turn is still in flight — the idle arm never touches them. */
const RUNNING_STATUSES = new Set(["active", "starting", "stopping", "pending"]);

/**
 * The sweep-eligible subset of `facts`, in input order. A thread at
 * exactly N days of age counts (age >= threshold), matching the board's
 * arm-time boundary.
 */
export function sweepCliEligible(
  facts: readonly SweepFact[],
  thresholds: SweepThresholds,
  now: number,
): SweepEligible[] {
  const doneThreshold = thresholds.doneArchiveMs;
  const idleThreshold = thresholds.idleArchiveMs;
  const eligible: SweepEligible[] = [];
  for (const fact of facts) {
    if (fact.archived) continue;
    if (fact.keep) continue;
    if (fact.hasLiveChildren) continue; // A live parent is never sweep-eligible.
    if (fact.doneAt !== null) {
      if (now - fact.doneAt >= doneThreshold) {
        eligible.push({ id: fact.id, reason: "done" });
      }
      continue; // Done threads are only Done-arm candidates.
    }
    if (!fact.pinned && !RUNNING_STATUSES.has(fact.status) && !fact.unread && now - fact.updatedAt >= idleThreshold) {
      eligible.push({ id: fact.id, reason: "idle" });
    }
  }
  return eligible;
}