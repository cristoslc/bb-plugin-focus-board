// Fixture for the daemon's detached tool-result delivery event: the raw
// `client/turn/requested` row the host stores when a plugin tool's answer
// lands after its turn has ended. Both the parser and the card tests build
// their inputs through this one builder, so a shape change in the delivery
// format is a one-place edit.
import type { ThreadEventRow } from "../../lib/decisions";

export function deliveredDecisionEvent(overrides: {
  result?: unknown;
  toolName?: string;
  kind?: string;
  systemMessageKind?: string;
  lead?: string;
  seq?: number;
  createdAt?: number;
  inputText?: string;
}): ThreadEventRow {
  const {
    result = {
      questions: [
        {
          question: "Which library should we use?",
          header: "Library",
          options: [
            { label: "date-fns", description: "Functional API" },
            { label: "Temporal" },
          ],
          multiSelect: false,
        },
      ],
      answers: { "Which library should we use?": "date-fns" },
    },
    toolName = "AskUserQuestion",
    kind = "tool-call",
    systemMessageKind = "tool-result-delivered",
    lead = "Your earlier AskUserQuestion tool call has finished. Its result:",
    seq = 100,
    createdAt = 1_790_618_537_120,
    inputText = `${lead}\n\n${JSON.stringify(result)}`,
  } = overrides;
  return {
    id: `evt_${seq}`,
    scope: { kind: "thread" },
    threadId: "thr_x",
    seq,
    createdAt,
    type: "client/turn/requested",
    data: {
      direction: "outbound",
      requestId: `creq_${seq}`,
      source: "tell",
      initiator: "system",
      senderThreadId: null,
      systemMessageKind,
      systemMessageSubject: { kind, toolName, suppress: true },
      input: [{ type: "text", text: inputText, mentions: [] }],
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
    },
  } as unknown as ThreadEventRow;
}