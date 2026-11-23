// @vitest-environment jsdom
// [REDWORK] The pane header's control on a coarse pointer (issue #267's
// contract, kept through the header unification of 2026-11-23). Every header
// control grows to a 36px box on a phone — the back button, the read toggle,
// the actions menu, the close button all carry `max-md:pointer-coarse:*`
// classes from components/ui/coarse-pointer-sizing.ts. The Focus Board control
// bb renders in its own thread header sizes itself the same way, and the
// board's pane header renders that same component
// (components/focus-board-thread-menu.tsx), so it must stand on the same
// ladder: a 36px target on a phone, its desktop 28px otherwise.
//
// The node this file used to guard was the pane's inline done checkbox, which
// the header unification retired (Done is the control's first menu row now).
// jsdom cannot measure a media query, so this pins the CLASS CONTRACT the
// compiled CSS resolves: the coarse-pointer box pair on the trigger, and no
// such pair without the pointer-coarse gate (which would grow it on a desktop
// mouse too).
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
        onOpenSnoozePicker: noop,
        onNewChildThread: noop,
      }),
    ),
  );
}

/** The pane header's Focus Board control, by the shared trigger marker. */
function boardMenuTrigger(): HTMLElement {
  const el = document.querySelector("[data-thread-menu-trigger]");
  if (!(el instanceof HTMLElement)) throw new Error("no Focus Board control rendered");
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
 * (9 * 0.25rem), the arbitrary `h-[36px]` the header constant uses, and the
 * `size-9` the compact branch's merge resolves to — so the check accepts every
 * spelling and judges the PIXEL size, not the spelling.
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

describe("pane header Focus Board control sizing on a coarse pointer", () => {
  afterEach(() => {
    cleanup();
  });

  it("carries a 36px coarse-pointer box, the size its siblings get on a phone", () => {
    renderPane();
    const cls = boardMenuTrigger().className;
    // The compact branch folds the pair into `max-md:pointer-coarse:size-9`,
    // which is the same 36px box.
    const sized =
      hasCoarseBox(cls, 36) || /max-md:pointer-coarse:size-9\b/.test(cls);
    expect(sized).toBe(true);
  });

  it("grows the mark with the box, the way its siblings do", () => {
    renderPane();
    // The header's size-9 siblings also step their icon up; the plugin's mark
    // must not stay a 16px speck inside a 36px box.
    expect(boardMenuTrigger().className).toMatch(
      /max-md:pointer-coarse:\[\&_\[data-icon-root\]\]:size-/,
    );
  });

  it("never grows on a fine pointer: the coarse gate wraps every size class", () => {
    renderPane();
    const cls = boardMenuTrigger().className;
    // Any h-9/w-9/[36px]/size-9 without the pointer-coarse gate would size the
    // desktop header up as well.
    const ungated = cls
      .split(/\s+/)
      .filter(
        (c) =>
          !c.includes("pointer-coarse:") &&
          /^(h-9|w-9|size-9|h-\[36px\]|w-\[36px\])$/.test(c),
      );
    expect(ungated).toEqual([]);
  });

  it("gates the size on the phone band (max-md), not on every viewport", () => {
    renderPane();
    expect(boardMenuTrigger().className).toMatch(/max-md:pointer-coarse:/);
  });

  it("keeps the header's other controls on the same ladder, so the row stays a row", () => {
    renderPane();
    const withLadder = headerButtons().filter((b) => /max-md:pointer-coarse:/.test(b.className));
    // The Focus Board control plus at least the back/read/close controls.
    expect(withLadder.length).toBeGreaterThanOrEqual(3);
  });
});

