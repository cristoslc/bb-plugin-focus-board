// Where a card click opens its thread, as the operator chose it.
//
// The board has two thread surfaces. "beside" is bb's own pane beside the
// board: the click asks the host's opener and the thread arrives in a real
// split pane (app.tsx `openThreadCardNative`). "panel" is the board's own
// in-panel pane: the click never asks the host and the window stays one pane
// (app.tsx `openThreadCard`). Both shipped for different reasons — the split
// pane by the native-pane move, the in-panel pane by the pane rule before it —
// and this preference is the one thing that picks between them.
//
// The value is a DECLARED plugin setting (server.ts `threadOpenTarget`), so
// bb's configuration page and the board's gear modal edit one host row and the
// click reads it through `useSettings()`. It carries NO default on purpose:
// bb stores nothing until someone answers, so "unset" means "this install has
// never been asked", which is the once-only marker the setup dialog needs. An
// answered install stores "beside" even when the operator kept the shipping
// behaviour, and the dialog never returns for it.
//
// The preference loses to the host, never the other way round: a compact
// viewport, a host known older than 0.50, a window with splits off, or bb's
// eight-pane ceiling still ends in the board's own pane whatever the stored
// value says (the click's own fallbacks in app.tsx).

/** The two surfaces, as the setting stores them. */
export const THREAD_OPEN_TARGETS = ["beside", "panel"] as const;

export type ThreadOpenTarget = (typeof THREAD_OPEN_TARGETS)[number];

/** What an unanswered install does: today's behaviour, the split pane. */
export const DEFAULT_THREAD_OPEN_TARGET: ThreadOpenTarget = "beside";

/** The two choices in an operator's words, for the dialog and the modal row. */
export const THREAD_OPEN_TARGET_LABELS: Record<ThreadOpenTarget, string> = {
  beside: "Beside the board",
  panel: "In the board panel",
};

/** True when a stored value is one of the two the setting declares. */
export function isThreadOpenTarget(value: unknown): value is ThreadOpenTarget {
  return (
    typeof value === "string" &&
    (THREAD_OPEN_TARGETS as readonly string[]).includes(value)
  );
}

/**
 * The effective choice for a stored value. Only a value the setting itself
 * declares is trusted; while loading, unset, or a foreign stored shape (only
 * stale data could carry one — the host schema rejects the write), the split
 * pane applies, which is the behaviour every board had before the choice
 * existed.
 */
export function threadOpenTargetFromSetting(
  value: string | number | boolean | undefined,
): ThreadOpenTarget {
  return isThreadOpenTarget(value) ? value : DEFAULT_THREAD_OPEN_TARGET;
}

/**
 * Whether this install has answered at all — the once-only marker. A stored
 * token means answered; anything else, `undefined` included, means the setup
 * dialog still owes this install its one ask.
 */
export function threadOpenTargetAnswered(
  value: string | number | boolean | undefined,
): boolean {
  return isThreadOpenTarget(value);
}
