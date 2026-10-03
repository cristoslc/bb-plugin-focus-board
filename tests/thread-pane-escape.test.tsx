// @vitest-environment jsdom
// The thread pane's Escape key behavior, governed by the "Esc stops running
// thread" toolbar toggle: ON (default), Escape stops a running thread and
// only closes the pane when the thread is not running; OFF, Escape always
// closes the pane as it always did.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const stop = vi.fn();
const onClose = vi.fn();

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // The pane's embedded chat is only imported for render; the Escape
  // handling under test does not involve it.
  ThreadChat: (): ReactNode => null,
  useSdk: () => ({ threads: { get: async () => ({}), stop } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
}));

vi.mock("../components/pending-interaction-card", () => ({
  PendingInteractionCard: (): ReactNode => null,
}));

vi.mock("../components/decided-questions-card", () => ({
  DecidedQuestionsCard: (): ReactNode => null,
}));

const noop = () => {};

beforeEach(() => {
  stop.mockReset();
  stop.mockResolvedValue({});
  onClose.mockReset();
});

afterEach(cleanup);

function renderPane(
  thread: Parameters<typeof ThreadPane>[0]["thread"],
  {
    escStopsRunningThread = true,
    escapeSuppressed = false,
  }: { escStopsRunningThread?: boolean; escapeSuppressed?: boolean } = {},
) {
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
        onClose,
        escStopsRunningThread,
        escapeSuppressed,
      }),
    ),
  );
}

const pressEscape = () => {
  // The listener is a capture-phase document listener; fire on the document
  // like a real keydown would reach it.
  fireEvent.keyDown(document, { key: "Escape" });
};

describe("Escape stops a running thread (toggle ON)", () => {
  it("stops an active thread instead of closing the pane", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "active",
      isUnread: false,
      projectName: null,
      branchName: null,
    });
    pressEscape();
    expect(stop).toHaveBeenCalledWith({ threadId: "thr_test" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops a starting thread too", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "starting",
      isUnread: false,
      projectName: null,
      branchName: null,
    });
    pressEscape();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("holds the pane open while a stop is already in flight", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "stopping",
      isUnread: false,
      projectName: null,
      branchName: null,
    });
    pressEscape();
    expect(stop).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the pane once the thread is idle", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: null,
      branchName: null,
    });
    pressEscape();
    expect(stop).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Escape closes the pane regardless of status (toggle OFF)", () => {
  it("closes an active thread's pane without stopping it", () => {
    renderPane(
      {
        id: "thr_test",
        displayTitle: "Test thread",
        status: "active",
        isUnread: false,
        projectName: null,
        branchName: null,
      },
      { escStopsRunningThread: false },
    );
    pressEscape();
    expect(stop).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Escape stands down while an overlay owns the key (composer modal open)", () => {
  it("neither stops a running thread nor closes the pane", () => {
    renderPane(
      {
        id: "thr_test",
        displayTitle: "Test thread",
        status: "active",
        isUnread: false,
        projectName: null,
        branchName: null,
      },
      { escapeSuppressed: true },
    );
    pressEscape();
    expect(stop).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close an idle thread's pane either", () => {
    renderPane(
      {
        id: "thr_test",
        displayTitle: "Test thread",
        status: "idle",
        isUnread: false,
        projectName: null,
        branchName: null,
      },
      { escStopsRunningThread: false, escapeSuppressed: true },
    );
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});