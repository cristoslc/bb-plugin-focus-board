// @vitest-environment jsdom
// Draft persistence for the pane's question form (`components/
// pending-interaction-card.tsx`): answers-so-far survive a reload or thread
// switch. bb persists composer drafts in the host (the new-thread modal's
// "saved as you type" promise) but question interactions have no SDK storage,
// so the card keeps a localStorage mirror keyed by interaction id — a later
// question can never inherit an earlier one's answers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  PendingInteractionCard,
  clearQuestionDraft,
  initialAnswerState,
  questionDraftKey,
  readQuestionDraft,
  writeQuestionDraft,
} from "../components/pending-interaction-card";
import type { QuestionSpec } from "../components/pending-interaction-card";

const THREAD_ID = "thr_1";

// The `ask-user-question` builtin's payload shape, nested under `data` for a
// plugin-origin interaction (cancellable without stopping the turn).
const QUESTIONS_DATA = {
  questions: [
    {
      id: "q0",
      prompt: "Which layout?",
      shortLabel: "Layout",
      multiSelect: false,
      options: [
        { value: "a", label: "Split" },
        { value: "b", label: "Stack" },
      ],
      allowFreeText: true,
    },
    {
      id: "q1",
      prompt: "Any notes?",
      shortLabel: "Notes",
      multiSelect: true,
      options: [{ value: "x", label: "Verbose" }],
      allowFreeText: true,
    },
  ],
};

const INTERACTION_ID = "itx_1";

const PENDING_ROW = {
  id: INTERACTION_ID,
  status: "pending",
  origin: { kind: "plugin" },
  payload: { kind: "plugin", title: "Setup", data: QUESTIONS_DATA },
};

const DRAFT_KEY = questionDraftKey(THREAD_ID, INTERACTION_ID);

// Both questions fully answered so "Submit answer" is enabled without more
// interaction; step 1 = the Notes tab. Multi-select carries the free text
// alongside the picked option.
const FULL_DRAFT = {
  v: 1,
  states: {
    q0: { selected: ["b"], otherSelected: false, otherText: "" },
    q1: { selected: ["x"], otherSelected: true, otherText: "watch the timezone" },
  },
  step: 1,
};

const { sdkRef } = vi.hoisted(() => ({
  sdkRef: { current: null as Record<string, unknown> | null },
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSdk: () => sdkRef.current,
}));

beforeEach(() => {
  const list = vi.fn().mockResolvedValue([PENDING_ROW]);
  const resolve = vi.fn().mockResolvedValue(undefined);
  const respond = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn().mockResolvedValue(undefined);
  const unsubscribe = vi.fn();
  const subscribe = vi.fn().mockReturnValue(unsubscribe);
  sdkRef.current = {
    threads: { interactions: { list, resolve, respond, cancel, stop } },
    subscribe,
  };
  window.localStorage.clear();
});

afterEach(cleanup);

function listMock(): ReturnType<typeof vi.fn> {
  const interactions = (
    sdkRef.current as {
      threads: { interactions: { list: ReturnType<typeof vi.fn>; respond: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } };
    }
  ).threads.interactions;
  return interactions.list;
}

function respondMock(): ReturnType<typeof vi.fn> {
  const interactions = (
    sdkRef.current as {
      threads: { interactions: { respond: ReturnType<typeof vi.fn> } };
    }
  ).threads.interactions;
  return interactions.respond;
}

function cancelMock(): ReturnType<typeof vi.fn> {
  const interactions = (
    sdkRef.current as {
      threads: { interactions: { cancel: ReturnType<typeof vi.fn> } };
    }
  ).threads.interactions;
  return interactions.cancel;
}

function renderCard(): void {
  render(createElement(PendingInteractionCard, { threadId: THREAD_ID, onOpenInMainView: () => {} }));
}

