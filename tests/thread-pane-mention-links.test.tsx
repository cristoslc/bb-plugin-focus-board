// @vitest-environment jsdom
// The pane claims host-rendered mention anchors (the operator's "File not
// found." regression, 2026-11-17): bb 0.49.0 renders an agent-written
// `@thread:…` token as an anchor whose href is a percent-encoded token
// resolved into a `file://` URL under the thread's workspace root —
// `file:///…/%40thread%3Athr_cvvvkw6rjz` — and its own click routing then
// opens that "path" in the file preview, which reads "File not found."
// The pane's transcript owns mention clicks: a mention-shaped anchor opens
// through the pane's reference opener, and an unresolvable one stays inert.
// A plain relative markdown link keeps the workspace-preview routing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import type { ReferenceMentions } from "../components/decorate-reference-mentions";

const onOpen = vi.fn();
const openFilePreview = vi.fn();

function hostMention(href: string, label: string, extra?: ReactNode) {
  return createElement(
    "a",
    { href, rel: "noopener noreferrer", target: "_blank" },
    label,
    extra,
  );
}

// Host shapes captured live on bb 0.49.0 (thr_msyjn52wjr pane): a thread
// mention resolved to its title, an href carrying the encoded token, and the
// host's own ExternalLink icon inside a glue unit. The project mention and a
// mention whose id fails to parse cover the sibling shapes; the last anchor
// is the plain relative markdown link that keeps its preview routing.
function transcript() {
  return createElement(
    "div",
    null,
    createElement(
      "p",
      null,
      hostMention(
        "file:///Users/cristos/Documents/projects/bv-brain2/%40thread%3Athr_cvvvkw6rjz",
        "Refine strategic engineering goals",
        createElement(
          "span",
          { className: "whitespace-nowrap" },
          createElement("span", { "data-focus-board-host-glue": "" }, "s", createElement("svg")),
        ),
      ),
    ),
    createElement(
      "p",
      null,
      hostMention("file:///r/%40project%3Aproj_api", "API Gateway"),
    ),
    createElement("p", null, hostMention("file:///r/%40thread%3Aproj_nope", "broken mention")),
    createElement("a", { href: "docs/erd.md" }, "ERD"),
  );
}

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (): ReactNode => transcript(),
  useSdk: () => ({ threads: { get: async () => ({ environmentId: "env_test" }) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({
    toThread: () => {},
    toProject: () => {},
    experimental_openFilePreview: openFilePreview,
  }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};

afterEach(() => {
  cleanup();
  onOpen.mockReset();
  openFilePreview.mockReset();
});

function renderPane(referenceMentions: ReferenceMentions | undefined) {
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
        referenceMentions,
      }),
    ),
  );
}

const mentions: ReferenceMentions = {
  labels: { threadLabel: () => null, projectLabel: () => null },
  onOpen,
};

describe("pane mention anchors (File not found regression)", () => {
  it("claims a host thread mention, opens the thread, and never the file preview", () => {
    renderPane(mentions);
    const anchor = screen.getByText("Refine strategic engineering goals").closest("a")!;
    // A real click lands on the glued icon or the label; both must claim.
    const notPrevented = fireEvent.click(anchor.querySelector("span") ?? anchor);
    expect(notPrevented).toBe(false);
    expect(onOpen).toHaveBeenCalledWith({
      kind: "thread",
      id: "thr_cvvvkw6rjz",
      messageSeq: null,
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("claims a host project mention and opens the project", () => {
    renderPane(mentions);
    const anchor = screen.getByText("API Gateway").closest("a")!;
    fireEvent.click(anchor);
    expect(onOpen).toHaveBeenCalledWith({
      kind: "project",
      id: "proj_api",
      messageSeq: null,
    });
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("leaves an unresolvable mention inert instead of opening the preview", () => {
    renderPane(mentions);
    const anchor = screen.getByText("broken mention").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    expect(notPrevented).toBe(false);
    expect(onOpen).not.toHaveBeenCalled();
    expect(openFilePreview).not.toHaveBeenCalled();
  });

  it("still routes a relative markdown link into the workspace preview", async () => {
    renderPane(mentions);
    const anchor = screen.getByText("ERD").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    expect(notPrevented).toBe(false);
    await vi.waitFor(() => {
      expect(openFilePreview).toHaveBeenCalledWith({
        target: { kind: "workspace", environmentId: "env_test", path: "docs/erd.md" },
        location: null,
      });
    });
  });

  it("without the reference wiring a mention anchor is inert, never a preview", () => {
    renderPane(undefined);
    const anchor = screen.getByText("Refine strategic engineering goals").closest("a")!;
    const notPrevented = fireEvent.click(anchor);
    expect(notPrevented).toBe(false);
    expect(openFilePreview).not.toHaveBeenCalled();
  });
});
