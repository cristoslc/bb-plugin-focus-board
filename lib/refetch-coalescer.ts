/**
 * The realtime-refetch coalescer (issue #186): every refetch-carrying
 * realtime signal (done-changed, link-changed, error-ack-changed,
 * snooze-changed, rank-changed, group-changed) currently refetches its lists
 * the moment it lands, so a burst of signals — one write echoed to several
 * channels, or several writes landing together — runs one full refetch pass
 * per signal on a board with hundreds of threads.
 *
 * The scheduler is ONE shared debounce over NAMED refetch units: a signal
 * handler schedules its units by name, identical units inside the burst
 * collapse into one run, and the shared timer fires the whole pending set as
 * one pass. Two bounds keep a continuous signal stream from starving it:
 * `REFETCH_COALESCE_MS` is the trailing debounce (the quiet window), and
 * `REFETCH_COALESCE_MAX_WAIT_MS` caps how long the first scheduled unit may
 * wait — when the wait is up, the pass runs immediately even though signals
 * keep arriving.
 *
 * The units are refetches over optional state, and every refetch body
 * (app.tsx) already carries its own silent failure path for a rejected RPC,
 * so the scheduler only guards against a SYNCHRONOUS throw in one unit
 * killing the rest of its pass (surfaced to console.error — a refetch
 * crashing must be visible, never silent).
 */

/** The quiet window a burst is debounced into (10 signals inside one
 * animation-frame window land as one pass comfortably). */
export const REFETCH_COALESCE_MS = 50;
/** The cap on how long the burst's FIRST pending unit may wait, measured
 * from its schedule — signals that keep arriving past this fire the pass at
 * once instead of extending the debounce forever. */
export const REFETCH_COALESCE_MAX_WAIT_MS = 200;

export interface RefetchScheduler {
  /** Schedule a refetch under a unit name. Units scheduled while a pass is
   * pending keep the latest callback of each; the callback runs once when
   * the pass fires. */
  schedule: (unit: string, refetch: () => void) => void;
  /** Cancel any pending pass (unmount). The scheduler stays usable for a
   * later mount cycle. */
  dispose: () => void;
}

export function createRefetchScheduler(delayMs: number, maxWaitMs: number = REFETCH_COALESCE_MAX_WAIT_MS): RefetchScheduler {
  const pending = new Map<string, () => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Epoch-ms of the burst's first schedule, for the max-wait bound.
  let firstScheduledAt: number | null = null;

  const runPass = () => {
    timer = null;
    firstScheduledAt = null;
    const units = [...pending.entries()];
    pending.clear();
    for (const [, refetch] of units) {
      try {
        refetch();
      } catch (error) {
        console.error("refetch-coalescer: refetch pass unit failed", error);
      }
    }
  };

  return {
    schedule: (unit, refetch) => {
      pending.set(unit, refetch);
      const now = Date.now();
      if (firstScheduledAt === null) firstScheduledAt = now;
      // Signals stretched past the max wait must not starve the pass: fire
      // at once when the wait is up.
      if (now - firstScheduledAt >= maxWaitMs) {
        if (timer !== null) clearTimeout(timer);
        runPass();
        return;
      }
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(runPass, delayMs);
    },
    dispose: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending.clear();
      firstScheduledAt = null;
    },
  };
}