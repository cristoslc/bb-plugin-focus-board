// The card click's split-ask guard: what a click asks the host for, and the two
// continuations that keep the click honest when the host answers by navigating.
//
// ## The 2026-11-24 report and what the probe found
//
// The operator reported, verbatim: "split pane not working in web browser, but
// not falling back to in-pane panel either -- just navs whole page". A browser
// is exactly the environment `scripts/screenshot/probe-web-one-pane.mjs` drives
// (bb's own renderer in Chrome, a fresh profile per phase), and that probe
// could not reproduce it on the installed 0.50.1 host: at 1600, 1024 and 700
// pixels, from a direct board route, from the sidebar's Focus Board entry,
// after a reload, with a second pane already open and on an early click, the
// host either split (`pane-1` board, `pane-2` thread) or, at 700, the compact
// click opened the board's own pane. No phase lost the board. The evidence and
// the frames are in `docs/screenshots/probe-web-one-pane/`.
//
// What the probe cannot reach is the state the report names: a host that
// answers a split ask with a plain navigation while the click believed it had
// asked a host that could split. On the installed host that needs the host's
// own predicate (`isCompact || layout === null`) to disagree with what the
// board read, which is a disagreement only the host can create. This module no
// longer assumes it cannot: the guard below is armed for EVERY split ask, not
// just the one-pane one, because the repair has to exist wherever the ask does.
//
// ## The measurement (bb 0.50.1, the installed host)
//
// `scripts/screenshot/probe-split-dance.mjs`, evidence in
// `docs/screenshots/probe-split-dance/evidence.json`, drives bb's own placement
// from a one-pane window on the board's route:
//
// | Step | Panes | Board | Route |
// |---|---|---|---|
// | board alone, fresh profile | 1 (`pane-1` = the board panel) | mounted | the board's |
// | opener for a thread beside the board, `split: true` | 2 (`pane-1` board, `pane-2` thread) | mounted | the thread's |
// | a second opener for another thread | 2 (the thread pane replaced in place) | mounted | that thread's |
//
// Two host facts make the click possible and they are both 0.50.1 facts, not
// 0.49.0 ones:
//
// - A one-pane window ALREADY carries a one-pane layout. The persisted atom
//   (`bb.splitLayout`) holds `{root: pane-1, content: the board's panel}` from
//   the first render, not null, so the host's opener reaches its placement
//   branch instead of its "plainly navigate" branch
//   (`openThreadInSplit`: `if (isCompact || layout === null) navigate(route)`).
// - The plugin-facing view of that atom returns null below two panes
//   (`useSidebarSplitLayout`), which is why a one-pane window reads as "no
//   split" to a plugin even though the host has a layout to split.
//
// So the ruling's step one already produces step two: the opener splits, the
// board keeps its pane, and the thread arrives beside it. Nothing unmounts, so
// nothing has to be brought back.
//
// ## Why a dance at all
//
// Two states measured no split, and both are real:
//
// - A window with splits off (bb's own setting) has no layout to split, so the
//   opener plainly navigates: the panel is replaced by the thread page and the
//   route is the thread. That is the state the operator's report described, and
//   the only surviving code that can repair it runs OUTSIDE React, because the
//   component is gone by the time the answer is visible. The continuation puts
//   the board's panel route back with the thread's subPath, which is the board
//   plus its own in-panel pane: both surfaces, never the board back without the
//   thread (measured in the probe's A phase).
// - A host that ignores the request leaves the panel mounted, one pane, the
//   board's route untouched. The same click opens the board's own pane there,
//   which is the shipped contract for a window bb will not split.
//
// ## The rules this module keeps
//
// - Every split ask is guarded, not only the one-pane one. A fresh-pane or
//   replacement ask is settled by the live board (`lib/native-fresh-pane.ts`,
//   the replacement's net), but those settlers live in React and die with the
//   panel. The guard's restore is the only continuation that survives, so it
//   is armed for every ask and stays out of the live board's way.
// - One dance at a time: a second click replaces the pending one, so two
//   continuations can never both fire (the operator's last click wins).
// - The dance expires: one deadline, checked once, plus one later watch for an
//   ask that already opened the board's own pane (the host's opener can answer
//   after the deadline). Nothing fires minutes later after the operator has
//   moved on. A continuation that finds the route on a thread this click did
//   not ask for expires instead of pulling the board back.
// - The observation is the host's own rendered truth: the count of pane
//   containers (`data-split-pane-id`, the attribute bb's split area names its
//   panes with, already read by lib/shortcut-ownership.ts), the board's panel
//   root, and the route's thread.
//
// Pure module apart from the browser singleton at the bottom: no React, no SDK.
// The clock, the timer, the observation, and the two continuation handles are
// injected, so the deadline is a number in tests rather than a real wait.

