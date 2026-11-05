import { useEffect, useRef, useState } from "react";
import { scheduleIdleCallback } from "../lib/idle-callback";

export type TicketStatus = { kind: string; state: string };

/** Poll cadence for tracker_status: a local SQLite read plus the freshness
 *  layer behind the RPC (lib/tracker-refresh.ts), so the interval is cheap
 *  and a cache catch-up repaints a changed dot on the next poll. */
export const TICKET_STATUS_POLL_MS = 30_000;

/** Per-call wall for `tracker_status`: the handler is a local SQLite read,
 *  so an 8s silence means the transport dropped the call (seen over the
 *  tunneled remote view). Status is optional decoration; a hung call
 *  degrades exactly like the documented "no status known" path instead of
 *  parking the batch guard forever (issue #214). */
export const TICKET_STATUS_TIMEOUT_MS = 8_000;

/** Minimal shape of the SDK rpc handle this hook needs. */
export type TrackerStatusRpc = {
  call: (
    method: "tracker_status",
    input: { repo: string; numbers: number[] },
  ) => Promise<{ statuses: Record<number, TicketStatus> }>;
};

/**
 * Live tracker status for the ticket chips, keyed by repo slug then issue
 * number: Record<repo, Record<number, { kind, state }>>. Fetched via the
 * `tracker_status` RPC (the GitHub plugin's local cache behind it), batched
 * per repo, refetched on a visible-ref key change, a short poll interval,
 * and window focus — a PR merging or an issue closing changes only the
 * cache, not the ref set, so key-change-only fetching would freeze the
 * dot at its first state.
 */
export function useTicketStatuses({
  rpc,
  visibleRefKey,
  refreshSignal,
}: {
  rpc: TrackerStatusRpc;
  /** Sorted, comma-joined visible refs ("owner/repo#42,...") — "" when none. */
  visibleRefKey: string;
  /**
   * The operator-moment bump (issue #205): the caller fingerprints the
   * board's display state (pane open/close, lane transitions, re-sorts).
   * A change refetches immediately with the ref set unchanged; an
   * equal string borrows the in-flight or settled snapshot, so a
   * fingerprint-stable rerender costs nothing.
   */
  refreshSignal?: string;
}): Record<string, Record<number, TicketStatus>> {
  const [ticketStatuses, setTicketStatuses] = useState<
    Record<string, Record<number, TicketStatus>>
  >({});
  // The load's first fetch rides idle (issue #373's attribution: the mount
  // fetch was the post-paint churn's visible driver). Before the FIRST
  // snapshot has landed, every fetch trigger (the mount fetch, an effect
  // re-run, the focus catch-up) schedules through the idle seam and its hard
  // fallback ceiling instead of issuing inside the load burst; once a
  // snapshot has landed, every trigger fetches immediately — the operator
  // moments (issue #205), the poll interval, and the focus catch-up keep
  // today's timing. A fetch that failed never counts as landed, so the
  // catch-up paths stay gated until real statuses exist. A ref-set clear (the
  // empty key) is a render-side clear, not a landing, and leaves the gate in
  // place: the load's own key churn (links and project remotes landing
  // mid-echo) keeps the whole first wave on the idle path.
  const landedRef = useRef(false);
  useEffect(() => {
    if (visibleRefKey === "") {
      setTicketStatuses({});
      return;
    }
    let cancelled = false;
    let fetching = false;
    const wanted = new Map<string, Set<number>>();
    for (const entry of visibleRefKey.split(",")) {
      const at = entry.lastIndexOf("#");
      const repo = entry.slice(0, at);
      const num = Number(entry.slice(at + 1));
      const set = wanted.get(repo) ?? new Set<number>();
      set.add(num);
      wanted.set(repo, set);
    }
    // Replace the whole map per snapshot (not merge) so statuses mirror the
    // visible ref set exactly — no stale dots, no session-long growth. The
    // ref set is fixed for this effect run (visibleRefKey is the dep), so
    // every re-fetch batch resolves to the same `next` map.
    const fetchAll = () => {
      if (fetching) return;
      fetching = true;
      const next: Record<string, Record<number, TicketStatus>> = {};
      let pending = wanted.size;
      const settle = () => {
        if (!cancelled && pending === 0) {
          landedRef.current = true;
          setTicketStatuses(next);
          fetching = false;
        }
      };
      // A call reaches terminal state on resolution, rejection, OR timeout;
      // any of the three frees its slice of the batch, so one hung repo
      // cannot suppress the others' fresh statuses (issue #214).
      const terminal = () => {
        pending -= 1;
        settle();
      };
      for (const [repo, numbers] of wanted) {
        // The RPC caps input at 500 numbers; slice so an overflowing repo
        // degrades to partial dots instead of a rejected call (no dots at
        // all).
        const batch = [...numbers].slice(0, 500);
        const call = rpc.call("tracker_status", { repo, numbers: batch });
        // Race wiring leaves the raw promise consumed, but a late
        // rejection (the transport answering after the timeout settled the
        // race) must never surface unhandled across a rerender.
        call.catch(() => {});
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{ statuses: Record<number, TicketStatus> }>(
          (resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              resolve({ statuses: {} });
            }, TICKET_STATUS_TIMEOUT_MS);
          },
        );
        Promise.race([call, timeout]).then(
          (result) => {
            clearTimeout(timer);
            if (!cancelled && !timedOut) {
              next[repo] = result.statuses;
            }
            terminal();
          },
          () => {
            // Status is optional decoration; chips render without it.
            clearTimeout(timer);
            terminal();
          },
        );
      }
    };
    // The idle gate itself: while unlanded, every trigger schedules the fetch
    // at idle (ceiling-bounded) and its pending handle joins the cleanup set,
    // so a re-run or an unmount cancels what never fired.
    const pendingCancels = new Set<() => void>();
    const fireFetch = () => {
      if (landedRef.current) {
        fetchAll();
        return;
      }
      const cancel = scheduleIdleCallback(fetchAll);
      pendingCancels.add(cancel);
    };
    fireFetch();
    // 30s poll: the tracker_status read is a local SQLite query, so the
    // cadence costs nothing and bounds staleness between focus events. The
    // tick and the catch-up route through fireFetch: while unlanded they ride
    // the idle ceiling (the state still lands), after it they fetch exactly
    // as today.
    const interval = setInterval(fireFetch, TICKET_STATUS_POLL_MS);
    window.addEventListener("focus", fireFetch);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", fireFetch);
      for (const cancel of pendingCancels) cancel();
      pendingCancels.clear();
    };
  }, [visibleRefKey, refreshSignal, rpc]);
  return ticketStatuses;
}