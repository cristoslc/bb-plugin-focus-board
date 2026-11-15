// The readiness gate's loading view, with a small quiet gesture in it.
//
// The gate (app.tsx, issue #403) holds the paint until the mount fan-in
// settles, so this view is the whole panel for a few hundred milliseconds on
// every open and for up to the ceiling (lib/idle-callback) worst case. Today
// it is one dashed box and a line of text; this module gives that box a
// landing that reads as finished, and a calm breath under it that repeats
// until the board paints.
//
// What it deliberately is NOT: a board shape. No lane skeletons, no ghost
// cards, no column bars, because a skeleton promises a shape the data may not
// keep, and removing that regression is the reason the gate exists.
//
// THE SCHEDULE IS SIZED FROM THE MEASURED DWELL, NOT FROM THE ANIMATION.
// Two rounds of this view shipped a cycle that was correct and invisible: the
// cycle waited for the 150ms landing and bottomed each dot out at 682ms, 905ms
// and 1128ms, while the gate released at a measured median of 41ms on a warm
// load, 234ms modeled, and ~0.6s on the production-shaped mount read. Every
// real load ended between the landing and the first breath, so the row landed
// and stopped, exactly as reported. Measured in Chrome 157 against this
// harness by `scripts/perf/measure-loading-view.mjs`; recorded in real time by
// `scripts/screenshot/capture-loading-view-live.mjs`. The numbers a change to
// this file must keep are in `LOADING_DIP_TIMES_MS` and the test beside it.
//
// So the breath now starts at the first paint (no landing-wide delay), bottoms
// the first dot out at 168ms and the third at 348ms, and is back to the landed
// state by 540ms: inside the dwell the gate actually gets. It repeats every
// 1200ms, so a held gate (the 1.8s ceiling) still shows a second full wave.
//
// The rules, borrowed from `components/dot-pulse.ts` (the precedent: one
// injected stylesheet keyed by a `data-` attribute, compositor-only properties,
// wrapped in `prefers-reduced-motion: no-preference`, the stylesheet text
// exported so a test pins the exact bytes):
//
// - one injected stylesheet, keyed by `data-loading-view`, injected once per
//   document and idempotent across mounts;
// - the motif animates on the compositor only, opacity and transform. React
//   never re-renders to animate it and the browser never re-lays-out one;
// - motion is two beats on two elements, which is what lets both start at
//   once without fighting over a property: the DOT lands (a one-shot fade,
//   drop and grow), and the dot's CORE breathes (an infinite opacity and scale
//   swell). Overlapping them is the whole fix; putting both on one element
//   would mean the second animation wins every shared property and the landing
//   would never paint;
// - each dot's breath starts at its own phase offset, so the troughs travel
//   left to right and the row reads as one wave, never three dots strobing in
//   unison. The offset is a plain `animation-delay` on the core;
// - no animation NAME is routed through a custom property: a name carried in
//   an inline `--var` resolves at computed-value time, and a name that fails to
//   resolve drops the animation with no error. The name is written in the rule;
// - every animation rule sits inside `prefers-reduced-motion: no-preference`,
//   so reduced motion renders the resting state itself, static;
// - the status line stays honest: one `role="status"` (EmptyState's), the plain
//   text "Loading threads…", and the motif marked `aria-hidden` so a screen
//   reader announces the loading once and never reads a decoration.

import { useInsertionEffect, type CSSProperties } from "react";
import { EmptyState } from "./empty-state";

/** The three treatments the gate can render, one shipped as the default.
 *  - `deal`: three dots drop in above the line, staggered, then breathe as a
 *    wave until the board paints.
 *  - `line`: the line alone eases up into place — the quietest option.
 *  - `still`: today's view, untouched. The control a capture compares against,
 *    so "does the gesture earn its place" is a question with evidence. */
export type LoadingViewVariant = "deal" | "line" | "still";

/** The shipped treatment. */
export const DEFAULT_LOADING_VIEW_VARIANT: LoadingViewVariant = "deal";

/** Every variant, in the order the capture script shoots them. */
export const LOADING_VIEW_VARIANTS: readonly LoadingViewVariant[] = ["deal", "line", "still"];

/** DOM id of the injected stylesheet; the idempotency key and the test handle.
 *  Only one element with this id ever exists per document. */
export const LOADING_VIEW_STYLE_ID = "focus-board-loading-view";

/** The attribute on the view's box. Its VALUE is the variant id, which is what
 *  the variant rules key on and what the tests and captures read. */
export const LOADING_VIEW_ATTR = "data-loading-view";

/** The attribute each motif dot carries: the element the landing animates. */
export const LOADING_DOT_ATTR = "data-loading-dot";

/** The attribute each dot's inner core carries: the element the breath
 *  animates. Two elements, because a landing and a breath that both start at
 *  the first paint cannot share opacity or transform on one node. */