import { HOST_PANEL_ATTR } from "../components/host-link-glue";

/** bb's pane container attribute: the pane id the split layout reports under
 *  the same name (lib/shortcut-ownership.ts reads it for the same reason). */
const HOST_SPLIT_PANE_ATTR = "data-split-pane-id";

/** How long a one-pane click waits for the host's answer before repairing it.
 *  The host's placement is synchronous inside the click (it writes the layout
 *  store and navigates), so this is a safety net for a slow frames budget, not
 *  a race the click normally runs. */
export const ONE_PANE_DANCE_MS = 250;

/** How long an ask that already opened the board's own pane stays watched for
 *  the host's LATE answer. The host's opener can defer its whole decision to
 *  an RPC (it fetches a thread's project before navigating), so a plain
 *  navigation can land after the deadline above; without this second check the
 *  board's pane would be opened and then replaced by the thread page, which is
 *  the operator's reported state. One check, not a loop. */
export const ONE_PANE_WATCH_MS = 1000;

/** What the guard does when the board is still mounted at the deadline. */
export type OnePaneDanceRepair =
  /** The window has nowhere to split, so the same click opens the board's own
   *  pane (the one-pane ask's fallback). */
  | "in-board-pane"
  /** The board owns this ask's settlement (a fresh pane, a replacement), so a
   *  live board needs nothing from the guard; only the unmounted answer is
   *  repaired. */
  | "restore-only";

/** One click's ask, still unanswered. */
export interface OnePaneDance {
  readonly threadId: string;
  /** The board's panel subPath carrying that thread: the route the restore
   *  returns to, which is also the board's own in-panel pane. */
  readonly subPath: string;
  readonly deadlineAt: number;
  /** Every thread this click asked the host to open: the clicked one, and the
   *  thread a replacement focused first. A plain navigation to any of them is
   *  this click's, so the board comes back. Absent means just `threadId`. */
  readonly askedThreadIds?: readonly string[];
  /** What a live board owes this ask. Absent means "in-board-pane", the
   *  one-pane ask's rule (the field is optional only so the oldest callers and
   *  their tests keep their exact shape). */
  readonly repair?: OnePaneDanceRepair;
}

/** What the host looks like when the deadline arrives. */
export interface OnePaneDanceObservation {
  readonly now: number;
  /** The pane containers the host is rendering. Two or more means it split. */
  readonly renderedPaneCount: number;
  /** Is the board's panel root still in the document? */
  readonly boardMounted: boolean;
  /** The thread the route shows, when the route is a thread page. */
  readonly routeThreadId: string | null;
}

/** What the dance does next. */
export type OnePaneDanceOutcome =
  | { readonly kind: "pending" }
  | { readonly kind: "split" }
  | { readonly kind: "in-board-pane" }
  | { readonly kind: "restore" }
  /** The board is alive and owns this ask's settlement: nothing to repair. */
  | { readonly kind: "defer" }
  | { readonly kind: "expire" };

/** The threads a dance considers its own: the clicked one and, for a
 *  replacement, the thread it focused on the way. */
export function askedThreadIds(dance: OnePaneDance): readonly string[] {
  return dance.askedThreadIds ?? [dance.threadId];
}

/**
 * The host's answer, read off what it is rendering.
 *
 * The pane count comes first and is not time-gated: a split the host has
 * already rendered is settled even if the deadline has not passed, which is
 * also what keeps a slow machine from opening the board's own pane beside a
 * split that did land.
 */
