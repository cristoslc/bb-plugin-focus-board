// @vitest-environment jsdom
// [REDWORK] The pane header's done checkbox is the one control that never
// joined the coarse-pointer ladder (issue #267). Every sibling in the same
// header grows to a 36px box on a phone — the back button, the read toggle,
// the actions menu, the close button all carry `max-md:pointer-coarse:*`
// classes from components/ui/coarse-pointer-sizing.ts — while the done
// checkbox stays at its desktop size, which on a 390x844 viewport with
// `(pointer: coarse)` matched measures 18x22 CSS px against the header's 36px
// siblings. That is under the 24px WCAG 2.5.8 floor on a surface the operator
// reaches with a thumb.
//
// The contract: the done checkbox carries the same coarse-pointer sizing as
// its siblings, so it is a 36px target on a phone and its desktop size
// otherwise. jsdom cannot measure the media query, so this pins the CLASS
// CONTRACT the compiled CSS resolves: the coarse-pointer box pair on the
// checkbox, and no such pair without the pointer-coarse gate (which would
// grow it on a desktop mouse too).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const noop = () => {};

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: () => null,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

vi.mock("../components/decided-questions-card", () => ({
  DecidedQuestionsCard: () => null,
}));

function renderPane() {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: true },
      createElement(ThreadPane, {
        thread: {
          id: "thr_test",
          displayTitle: "Test thread",
          status: "idle",
          isUnread: false,
          isPinned: false,
        },
        isArchived: false,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onTogglePinned: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize: noop,
        onClose: noop,
        escStopsRunningThread: false,
      }),
    ),
  );
}

/** The pane header's done checkbox, by its own data attribute. */
function doneCheckbox(): HTMLElement {
  const el = document.querySelector("[data-pane-done-checkbox]");
  if (!(el instanceof HTMLElement)) throw new Error("no pane done checkbox rendered");
  return el;
}

/** The pane header's sibling controls, which are already phone-sized. */
function headerButtons(): HTMLElement[] {
  return [...document.querySelectorAll('aside[role="complementary"] header button')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

/**
 * Does a class list carry a coarse-pointer box of `px` pixels on each side?
 * The codebase spells the same 36px box two ways — Tailwind's `h-9`
 * (9 * 0.25rem) and the arbitrary `h-[36px]` the header constant uses — so the
 * check accepts both and judges the PIXEL size, not the spelling.
 */
function hasCoarseBox(cls: string, px: number): boolean {
  const rem = px / 4;
  const heights = [`h-${rem}`, `h-[${px}px]`];
  const widths = [`w-${rem}`, `w-[${px}px]`];
  return (
    heights.some((c) => cls.includes(`max-md:pointer-coarse:${c}`)) &&
    widths.some((c) => cls.includes(`max-md:pointer-coarse:${c}`))
  );
}

describe("pane header done checkbox sizing on a coarse pointer", () => {
  afterEach(() => {
    cleanup();
  });

  it("carries a 36px coarse-pointer box, the size its siblings get on a phone", () => {
    renderPane();
    expect(hasCoarseBox(doneCheckbox().className, 36)).toBe(true);
  });

  it("grows the glyph with the box, the way its siblings do", () => {
    renderPane();
    // The header's own size-9 siblings also step their icon up; the checkbox
    // icon must not stay a 14px speck inside a 36px box.
    expect(doneCheckbox().className).toMatch(
      /max-md:pointer-coarse:\[\&_\[data-icon-root\]\]:size-/,
    );
  });

  it("never grows on a fine pointer: the coarse gate wraps every size class", () => {
    renderPane();
    const cls = doneCheckbox().className;
    // Any h-9/w-9/[36px] without the pointer-coarse gate would size the
    // desktop header up as well.
    const ungated = cls
      .split(/\s+/)
      .filter((c) => !c.includes("pointer-coarse:") && /^(h-9|w-9|h-\[36px\]|w-\[36px\])$/.test(c));
    expect(ungated).toEqual([]);
  });

  it("gates the size on the phone band (max-md), not on every viewport", () => {
    renderPane();
    expect(doneCheckbox().className).toMatch(/max-md:pointer-coarse:/);
  });

  it("keeps the header's other controls on the same ladder, so the row stays a row", () => {
    renderPane();
    const withLadder = headerButtons().filter((b) => /max-md:pointer-coarse:/.test(b.className));
    // The done checkbox plus at least the back/read/close controls.
    expect(withLadder.length).toBeGreaterThanOrEqual(3);
  });
});
