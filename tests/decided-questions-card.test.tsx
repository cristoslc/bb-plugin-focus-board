// @vitest-environment jsdom
// The decided-questions card: after a question card is submitted, the host
// transcript drops every trace of the answer, so the pane shows a record of
// recent decisions parsed from the event log. This file pins the DOM
// behavior: hidden when there is nothing to show, collapsed by default,
// auto-expanding when a fresh decision lands (the just-answered moment).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { DecidedQuestionsCard } from "../components/decided-questions-card";
import { deliveredDecisionEvent } from "./helpers/decision-fixture";

type ChangeHandler = (event: {
  entity: string;
  id?: string;
  changes: readonly string[];
  metadata?: { eventTypes?: readonly string[] };
}) => void;

let handlers: ChangeHandler[];
let decisionEvents: unknown[];
let listCalls: { args: unknown }[];

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSdk: () => mockSdk,
  // Imported for types only by the component; the mock needs no more.
  ThreadChat: (): ReactNode => null,
}));

const mockSdk = {
  subscribe: (options: { callback: ChangeHandler }) => {
    handlers.push(options.callback);
    return () => {};
  },
  threads: {
    events: {
      list: async (args: unknown) => {
        listCalls.push({ args });
        return decisionEvents;
      },
    },
  },
};

function decision(
  seq: number,
  prompt = "Which library should we use?",
  answer = "date-fns",
): unknown {
  return deliveredDecisionEvent({
    seq,
    createdAt: 1_700_000_000_000 + seq,
    result: {
      questions: [
        {
          question: prompt,
          header: "Library",
          options: [{ label: "date-fns" }, { label: "Temporal" }],
          multiSelect: false,
        },
      ],
      answers: { [prompt]: answer },
    },
  });
}

beforeEach(() => {
  handlers = [];
  listCalls = [];
  decisionEvents = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The card's fetch state lands a microtask (and a scheduler tick) after the
 * list call registers; flush it so queries see the rendered result. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderCard(props: { threadId?: string } = {}) {
  const view = render(<DecidedQuestionsCard threadId={props.threadId ?? "thr_x"} />);
  await vi.waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
  await flush();
  return view;
}

describe("visibility", () => {
  it("renders nothing when the thread has no delivered answers", async () => {
    await renderCard();
    expect(screen.queryByTestId("thread-board-decisions")).toBeNull();
  });

  it("renders nothing when the host has no events surface at all", async () => {
    const bare = { ...mockSdk, threads: {} } as typeof mockSdk;
    const original = mockSdk.threads;
    // The component must guard against hosts/harnesses without the area.
    Object.assign(mockSdk, { threads: {} });
    try {
      const view = render(<DecidedQuestionsCard threadId="thr_x" />);
      expect(view.container.querySelector('[data-testid="thread-board-decisions"]')).toBeNull();
    } finally {
      Object.assign(mockSdk, { threads: original });
    }
  });
});

describe("collapsed by default", () => {
  it("hides the decisions behind an expandable header until opened", async () => {
    decisionEvents = [decision(100)];
    await renderCard();
    const card = screen.getByTestId("thread-board-decisions");
    expect(card.getAttribute("aria-expanded")).toBe("false");
    expect(card.textContent).toContain("Recent decisions");
    // Closed: the answer is not on the page yet.
    expect(screen.queryByText("date-fns")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Recent decisions/i }));
    expect(screen.getByText("date-fns")).not.toBeNull();
    expect(screen.getByText("Which library should we use?")).not.toBeNull();
    expect(screen.getByText("Library")).not.toBeNull();
  });

  it("shows the newest decisions first, capped", async () => {
    decisionEvents = [decision(100), decision(200, "Second question?"), decision(300, "Third?")];
    await renderCard();
    fireEvent.click(screen.getByRole("button", { name: /Recent decisions/i }));
    const rows = screen.getAllByTestId("thread-board-decision");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Third?");
    expect(rows[2]?.textContent).toContain("Which library should we use?");
  });
});

describe("auto-expand on a fresh decision", () => {
  it("expands itself when a refetch reveals a newer decision than last seen", async () => {
    vi.useFakeTimers();
    decisionEvents = [decision(100)];
    render(<DecidedQuestionsCard threadId="thr_x" />);
    await vi.waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
    await flush();
    expect(screen.queryByTestId("thread-board-decisions")).not.toBeNull();
    expect(screen.queryByText("date-fns")).toBeNull();

    // The user just answered: the pending card resolved, the delivered
    // result event lands, and the thread:changed signal fires.
    decisionEvents = [decision(200, "Second question?", "Temporal"), decision(100)];
    for (const handler of handlers) {
      handler({ entity: "thread", id: "thr_x", changes: ["interactions-changed"] });
    }
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(listCalls.length).toBeGreaterThan(1));
    await flush();

    const card = screen.getByTestId("thread-board-decisions");
    expect(card.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("date-fns")).not.toBeNull();
  });

  it("ignores thread:changed signals for other threads", async () => {
    vi.useFakeTimers();
    decisionEvents = [decision(100)];
    render(<DecidedQuestionsCard threadId="thr_x" />);
    await vi.waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
    await flush();
    const calls = listCalls.length;
    for (const handler of handlers) {
      handler({ entity: "thread", id: "thr_other", changes: ["interactions-changed"] });
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(listCalls.length).toBe(calls);
  });

  it("coalesces bursts into one refetch", async () => {
    vi.useFakeTimers();
    decisionEvents = [decision(100)];
    render(<DecidedQuestionsCard threadId="thr_x" />);
    await vi.waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
    await flush();
    const calls = listCalls.length;
    for (const handler of handlers) {
      handler({ entity: "thread", id: "thr_x", changes: ["interactions-changed"] });
      handler({ entity: "thread", id: "thr_x", changes: ["status-changed"] });
      handler({ entity: "thread", id: "thr_x", changes: ["events-appended"] });
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(listCalls.length).toBe(calls + 1);
  });

  it("skips events-appended bursts that carry no prompt deliveries", async () => {
    vi.useFakeTimers();
    decisionEvents = [decision(100)];
    render(<DecidedQuestionsCard threadId="thr_x" />);
    await vi.waitFor(() => expect(listCalls.length).toBeGreaterThan(0));
    await flush();
    const calls = listCalls.length;
    for (const handler of handlers) {
      handler({
        entity: "thread",
        id: "thr_x",
        changes: ["events-appended"],
        metadata: { eventTypes: ["item/agentMessage/delta"] },
      });
    }
    await vi.advanceTimersByTimeAsync(400);
    expect(listCalls.length).toBe(calls);
  });
});