// @vitest-environment jsdom
// The thread pane's composer-context fallback row.
//
// bb's own thread page passes both `environmentSummary` and
// `compactEnvironmentSummary` to its promptbox, but the embedded
// `ThreadChat` the SDK hands plugin panels passes only the full summary —
// and the promptbox renders the compact one when its container is narrow,
// which a plugin panel always is. Worse (the vanish the pane's probe
// traces): the composer's footer — where the chips actually paint —
// collapses to height 0 whenever the composer sits unexpanded, an
// attribute flip plus a 180ms CSS transition, no mount or unmount. The
// pane therefore keeps its own "project · checkout · branch" line under
// the transcript whenever the host's chips are mounted but not actually
// painted, and yields the moment they paint.
//
// The fixtures below mirror how bb 0.46.1 paints the context:
// `[data-option-display]` chips whose sr-only label reads "Project: " /
// "Environment: ", `[data-promptbox-hide-branch-compact]` checkout chips,
// the compact `Thread details: …` button, and the collapsed/expanded
// footer boxes from the live captures. jsdom measures every element at
// 0x0, so the paint-state tests stub the rect getter per element.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { composerContextVisible } from "../components/pane-context-row";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const chatHolder = vi.hoisted(() => ({ content: null as ReactNode }));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // The pane's embedded chat is only imported for render; the observer
  // under test watches whatever DOM the mock paints. dangerouslySetInnerHTML
  // paints the fixtures as real DOM, matching how the host renders.
  ThreadChat: (): ReactNode => chatHolder.content,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};

afterEach(() => {
  cleanup();
  chatHolder.content = null;
});

function paneThread(context: Parameters<typeof ThreadPane>[0]["thread"]["context"]) {
  return {
    id: "thr_test",
    displayTitle: "Test thread",
    status: "idle",
    isUnread: false,
    isPinned: false,
    href: "/threads/thr_test",
    context,
  };
}

const worktreeContext = {
  projectId: "proj_focus",
  projectLabel: "Focus Board plugin",
  environmentLabel: "Worktree thr_9iwfimagwv-1",
  branchLabel: "feat/pane-context",
};

function renderPane(thread: ReturnType<typeof paneThread>) {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, {
        thread,
        isArchived: false,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize: noop,
        onClose: noop,
      }),
    ),
  );
}

const settle = () =>
  new Promise((resolve) => setTimeout(resolve, 350));

/** Host-shaped fixture HTML: a chip exactly as the promptbox paints it. */
function hostChipHtml(label: string, value: string) {
  return `<div data-option-display><span class="sr-only">${label}: </span><span data-promptbox-full-label>${value}</span></div>`;
}

function chatWith(html: string) {
  chatHolder.content = createElement("div", {
    "data-testid": "mock-chat",
    dangerouslySetInnerHTML: { __html: html },
  });
}

function rooted(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

/** jsdom measures every element at 0x0; these tests stub the prototype getter
 *  with a per-element rect map so the paint-state walk sees real geometry. */
type RectMap = Map<Element, { x: number; y: number; width: number; height: number }>;

function rect(value: { x: number; y: number; width: number; height: number }): DOMRect {
  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    top: value.y,
    bottom: value.y + value.height,
    left: value.x,
    right: value.x + value.width,
    toJSON() {},
  } as DOMRect;
}

let rectMap: RectMap | null = null;

beforeEach(() => {
  rectMap = new Map();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const stored = rectMap?.get(this);
    return rect(stored ?? { x: 0, y: 0, width: 0, height: 0 });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rectMap = null;
});

function withRect(el: Element, value: { y: number; height: number; width: number }) {
  if (rectMap === null) throw new Error("rect map not armed");
  rectMap.set(el, { x: 10, y: value.y, width: value.width, height: value.height });
}

