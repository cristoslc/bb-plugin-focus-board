// @vitest-environment jsdom
// [REDWORK] The host's queued-message row reveals its actions on a touch
// device through two `@media (hover:none)` utilities (opacity and
// pointer-events). bb scopes our plugin stylesheet with
// `:where([data-bb-plugin="focus-board"], ...)` and appends it after bb's
// global utilities, so our own scoped `.opacity-0` and `.pointer-events-none`
// outrank those host utilities on every host element inside the plugin root.
// The queued row is the case that hurts a person: on a phone its "…" control
// stays `opacity:0` and `pointer-events:none`, the only control that reveals
// Send is invisible, and the queued message cannot be sent from the pane
// (issue #296).
//
// The pane re-asserts the host's two utilities from the subtree that wraps the
// host chat, so the compiled sheet carries them after our plain utilities and
// they win by order.
//
// jsdom cannot evaluate a `@media (hover:none)` rule, so this pins the CLASS
// CONTRACT the compiled CSS resolves, the same way
// thread-pane-coarse-controls.test.tsx pins the coarse-pointer ladder. The
// class names are assembled from pieces on purpose: written literally, this
// file would itself teach the build's Tailwind pass (it scans tests too) to
// emit the utilities, and the real-Chrome UAT beside it would then pass on an
// unfixed tree. The shipped sheet must carry them only because the pane does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const HOVER_NONE = ["[@media(hover:none)]"].join("");
/** The host's touch-reveal utilities the pane must re-assert. */
const REVEAL = ["pointer-events-auto", "opacity-100"].map((utility) => `${HOVER_NONE}:${utility}`);

const noop = () => {};

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: () => null,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

vi.mock("../components/pending-interaction-card", () => ({
  PendingInteractionCard: () => null,
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

describe("pane chat body re-asserts the host's touch reveal", () => {
  afterEach(() => {
    cleanup();
  });

  it("carries both host touch-reveal utilities, so the scoped sheet can win by order", () => {
    renderPane();
    const body = document.querySelector("[data-pane-chat-body]");
    expect(body, "the pane must mark the wrapper around the host chat").toBeTruthy();
    const className = (body as HTMLElement).className;
    for (const token of REVEAL) {
      expect(className, `missing the ${token.split(":").slice(1).join(":")} re-assertion`).toContain(token);
    }
  });

  it("keeps the wrapper's own layout classes untouched", () => {
    renderPane();
    const body = document.querySelector("[data-pane-chat-body]");
    expect(body, "the pane must mark the wrapper around the host chat").toBeTruthy();
    const className = (body as HTMLElement).className;
    expect(className).toContain("min-h-0");
    expect(className).toContain("flex-1");
  });
});
