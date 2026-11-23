// The card click's fresh pane: what the click asks the host for when its own
// record no longer names a pane of the board's, and how that ask is settled.
//
// ## The report this answers
//
// Operator, 2026-11-21: "sometimes (uncertain on repro steps) when the native
// thread pane is open, clicking on a card then opens the legacy focus board
// thread pane instead of swapping the native one. This may be occurring after
// an action is taken in the native pane that causes the right sidebar to open
// in bb."
//
// Measured live, in a browser of the probe's own
// (scripts/screenshot/probe-card-click-after-right-panel.mjs; the trace lines,
// the layouts and the frames are in
// docs/screenshots/probe-card-click-after-right-panel/):
//
// | What the operator did in the native pane | The next card click |
// |---|---|
// | opened bb's right panel | replaced the pane's thread, correctly |
// | navigated the pane to another thread (a sidebar row) | opened the board's own in-panel pane |
//
// The second row is the report, and the click's own trace names the branch:
// `in-board: no pane of the board's to use`. The right panel alone changes
// nothing the click reads (the layout keeps its pane ids and the record keeps
// matching), while a pane NAVIGATED from inside itself stops matching the
// record's `{paneId, threadId}` pair — a mention, a child row, a sidebar row,
// `bb thread open` for another thread, and every one of those is "an action
// taken in the native pane". The legacy pane was the old fallback for a record
// that no longer resolves.
//
// ## Why a fresh split is the honest answer, and what it may not claim
//
// A record that does not resolve can mean two things, and the click cannot
// tell them apart from the record alone: the pane is gone, or it now shows a
// thread the operator put there. Neither is a reason to leave the native
// surface, so the click re-plans from what the host renders: it asks the
// host's opener for the CLICKED thread (`open(threadId, { split: true })`),
// which splits beside the focused pane — the board, because a card press
// focuses it — and then adopts the pane that appeared.
//
// The pane it may adopt is narrow on purpose: a pane showing the asked thread
// whose pane id was NOT in the window when the click asked. A pane that was
// already there is the operator's own (they opened it from bb's sidebar, or
// they navigated it), and claiming it would be the guess lib/native-pane-
// ownership.ts forbids: the ask then only FOCUSES their pane, which is what
// the host's own opener does for a thread that is already open, and the board
// records nothing.
//
// Measured for the repair's premise, same probe, phase E: with the pane
// rethreaded and the board focused, bb's own split placement for a third
// thread produced `pane-1` (the board, still its slot), `pane-3` (the new
// thread, focused) and the operator's `pane-2` untouched.
//
// ## Why this state outlives the panel
//
// bb re-creates the plugin panel's subtree when the layout changes, which is
// exactly what the ask causes, so the pending ask cannot live in React state
// (the same lesson, and the same reason, as lib/native-one-pane-dance.ts): it
// lives at module scope, and the mounted board settles it on every layout
// change and on mount. The deadline covers the one thing the layout cannot:
// a host that never answers, where the click still has to open something.
//
// Pure module for the decision; the browser singleton is at the bottom.

import type { SplitPaneLayoutView } from "./split-pane-cap";

/** How long the click waits for the host's answer before it opens the board's
 *  own pane. The host's placement is synchronous inside the click (it writes
 *  the layout store and navigates), so this is a safety net for a slow frame
 *  budget, not a race the click normally runs. */
export const FRESH_PANE_ASK_MS = 400;

/** One click's ask, still being settled. */
export interface FreshPaneAsk {
  readonly threadId: string;
  /** The pane ids the window held when the click asked. A pane showing the
   *  asked thread that is not in this list is the one the host created for the
   *  ask; one that is in it is the operator's own. */
  readonly priorPaneIds: readonly string[];
  readonly deadlineAt: number;
}

/** What the live layout says about the ask. */
export type FreshPaneSettlement =
  | { readonly kind: "pending" }
  /** The host created this pane for the ask: the board adopts it. */
  | { readonly kind: "adopted"; readonly paneId: string }
  /** The clicked thread is in a pane that was already there: the host focused
   *  it, and the board claims nothing. */
  | { readonly kind: "theirs"; readonly paneId: string }
  /** Past the deadline with no pane holding the thread: the host gave it no
   *  native surface, so the click opens the board's own. */
  | { readonly kind: "unanswered" };

/**
 * The ask against the live layout.
 *
 * The layout comes first and is not time-gated: a pane showing the asked
 * thread that was not there when the click asked is settled however early it
 * is asked, which is what keeps a slow machine from opening the board's own
 * pane beside a split that did land.
 */
