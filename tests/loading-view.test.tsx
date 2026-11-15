// @vitest-environment jsdom
// The readiness gate's loading view (components/loading-view.tsx).
//
// The gate test beside this file (app-mount-readiness-gate.test.tsx) pins WHEN
// the loading view holds and when it releases; this one pins WHAT it renders.
// The laws:
// - one injected stylesheet, idempotent across mounts, keyed by a `data-`
//   attribute, and its exact bytes;
// - the motif animates on the compositor only (opacity and transform), never a
//   layout property;
// - two beats: the landing, a one-shot that rests landed, then a cycle that
//   repeats until the view unmounts, starting where the landing ended;
// - the cycle's dots dip at different points in the period, so the row is a
//   wave and not three dots strobing in unison;
// - every animation rule sits inside `prefers-reduced-motion: no-preference`,
//   so reduced motion renders the resting state itself, static;
// - the status stays honest: one `role="status"`, the plain "Loading threads…"
//   line, and the decoration out of the accessibility tree;
// - the capture seam refuses an unknown variant instead of silently shooting
//   the default.
// jsdom runs no animations, so the stylesheet bytes pinned here are the
// mechanism; scripts/screenshot/capture-loading-view.mjs is the proof that a
// browser paints them.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  DEFAULT_LOADING_VIEW_VARIANT,
  LOADING_BREATH_ANIMATION_NAME,
  LOADING_BREATH_DURATION_MS,
  LOADING_BREATH_LANDED_PERCENT,
  LOADING_BREATH_TROUGH_OPACITY,
  LOADING_BREATH_TROUGH_PERCENT,
  LOADING_BREATH_TROUGH_SCALE,
  LOADING_DEAL_ANIMATION_NAME,
  LOADING_DIP_TIMES_MS,
  LOADING_DOT_ATTR,
  LOADING_DOT_CORE_ATTR,
  LOADING_DOT_DELAYS_MS,
  LOADING_DOT_DELAY_VAR,
  LOADING_DOT_PHASES_MS,
  LOADING_DOT_PHASE_VAR,
  LOADING_LANDING_DURATION_MS,
  LOADING_LINE_ATTR,
  LOADING_VIEW_ATTR,
  LOADING_VIEW_STYLE_ID,
  LOADING_VIEW_STYLE_TEXT,
  LOADING_VIEW_VARIANTS,
  LoadingView,
  isLoadingViewVariant,
  setLoadingViewVariantForCapture,
} from "../components/loading-view";
import {
  fakeRpcCalls,
  registeredNavPanel,
  releaseRpcHangs,
  seedFakeThreads,
  stubRpcHang,
} from "./helpers/app-fake-sdk";

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const HOUR = 3_600_000;

const loadingLine = (): HTMLElement | null => screen.queryByText("Loading threads…");
const dots = (): Element[] => [...document.querySelectorAll(`[${LOADING_DOT_ATTR}]`)];

/** The injected text of one named keyframe block, so a law about the cycle's
 *  shape reads as the shape rather than a substring hunt. */
