// @vitest-environment jsdom
// The thread pane footer shows which project (and branch) the open thread
// runs on: a project's own checkout environment is just called "Project
// Checkout", so without a project label there is no way to tell which
// project the chat pane is working on. Archived threads keep a minimal
// shape and render no footer at all.
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
        escStopsRunningThread: false,
      }),
    ),
  );
}

describe("thread pane footer project line", () => {
  it("shows the project name in the pane footer", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: "bb-plugin-focus-board",
      branchName: null,
    });
    const line = screen.getByText("bb-plugin-focus-board");
    expect(line.closest("footer")).not.toBeNull();
  });

  it("shows the branch next to the project in the footer", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: "bb-plugin-focus-board",
      branchName: "feat/context-line",
    });
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain("bb-plugin-focus-board");
    expect(footer.textContent).toContain("feat/context-line");
    expect(footer.textContent).toContain("·");
  });

  it("omits the footer when the pane has no project", () => {
    renderPane({
      id: "thr_test",
      displayTitle: "Test thread",
      status: "idle",
      isUnread: false,
      projectName: null,
      branchName: null,
    });
    // Archived rows keep only the title shape; the footer is gone.
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });
});