export function settleFreshPaneAsk(
  layout: SplitPaneLayoutView | null,
  ask: FreshPaneAsk,
  now: number,
): FreshPaneSettlement {
  if (layout !== null) {
    const pane = layout.panes.find(
      (candidate) => candidate.threadId === ask.threadId,
    );
    if (pane !== undefined) {
      return ask.priorPaneIds.includes(pane.paneId)
        ? { kind: "theirs", paneId: pane.paneId }
        : { kind: "adopted", paneId: pane.paneId };
    }
  }
  return now < ask.deadlineAt ? { kind: "pending" } : { kind: "unanswered" };
}

/** Everything the controller cannot know on its own. */
export interface FreshPaneAskDeps {
  now(): number;
  schedule(callback: () => void, delayMs: number): number;
  cancel(handle: number): void;
  /** The host's layout as the board last rendered it. */
  layout(): SplitPaneLayoutView | null;
  /** A settled ask, handed back with the ask it settles: the caller owns every
   *  consequence (adopt the pane, drop the record, open the board's own). */
  onSettle(ask: FreshPaneAsk, settlement: FreshPaneSettlement): void;
  trace?(event: Record<string, unknown>): void;
  deadlineMs?: number;
}

/** One click's ask, with the rules above attached. */
export interface FreshPaneAskController {
  /** Start (or replace) the click's ask and arm its deadline. */
  begin(input: {
    threadId: string;
    priorPaneIds: readonly string[];
  }): FreshPaneAsk;
  /** The ask still waiting on the host, or null. */
  pending(): FreshPaneAsk | null;
  /** Settle the ask against the host's layout now: on every layout change, on
   *  mount, and from the deadline. */
  settle(): FreshPaneSettlement;
  /** Stop watching without acting (a click that has already landed elsewhere). */
  cancel(): void;
}

export function createFreshPaneAsk(
  deps: FreshPaneAskDeps,
): FreshPaneAskController {
  const deadlineMs = deps.deadlineMs ?? FRESH_PANE_ASK_MS;
  let ask: FreshPaneAsk | null = null;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    deps.cancel(timer);
    timer = null;
  };

  const settle = (forced: boolean): FreshPaneSettlement => {
    const current = ask;
    if (current === null) return { kind: "pending" };
    const now = forced
      ? Math.max(deps.now(), current.deadlineAt)
      : deps.now();
    const settlement = settleFreshPaneAsk(deps.layout(), current, now);
    if (settlement.kind === "pending") return settlement;
    clearTimer();
    ask = null;
    deps.trace?.({
      step: "fresh-pane-ask",
      outcome: settlement.kind,
      threadId: current.threadId,
      ...(settlement.kind === "adopted" || settlement.kind === "theirs"
        ? { paneId: settlement.paneId }
        : {}),
      priorPaneIds: current.priorPaneIds,
    });
    deps.onSettle(current, settlement);
    return settlement;
  };

  return {
    begin({ threadId, priorPaneIds }) {
      clearTimer();
      ask = {
        threadId,
        priorPaneIds: [...priorPaneIds],
        deadlineAt: deps.now() + deadlineMs,
      };
      // Forced: a timer that fires with the clock behind its own deadline (a
      // throttled tab) must not read as pending, or the ask outlives the click.
      timer = deps.schedule(() => settle(true), deadlineMs);
      return ask;
    },
    pending: () => ask,
    settle: () => settle(false),
    cancel() {
      clearTimer();
      ask = null;
    },
  };
}

/** The mounted board's consequence handler, assigned on mount (app.tsx). */
export const freshPaneAskHost: {
  onSettle:
    | ((ask: FreshPaneAsk, settlement: FreshPaneSettlement) => void)
    | null;
} = { onSettle: null };

/** The board's latest layout, pushed on commit: the deadline settles against
 *  what the host last rendered, never against a frame the board cannot see. */
let freshPaneAskLayout: SplitPaneLayoutView | null = null;
export function setFreshPaneAskLayout(layout: SplitPaneLayoutView | null): void {
  freshPaneAskLayout = layout;
}

let askDebug = false;

/** The developer trace switch (server.ts's `nativeOpenDebug`), so the live
 *  window can be read with the same one-line-per-event trace the click writes. */
export function setFreshPaneAskDebug(enabled: boolean): void {
  askDebug = enabled;
}

/** The board's one ask. Module scope on purpose: bb re-creates the plugin
 *  panel's subtree when the split lands, so this state must outlive it. */
export const freshPaneAsk = createFreshPaneAsk({
  now: () => Date.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle),
  layout: () => freshPaneAskLayout,
  onSettle: (ask, settlement) => {
    freshPaneAskHost.onSettle?.(ask, settlement);
  },
  trace: (event) => {
    if (askDebug) console.debug("[focus-board:native-open]", event);
  },
});