const keyframeBlock = (name: string): string => {
  const start = LOADING_VIEW_STYLE_TEXT.indexOf(`@keyframes ${name} {`);
  expect(start).toBeGreaterThan(-1);
  const end = LOADING_VIEW_STYLE_TEXT.indexOf("} }", start);
  expect(end).toBeGreaterThan(start);
  return LOADING_VIEW_STYLE_TEXT.slice(start, end + 3);
};

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  releaseRpcHangs();
  stubRpcHang(null);
  setLoadingViewVariantForCapture(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the loading view's stylesheet", () => {
  it("is injected once, idempotently, under a stable id, and states the exact rule", () => {
    render(<LoadingView />);
    const sheet = document.getElementById(LOADING_VIEW_STYLE_ID);
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toBe(LOADING_VIEW_STYLE_TEXT);
    cleanup();
    render(<LoadingView />);
    render(<LoadingView />);
    expect(document.querySelectorAll(`#${LOADING_VIEW_STYLE_ID}`)).toHaveLength(1);
  });

  it("animates on the compositor only — opacity and transform, no layout property", () => {
    expect(LOADING_VIEW_STYLE_TEXT).toContain("opacity");
    expect(LOADING_VIEW_STYLE_TEXT).toContain("transform");
    // No property the browser would have to re-lay-out or re-paint for.
    expect(LOADING_VIEW_STYLE_TEXT).not.toMatch(
      /width|height|margin|padding|top:|left:|right:|bottom:|filter|background|font-size/,
    );
  });

  it("keeps the landing as the first beat, unchanged", () => {
    // The gesture the 1.7.13 release shipped, byte for byte: the same 150ms
    // bezier, the same `both` fill, the same per-dot stagger.
    expect(LOADING_VIEW_STYLE_TEXT).toContain(
      `animation: ${LOADING_DEAL_ANIMATION_NAME} ${LOADING_LANDING_DURATION_MS}ms cubic-bezier(0.34, 1.4, 0.64, 1) both`,
    );
    expect(LOADING_VIEW_STYLE_TEXT).toContain(`animation-delay: var(${LOADING_DOT_DELAY_VAR}); `);
    expect(keyframeBlock(LOADING_DEAL_ANIMATION_NAME)).toBe(
      `@keyframes ${LOADING_DEAL_ANIMATION_NAME} { from { opacity: 0; transform: translateY(4px) scale(0.5); } }`,
    );
  });

  it("breathes on a loop that repeats until the view unmounts", () => {
    expect(LOADING_VIEW_STYLE_TEXT).toContain(
      `animation: ${LOADING_BREATH_ANIMATION_NAME} ${LOADING_BREATH_DURATION_MS}ms ease-in-out infinite`,
    );
    expect(LOADING_VIEW_STYLE_TEXT).not.toContain("alternate");
    // One breath inside the calm band: slow enough to read as working, never a
    // pulse asking for attention.
    expect(LOADING_BREATH_DURATION_MS).toBeGreaterThanOrEqual(1200);
    expect(LOADING_BREATH_DURATION_MS).toBeLessThanOrEqual(1800);
  });

  it("puts the breath on the dot's core and starts it at the dot's own phase", () => {
    // The breath's delay is the dot's phase alone. The whole 150ms landing wait
    // is the bug this fix removes: the view was gone before it expired.
    expect(LOADING_VIEW_STYLE_TEXT).toContain(`> [${LOADING_DOT_CORE_ATTR}] {`);
    expect(LOADING_VIEW_STYLE_TEXT).toContain(`animation-delay: var(${LOADING_DOT_PHASE_VAR})`);
    expect(LOADING_VIEW_STYLE_TEXT).not.toContain(`calc(var(${LOADING_DOT_DELAY_VAR}) +`);
    // The breath opens and closes on the landed state (opacity 1, scale 1), so
    // a loop restart shows no jump and never replays the landing. Two `from`
    // blocks survive: the landing's and the line's, and the breath writes none.
    expect(LOADING_VIEW_STYLE_TEXT.match(/from \{/g)).toHaveLength(2);
    expect(keyframeBlock(LOADING_BREATH_ANIMATION_NAME)).toBe(
      `@keyframes ${LOADING_BREATH_ANIMATION_NAME} { ` +
        `0%, 100% { opacity: 1; transform: scale(1); } ` +
        `${LOADING_BREATH_TROUGH_PERCENT}% { opacity: ${LOADING_BREATH_TROUGH_OPACITY}; transform: scale(${LOADING_BREATH_TROUGH_SCALE}); } ` +
        `${LOADING_BREATH_LANDED_PERCENT}% { opacity: 1; transform: scale(1); } }`,
    );
  });

  it("keeps the three dots out of phase, so the row is a wave and not a strobe", () => {
    expect(LOADING_DOT_PHASES_MS).toHaveLength(LOADING_DOT_DELAYS_MS.length);
    expect(new Set(LOADING_DOT_PHASES_MS).size).toBe(LOADING_DOT_DELAYS_MS.length);
    for (const [index, phaseMs] of LOADING_DOT_PHASES_MS.entries()) {
      if (index > 0) {
        // Each dot's dip lands later than the one to its left: the trough
        // travels left to right, the same direction the landing ran.
        expect(phaseMs).toBeGreaterThan(LOADING_DOT_PHASES_MS[index - 1] ?? 0);
      }
    }
    // The wave is narrower than one dip, so the row never shows all three dots
    // at the same point of the breath.
    expect(Math.max(...LOADING_DOT_PHASES_MS)).toBeLessThan(
      (LOADING_BREATH_DURATION_MS * (LOADING_BREATH_LANDED_PERCENT - LOADING_BREATH_TROUGH_PERCENT)) / 100,
    );
  });

  it("wraps every animation rule in the motion-safe query, so reduced motion rests", () => {
    const motionSafe = "@media (prefers-reduced-motion: no-preference)";
    expect(LOADING_VIEW_STYLE_TEXT).toContain(motionSafe);
    // Everything before the keyframes is the media block, and the block closes
    // right before them: both animation declarations are inside it.
    const keyframesAt = LOADING_VIEW_STYLE_TEXT.indexOf("@keyframes");
    expect(keyframesAt).toBeGreaterThan(0);
    const animatedPart = LOADING_VIEW_STYLE_TEXT.slice(0, keyframesAt);
    const keyframePart = LOADING_VIEW_STYLE_TEXT.slice(keyframesAt);
    expect(animatedPart).toContain(motionSafe);
    expect(animatedPart.match(/animation:/g)).toHaveLength(3);
    expect(animatedPart.trimEnd().endsWith("} }")).toBe(true);
    expect(keyframePart).not.toContain("animation:");
  });
});

