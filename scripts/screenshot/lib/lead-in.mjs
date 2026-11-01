/**
 * The opening beat every demo gif gets: the staged board at rest, before the
 * first gesture.
 *
 * A gif that opens mid-gesture gives a first-time viewer nothing to orient
 * against: the menu is already open, the pointer is already in flight, and
 * the before-picture the clip is supposed to contrast with never appears. So
 * the recorder holds the board for a beat before the storyboard's first step,
 * once, for every demo — the timing lives here rather than in 34 storyboards,
 * where one omission would be invisible until the gif was on a release page.
 *
 * The window is a second-ish by operator ruling (2026-10-31): enough to read
 * the board, short enough that a quick feature stays quick. A storyboard may
 * override it per demo (`leadIn: 1.6`), and `leadIn: 0` opts out for a demo
 * whose first frame is meant to be the gesture.
 */
export const LEAD_IN_SECONDS = 1;

/** The range the operator named for the beat, kept for the convention doc and
 *  the guard test: a storyboard outside it is a deliberate choice, not a typo
 *  the recorder should paper over. */
export const LEAD_IN_RANGE = { min: 0.8, max: 1.2 };

/**
 * The lead-in a demo gets, in seconds. Absent → the shared default. A value
 * that is not a finite, non-negative number throws instead of silently
 * becoming zero frames: a typo must not remove the beat.
 */
export function leadInFor(demo) {
  const override = demo?.leadIn;
  if (override === undefined) return LEAD_IN_SECONDS;
  if (typeof override !== "number" || !Number.isFinite(override) || override < 0) {
    throw new Error(
      `leadIn must be a finite, non-negative number of seconds; got ${JSON.stringify(override)}`,
    );
  }
  return override;
}