describe("draft storage helpers", () => {
  const KEY = "focus-board:questionDraft:thr_a:itx_b";
  const SPEC: QuestionSpec = {
    id: "q0",
    prompt: "P",
    multiSelect: false,
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    allowFreeText: false,
  };

  it("builds a unique key per thread and interaction", () => {
    expect(KEY).toBe("focus-board:questionDraft:thr_a:itx_b");
    expect(questionDraftKey("thr_a", "itx_c")).not.toBe(KEY);
  });

  it("round-trips written states and a clamped step", () => {
    const states = {
      q0: { selected: ["b"], otherSelected: false, otherText: "custom" },
    };
    writeQuestionDraft(KEY, states, 3);
    const draft = readQuestionDraft(KEY, [SPEC]);
    expect(draft).toEqual({ states, step: 0 });
    expect(readQuestionDraft(KEY, [SPEC])?.step).toBe(0); // clamped to range
  });

  it("drops selections the current option list no longer offers", () => {
    writeQuestionDraft(KEY, { q0: { selected: ["zzz"], otherSelected: false, otherText: "" } }, 0);
    expect(readQuestionDraft(KEY, [SPEC])?.states.q0?.selected).toEqual([]);
  });

  it("rejects malformed or missing drafts outright", () => {
    expect(readQuestionDraft("focus-board:questionDraft:none", [SPEC])).toBeNull();
    window.localStorage.setItem(KEY, "{broken");
    expect(readQuestionDraft(KEY, [SPEC])).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2, states: {}, step: 0 }));
    expect(readQuestionDraft(KEY, [SPEC])).toBeNull();
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, states: { q0: { selected: "b", otherSelected: false, otherText: "" } }, step: 0 }),
    );
    expect(readQuestionDraft(KEY, [SPEC])).toBeNull();
  });

  it("clear removes the key", () => {
    writeQuestionDraft(KEY, {}, 0);
    clearQuestionDraft(KEY);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("draft hydration on mount", () => {
  it("restores selections, free text, and the open tab", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(FULL_DRAFT));
    renderCard();
    // Step 1 restored: the Notes question shows, 2 of 2, textarea kept.
    const textarea = await screen.findByPlaceholderText("Type your own answer…");
    expect((textarea as HTMLTextAreaElement).value).toBe("watch the timezone");
    expect(screen.getByText("2 of 2")).toBeTruthy();
    // Back to question 1: the stored pick is still pressed.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("1 of 2")).toBeTruthy();
    const stack = screen.getByRole("button", { name: /Stack/ });
    expect(stack.getAttribute("aria-pressed")).toBe("true");
  });

  it("restores nothing visible for a malformed draft", async () => {
    window.localStorage.setItem(DRAFT_KEY, "not json");
    renderCard();
    await screen.findByText("1 of 2");
    const split = screen.getByRole("button", { name: /Split/ });
    expect(split.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("draft persistence while answering", () => {
  it("writes the draft when an answer changes", async () => {
    renderCard();
    await screen.findByText("1 of 2");
    fireEvent.click(screen.getByRole("button", { name: /Stack/ }));
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull());
    const saved = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? "{}");
    expect(saved.states.q0).toEqual({ selected: ["b"], otherSelected: false, otherText: "" });
  });

  it("does not write before any interaction", async () => {
    renderCard();
    await screen.findByText("1 of 2");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("draft clearing", () => {
  it("clears after a successful submit", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(FULL_DRAFT));
    renderCard();
    const submit = await screen.findByRole("button", { name: /Submit answer/ });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(respondMock()).toHaveBeenCalledWith({
        threadId: THREAD_ID,
        interactionId: INTERACTION_ID,
        value: {
          answers: {
            q0: { selected: ["b"] },
            q1: { selected: ["x"], freeText: "watch the timezone" },
          },
        },
      }),
    );
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
  });

  it("keeps the draft when the submit fails", async () => {
    respondMock().mockRejectedValueOnce(new Error("offline"));
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(FULL_DRAFT));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: /Submit answer/ }));
    await screen.findByText("offline");
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });

  it("clears after a successful dismiss of a cancellable form", async () => {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(FULL_DRAFT));
    renderCard();
    // The cancel labels itself dismiss: "Dismissing without answering…".
    fireEvent.click(await screen.findByRole("button", { name: /Dismiss without answering/ }));
    await waitFor(() => expect(cancelMock()).toHaveBeenCalled());
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("prunes settled interactions' drafts on refresh", async () => {
    const settledKey = questionDraftKey(THREAD_ID, "itx_settled");
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(FULL_DRAFT));
    window.localStorage.setItem(settledKey, JSON.stringify(FULL_DRAFT));
    listMock().mockResolvedValue([
      PENDING_ROW,
      { id: "itx_settled", status: "resolved", origin: { kind: "plugin" }, payload: { kind: "plugin", data: QUESTIONS_DATA } },
    ]);
    renderCard();
    // The stored draft hydrated (step 1 restored), so this is "2 of 2".
    await screen.findByText("2 of 2");
    expect(window.localStorage.getItem(settledKey)).toBeNull();
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
  });
});