describe("the loading view's default treatment", () => {
  it("keeps one honest status line and lands three dots above it", () => {
    render(<LoadingView />);
    // One live region, and its announced text is the plain loading line.
    const status = screen.getAllByRole("status");
    expect(status).toHaveLength(1);
    expect(status[0]?.textContent).toContain("Loading threads…");
    expect(loadingLine()).not.toBeNull();
    const box = document.querySelector(`[${LOADING_VIEW_ATTR}]`);
    expect(box?.getAttribute(LOADING_VIEW_ATTR)).toBe(DEFAULT_LOADING_VIEW_VARIANT);
    expect(DEFAULT_LOADING_VIEW_VARIANT).toBe("deal");
    // Three of the product's own atoms, staggered left to right, each carrying
    // its landing stagger and its breath phase and nothing else: no animation
    // name ever rides an inline custom property.
    expect(dots()).toHaveLength(LOADING_DOT_DELAYS_MS.length);
    expect(dots().map((dot) => dot.getAttribute("style"))).toEqual(
      LOADING_DOT_DELAYS_MS.map(
        (delay, index) =>
          `${LOADING_DOT_DELAY_VAR}: ${delay}ms; ${LOADING_DOT_PHASE_VAR}: ${LOADING_DOT_PHASES_MS[index]}ms;`,
      ),
    );
    // Every dot has one core, which is the element the breath animates.
    for (const dot of dots()) {
      expect(dot.querySelectorAll(`[${LOADING_DOT_CORE_ATTR}]`)).toHaveLength(1);
    }
  });

  it("keeps the decoration out of the accessibility tree", () => {
    render(<LoadingView />);
    const row = dots()[0]?.parentElement;
    expect(row?.getAttribute("aria-hidden")).toBe("true");
    // The dots themselves carry no text and no role of their own.
    for (const dot of dots()) {
      expect(dot.textContent).toBe("");
      expect(dot.getAttribute("role")).toBeNull();
    }
  });

  it("renders the motif in the DOM with motion reduced — the static state still charms", () => {
    // jsdom evaluates no media query, so what is provable here is the pair the
    // stylesheet relies on: the dots exist unconditionally (the resting row IS
    // the reduced-motion state), and no animation rule applies outside the
    // motion-safe wrapper (pinned above).
    render(<LoadingView />);
    expect(dots()).toHaveLength(3);
    expect(loadingLine()).not.toBeNull();
  });

  it("runs the breath from the stylesheet alone: no timer, no re-render", () => {
    // An animation driven by JS would have to tick something. Nothing ticks:
    // the row's DOM is identical ten seconds in, and its whole state is the
    // two custom properties the mount wrote.
    const interval = vi.spyOn(globalThis, "setInterval");
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    vi.useFakeTimers();
    render(<LoadingView />);
    const mounted = document.body.innerHTML;
    expect(interval).not.toHaveBeenCalled();
    expect(raf).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(document.body.innerHTML).toBe(mounted);
  });

  it("leaves nothing behind once the board paints", () => {
    const { unmount } = render(<LoadingView />);
    // The one stylesheet is document-scoped, so it outlives the view by design.
    expect(document.querySelectorAll(`#${LOADING_VIEW_STYLE_ID}`)).toHaveLength(1);
    unmount();
    // The animation lives on the dots' elements, so removing them is what
    // stops the cycle: no view, no dots, no status line.
    expect(document.querySelector(`[${LOADING_VIEW_ATTR}]`)).toBeNull();
    expect(dots()).toHaveLength(0);
    expect(loadingLine()).toBeNull();
    // A remount reuses that one element rather than stacking a second.
    render(<LoadingView />);
    expect(document.querySelectorAll(`#${LOADING_VIEW_STYLE_ID}`)).toHaveLength(1);
  });
});

