// @vitest-environment jsdom
// The pane-parity audit's Gap 5: plugin panels' chats run with
// `includePluginMessageActions: false`, so the host excludes every plugin's
// message actions there; the SDK lets the consumer pass its OWN
// `messageActions`, which the pane never did. The pane passes two
// board-owned actions: copy the message's text, and open the thread in the
// main view (the pane's maximize, where the pane's boundary surfaces live).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadChatMessageAction } from "@get-bb/plugin-sdk/app";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const mockMessageActions: Array<readonly ThreadChatMessageAction[] | undefined> = [];

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (props: { messageActions?: readonly ThreadChatMessageAction[] }): ReactNode => {
    mockMessageActions.push(props.messageActions);
    return null;
  },
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};
const onMaximize = vi.fn();
const writeText = vi.fn(async () => {});

beforeEach(() => {
  onMaximize.mockClear();
  writeText.mockClear();
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  mockMessageActions.length = 0;
});

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

describe("the pane's board-owned message actions", () => {
  it("the pane passes its own actions to the embedded chat", () => {
    renderPane();
    expect(mockMessageActions[0]).toBeDefined();
    const actions = mockMessageActions[0] ?? [];
    expect(actions.map((action) => action.id)).toEqual(["copy-message", "open-in-main-view"]);
  });

  it("Copy message writes the message's text to the clipboard", async () => {
    renderPane();
    const action = (mockMessageActions[0] ?? []).find((entry) => entry.id === "copy-message");
    expect(action).toBeDefined();
    await action?.run({ id: "m1", threadId: "thr_test", role: "assistant", text: "line one\nline two", sourceSeqEnd: 5 });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("line one\nline two");
  });

  it("Open in main view runs the pane's maximize", () => {
    renderPane();
    const action = (mockMessageActions[0] ?? []).find((entry) => entry.id === "open-in-main-view");
    expect(action).toBeDefined();
    action?.run({ id: "m2", threadId: "thr_test", role: "user", text: "go", sourceSeqEnd: 7 });
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });
});
