// Decision-record parsing: answers the user submits through the pane's
// question card are invisible in the host transcript (the AskUserQuestion
// tool call and the system message carrying the answer are both marked
// `suppress: true`, and bb's timeline drops both). The only durable trace is
// the raw event log: the detached tool-result delivery stores the answers as
// a `client/turn/requested` event whose text ends with the result JSON.
//
// The JSON shape is the builtin plugin's `buildToolResult` output:
// { questions: [{ question, header, options, multiSelect }],
//   answers: { [question]: "<labels>, …; <free text>" },
//   response?,  // free-text-only answer to a single-question call
//   annotations? }
import { describe, expect, it } from "vitest";
import { decisionsFromEvents, parseDecisionEvent } from "../lib/decisions";
import { deliveredDecisionEvent } from "./helpers/decision-fixture";

describe("parseDecisionEvent", () => {
  it("parses the delivered answer record: header chip, prompt, chosen label", () => {
    const decision = parseDecisionEvent(deliveredDecisionEvent({}));
    expect(decision).not.toBeNull();
    expect(decision?.seq).toBe(100);
    expect(decision?.createdAt).toBe(1_790_618_537_120);
    expect(decision?.questions).toEqual([
      {
        header: "Library",
        prompt: "Which library should we use?",
        answer: "date-fns",
      },
    ]);
  });

  it("pairs multiple questions with their own answers", () => {
    const decision = parseDecisionEvent(
      deliveredDecisionEvent({
        result: {
          questions: [
            { question: "Deploy where?", header: "Region", multiSelect: false, options: [] },
            { question: "Which extras?", header: "Extras", multiSelect: true, options: [] },
          ],
          answers: {
            "Deploy where?": "nbg1",
            "Which extras?": "Timezones, Metrics; plus logging",
          },
        },
      }),
    );
    expect(decision?.questions).toEqual([
      { header: "Region", prompt: "Deploy where?", answer: "nbg1" },
      { header: "Extras", prompt: "Which extras?", answer: "Timezones, Metrics; plus logging" },
    ]);
  });

  it("falls back to `response` for a free-text-only single question", () => {
    // The builtin puts a free-text-only single answer in `response`, not in
    // the answers map.
    const decision = parseDecisionEvent(
      deliveredDecisionEvent({
        result: {
          questions: [{ question: "Anything to add?", header: "Notes", multiSelect: false, options: [] }],
          answers: {},
          response: "Ship it Friday",
        },
      }),
    );
    expect(decision?.questions[0]?.answer).toBe("Ship it Friday");
  });

  it("marks a question left unanswered as no answer", () => {
    // The builtin drops empty answers from the map entirely; its own detail
    // lines render those as "no answer".
    const decision = parseDecisionEvent(
      deliveredDecisionEvent({
        result: {
          questions: [
            { question: "A?", header: "A", multiSelect: false, options: [] },
            { question: "B?", header: "B", multiSelect: false, options: [] },
          ],
          answers: { "A?": "yes" },
        },
      }),
    );
    expect(decision?.questions[0]?.answer).toBe("yes");
    expect(decision?.questions[1]?.answer).toBeNull();
  });

  it("tolerates a missing header (provider questions have none)", () => {
    const decision = parseDecisionEvent(
      deliveredDecisionEvent({
        result: {
          questions: [{ question: "Proceed?", multiSelect: false, options: [] }],
          answers: { "Proceed?": "yes" },
        },
      }),
    );
    expect(decision?.questions[0]?.header).toBeNull();
  });

  it("rejects every non-decision event", () => {
    // Not the delivery system message.
    expect(
      parseDecisionEvent(deliveredDecisionEvent({ systemMessageKind: "unlabeled" })),
    ).toBeNull();
    // Not a tool-call subject.
    expect(parseDecisionEvent(deliveredDecisionEvent({ kind: "thread" }))).toBeNull();
    // A different tool's detached result.
    expect(
      parseDecisionEvent(deliveredDecisionEvent({ toolName: "AskUserQuestionOther" })),
    ).toBeNull();
    expect(parseDecisionEvent(deliveredDecisionEvent({ toolName: "webfetch" }))).toBeNull();
    // Not a client/turn/requested row at all.
    const wrongType = deliveredDecisionEvent({}) as unknown as Record<string, unknown>;
    wrongType["type"] = "turn/completed";
    expect(parseDecisionEvent(wrongType)).toBeNull();
    expect(parseDecisionEvent(null)).toBeNull();
    expect(parseDecisionEvent(undefined)).toBeNull();
    expect(parseDecisionEvent("nope")).toBeNull();
  });

  it("rejects malformed delivered payloads instead of guessing", () => {
    // Unparseable JSON body.
    expect(
      parseDecisionEvent(
        deliveredDecisionEvent({
          inputText: "Your earlier AskUserQuestion tool call has finished. Its result:\n\n{oops",
        }),
      ),
    ).toBeNull();
    // JSON that is not the question/answers shape.
    expect(parseDecisionEvent(deliveredDecisionEvent({ result: { hello: 1 } }))).toBeNull();
    expect(parseDecisionEvent(deliveredDecisionEvent({ result: { questions: [] } }))).toBeNull();
    expect(
      parseDecisionEvent(deliveredDecisionEvent({ result: { questions: "nope", answers: {} } })),
    ).toBeNull();
    // Missing numbers.
    const noSeq = deliveredDecisionEvent({}) as unknown as Record<string, unknown>;
    delete noSeq["seq"];
    expect(parseDecisionEvent(noSeq)).toBeNull();
    // The failure lead (no result) is not a decision record.
    expect(
      parseDecisionEvent(
        deliveredDecisionEvent({ lead: "Your earlier AskUserQuestion tool call failed:" }),
      ),
    ).toBeNull();
  });

  it("reads the JSON after the lead even when free text echoes the lead", () => {
    // The user's free-text answer contains the lead phrase itself; the
    // parser splits on the FIRST occurrence, so the remainder still starts
    // with the JSON object.
    const result = {
      questions: [{ question: "Notes?", header: "Notes", multiSelect: false, options: [] }],
      answers: {},
      response: "Its result:\n\n was good",
    };
    const decision = parseDecisionEvent(
      deliveredDecisionEvent({
        inputText: `Your earlier AskUserQuestion tool call has finished. Its result:\n\n${JSON.stringify(result)}`,
      }),
    );
    expect(decision?.questions[0]?.answer).toBe("Its result:\n\n was good");
  });
});

