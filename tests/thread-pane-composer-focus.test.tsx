// @vitest-environment jsdom
// The pane-parity audit's Gap 8: the pane never focuses the composer, so a
// keyboard-first operator clicks into it by hand on every open and every
// thread switch. The SDK's ThreadChat bumps composer focus on a
// focusRequest counter; ThreadPane owns the counter (1 on open, +1 per
// switch) and passes it through.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { ThreadPane, type ThreadPaneThread } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const mockFocusRequests: Array<number | undefined> = [];
const mockThreadIds: Array<string | undefined> = [];

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (props: { threadId: string; focusRequest?: number }): ReactNode => {
    mockFocusRequests.push(props.focusRequest);
    mockThreadIds.push(props.threadId);
    return null;
  },
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};

function threadPaneProps(thread: ThreadPaneThread): Parameters<typeof ThreadPane>[0] {
  return {
    thread,
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
  };
}

function baseThread(id: string): ThreadPaneThread {
  return {
    id,
    displayTitle: "Test thread",
    status: "idle",
    isUnread: false,
    isPinned: false,
    href: `/threads/${id}`,
  };
}

function renderPane(props: Parameters<typeof ThreadPane>[0]) {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, props),
    ),
  );
}

describe("the pane's composer focus request", () => {
  afterEach(() => {
    cleanup();
    mockFocusRequests.length = 0;
    mockThreadIds.length = 0;
  });

  it("opens with focusRequest 1", () => {
    renderPane(threadPaneProps(baseThread("thr_a")));
    expect(mockFocusRequests).toEqual([1]);
    expect(mockThreadIds).toEqual(["thr_a"]);
  });

  it("bumps when the pane switches to another thread", () => {
    const view = renderPane(threadPaneProps(baseThread("thr_a")));
    const switched = threadPaneProps(baseThread("thr_b"));
    view.rerender(
      createElement(
        CompactViewportOverrideProvider,
        { isCompactViewport: false },
        createElement(ThreadPane, switched),
      ),
    );
    expect(mockFocusRequests).toEqual([1, 2]);
    expect(mockThreadIds).toEqual(["thr_a", "thr_b"]);
  });

  it("stays put when the same thread re-renders", () => {
    const view = renderPane(threadPaneProps(baseThread("thr_a")));
    const churned = { ...threadPaneProps(baseThread("thr_a")), isDone: true };
    view.rerender(
      createElement(
        CompactViewportOverrideProvider,
        { isCompactViewport: false },
        createElement(ThreadPane, churned),
      ),
    );
    expect(mockFocusRequests.every((value) => value === 1)).toBe(true);
  });
});