export function settleOnePaneDance(
  dance: OnePaneDance,
  observation: OnePaneDanceObservation,
): OnePaneDanceOutcome {
  if (observation.renderedPaneCount >= 2) return { kind: "split" };
  if (observation.now < dance.deadlineAt) return { kind: "pending" };
  // One pane and the panel alive: the host has nowhere to split. The one-pane
  // ask opens the board's own pane there instead of doing nothing; an ask the
  // board already settles itself (a fresh pane, a replacement) leaves the
  // live board alone and lets its own settler answer.
  if (observation.boardMounted) {
    return (dance.repair ?? "in-board-pane") === "in-board-pane"
      ? { kind: "in-board-pane" }
      : { kind: "defer" };
  }
  // One pane and the panel gone: the host plainly navigated. When the route is
  // the thread this click asked for, the board comes back with that thread in
  // its own pane, which is the state that keeps both surfaces on screen.
  if (
    observation.routeThreadId !== null &&
    askedThreadIds(dance).includes(observation.routeThreadId)
  ) {
    return { kind: "restore" };
  }
  // The operator moved on to another thread: the ask is void, not repaired.
  return { kind: "expire" };
}

/** The two continuations, owned by the mounted board. */
export interface OnePaneDanceHost {
  /** Open the board's own in-panel pane (the panel is alive). */
  openBoardPane: ((threadId: string) => void) | null;
  /** Put the board's panel route back with the thread's subPath (works after
   *  the panel was replaced: the host's router outlives it). */
  restoreBoardRoute: ((subPath: string) => void) | null;
}

/** Everything the controller cannot know on its own. */
export interface OnePaneDanceDeps {
  now(): number;
  schedule(callback: () => void, delayMs: number): number;
  cancel(handle: number): void;
  observe(): Omit<OnePaneDanceObservation, "now">;
  host: OnePaneDanceHost;
  trace?(event: Record<string, unknown>): void;
  deadlineMs?: number;
  watchMs?: number;
}

/** One click's ask, with the rules above attached. */
export interface OnePaneDanceController {
  /** Start (or replace) the click's dance and arm its deadline. */
  begin(input: {
    threadId: string;
    subPath: string;
    askedThreadIds?: readonly string[];
    repair?: OnePaneDanceRepair;
  }): OnePaneDance;
  /** The ask still waiting on the host, or null. */
  pending(): OnePaneDance | null;
  /** Stop watching without acting: the split landed, or the click is void. */
  cancel(): void;
  /** The host's layout now shows this thread in a pane. True when that was
   *  the dance's thread, so the caller can adopt the pane it landed in. */
  noteThreadInPane(threadId: string): boolean;
}

