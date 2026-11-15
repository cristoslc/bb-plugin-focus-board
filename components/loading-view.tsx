// The readiness gate's loading view, with a small quiet gesture in it.
//
// The gate (app.tsx, issue #403) holds the paint until the mount fan-in
// settles, so this view is the whole panel for a few hundred milliseconds on
// every open and for up to the ceiling (lib/idle-callback) worst case. Today
// it is one dashed box and a line of text; this module gives that box a
// landing that reads as finished at ~150ms, and then a calm breath that keeps
// going until the board paints.
//
// What it deliberately is NOT: a board shape. No lane skeletons, no ghost
// cards, no column bars, because a skeleton promises a shape the data may not
// keep, and removing that regression is the reason the gate exists.
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
// - motion is two beats: the LANDING, a one-shot that opens on the row and
//   rests landed, then the CYCLE, which hands off from that landed state and
//   repeats until the view unmounts. The cycle starts where the landing ends
//   (opacity 1, no transform), so the handoff shows no jump, and it never
//   replays the landing;
// - the cycle's three dots dip at different points in the period, so the row
//   reads as one wave crossing it, never three dots strobing in unison;
// - `prefers-reduced-motion: reduce` gets the resting state itself (the dot
//   row and the line), static: the view still charms without moving.
//
// The status line stays honest: one `role="status"` (EmptyState's), the plain
// text "Loading threads…", and the motif marked `aria-hidden` so a screen
// reader announces the loading once and never reads a decoration.

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

/** The attribute each motif dot carries. */
export const LOADING_DOT_ATTR = "data-loading-dot";

/** The attribute the line carries, the element `line` animates. */
export const LOADING_LINE_ATTR = "data-loading-line";

/** The custom property carrying one dot's landing stagger into the injected
 *  rule. Both beats read it, so the landing's offset and the cycle's wait stay
 *  one number and neither needs a per-dot rule. */
export const LOADING_DOT_DELAY_VAR = "--loading-dot-delay";

/** The `@keyframes` names the injected rules animate. `deal` is the landing;
 *  the cycle's names come from the trough table below, one per dot. */
export const LOADING_DEAL_ANIMATION_NAME = "focus-board-loading-deal";
export const LOADING_LINE_ANIMATION_NAME = "focus-board-loading-line";

/** The custom property carrying one dot's cycle animation name into the
 *  injected rule. It rides the inline style beside the delay, so the per-dot
 *  difference lives in the data the component already writes rather than in a
 *  rule per dot. */
export const LOADING_DOT_CYCLE_VAR = "--loading-dot-cycle";

/** Each dot's landing start, in ms: the row lands left to right in ~260ms
 *  total (the third dot's 110ms start plus its 150ms landing). The same
 *  stagger is the landing's; the cycle carries its own, wider phase, because
 *  55ms is too small a slice of a 1.4s period to read as a wave. */
export const LOADING_DOT_DELAYS_MS: readonly number[] = [0, 55, 110];

/** How long the landing runs, in ms. The cycle waits this long (plus the dot's
 *  own stagger) before it takes over, which is what keeps the two beats from
 *  fighting over the same properties. */
export const LOADING_LANDING_DURATION_MS = 150;

/** One full breath of the cycle, in ms: the calm band (1.2s to 1.8s) rather
 *  than a quick pulse, so the row reads as working, not as asking for
 *  attention. */
export const LOADING_CYCLE_DURATION_MS = 1400;

/** Where each dot's dip sits in the cycle, as a percentage of the period. The
 *  trough travels left to right (38%, then 50%, then 62%), which is the wave;
 *  a dot's cycle opens and closes on the landed state itself (opacity 1, no
 *  transform) because only the trough is written, and that is what makes the
 *  handoff from the landing invisible. One entry per dot. */
export const LOADING_CYCLE_TROUGH_PERCENT: readonly number[] = [38, 50, 62];

/** The `@keyframes` name of each dot's cycle, in dot order. */
export const LOADING_CYCLE_ANIMATION_NAMES: readonly string[] = LOADING_CYCLE_TROUGH_PERCENT.map(
  (_percent, index) => `focus-board-loading-cycle-${index + 1}`,
);

/** The injected stylesheet. Exported so tests assert the exact text rather than
 *  a paraphrase of it. Every animation rule lives INSIDE the motion-safe
 *  wrapper, which is what gives reduced motion the static resting state; the
 *  keyframes can sit outside it because nothing references them unless the
 *  wrapper's rule applied. */
export const LOADING_VIEW_STYLE_TEXT =
  `@media (prefers-reduced-motion: no-preference) { ` +
  `[${LOADING_VIEW_ATTR}="deal"] [${LOADING_DOT_ATTR}] { ` +
  `animation: ${LOADING_DEAL_ANIMATION_NAME} ${LOADING_LANDING_DURATION_MS}ms cubic-bezier(0.34, 1.4, 0.64, 1) both, ` +
  `var(${LOADING_DOT_CYCLE_VAR}) ${LOADING_CYCLE_DURATION_MS}ms ease-in-out infinite; ` +
  `animation-delay: var(${LOADING_DOT_DELAY_VAR}), ` +
  `calc(var(${LOADING_DOT_DELAY_VAR}) + ${LOADING_LANDING_DURATION_MS}ms); } ` +
  `[${LOADING_VIEW_ATTR}="line"] [${LOADING_LINE_ATTR}] { ` +
  `animation: ${LOADING_LINE_ANIMATION_NAME} 140ms ease-out both; } } ` +
  `@keyframes ${LOADING_DEAL_ANIMATION_NAME} { from { opacity: 0; transform: translateY(4px) scale(0.5); } } ` +
  `@keyframes ${LOADING_LINE_ANIMATION_NAME} { from { opacity: 0.55; transform: translateY(2px); } } ` +
  LOADING_CYCLE_TROUGH_PERCENT.map(
    (percent, index) =>
      `@keyframes ${LOADING_CYCLE_ANIMATION_NAMES[index]} { ${percent}% { opacity: 0.5; transform: scale(0.94); } }`,
  ).join(" ");

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
 *  board paints. Each dot carries its own stagger and its own cycle keyframe
 *  name, so the stylesheet needs a single rule for all three. */
function LoadingDots() {
  return (
    <span aria-hidden className="flex items-center gap-2">
      {LOADING_DOT_DELAYS_MS.map((delayMs, index) => (
        <span
          key={delayMs}
          data-loading-dot=""
          className="size-2 rounded-full bg-muted-foreground/70"
          style={
            {
              [LOADING_DOT_DELAY_VAR]: `${delayMs}ms`,
              [LOADING_DOT_CYCLE_VAR]: LOADING_CYCLE_ANIMATION_NAMES[index],
            } as CSSProperties
          }
        />
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
