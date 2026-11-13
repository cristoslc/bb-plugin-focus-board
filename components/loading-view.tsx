// The readiness gate's loading view, with a small quiet gesture in it.
//
// The gate (app.tsx, issue #403) holds the paint until the mount fan-in
// settles, so this view is the whole panel for a few hundred milliseconds on
// every open and for up to the ceiling (lib/idle-callback) worst case. Today
// it is one dashed box and a line of text; this module gives that box a
// moment that reads as finished at ~150ms and stays deliberate when the gate
// holds.
//
// What it deliberately is NOT: a board shape. No lane skeletons, no ghost
// cards, no column bars — a skeleton promises a shape the data may not keep,
// and removing that regression is the reason the gate exists.
//
// The rules, borrowed from `components/dot-pulse.ts` (the precedent: one
// injected stylesheet keyed by a `data-` attribute, opacity-only, wrapped in
// `prefers-reduced-motion: no-preference`, the stylesheet text exported so a
// test pins the exact bytes):
//
// - one injected stylesheet, keyed by `data-loading-view`, injected once per
//   document and idempotent across mounts;
// - the motif animates on the compositor only — opacity and transform. React
//   never re-renders to animate it and the browser never re-lays-out one;
// - motion is a ONE-SHOT that ends in the resting state: the dots land and
//   stay landed, so the twentieth panel open shows the same short gesture the
//   first one did, never a loop that celebrates at the operator;
// - `prefers-reduced-motion: reduce` gets the resting state itself (the dot
//   row and the line), static: the view still charms without moving.
//
// The status line stays honest: one `role="status"` (EmptyState's), the plain
// text "Loading threads…", and the motif marked `aria-hidden` so a screen
// reader announces the loading once and never reads a decoration.

import { useInsertionEffect, type CSSProperties } from "react";
import { EmptyState } from "./empty-state";

/** The three treatments the gate can render, one shipped as the default.
 *  - `deal`: three dots drop in above the line, staggered, and rest as a row.
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

/** The custom property carrying one dot's stagger into the injected rule, so
 *  the animation never needs a per-dot rule. */
export const LOADING_DOT_DELAY_VAR = "--loading-dot-delay";

/** The `@keyframes` names the injected rules animate. */
export const LOADING_DEAL_ANIMATION_NAME = "focus-board-loading-deal";
export const LOADING_LINE_ANIMATION_NAME = "focus-board-loading-line";

/** Each dot's animation start, in ms: the row lands left to right in ~260ms
 *  total (the third dot's 110ms start plus its 150ms landing), so the gesture
 *  is finished inside the common gate window and simply rests there when the
 *  gate holds. */
export const LOADING_DOT_DELAYS_MS: readonly number[] = [0, 55, 110];

/** The injected stylesheet. Exported so tests assert the exact text rather than
 *  a paraphrase of it. Every animation rule lives INSIDE the motion-safe
 *  wrapper, which is what gives reduced motion the static resting state. */
export const LOADING_VIEW_STYLE_TEXT =
  `@media (prefers-reduced-motion: no-preference) { ` +
  `[${LOADING_VIEW_ATTR}="deal"] [${LOADING_DOT_ATTR}] { ` +
  `animation: ${LOADING_DEAL_ANIMATION_NAME} 150ms cubic-bezier(0.34, 1.4, 0.64, 1) both; ` +
  `animation-delay: var(${LOADING_DOT_DELAY_VAR}); } ` +
  `[${LOADING_VIEW_ATTR}="line"] [${LOADING_LINE_ATTR}] { ` +
  `animation: ${LOADING_LINE_ANIMATION_NAME} 140ms ease-out both; } } ` +
  `@keyframes ${LOADING_DEAL_ANIMATION_NAME} { from { opacity: 0; transform: translateY(4px) scale(0.5); } } ` +
  `@keyframes ${LOADING_LINE_ANIMATION_NAME} { from { opacity: 0.55; transform: translateY(2px); } }`;

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
 *  status dot), landing left to right and resting as a row. */
function LoadingDots() {
  return (
    <span aria-hidden className="flex items-center gap-2">
      {LOADING_DOT_DELAYS_MS.map((delayMs) => (
        <span
          key={delayMs}
          data-loading-dot=""
          className="size-2 rounded-full bg-muted-foreground/70"
          style={{ [LOADING_DOT_DELAY_VAR]: `${delayMs}ms` } as CSSProperties}
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