describe("the loading view's other variants", () => {
  it("line is the quiet option: the line alone, no dots", () => {
    setLoadingViewVariantForCapture("line");
    render(<LoadingView />);
    expect(dots()).toHaveLength(0);
    expect(loadingLine()?.hasAttribute(LOADING_LINE_ATTR)).toBe(true);
    expect(document.querySelector(`[${LOADING_VIEW_ATTR}]`)?.getAttribute(LOADING_VIEW_ATTR)).toBe("line");
  });

  it("still is the screen this replaced, byte for byte in structure", () => {
    setLoadingViewVariantForCapture("still");
    render(<LoadingView />);
    expect(dots()).toHaveLength(0);
    const status = screen.getAllByRole("status");
    expect(status).toHaveLength(1);
    // The text sits straight in the dashed status box, no wrapper line element.
    expect(status[0]?.textContent).toBe("Loading threads…");
    expect(loadingLine()).toBe(status[0]);
    expect(loadingLine()?.hasAttribute(LOADING_LINE_ATTR)).toBe(false);
  });

  it("names every variant it can shoot, and refuses one it cannot", () => {
    for (const variant of LOADING_VIEW_VARIANTS) expect(isLoadingViewVariant(variant)).toBe(true);
    expect(isLoadingViewVariant("bounce")).toBe(false);
    expect(() => setLoadingViewVariantForCapture("bounce")).toThrow(/unknown variant/);
    // A refused id leaves the seam exactly as it was.
    expect(isLoadingViewVariant("deal")).toBe(true);
    setLoadingViewVariantForCapture(null);
    render(<LoadingView />);
    expect(document.querySelector(`[${LOADING_VIEW_ATTR}]`)?.getAttribute(LOADING_VIEW_ATTR)).toBe(
      DEFAULT_LOADING_VIEW_VARIANT,
    );
  });
});

// ---------------------------------------------------------------------------
// The law this fix exists for: the row must be visibly MOVING inside the time
// the readiness gate is actually up, not after it.
//
// Measured in Chrome against this harness (scripts/perf/measure-loading-view.mjs,
// Chrome 157): the view holds a median 41ms on a warm load and 234ms on the
// modeled profile, and ~0.6s on the production-shaped mount read the gate
// documents (lib/idle-callback). The shipped schedule opened its cycle at 150ms
// and bottomed each dot out at 682/905/1128ms, i.e. always after the view was
// gone, which is why two rounds of "the cycle exists" review changed nothing an
// operator could see.
//
// What is pinned here: the schedule arithmetic and the stylesheet mechanism.
// What jsdom cannot pin, and the harness proves instead: that a browser paints
// those frames. scripts/screenshot/capture-loading-view-live.mjs records them in
// real time (CDP screencast, Chrome's own frame timestamps) at each dwell.
const MODELED_DWELL_MS = 234; // median of 7 measured modeled loads
const PRODUCTION_SHAPED_DWELL_MS = 600; // the fan-in a large workspace pays

