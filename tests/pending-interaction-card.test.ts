import { describe, expect, it } from "vitest";
import {
  buildAnswerValue,
  initialAnswerState,
  isAnswered,
  parseQuestionData,
} from "../components/pending-interaction-card";
import type { QuestionSpec } from "../components/pending-interaction-card";

// The payload shape the `ask-user-question` builtin stores as
// `{ kind: "plugin", data: ... }` via `ui.requestInput` — the interaction the
// host's embedded ThreadChat hides and this card renders instead.
const ASK_USER_QUESTION_DATA = {
  questions: [
    {
      id: "q0",
      prompt: "Which library should we use for date formatting?",
      shortLabel: "Library",
      multiSelect: false,
      options: [
        { value: "q0o0", label: "date-fns", description: "Functional API" },
        { value: "q0o1", label: "Temporal", description: "Built into the platform" },
      ],
      allowFreeText: true,
    },
    {
      id: "q1",
      prompt: "Which extras should be enabled?",
      shortLabel: "Extras",
      multiSelect: true,
      options: [{ value: "q1o0", label: "Timezones" }],
      allowFreeText: true,
    },
  ],
};

describe("parseQuestionData", () => {
  it("parses the ask-user-question payload shape", () => {
    const parsed = parseQuestionData(ASK_USER_QUESTION_DATA);
    expect(parsed).not.toBeNull();
    expect(parsed?.questions.map((question) => question.id)).toEqual(["q0", "q1"]);
    expect(parsed?.questions[0]?.options).toHaveLength(2);
    expect(parsed?.questions[1]?.multiSelect).toBe(true);
  });

  it("keeps option descriptions and previews", () => {
    const parsed = parseQuestionData({
      questions: [
        {
          id: "q0",
          prompt: "Layout?",
          multiSelect: false,
          options: [
            {
              value: "a",
              label: "Split",
              description: "Two panes",
              preview: "┌─┬─┐\n├─┼─┤",
            },
          ],
          allowFreeText: false,
        },
      ],
    });
    expect(parsed?.questions[0]?.options[0]?.preview).toBe("┌─┬─┐\n├─┼─┤");
    expect(parsed?.questions[0]?.options[0]?.description).toBe("Two panes");
    expect(parsed?.questions[0]?.shortLabel).toBeUndefined();
  });

  it("rejects shapes the pane cannot render", () => {
    expect(parseQuestionData(undefined)).toBeNull();
    expect(parseQuestionData({})).toBeNull();
    expect(parseQuestionData({ questions: [] })).toBeNull();
    expect(parseQuestionData({ questions: ["nope"] })).toBeNull();
    expect(parseQuestionData({ questions: [{ id: "q0" }] })).toBeNull();
    expect(
      parseQuestionData({
        questions: [
          {
            id: "q0",
            prompt: "P",
            multiSelect: false,
            options: [{ value: "a" }], // missing label
            allowFreeText: false,
          },
        ],
      }),
    ).toBeNull();
    // A question with no options must allow free text (server invariant).
    expect(
      parseQuestionData({
        questions: [{ id: "q0", prompt: "P", multiSelect: false, options: [], allowFreeText: false }],
      }),
    ).toBeNull();
  });

  it("caps options per question like the builtin tool", () => {
    const five = [1, 2, 3, 4, 5].map((index) => ({ value: `v${index}`, label: `V${index}` }));
    expect(
      parseQuestionData({
        questions: [{ id: "q0", prompt: "P", multiSelect: false, options: five, allowFreeText: false }],
      }),
    ).toBeNull();
  });

  it("accepts the provider `user_question` payload shape", () => {
    // The provider's native ask-user-question tool stores the question shape
    // at `payload.questions` directly (no `data` wrapper), with `options`
    // optional per the provider schema.
    const parsed = parseQuestionData({
      questions: [
        {
          id: "toolu_01:question-1",
          prompt: "SSH was blocked. How do you want to proceed?",
          shortLabel: "SSH auth",
          multiSelect: false,
          options: [
            { value: "toolu_01:question-1:option-1", label: "Authorize", description: "Run the fix" },
            { value: "toolu_01:question-1:option-2", label: "I'll run it myself" },
          ],
          allowFreeText: true,
        },
        {
          id: "toolu_01:question-2",
          prompt: "Anything to add?",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.questions.map((question) => question.id)).toEqual([
      "toolu_01:question-1",
      "toolu_01:question-2",
    ]);
    expect(parsed?.questions[0]?.options).toHaveLength(2);
    // Missing options with free text allowed parse to an empty list.
    expect(parsed?.questions[1]?.options).toEqual([]);
    expect(parsed?.questions[1]?.allowFreeText).toBe(true);
  });
});

const SINGLE: QuestionSpec = {
  id: "q0",
  prompt: "P",
  multiSelect: false,
  options: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
  allowFreeText: true,
};

const MULTI: QuestionSpec = {
  id: "q1",
  prompt: "P",
  multiSelect: true,
  options: [
    { value: "x", label: "X" },
    { value: "y", label: "Y" },
  ],
  allowFreeText: true,
};

describe("answer state", () => {
  it("tracks answered state across options and free text", () => {
    const state = initialAnswerState();
    expect(isAnswered(SINGLE, state)).toBe(false);
    expect(isAnswered(SINGLE, { ...state, selected: ["a"] })).toBe(true);
    expect(isAnswered(SINGLE, { ...state, other: true, otherText: "  " })).toBe(false);
    expect(isAnswered(SINGLE, { ...state, other: true, otherText: "custom" })).toBe(true);
  });

  it("single-select Other drops picked options, multi-select keeps them", () => {
    expect(
      buildAnswerValue(SINGLE, { selected: ["a"], other: true, otherText: "custom" }),
    ).toEqual({ selected: [], freeText: "custom" });
    expect(
      buildAnswerValue(MULTI, { selected: ["x", "y"], other: true, otherText: "plus this" }),
    ).toEqual({ selected: ["x", "y"], freeText: "plus this" });
    expect(buildAnswerValue(SINGLE, { selected: ["b"], other: false, otherText: "" })).toEqual({
      selected: ["b"],
    });
  });

  it("omits blank free text from the submitted value", () => {
    expect(
      buildAnswerValue(SINGLE, { selected: [], other: true, otherText: "   " }),
    ).toEqual({ selected: [] });
  });
});
