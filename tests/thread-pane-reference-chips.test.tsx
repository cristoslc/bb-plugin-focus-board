// @vitest-environment jsdom
// The pane claims clicks on the reference chips the decorator painted
// (components/decorate-reference-mentions.ts) — issue #161. ThreadChat is
// mocked to render the exact host shapes seen in live bb 0.46.0: raw
// `@project:proj_…` text in an agent message, an empty `bb-thread-mention`
// element (the renderer-less autolink), and untouched prose between them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import type { ReferenceMentions } from "../components/decorate-reference-mentions";

const onOpen = vi.fn();

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (): ReactNode =>
    createElement(
      "div",
      null,
      createElement(
        "p",
        null,
        "Remote: registered as @project:proj_api; packaging thread: @thread:thr_glyph_glue#msg=12 is now active",
      ),
      createElement(
        "p",
        null,
        "Homelab thread ",
        createElement("bb-thread-mention", { "data-thread-id": "thr_glyph_glue" }),
        " done.",
      ),
    ),
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {}, toProject: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};

afterEach(() => {
  cleanup();
  onOpen.mockReset();
});

function renderPane(referenceMentions: ReferenceMentions | undefined) {
  render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, {
        thread: {
          id: "thr_review_pr",
          displayTitle: "Review PR #14 — extract thread-pane subcomponents",
          status: "idle",
          isUnread: false,
          isPinned: false,
          href: "/projects/web/threads/thr_review_pr",
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
  return referenceMentions === undefined;
}

describe("pane reference chips (issue #161)", () => {
  it("paints chips for agent-written tokens and the empty host mention", () => {
    renderPane({
      labels: {
        threadLabel: (id) => (id === "thr_glyph_glue" ? "Wrap check with the open glyph" : null),
        projectLabel: (id) => (id === "proj_api" ? "API Gateway" : null),
      },
      onOpen,
    });
    const chips = document.querySelectorAll("[data-focus-board-ref-kind]");
    expect(chips).toHaveLength(3);
    expect(screen.getByText("API Gateway").textContent).toBe("API Gateway");
    // The token chip and the repainted host mention element both resolve
    // the same thread, so the label paints twice.
    expect(screen.getAllByText("Wrap check with the open glyph")).toHaveLength(2);
    // The raw serialized forms no longer appear anywhere in the transcript.
    expect(document.body.textContent).not.toContain("@project:proj_api");
    expect(document.body.textContent).not.toContain("@thread:thr_glyph_glue");
  });

  it("clicking a chip claims the click and hands the parsed target to onOpen", () => {
    renderPane({
      labels: {
        threadLabel: () => null,
        projectLabel: () => "API Gateway",
      },
      onOpen,
    });
    const chip = screen.getByText("API Gateway").closest(
      "[data-focus-board-ref-kind]",
    );
    fireEvent.click(chip!);
    expect(onOpen).toHaveBeenCalledWith({
      kind: "project",
      id: "proj_api",
      messageSeq: null,
    });
  });

  it("without the wiring the pane stays exactly as before: no chips, dead onOpen", () => {
    renderPane(undefined);
    expect(
      document.querySelectorAll("[data-focus-board-ref-kind]"),
    ).toHaveLength(0);
  });
});