describe("composerContextVisible probe", () => {
  it("reads null or absent DOM as not visible", () => {
    expect(composerContextVisible(null)).toBe(false);
    expect(composerContextVisible(document.createElement("div"))).toBe(false);
  });

  it("sees the host's Project and Environment chips", () => {
    expect(
      composerContextVisible(rooted(hostChipHtml("Project", "Focus Board plugin"))),
    ).toBe(true);
    expect(
      composerContextVisible(rooted(hostChipHtml("Environment", "Worktree thr_9iwfimagwv-1"))),
    ).toBe(true);
  });

  it("ignores unrelated picker chips that share the same markup", () => {
    expect(composerContextVisible(rooted(hostChipHtml("Model", "Haiku")))).toBe(false);
  });

  it("sees the compact Thread details button", () => {
    expect(
      composerContextVisible(
        rooted(`<button aria-label="Thread details: feat/x">feat/x</button>`),
      ),
    ).toBe(true);
  });

  it("sees the full row's checkout chip", () => {
    expect(
      composerContextVisible(
        rooted(`<span data-promptbox-hide-branch-compact="">feat/x</span>`),
      ),
    ).toBe(true);
  });
});

describe("probe paint state", () => {
  // bb 0.46.1 collapses the composer's footer to height 0 (attribute-driven,
  // animated) while the chips stay mounted; the chips' own rects still
  // measure, so presence proves nothing. The probe must follow the paint.
  it("reads chips clipped by a height-0 collapsed footer as absent", () => {
    const root = rooted(
      `<div data-follow-up-composer-footer style="overflow-x: visible; overflow-y: hidden;">
         ${hostChipHtml("Project", "Focus Board plugin")}
       </div>`,
    );
    const footer = root.querySelector("[data-follow-up-composer-footer]");
    if (footer === null) throw new Error("fixture footer missing");
    withRect(footer, { y: 1059, height: 0, width: 477 });
    for (const chip of root.querySelectorAll("[data-option-display]")) {
      withRect(chip, { y: 1047, height: 24, width: 81 });
    }
    expect(composerContextVisible(root)).toBe(false);
  });

  it("reads the same chips as present once the footer expands", () => {
    const root = rooted(
      `<div data-follow-up-composer-footer style="overflow-x: visible; overflow-y: hidden;">
         ${hostChipHtml("Project", "Focus Board plugin")}
       </div>`,
    );
    const footer = root.querySelector("[data-follow-up-composer-footer]");
    if (footer === null) throw new Error("fixture footer missing");
    withRect(footer, { y: 1035, height: 24, width: 477 });
    for (const chip of root.querySelectorAll("[data-option-display]")) {
      withRect(chip, { y: 1037, height: 20, width: 57 });
    }
    expect(composerContextVisible(root)).toBe(true);
  });

  it("reads opacity-0 and display-none ancestors as absent", () => {
    const faded = rooted(`<div style="opacity: 0">${hostChipHtml("Project", "x")}</div>`);
    expect(composerContextVisible(faded)).toBe(false);
    const hidden = rooted(`<div style="display: none">${hostChipHtml("Project", "x")}</div>`);
    expect(composerContextVisible(hidden)).toBe(false);
  });

  it("reads visible-overflow ancestors as present when the chip escapes the box", () => {
    const root = rooted(`<div>${hostChipHtml("Project", "Focus Board plugin")}</div>`);
    // No inline overflow: the ancestor clips nothing, so the chip paints.
    withRect(root.firstElementChild!, { y: 1059, height: 0, width: 477 });
    for (const chip of root.querySelectorAll("[data-option-display]")) {
      withRect(chip, { y: 1047, height: 24, width: 81 });
    }
    expect(composerContextVisible(root)).toBe(true);
  });
});

