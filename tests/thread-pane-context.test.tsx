// @vitest-environment jsdom
// The thread pane header shows which project (and branch) the open thread
// runs on: a project's own checkout environment is just called "Project
// Checkout", so without a project label there is no way to tell which
// project the chat pane is working on. Archived threads keep a minimal
// shape and render no context line at all.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // The pane's embedded chat is only imported for render; the header line
  // under test does not involve it.
  ThreadChat: (): ReactNode => null,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
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

afterEach(cleanup);

function renderPane(thread: Parameters<typeof ThreadPane>[0]["thread"]) {
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

describe("thread pane header context line", () => {
  it("shows the project name", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: "bb-plugin-focus-board",
      branchName: null,
    });
    expect(screen.getByText("bb-plugin-focus-board")).toBeTruthy();
  });

  it("shows the branch next to the project", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: "bb-plugin-focus-board",
      branchName: "feat/context-line",
    });
    expect(screen.getByText(/bb-plugin-focus-board/)).toBeTruthy();
    const line = screen.getByText(/feat\/context-line/);
    expect(line.textContent).toContain("·");
  });

  it("omits the context line when the pane has no project", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: null,
      branchName: null,
    });
    // The header keeps only the title; no muted metadata line below it.
    expect(screen.queryByText("Personal")).toBeNull();
  });
});