export function createOnePaneDance(
  deps: OnePaneDanceDeps,
): OnePaneDanceController {
  const deadlineMs = deps.deadlineMs ?? ONE_PANE_DANCE_MS;
  const watchMs = deps.watchMs ?? ONE_PANE_WATCH_MS;
  let dance: OnePaneDance | null = null;
  /** The second check an ask that deferred or opened the board's own pane arms:
   *  the host's LATE plain navigation is still this click's, and the board has
   *  to survive it. */
  let watch: { dance: OnePaneDance; deadlineAt: number } | null = null;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    deps.cancel(timer);
    timer = null;
  };

  const settle = () => {
    const fromWatch = dance === null && watch !== null;
    const ask = dance ?? watch?.dance ?? null;
    if (ask === null) return;
    // The watch's second beat settles against its own later deadline, not the
    // ask's original one, and it never acts on a live board: only a board that
    // went away after the first beat needs the second.
    const effective: OnePaneDance =
      fromWatch && watch !== null
        ? { ...ask, deadlineAt: watch.deadlineAt, repair: "restore-only" }
        : ask;
    const observation: OnePaneDanceObservation = {
      now: deps.now(),
      ...deps.observe(),
    };
    const outcome = settleOnePaneDance(effective, observation);
    if (outcome.kind === "pending") {
      // A timer that ran ahead of its own deadline (a throttled background
      // tab) re-arms for the remainder instead of acting early.
      timer = deps.schedule(
        settle,
        Math.max(0, effective.deadlineAt - observation.now),
      );
      return;
    }
    timer = null;
    dance = null;
    watch = null;
    deps.trace?.({
      step: "one-pane-dance",
      outcome: outcome.kind,
      threadId: effective.threadId,
      askedThreadIds: askedThreadIds(effective),
      repair: effective.repair ?? "in-board-pane",
      renderedPaneCount: observation.renderedPaneCount,
      boardMounted: observation.boardMounted,
      routeThreadId: observation.routeThreadId,
    });
    if (outcome.kind === "in-board-pane") {
      deps.host.openBoardPane?.(effective.threadId);
    } else if (outcome.kind === "restore") {
      deps.host.restoreBoardRoute?.(effective.subPath);
    }
    // The host can still answer late: its opener may await a thread's project
    // before it navigates, so its plain navigation can land after this beat.
    // Keep the click's identity for one more check. An ask that opened the
    // board's own pane and an ask that deferred to the live board both need it,
    // because either can be followed by a whole-page answer.
    if (
      !fromWatch &&
      (outcome.kind === "in-board-pane" || outcome.kind === "defer")
    ) {
      watch = {
        dance: { ...effective, repair: "restore-only" },
        deadlineAt: deps.now() + watchMs,
      };
      timer = deps.schedule(settle, watchMs);
    }
  };

  return {
    begin({ threadId, subPath, askedThreadIds, repair }) {
      clearTimer();
      dance = {
        threadId,
        subPath,
        deadlineAt: deps.now() + deadlineMs,
        ...(askedThreadIds === undefined ? {} : { askedThreadIds }),
        ...(repair === undefined ? {} : { repair }),
      };
      watch = null;
      timer = deps.schedule(settle, deadlineMs);
      return dance;
    },
    pending: () => dance,
    cancel() {
      clearTimer();
      dance = null;
      watch = null;
    },
    noteThreadInPane(threadId) {
      const current = dance ?? watch?.dance ?? null;
      if (current === null || current.threadId !== threadId) return false;
      clearTimer();
      dance = null;
      watch = null;
      return true;
    },
  };
}

/**
 * The thread a host route shows, or null.
 *
 * bb's thread pages are `/projects/<projectId>/threads/<threadId>` and
 * `/threads/<threadId>`. The board's own panel routes carry the thread as a
 * subPath (`/plugins/focus-board/board/t/<threadId>`), which is NOT a thread
 * page: the board is what is on screen there.
 */
export function routeThreadIdFromPath(pathname: string): string | null {
  const match = /\/threads\/([^/?#]+)\/?$/.exec(pathname);
  return match === null ? null : match[1];
}

/** What the host is rendering, read off the document. */
function observeHostWindow(): Omit<OnePaneDanceObservation, "now"> {
  return {
    renderedPaneCount: document.querySelectorAll(`[${HOST_SPLIT_PANE_ATTR}]`).length,
    boardMounted: document.querySelector(`[${HOST_PANEL_ATTR}]`) !== null,
    routeThreadId: routeThreadIdFromPath(window.location.pathname),
  };
}

/** The mounted board's continuations, assigned on mount (app.tsx). */
export const onePaneDanceHost: OnePaneDanceHost = {
  openBoardPane: null,
  restoreBoardRoute: null,
};

let danceDebug = false;

/** The developer trace switch (server.ts's `nativeOpenDebug`), so the live
 *  window can be diagnosed with the same one-line-per-event trace the click
 *  itself writes. */
export function setOnePaneDanceDebug(enabled: boolean): void {
  danceDebug = enabled;
}

/** The board's one dance. Module scope on purpose: the click destroys the
 *  panel when the host has no layout to split, so this state must outlive it. */
export const onePaneDance = createOnePaneDance({
  now: () => Date.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle),
  observe: observeHostWindow,
  host: onePaneDanceHost,
  trace: (event) => {
    if (danceDebug) console.debug("[focus-board:native-open]", event);
  },
});
