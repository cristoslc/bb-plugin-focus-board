// @vitest-environment jsdom
// The readiness gate's loading view (components/loading-view.tsx).
//
// The gate test beside this file (app-mount-readiness-gate.test.tsx) pins WHEN
// the loading view holds and when it releases; this one pins WHAT it renders.
// The laws:
// - one injected stylesheet, idempotent across mounts, keyed by a `data-`
//   attribute, and its exact bytes;
// - the motif animates on the compositor only (opacity and transform), never a
//   layout property, and never an endless loop: a one-shot that rests;
// - every animation rule sits inside `prefers-reduced-motion: no-preference`,
//   so reduced motion renders the resting state itself — the motif is in the
//   DOM either way, static;
// - the status stays honest: one `role="status"`, the plain "Loading threads…"
//   line, and the decoration out of the accessibility tree;
// - the capture seam refuses an unknown variant instead of silently shooting
//   the default.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  DEFAULT_LOADING_VIEW_VARIANT,
  LOADING_DOT_ATTR,
  LOADING_DOT_DELAYS_MS,
  LOADING_DOT_DELAY_VAR,
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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  releaseRpcHangs();
  stubRpcHang(null);
  setLoadingViewVariantForCapture(null);
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

  it("is a one-shot that rests, never a loop", () => {
    // `both` fill: the dots land and stay landed, so the twentieth panel open
    // shows the same short landing the first one did.
    expect(LOADING_VIEW_STYLE_TEXT).toContain("both");
    expect(LOADING_VIEW_STYLE_TEXT).not.toContain("infinite");
    expect(LOADING_VIEW_STYLE_TEXT).not.toContain("alternate");
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
    // Three of the product's own atoms, staggered left to right.
    expect(dots()).toHaveLength(LOADING_DOT_DELAYS_MS.length);
    expect(dots().map((dot) => dot.getAttribute("style"))).toEqual(
      LOADING_DOT_DELAYS_MS.map((delay) => `${LOADING_DOT_DELAY_VAR}: ${delay}ms;`),
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