describe("the row moves inside the dwell the browser measured", () => {
  it("starts every dot's breath inside the modeled dwell", () => {
    // The brief's law, stated where it can fail: the animation has to START in
    // the time the view is actually up. The shipped schedule's last dot opened
    // its cycle at 150 + 110 = 260ms, past the measured 234ms.
    expect(Math.max(...LOADING_DOT_PHASES_MS)).toBeLessThanOrEqual(MODELED_DWELL_MS);
  });

  it("bottoms the first dot out inside the modeled dwell, where the old one never did", () => {
    expect(Math.min(...LOADING_DIP_TIMES_MS)).toBeLessThanOrEqual(MODELED_DWELL_MS);
  });

  it("leaves no still gap between the landing and the breath", () => {
    // The landing ends at 150ms; the first trough must arrive within a frame or
    // two of it, or a load that lands mid-dwell shows a landed, still row.
    expect(Math.min(...LOADING_DIP_TIMES_MS)).toBeLessThanOrEqual(LOADING_LANDING_DURATION_MS + 60);
  });

  it("finishes the wave inside the production-shaped dwell", () => {
    expect(Math.max(...LOADING_DIP_TIMES_MS)).toBeLessThanOrEqual(PRODUCTION_SHAPED_DWELL_MS);
  });

  it("keeps the dip schedule in dot order, left to right", () => {
    for (const [index, dipMs] of LOADING_DIP_TIMES_MS.entries()) {
      if (index > 0) expect(dipMs).toBeGreaterThan(LOADING_DIP_TIMES_MS[index - 1] ?? 0);
    }
    expect(LOADING_DIP_TIMES_MS).toHaveLength(LOADING_DOT_DELAYS_MS.length);
  });

  it("still repeats on a held gate, at least once inside the 1.8s ceiling", () => {
    // A held gate is the only view that can show a repeat, and the gate's
    // ceiling (lib/idle-callback MOUNT_SETTLE_CEILING_MS) is the longest it can
    // hold, so the second wave has to be inside that window.
    const secondWave = Math.max(...LOADING_DIP_TIMES_MS) + LOADING_BREATH_DURATION_MS;
    expect(secondWave).toBeLessThan(1800);
  });

  it("routes no animation name through a custom property", () => {
    // The shipped mechanism put each dot's keyframe name in an inline
    // `--loading-dot-cycle` and resolved it inside the shorthand. A name that
    // fails to resolve drops the animation with no error and leaves exactly the
    // reported symptom, so the name is written in the rule itself.
    expect(LOADING_VIEW_STYLE_TEXT).not.toContain("--loading-dot-cycle");
    // No animation shorthand takes its NAME from a variable: every name is
    // literal text in the rule, where a missing keyframe is a visible mistake
    // rather than a silently dropped animation.
    for (const declaration of LOADING_VIEW_STYLE_TEXT.match(/animation: [^;]+;/g) ?? []) {
      expect(declaration).not.toContain("var(");
    }
    render(<LoadingView />);
    for (const dot of dots()) {
      expect(dot.getAttribute("style") ?? "").not.toMatch(/animation/);
    }
  });
});

describe("the readiness gate renders it", () => {
  it("holds the panel on the loading view, then paints the settled board", async () => {
    seedFakeThreads([
      {
        id: "thr_loading",
        projectId: "proj_a",
        providerId: "pi",
        status: "idle",
        isUnread: false,
        isPinned: false,
        isArchived: false,
        isHidden: false,
        parentThreadId: null,
        hasPendingInteraction: false,
        updatedAt: Date.now() - 2 * HOUR,
        displayTitle: "Loading view board",
        lastReadAt: null,
        createdAt: 0,
      },
    ]);
    stubRpcHang("rank_list");
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    // The gate's own condition is untouched: it holds on the new view.
    expect(document.querySelector(`[${LOADING_VIEW_ATTR}]`)).not.toBeNull();
    expect(dots()).toHaveLength(3);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelector("[data-thread-card]")).toBeNull();
    expect(fakeRpcCalls().map((call) => call.method)).toContain("rank_list");
    await act(async () => {
      releaseRpcHangs();
    });
    // The same exit as always: the settled board, and no loading view left.
    expect(loadingLine()).toBeNull();
    expect(document.querySelector(`[${LOADING_VIEW_ATTR}]`)).toBeNull();
    expect(document.querySelector("[data-thread-card]")).not.toBeNull();
  });
});
