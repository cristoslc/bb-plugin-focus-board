// @vitest-environment jsdom
// The pane-parity audit's Gap 4: in the pane, a file-change row's title is
// colored exactly like the main view's clickable file accent (bb renders the
// path segment with `text-timeline-accent` — the only place that class
// appears in the timeline besides the unread divider's header), but the
// plugin path passes no title-action resolver, so the click does nothing.
// The pane's answer is the maximize fallback: clicking the title opens the
// thread in the main view, where the diff opens.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // A host-faithful file-change row title: bb renders the path segment with
  // the file accent class inside TimelineTitleView's tooltip wrapper. The
  // unread divider's header carries the same accent class on a DIV, so the
  // detector must not claim it.
  ThreadChat: (): ReactNode => (
    <div>
      <span title="docs/erd.mmd">
        <span className="min-w-0 truncate whitespace-pre text-timeline-accent">
          docs/erd.mmd
        </span>
      </span>
      <div
        role="separator"
        aria-label="New messages"
        className="text-[10px] font-medium uppercase tracking-wider text-timeline-accent"
      >
        <span className="shrink-0">New</span>
      </div>
    </div>
  ),
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};
const onMaximize = vi.fn();

beforeEach(() => {
  onMaximize.mockClear();
});

afterEach(cleanup);

function renderPane() {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, {
        thread: {
          id: "thr_test",
          displayTitle: "Test thread",
          status: "idle",
          isUnread: false,
          isPinned: false,
          href: "/threads/thr_test",
        },
        isArchived: false,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onTogglePinned: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize,
        onClose: noop,
        escStopsRunningThread: false,
      }),
    ),
  );
}

describe("file-change title clicks in the pane", () => {
  it("a click on the file accent opens the thread in the main view", () => {
    const view = renderPane();
    const title = view.getByText("docs/erd.mmd");
    fireEvent.click(title);
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it("the click is claimed: no default navigation follows", () => {
    const view = renderPane();
    const title = view.getByText("docs/erd.mmd");
    const event = fireEvent.click(title, { button: 0 });
    expect(event).toBe(false);
  });

  it("a click on the unread divider's accent header does not maximize", () => {
    const view = renderPane();
    fireClick(view.getByText("New"));
    expect(onMaximize).not.toHaveBeenCalled();
  });

  it("non-left clicks stay native", () => {
    const view = renderPane();
    const title = view.getByText("docs/erd.mmd");
    fireEvent.click(title, { button: 2 });
    expect(onMaximize).not.toHaveBeenCalled();
  });
});

function fireClick(target: HTMLElement) {
  fireEvent.click(target);
}