export const LOADING_DOT_CORE_ATTR = "data-loading-dot-core";

/** The attribute the line carries, the element `line` animates. */
export const LOADING_LINE_ATTR = "data-loading-line";

/** The custom property carrying one dot's landing stagger into the injected
 *  rule: one number per dot, no rule per dot. */
export const LOADING_DOT_DELAY_VAR = "--loading-dot-delay";

/** The custom property carrying one dot's breath phase, the wave's offset. */
export const LOADING_DOT_PHASE_VAR = "--loading-dot-phase";

/** The `@keyframes` names the injected rules animate, written into the rules
 *  themselves (never handed to a rule through a custom property). */
export const LOADING_DEAL_ANIMATION_NAME = "focus-board-loading-deal";
export const LOADING_BREATH_ANIMATION_NAME = "focus-board-loading-breath";
export const LOADING_LINE_ANIMATION_NAME = "focus-board-loading-line";

/** Each dot's landing start, in ms: the row lands left to right in ~260ms
 *  total (the third dot's 110ms start plus its 150ms landing). */
export const LOADING_DOT_DELAYS_MS: readonly number[] = [0, 55, 110];

/** Each dot's breath phase, in ms. The wave runs left to right over 180ms,
 *  which is a sixth of the period: wide enough that three dots never share a
 *  trough, small enough that the whole wave is done in 348ms. */
export const LOADING_DOT_PHASES_MS: readonly number[] = [0, 90, 180];

/** How long the landing runs, in ms. Unchanged from the 1.7.13 release: the
 *  same bezier, the same `both` fill, the same per-dot stagger. */
export const LOADING_LANDING_DURATION_MS = 150;

/** One full breath, in ms: the calm band (1.2s to 1.8s) rather than a quick
 *  pulse, so the row reads as working, not as asking for attention. It is also
 *  what puts the second wave inside the gate's 1.8s ceiling. */
export const LOADING_BREATH_DURATION_MS = 1200;

/** Where the breath bottoms out, as a percentage of the period: 168ms in, which
 *  is one dot's landing plus a frame, so there is no still gap between the land
 *  and the breath. */
export const LOADING_BREATH_TROUGH_PERCENT = 14;

/** Where the breath is back to the landed state, as a percentage: 360ms in. The
 *  rest of the period rests at the landed state, which is the "calm" part. */
export const LOADING_BREATH_LANDED_PERCENT = 30;

/** The trough's opacity and scale. Deep enough to read on an 8px dot that is
 *  already 70% opacity (a 20% dip was measured and read as nothing), shallow
 *  enough to stay a breath. */
export const LOADING_BREATH_TROUGH_OPACITY = 0.45;
export const LOADING_BREATH_TROUGH_SCALE = 0.9;

/** When each dot's first breath bottoms out, in ms from the view's own first
 *  paint. Derived from the beat constants above rather than restated, so the
 *  schedule a test reads is the schedule the stylesheet runs. This is the
 *  number the operator's report turns on: a row whose first trough lands after
 *  the dwell never visibly moves at all. */
export const LOADING_DIP_TIMES_MS: readonly number[] = LOADING_DOT_PHASES_MS.map(
  (phaseMs) => phaseMs + (LOADING_BREATH_DURATION_MS * LOADING_BREATH_TROUGH_PERCENT) / 100,
);

/** The injected stylesheet. Exported so tests assert the exact text rather than
 *  a paraphrase of it. Every animation rule lives INSIDE the motion-safe
 *  wrapper, which is what gives reduced motion the static resting state; the
 *  keyframes can sit outside it because nothing references them unless the
 *  wrapper's rule applied. */
export const LOADING_VIEW_STYLE_TEXT =
  `@media (prefers-reduced-motion: no-preference) { ` +
  `[${LOADING_VIEW_ATTR}="deal"] [${LOADING_DOT_ATTR}] { ` +
  `animation: ${LOADING_DEAL_ANIMATION_NAME} ${LOADING_LANDING_DURATION_MS}ms cubic-bezier(0.34, 1.4, 0.64, 1) both; ` +
  `animation-delay: var(${LOADING_DOT_DELAY_VAR}); } ` +
  `[${LOADING_VIEW_ATTR}="deal"] [${LOADING_DOT_ATTR}] > [${LOADING_DOT_CORE_ATTR}] { ` +
  `animation: ${LOADING_BREATH_ANIMATION_NAME} ${LOADING_BREATH_DURATION_MS}ms ease-in-out infinite; ` +
  `animation-delay: var(${LOADING_DOT_PHASE_VAR}); } ` +
  `[${LOADING_VIEW_ATTR}="line"] [${LOADING_LINE_ATTR}] { ` +
  `animation: ${LOADING_LINE_ANIMATION_NAME} 140ms ease-out both; } } ` +
  `@keyframes ${LOADING_DEAL_ANIMATION_NAME} { from { opacity: 0; transform: translateY(4px) scale(0.5); } } ` +
  `@keyframes ${LOADING_LINE_ANIMATION_NAME} { from { opacity: 0.55; transform: translateY(2px); } } ` +
  `@keyframes ${LOADING_BREATH_ANIMATION_NAME} { ` +
  `0%, 100% { opacity: 1; transform: scale(1); } ` +
  `${LOADING_BREATH_TROUGH_PERCENT}% { opacity: ${LOADING_BREATH_TROUGH_OPACITY}; transform: scale(${LOADING_BREATH_TROUGH_SCALE}); } ` +
  `${LOADING_BREATH_LANDED_PERCENT}% { opacity: 1; transform: scale(1); } }`;

