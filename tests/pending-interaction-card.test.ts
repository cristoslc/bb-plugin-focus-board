import { describe, expect, it } from "vitest";
import {
  buildAnswerValue,
  buildAnswers,
  choiceForDigitKey,
  initialAnswerState,
  isAnswered,
  knownSelections,
  parseQuestionData,
  tabLabel,
  visibleQuestion,
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

const FREE_ONLY: QuestionSpec = {
  id: "q2",
  prompt: "P",
  multiSelect: false,
  options: [],
  allowFreeText: true,
};

describe("initial answer state", () => {
  it("defaults to picking when options exist, typing when they do not", () => {
    // Host behavior: otherSelected starts as !hasOptions.
    expect(initialAnswerState(SINGLE)).toEqual({
      selected: [],
      otherSelected: false,
      otherText: "",
    });
    expect(initialAnswerState(FREE_ONLY)).toEqual({
      selected: [],
      otherSelected: true,
      otherText: "",
    });
  });
});

describe("answer state", () => {
  it("tracks answered state across options and free text", () => {
    const state = initialAnswerState(SINGLE);
    expect(isAnswered(SINGLE, state)).toBe(false);
    expect(isAnswered(SINGLE, { ...state, selected: ["a"] })).toBe(true);
    expect(isAnswered(SINGLE, { ...state, otherSelected: true, otherText: "  " })).toBe(false);
    expect(isAnswered(SINGLE, { ...state, otherSelected: true, otherText: "custom" })).toBe(true);
    // A free-text-only question is unanswered until text lands, even though
    // it opens with the textarea visible.
    expect(isAnswered(FREE_ONLY, initialAnswerState(FREE_ONLY))).toBe(false);
    expect(
      isAnswered(FREE_ONLY, { selected: [], otherSelected: true, otherText: "words" }),
    ).toBe(true);
  });

  it("single-select Other drops picked options, multi-select keeps them", () => {
    expect(
      buildAnswerValue(SINGLE, { selected: ["a"], otherSelected: true, otherText: "custom" }),
    ).toEqual({ selected: [], freeText: "custom" });
    expect(
      buildAnswerValue(MULTI, { selected: ["x", "y"], otherSelected: true, otherText: "plus this" }),
    ).toEqual({ selected: ["x", "y"], freeText: "plus this" });
    expect(buildAnswerValue(SINGLE, { selected: ["b"], otherSelected: false, otherText: "" })).toEqual({
      selected: ["b"],
    });
  });

  it("omits blank free text from the submitted value", () => {
    expect(
      buildAnswerValue(SINGLE, { selected: [], otherSelected: true, otherText: "   " }),
    ).toEqual({ selected: [] });
  });

  it("filters stale selections to known option values", () => {
    expect(knownSelections(SINGLE, ["a", "zzz"])).toEqual(["a"]);
    expect(
      buildAnswerValue(MULTI, { selected: ["x", "gone"], otherSelected: false, otherText: "" }),
    ).toEqual({ selected: ["x"] });
    // Nothing known and no other text → unanswered, so submit stays gated.
    expect(isAnswered(SINGLE, { selected: ["gone"], otherSelected: false, otherText: "" })).toBe(false);
  });

  it("builds the full answers record for submit", () => {
    const answers = buildAnswers([SINGLE, FREE_ONLY], {
      [SINGLE.id]: { selected: ["a"], otherSelected: false, otherText: "" },
      // FREE_ONLY omitted from the map → falls back to its initial state
      // (otherSelected true, empty text) and submits as unselected.
    });
    expect(answers).toEqual({
      q0: { selected: ["a"] },
      q2: { selected: [] },
    });
  });
});

describe("sequential navigation helpers", () => {
  it("clamps the visible question to range", () => {
    const questions = [SINGLE, MULTI];
    expect(visibleQuestion(questions, 0)).toBe(SINGLE);
    expect(visibleQuestion(questions, 1)).toBe(MULTI);
    expect(visibleQuestion(questions, 5)).toBeNull();
  });

  it("labels tabs from shortLabel with the Question N default", () => {
    expect(tabLabel(SINGLE, 0)).toBe("Question 1");
    const labelled: QuestionSpec = { ...SINGLE, shortLabel: "SSH auth" };
    expect(tabLabel(labelled, 0)).toBe("SSH auth");
    expect(tabLabel(MULTI, 1)).toBe("Question 2");
  });

  it("maps number keys to options in order, then Other when rendered", () => {
    expect(choiceForDigitKey(SINGLE, "1")).toEqual({ kind: "option", value: "a" });
    expect(choiceForDigitKey(SINGLE, "2")).toEqual({ kind: "option", value: "b" });
    // Other renders after both options → digit 3.
    expect(choiceForDigitKey(SINGLE, "3")).toEqual({ kind: "other" });
    expect(choiceForDigitKey(SINGLE, "4")).toBeNull();
    expect(choiceForDigitKey(SINGLE, "x")).toBeNull();
    // A free-text-only question renders no Other row → no shortcuts at all.
    expect(choiceForDigitKey(FREE_ONLY, "1")).toBeNull();
  });
});
