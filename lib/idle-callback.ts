// The idle-callback seam for load-time decoration fences (issue #373): a
// callback that must not run inside the load burst moves to the browser's
// idle time, with a hard timer ceiling so it always fires even if the host
// never signals idle.
//
// The contract its users keep:
// - the callback runs EXACTLY ONCE, on rAF-idle (requestIdleCallback with a
//   `timeout` ceiling) or on the fallback timer, whichever lands first;
// - the returned cancel function stops both paths, so an effect re-run (a
//   new ref key, a new fingerprint) replaces a pending idle fetch instead of
//   stacking one;
// - environments without requestIdleCallback (jsdom) get the fallback timer
//   only, which is what unit tests drive with fake timers — the idle path
//   is deterministic there and in every UAT run (Chrome fires the idle
//   callback within a frame of the load settling, and the ceiling bounds the
//   worst case).

/** The hard ceiling in ms: the callback fires by this time even when the host
 *  is never idle. Small enough that a deferred fetch still lands before an
 *  operator can realistically gesture after the board paints. */
export const IDLE_CALLBACK_FALLBACK_MS = 400;

/** The mount fan-in's hard ceiling in ms (issues #403, #424): past this time
 *  the board paints with whatever mount lists have landed, exactly the
 *  pre-gate behavior, so a hung list can never blank the panel.
 *
 *  Sized from the MEASURED fan-in, never guessed (issue #424): the mount used
 *  to cost six per-thread metadata walks that serialize on bb's bridge —
 *  ~2.0-2.3s on a 358-thread workspace, which is why the retired 400ms value
 *  was the active path on every real mount and the board painted before the
 *  metadata landed. The aggregate mount read (`board_state_get`) collapses
 *  those six walks into one pass, measured at ~0.6s on the same workspace, so
 *  1.8s is ~2.5x the live fan-in with room for a board three times larger; the
 *  ceiling now only fires on a genuinely hung call. */
export const MOUNT_SETTLE_CEILING_MS = 1800;

/** Schedule `callback` at idle with the fallback ceiling; returns cancel. */
export function scheduleIdleCallback(
  callback: () => void,
  fallbackMs: number = IDLE_CALLBACK_FALLBACK_MS,
): () => void {
  const host = typeof window === "undefined" ? undefined : window;
  if (host === undefined || typeof host.setTimeout !== "function") {
    throw new Error(
      "scheduleIdleCallback: no window host to schedule against (the hooks that use this seam run in a browser-like document; jsdom provides one)",
    );
  }
  /** The host's own idle callback when the host carries one (jsdom does not). */
  type RequestIdleLike = (callback: () => void, options: { timeout: number }) => number;
  const idleCallback =
    typeof host.requestIdleCallback === "function" ? (host.requestIdleCallback as RequestIdleLike) : null;
  let done = false;
  let idleHandle: number | undefined;
  let timerHandle: number | undefined;
  const cancel = () => {
    if (idleHandle !== undefined) host.cancelIdleCallback?.(idleHandle);
    if (timerHandle !== undefined) clearTimeout(timerHandle);
  };
  const once = () => {
    if (done) return;
    done = true;
    cancel();
    callback();
  };
  if (idleCallback !== null) {
    idleHandle = idleCallback.call(host, once, { timeout: fallbackMs });
  }
  // jsdom drives this timer with fake timers; a real browser's idle callback
  // wins in nearly every load and the ceiling bounds the rest.
  timerHandle = host.setTimeout(once, fallbackMs);
  return cancel;
}