describe("decisionsFromEvents", () => {
  it("returns parsed decisions, newest first", () => {
    const rows = [
      deliveredDecisionEvent({ seq: 300, createdAt: 3000 }),
      deliveredDecisionEvent({ seq: 100, createdAt: 1000 }),
      deliveredDecisionEvent({ seq: 200, createdAt: 2000 }),
    ];
    const decisions = decisionsFromEvents(rows);
    expect(decisions.map((decision) => decision.seq)).toEqual([300, 200, 100]);
  });

  it("keeps only the newest `limit` decisions", () => {
    const rows = [100, 200, 300, 400].map((seq) =>
      deliveredDecisionEvent({ seq, createdAt: seq }),
    );
    const decisions = decisionsFromEvents(rows, 2);
    expect(decisions.map((decision) => decision.seq)).toEqual([400, 300]);
  });

  it("skips non-decision rows without failing", () => {
    const rows = [
      { type: "turn/completed" },
      deliveredDecisionEvent({ seq: 42, createdAt: 4200 }),
      null,
    ];
    const decisions = decisionsFromEvents(rows, 5);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.seq).toBe(42);
  });

  it("returns an empty list for garbage input", () => {
    expect(decisionsFromEvents([])).toEqual([]);
    expect(decisionsFromEvents(["bad", 7, undefined])).toEqual([]);
  });
});