/**
 * The capture seam. The screenshot harness (`?loadingView=<variant>`) sets the
 * variant before mounting so one pull request can show the alternatives; the
 * app itself never calls this, and `null` restores the shipped default.
 * Unknown ids throw: a capture that silently photographed the default would be
 * evidence for the wrong candidate.
 */
let captureVariant: LoadingViewVariant | null = null;

/** Whether `value` names a variant. */
export function isLoadingViewVariant(value: string): value is LoadingViewVariant {
  return (LOADING_VIEW_VARIANTS as readonly string[]).includes(value);
}

/** Force a variant for a capture run, or pass `null` to restore the default. */
export function setLoadingViewVariantForCapture(variant: string | null): void {
  if (variant === null) {
    captureVariant = null;
    return;
  }
  if (!isLoadingViewVariant(variant)) {
    throw new Error(
      `loading view: unknown variant ${JSON.stringify(variant)} (have ${LOADING_VIEW_VARIANTS.join(", ")})`,
    );
  }
  captureVariant = variant;
}

/** The variant this mount renders: the capture override, else the default. */
export function loadingViewVariant(): LoadingViewVariant {
  return captureVariant ?? DEFAULT_LOADING_VIEW_VARIANT;
}

function ensureLoadingViewStyles(): void {
  if (document.getElementById(LOADING_VIEW_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = LOADING_VIEW_STYLE_ID;
  style.textContent = LOADING_VIEW_STYLE_TEXT;
  document.head.append(style);
}

/**
 * Mount the loading-view stylesheet. An insertion effect, not a passive one:
 * the dots' animation starts at opacity 0 (`both` fill), so a stylesheet that
 * arrived after the first paint would flash the resting row and then replay
 * the landing. Inserting before the paint is the whole point.
 */
export function useLoadingViewStyles(): void {
  useInsertionEffect(() => {
    ensureLoadingViewStyles();
  }, []);
}

/** The default treatment's motif: three of the product's own atoms (the card's
 *  status dot), landing left to right, then breathing left to right until the
 *  board paints. The outer span lands; its core breathes. Each dot carries its
 *  own stagger and phase, so the stylesheet needs two rules, not six. */
function LoadingDots() {
  return (
    <span aria-hidden className="flex items-center gap-2">
      {LOADING_DOT_DELAYS_MS.map((delayMs, index) => (
        <span
          key={delayMs}
          data-loading-dot=""
          className="flex size-2"
          style={
            {
              [LOADING_DOT_DELAY_VAR]: `${delayMs}ms`,
              [LOADING_DOT_PHASE_VAR]: `${LOADING_DOT_PHASES_MS[index] ?? 0}ms`,
            } as CSSProperties
          }
        >
          <span
            data-loading-dot-core=""
            className="block size-full rounded-full bg-muted-foreground/70"
          />
        </span>
      ))}
    </span>
  );
}

/**
 * The readiness gate's loading view: the same padded shell and dashed
 * `EmptyState` the gate has always returned, plus the chosen motif. The gate's
 * condition, exit, and readiness semantics stay in app.tsx, untouched.
 */
export function LoadingView() {
  useLoadingViewStyles();
  const variant = loadingViewVariant();
  // The variant id on the box is both the stylesheet's key and the handle the
  // tests and captures read, so it is written once for every variant.
  const variantAttr = { [LOADING_VIEW_ATTR]: variant };
  // `still` is exactly the view this replaces: no motif, the text sitting
  // straight in the status box.
  if (variant === "still") {
    return (
      <div className="p-4" {...variantAttr}>
        <EmptyState>Loading threads…</EmptyState>
      </div>
    );
  }
  return (
    <div className="p-4" {...variantAttr}>
      <EmptyState>
        <span className="flex flex-col items-center gap-2">
          {variant === "deal" ? <LoadingDots /> : null}
          <span data-loading-line="">Loading threads…</span>
        </span>
      </EmptyState>
    </div>
  );
}
