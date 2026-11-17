// @vitest-environment jsdom
// The host-surface gate (bb 0.49.0 routes local file links itself) must not
// swallow the mention claim. The two arrived in separate changes: PR #455
// taught the pane's click capture to claim bb's `@thread:`/`@project:`
// anchors, and PR #456 gated the 0.44-era file-link rescue behind a host
// capability. With the gate first, a 0.49.0 host returns from the handler
// before the mention claim runs, and the operator's "File not found." pane
// comes back on exactly the host they run. This file pins the order.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import {
  resetHostCapabilitiesForTests,
  waitForHostCapabilities,
} from "../lib/host-capabilities";
import type { ReferenceMentions } from "../components/decorate-reference-mentions";

const onOpen = vi.fn();
const openFilePreview = vi.fn();

function hostMention(href: string, label: string) {
  return createElement("a", { href, rel: "noopener noreferrer", target: "_blank" }, label);
}

function transcript() {
  return createElement(
    "div",
    null,
    createElement(
      "p",
      null,
      hostMention("file:///w/%40thread%3Athr_cvvvkw6rjz", "Refine strategic engineering goals"),
    ),
    createElement("p", null, hostMention("file:///w/%40project%3Aproj_api", "API Gateway")),
    createElement("a", { href: "docs/erd.md" }, "ERD"),
  );
}

// A 0.49.0 host: it routes local file links itself, which is the state that
// makes the pane stand down its rescue.
vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: () => transcript(),
  useSdk: () => ({ threads: { get: async () => ({ environmentId: "env_test" }) } }),
  useRpc: () => ({
    call: async (method: string) =>
      method === "host_version" ? { version: "0.49.0" } : { existence: {} },
  }),
  useBbNavigate: () => ({
    toThread: () => {},
    toProject: () => {},
    experimental_openFilePreview: openFilePreview,
  }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};

const mentions: ReferenceMentions = {
  labels: { threadLabel: () => null, projectLabel: () => null },
  onOpen,
};

beforeEach(() => {
  resetHostCapabilitiesForTests();
});

afterEach(() => {
  cleanup();
  onOpen.mockReset();
  openFilePreview.mockReset();
  resetHostCapabilitiesForTests();
});

function renderPane() {
  render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, {
        thread: {
          id: "thr_msyjn52jwr",
          displayTitle: "Find the strategy statements thread",
          status: "idle",
          isUnread: false,
          isPinned: false,
          href: "/projects/bv-brain2/threads/thr_msyjn52jwr",
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
        referenceMentions: mentions,
      }),
    ),
  );
}

describe("mention claim on a host that routes local file links itself", () => {
  it("still opens a thread mention instead of handing it to the host's preview", async () => {
    renderPane();
    const capabilities = await waitForHostCapabilities();
    // The premise of this file: the gate really is open on this host.
    expect(capabilities.routesLocalFileLinks).toBe(true);

    const anchor = screen.getByText("Refine strategic engineering goals").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    expect(notPrevented).toBe(false);
    expect(onOpen).toHaveBeenCalledWith({
      kind: "thread",
      id: "thr_cvvvkw6rjz",
      messageSeq: null,
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("still opens a project mention instead of handing it to the host's preview", async () => {
    renderPane();
    await waitForHostCapabilities();
    const anchor = screen.getByText("API Gateway").closest("a")!;
    fireEvent.click(anchor);
    expect(onOpen).toHaveBeenCalledWith({
      kind: "project",
      id: "proj_api",
      messageSeq: null,
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("leaves an ordinary relative link to the host once the gate is open", async () => {
    renderPane();
    const capabilities = await waitForHostCapabilities();
    expect(capabilities.routesLocalFileLinks).toBe(true);
    const anchor = screen.getByText("ERD").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    // Not claimed by the pane: the host routes its own file links on 0.49.0.
    expect(notPrevented).toBe(true);
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
