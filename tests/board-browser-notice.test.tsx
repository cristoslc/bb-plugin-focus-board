// @vitest-environment jsdom
// The reveal notice banner. The "Reveal browser tab" card action can
// only be honest about its outcome on the board surface itself — bb's
// reveal answers {ok:true} even when the tab stays hidden, and the
// plugin has no toast API to lean on. Board renders a dismissible,
// self-expiring status banner (same visual language as the sweep
// notice) with the report; a board without the prop renders nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  browserNotice: { message: string } | null,
  onDismissBrowserNotice?: () => void,
) {
  const threads: PluginSidebarThread[] = [thread({ id: "thr_a", updatedAt: NOW - 5000 })];
  const props = {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    browserNotice,
    onDismissBrowserNotice,
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

function notice(): HTMLElement {
  const root = document.querySelector('[data-testid="browser-reveal-notice"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing browser reveal notice");
  return root;
}

describe("Board renders the browser reveal notice", () => {
  it("a carried report shows as a status banner with its message and a dismiss control", () => {
    renderBoard({ message: 'No controlled browser tab belongs to the thread "Test thread".' });
    const root = notice();
    expect(root.getAttribute("role")).toBe("status");
    expect(root.textContent).toContain("No controlled browser tab");
    const dismiss = root.querySelector('button[aria-label="Dismiss browser notice"]');
    expect(dismiss).not.toBeNull();
  });

  it("dismissing reports to the caller", () => {
    const onDismissBrowserNotice = vi.fn();
    renderBoard({ message: "No controlled browser tab belongs to this thread yet." }, onDismissBrowserNotice);
    const dismiss = notice().querySelector('button[aria-label="Dismiss browser notice"]');
    if (!(dismiss instanceof HTMLButtonElement)) throw new Error("missing dismiss button");
    dismiss.click();
    expect(onDismissBrowserNotice).toHaveBeenCalledTimes(1);
  });

  it("no notice prop leaves the banner out entirely", () => {
    renderBoard(null, () => {});
    expect(document.querySelector('[data-testid="browser-reveal-notice"]')).toBeNull();
  });

  it("the notice expires on its own — a dead message must not squat on the board", () => {
    vi.useFakeTimers();
    try {
      const onDismissBrowserNotice = vi.fn();
      renderBoard({ message: "The browser tab stayed hidden." }, onDismissBrowserNotice);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(onDismissBrowserNotice).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});