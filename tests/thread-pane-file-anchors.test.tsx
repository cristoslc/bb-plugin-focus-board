// @vitest-environment jsdom
// bb links any existing workspace path as a `file://` anchor, and its file
// preview refuses directories ("Path is not a regular file", the operator's
// 2026-11-16 report). The pane's click capture now classifies those anchors
// against the thread's workspace and routes them itself: a directory opens
// in the operator's preferred editor (falling back to a file manager), a
// file keeps BB's preview, and a destination outside the workspace stays
// inert instead of opening the error pane.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const openFilePreview = vi.fn();
const rpcCall = vi.fn();

const DIRECTORY_HREF = "file:///w/bv-brain2/.worktrees";
const FILE_HREF = "file:///w/bv-brain2/docs/erd.md";
const OUTSIDE_HREF = "file:///etc/hosts";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (): ReactNode =>
    createElement(
      "div",
      null,
      createElement("a", { href: DIRECTORY_HREF }, "worktrees"),
      createElement("a", { href: FILE_HREF }, "ERD"),
      createElement("a", { href: OUTSIDE_HREF }, "hosts"),
    ),
  useSdk: () => ({ threads: { get: async () => ({ environmentId: "env_test" }) } }),
  useRpc: () => ({ call: rpcCall }),
  useBbNavigate: () => ({
    toThread: () => {},
    toProject: () => {},
    experimental_openFilePreview: openFilePreview,
  }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const TARGETS = {
  status: "available" as const,
  reason: null,
  root: "/w/bv-brain2",
  targets: [
    {
      id: "vscode",
      label: "Visual Studio Code",
      kind: "editor",
      icon: null,
      capabilities: {
        openDirectory: true,
        openFile: true,
        openFileAtLine: true,
        openFileAtColumn: true,
      },
    },
    {
      id: "finder",
      label: "Finder",
      kind: "file-manager",
      icon: null,
      capabilities: {
        openDirectory: true,
        openFile: false,
        openFileAtLine: false,
        openFileAtColumn: null,
      },
    },
  ],
};

function kindFor(href: string) {
  if (href === DIRECTORY_HREF) return { kind: "directory", path: ".worktrees" };
  if (href === FILE_HREF) return { kind: "file", path: "docs/erd.md" };
  return { kind: "outside", path: null };
}

const noop = () => {};

afterEach(() => {
  cleanup();
  openFilePreview.mockReset();
  rpcCall.mockReset();
  window.localStorage.clear();
});

function renderPane() {
  rpcCall.mockImplementation(async (method: string, args: unknown) => {
    if (method === "workspace_path_kind") {
      return kindFor((args as { href: string }).href);
    }
    if (method === "workspace_open_targets") return TARGETS;
    if (method === "workspace_open_in_target") return { ok: true, message: null };
    return {};
  });
  render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, {
        thread: {
          id: "thr_scan",
          displayTitle: "Scan the worktrees",
          status: "idle",
          isUnread: false,
          isPinned: false,
          href: "/projects/bv-brain2/threads/thr_scan",
        },
        isArchived: false,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize: noop,
        onClose: noop,
        escStopsRunningThread: false,
        referenceMentions: undefined,
      }),
    ),
  );
}

describe("pane file anchors", () => {
  it("opens a workspace directory in the preferred editor instead of the preview", async () => {
    renderPane();
    const anchor = screen.getByText("worktrees").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    expect(notPrevented).toBe(false);
    await vi.waitFor(() => {
      expect(rpcCall).toHaveBeenCalledWith("workspace_open_in_target", {
        threadId: "thr_scan",
        targetId: "vscode",
        path: ".worktrees",
      });
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("keeps BB's preview for a workspace file", async () => {
    renderPane();
    const anchor = screen.getByText("ERD").closest("a")!;
    fireEvent.click(anchor);
    await vi.waitFor(() => {
      expect(openFilePreview).toHaveBeenCalledWith({
        target: { kind: "workspace", environmentId: "env_test", path: "docs/erd.md" },
        location: null,
      });
    });
    expect(rpcCall).not.toHaveBeenCalledWith(
      "workspace_open_in_target",
      expect.anything(),
    );
  });

  it("leaves a destination outside the workspace inert", async () => {
    renderPane();
    const anchor = screen.getByText("hosts").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    expect(notPrevented).toBe(false);
    await vi.waitFor(() => {
      expect(rpcCall).toHaveBeenCalledWith("workspace_path_kind", {
        threadId: "thr_scan",
        href: OUTSIDE_HREF,
      });
    });
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(rpcCall).not.toHaveBeenCalledWith(
      "workspace_open_in_target",
      expect.anything(),
    );
  });

  it("does nothing when no open target is available", async () => {
    renderPane();
    rpcCall.mockImplementation(async (method: string) => {
      if (method === "workspace_path_kind") return { kind: "directory", path: ".worktrees" };
      if (method === "workspace_open_targets") {
        return { status: "unavailable", reason: "Local host daemon is unavailable.", root: null, targets: [] };
      }
      return {};
    });
    fireEvent.click(screen.getByText("worktrees").closest("a")!);
    await vi.waitFor(() => {
      expect(rpcCall).toHaveBeenCalledWith("workspace_open_targets", { threadId: "thr_scan" });
    });
    expect(rpcCall).not.toHaveBeenCalledWith(
      "workspace_open_in_target",
      expect.anything(),
    );
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
