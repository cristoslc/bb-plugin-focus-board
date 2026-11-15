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
  LOADING_CYCLE_ANIMATION_NAMES,
  LOADING_CYCLE_DURATION_MS,
  LOADING_CYCLE_TROUGH_PERCENT,
  LOADING_DEAL_ANIMATION_NAME,
  LOADING_DOT_ATTR,
  LOADING_DOT_CYCLE_VAR,
  LOADING_DOT_DELAYS_MS,
  LOADING_DOT_DELAY_VAR,
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
    expect(LOADING_VIEW_STYLE_TEXT).toContain(`animation-delay: var(${LOADING_DOT_DELAY_VAR}), `);
    expect(keyframeBlock(LOADING_DEAL_ANIMATION_NAME)).toBe(
      `@keyframes ${LOADING_DEAL_ANIMATION_NAME} { from { opacity: 0; transform: translateY(4px) scale(0.5); } }`,
    );
  });

  it("hands off to a cycle that repeats until the view unmounts", () => {
    expect(LOADING_VIEW_STYLE_TEXT).toContain(
      `var(${LOADING_DOT_CYCLE_VAR}) ${LOADING_CYCLE_DURATION_MS}ms ease-in-out infinite`,
    );
    expect(LOADING_VIEW_STYLE_TEXT).not.toContain("alternate");
    // One breath inside the calm band: slow enough to read as working, never a
    // pulse asking for attention.
    expect(LOADING_CYCLE_DURATION_MS).toBeGreaterThanOrEqual(1200);
    expect(LOADING_CYCLE_DURATION_MS).toBeLessThanOrEqual(1800);
  });

  it("starts the cycle where the landing ended, so the handoff shows no jump", () => {
    // The cycle's delay is the dot's own landing stagger plus the whole
    // landing, so the two beats never fight over opacity or transform.
    expect(LOADING_VIEW_STYLE_TEXT).toContain(
      `calc(var(${LOADING_DOT_DELAY_VAR}) + ${LOADING_LANDING_DURATION_MS}ms)`,
    );
    // Every cycle keyframe writes its trough and nothing else: 0% and 100%
    // fall back to the landed state (opacity 1, no transform), which both
    // matches the landing's end frame and keeps the landing from replaying.
    // Exactly one stop per cycle keyframe is the mechanical proof of that.
    expect(LOADING_VIEW_STYLE_TEXT.match(/\d+% \{/g)).toHaveLength(LOADING_CYCLE_ANIMATION_NAMES.length);
    expect(LOADING_VIEW_STYLE_TEXT.match(/from \{/g)).toHaveLength(2);
    for (const [index, name] of LOADING_CYCLE_ANIMATION_NAMES.entries()) {
      expect(keyframeBlock(name)).toBe(
        `@keyframes ${name} { ${LOADING_CYCLE_TROUGH_PERCENT[index]}% { opacity: 0.5; transform: scale(0.94); } }`,
      );
    }
  });

  it("keeps the three dots out of phase, so the row is a wave and not a strobe", () => {
    expect(LOADING_CYCLE_TROUGH_PERCENT).toHaveLength(LOADING_DOT_DELAYS_MS.length);
    expect(new Set(LOADING_CYCLE_ANIMATION_NAMES).size).toBe(LOADING_DOT_DELAYS_MS.length);
    for (const [index, percent] of LOADING_CYCLE_TROUGH_PERCENT.entries()) {
      if (index > 0) {
        // Each dot's dip lands later than the one to its left: the trough
        // travels left to right, the same direction the landing ran.
        expect(percent).toBeGreaterThan(LOADING_CYCLE_TROUGH_PERCENT[index - 1] ?? 0);
      }
      // Never on the handoff itself, or the row would open the cycle mid-dip.
      expect(percent).toBeGreaterThan(25);
      expect(percent).toBeLessThan(75);
    }
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
    expect(animatedPart.match(/animation:/g)).toHaveLength(2);
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
    // its own cycle name so one stylesheet rule animates all three.
    expect(dots()).toHaveLength(LOADING_DOT_DELAYS_MS.length);
    expect(dots().map((dot) => dot.getAttribute("style"))).toEqual(
      LOADING_DOT_DELAYS_MS.map(
        (delay, index) =>
          `${LOADING_DOT_DELAY_VAR}: ${delay}ms; ${LOADING_DOT_CYCLE_VAR}: ${LOADING_CYCLE_ANIMATION_NAMES[index]};`,
      ),
    );
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

  it("runs the cycle from the stylesheet alone: no timer, no re-render", () => {
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