describe("thread pane composer-context fallback row", () => {
  const collapsedFooterHtml = `<div data-follow-up-composer-footer style="overflow-x: visible; overflow-y: hidden;">${hostChipHtml("Project", "Focus Board plugin")}</div>`;

  function armFooterRects(state: "collapsed" | "expanded") {
    const chat = document.querySelector("[data-testid='mock-chat']");
    if (chat === null) throw new Error("mock chat missing");
    const footer = chat.querySelector("[data-follow-up-composer-footer]");
    if (!(footer instanceof HTMLElement)) throw new Error("mock footer missing");
    // The host's chips' rects read through the ancestor clip only when the
    // footer's box contains them; collapsed = height 0 at its bottom edge.
    withRect(footer, state === "collapsed" ? { y: 1059, height: 0, width: 477 } : { y: 1035, height: 24, width: 477 });
    for (const chip of footer.querySelectorAll("[data-option-display]")) {
      withRect(chip, state === "collapsed" ? { y: 1047, height: 24, width: 81 } : { y: 1037, height: 20, width: 57 });
    }
  }

  it("stays hidden while the host visibly paints its own context chips", async () => {
    chatWith(collapsedFooterHtml.replace("data-follow-up-composer-footer ", "data-follow-up-composer-footer data-follow-up-composer-footer-visible "));
    const { queryByTestId } = renderPane(paneThread(worktreeContext));
    armFooterRects("expanded");
    await settle();
    expect(queryByTestId("pane-context-row")).toBeNull();
  });

  it("shows the fallback while the host's footer sits collapsed at height 0", async () => {
    chatWith(collapsedFooterHtml);
    const { getByTestId } = renderPane(paneThread(worktreeContext));
    armFooterRects("collapsed");
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    expect(getByTestId("pane-context-row").textContent).toContain("Focus Board plugin");
  });

  it("swaps over when the composer's footer expands, on the attribute toggle alone", async () => {
    chatWith(collapsedFooterHtml);
    const { queryByTestId, getByTestId } = renderPane(paneThread(worktreeContext));
    armFooterRects("collapsed");
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    // bb's collapse is an attribute flip + CSS transition: no node mounts or
    // unmounts. The probe must wake on the attribute alone.
    const footer = document.querySelector("[data-follow-up-composer-footer]");
    if (!(footer instanceof HTMLElement)) throw new Error("mock footer missing");
    footer.setAttribute("data-follow-up-composer-footer-visible", "");
    armFooterRects("expanded");
    await waitFor(() => expect(queryByTestId("pane-context-row")).toBeNull());
  });

  it("appears under the transcript when the host paints nothing", async () => {
    chatWith("");
    const { getByTestId } = renderPane(paneThread(worktreeContext));
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    const row = getByTestId("pane-context-row");
    expect(row.textContent).toContain("Focus Board plugin");
    expect(row.textContent).toContain("feat/pane-context");
  });

  it("still appears when the host paints only unrelated picker chips", async () => {
    chatWith(hostChipHtml("Model", "Haiku"));
    const { getByTestId } = renderPane(paneThread(worktreeContext));
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
  });

  it("never appears for a thread with no environment to describe", async () => {
    chatWith("");
    const { queryByTestId } = renderPane(paneThread(null));
    await settle();
    expect(queryByTestId("pane-context-row")).toBeNull();
  });

  it("drops the row at once when the pane opens a thread without context", async () => {
    chatWith("");
    const { rerender, getByTestId, queryByTestId } = renderPane(
      paneThread(worktreeContext),
    );
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    chatHolder.content = null;
    rerender(
      createElement(
        CompactViewportOverrideProvider,
        { isCompactViewport: false },
        createElement(ThreadPane, {
          thread: paneThread(null),
          isArchived: false,
          isDone: false,
          onToggleDone: noop,
          onToggleArchived: noop,
          onToggleUnread: noop,
          onRename: async () => {},
          onMaximize: noop,
          onClose: noop,
        }),
      ),
    );
    await waitFor(() => expect(queryByTestId("pane-context-row")).toBeNull());
  });

  it("prefers the environment label when the branch is unknown", async () => {
    chatWith("");
    const { getByTestId } = renderPane(
      paneThread({
        projectId: "proj_focus",
        projectLabel: "Focus Board plugin",
        environmentLabel: "Project checkout",
        branchLabel: null,
      }),
    );
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    expect(getByTestId("pane-context-row").textContent).toContain(
      "Project checkout",
    );
  });
});