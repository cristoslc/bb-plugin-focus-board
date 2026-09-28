// Decision records: what the user answered when a question card was
// submitted. The host transcript hides every trace of the answer — the
// `AskUserQuestion` tool call is marked `presentation.suppress`, the system
// message that carries the answer is marked `suppress` on its subject, and
// bb's timeline projection drops both (`isSuppressedSystemMessage` /
// `shouldSuppressLowValueToolCall`). Plugin-form lifecycle rows survive but
// record only "Submitted <title>", never the chosen options. The one durable
// trace is the raw event log: when the builtin's tool completes after its
// turn has ended, the daemon stores a `client/turn/requested` event with
// `systemMessageKind: "tool-result-delivered"` whose text carries the result
// JSON (`buildToolResult` in the builtin's server: questions plus a
// prompt → answer-text map).
//
// This module turns those events back into the decisions the user made. It
// is deliberately strict: anything that is not exactly a delivered
// AskUserQuestion result parses to null rather than to a guessed record.

/** The agent-facing tool name whose detached results carry answers. */
export const DECISION_TOOL_NAME = "AskUserQuestion";

/** The success lead the daemon prepends to the delivered result text. */
const RESULT_LEAD = `Your earlier ${DECISION_TOOL_NAME} tool call has finished. Its result:`;

export interface DecisionQuestion {
  /** The short label chip ("Library"), or null when the call had none. */
  header: string | null;
  /** The full question text; also the key the answer is recorded under. */
  prompt: string;
  /** The chosen answer text, or null when the question got no answer. */
  answer: string | null;
}

export interface DecisionRecord {
  seq: number;
  createdAt: number;
  questions: DecisionQuestion[];
}

/**
 * The event row shape the card reads — structurally the subset of the SDK's
 * `ThreadEventRow` this module touches, kept local so tests can feed plain
 * fixtures without the SDK's branded tuples.
 */
export interface ThreadEventRow {
  type: string;
  seq: number;
  createdAt: number;
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseQuestions(value: unknown): DecisionQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4) return null;
  const questions: DecisionQuestion[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const prompt = asNonEmptyString(entry["question"]);
    if (prompt === null) return null;
    const header = asNonEmptyString(entry["header"]);
    questions.push({ header, prompt, answer: null });
  }
  return questions;
}

/**
 * Parses one stored `client/turn/requested` event row into a decision
 * record. Returns null for anything else — ordinary prompts, other tools'
 * detached results, the failure lead, malformed bodies — rather than
 * guessing at a partial record.
 */
export function parseDecisionEvent(row: unknown): DecisionRecord | null {
  if (!isRecord(row)) return null;
  if (row["type"] !== "client/turn/requested") return null;
  const seq = typeof row["seq"] === "number" && Number.isFinite(row["seq"]) ? row["seq"] : null;
  const createdAt =
    typeof row["createdAt"] === "number" && Number.isFinite(row["createdAt"]) ? row["createdAt"] : null;
  const data = row["data"];
  if (seq === null || createdAt === null || !isRecord(data)) return null;
  if (data["systemMessageKind"] !== "tool-result-delivered") return null;
  const subject = data["systemMessageSubject"];
  if (!isRecord(subject)) return null;
  if (subject["kind"] !== "tool-call") return null;
  if (subject["toolName"] !== DECISION_TOOL_NAME) return null;
  const input = data["input"];
  if (!Array.isArray(input) || input.length === 0) return null;
  const first = input[0];
  if (!isRecord(first)) return null;
  const text = first["text"];
  if (typeof text !== "string" || !text.startsWith(RESULT_LEAD)) return null;
  // Split on the first occurrence so free-text answers that echo the lead
  // cannot push the split past the JSON.
  const json = text.slice(RESULT_LEAD.length).trim();
  if (!json.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const questions = parseQuestions(parsed["questions"]);
  if (questions === null) return null;
  const answers = parsed["answers"];
  if (answers !== undefined && !isRecord(answers)) return null;
  const answerMap = (answers ?? {}) as Record<string, unknown>;
  const response = asNonEmptyString(parsed["response"]);
  for (const question of questions) {
    const answer = asNonEmptyString(answerMap[question.prompt]);
    if (answer !== null) {
      question.answer = answer;
    } else if (
      // A free-text-only answer to a single-question call rides in
      // `response` instead of the map (the builtin's `y()`).
      questions.length === 1 && response !== null
    ) {
      question.answer = response;
    }
  }
  return { seq, createdAt, questions };
}

/**
 * Parses a batch of event rows into decision records, newest first, keeping
 * at most `limit`. Non-decision rows are skipped silently — the log is full
 * of ordinary prompts.
 */
export function decisionsFromEvents(
  rows: readonly unknown[],
  limit = 5,
): DecisionRecord[] {
  const decisions: DecisionRecord[] = [];
  for (const row of rows) {
    const decision = parseDecisionEvent(row);
    if (decision !== null) decisions.push(decision);
  }
  decisions.sort((a, b) => b.seq - a.seq);
  return decisions.slice(0, Math.max(0, limit));
}