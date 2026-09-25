import { useCallback, useEffect, useMemo, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";

/**
 * Pending interactions are invisible inside `ThreadChat`: the host's embedded
 * chat renders no interaction UI at all (only the main thread view does), so
 * a question asked while a thread is viewed in this pane never shows a form
 * and the tool call blocks until it times out.
 *
 * This card restores parity for the pane. Questions reach it in two shapes:
 *
 * - `user_question` — the provider's native ask-user-question tool (origin
 *   kind `provider`, questions at `payload.questions`). Answered through
 *   `interactions.resolve` with a `{ kind: "user_answer", answers }`
 *   resolution; dismissing it means stopping the turn, exactly like the
 *   host's own form.
 * - `plugin` — a plugin-registered form (origin kind `plugin`, renderer
 *   `ask-user-question`, questions under `payload.data.questions`). The host
 *   delegates these to the plugin's renderer component, which submits
 *   through `interactions.respond({ value: { answers } })`; the card sends
 *   the same value for the well-known question shape.
 *
 * Payloads the pane cannot render fall back to a pointer at the main view.
 */

type InteractionsListResult = Awaited<
  ReturnType<PluginBrowserBbSdk["threads"]["interactions"]["list"]>
>;
type PendingInteractionRow = InteractionsListResult[number];

interface QuestionOption {
  value: string;
  label: string;
  description?: string;
  preview?: string;
}

export interface QuestionSpec {
  id: string;
  prompt: string;
  shortLabel?: string;
  multiSelect: boolean;
  options: QuestionOption[];
  allowFreeText: boolean;
}

/** Answers keyed by question id, the shape both submit paths carry. */
export type QuestionAnswers = Record<
  string,
  { selected: string[]; freeText?: string }
>;

interface QuestionFormData {
  questions: QuestionSpec[];
}

const MAX_OPTIONS_PER_QUESTION = 4;
const MAX_FREE_TEXT_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOption(value: unknown): QuestionOption | null {
  if (!isRecord(value)) return null;
  if (typeof value.value !== "string" || value.value.length === 0) return null;
  if (typeof value.label !== "string" || value.label.length === 0) return null;
  const option: QuestionOption = { value: value.value, label: value.label };
  if (typeof value.description === "string") option.description = value.description;
  if (typeof value.preview === "string") option.preview = value.preview;
  return option;
}

function parseQuestion(value: unknown): QuestionSpec | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (typeof value.prompt !== "string" || value.prompt.length === 0) return null;
  if (typeof value.multiSelect !== "boolean") return null;
  // `options` is required in the plugin-form schema but optional in the
  // provider `user_question` schema; treat a missing array as empty.
  const rawOptions = Array.isArray(value.options) ? value.options : [];
  if (rawOptions.length > MAX_OPTIONS_PER_QUESTION) return null;
  const options: QuestionOption[] = [];
  for (const entry of rawOptions) {
    const option = parseOption(entry);
    if (option === null) return null;
    options.push(option);
  }
  if (!value.allowFreeText && options.length === 0) return null;
  const question: QuestionSpec = {
    id: value.id,
    prompt: value.prompt,
    multiSelect: value.multiSelect,
    options,
    allowFreeText: value.allowFreeText === true,
  };
  if (typeof value.shortLabel === "string" && value.shortLabel.length > 0) {
    question.shortLabel = value.shortLabel;
  }
  return question;
}

/**
 * Recognizes the question shape shared by both payload kinds:
 * `{ questions: [{ id, prompt, shortLabel?, multiSelect, options, allowFreeText }] }`.
 * The plugin form nests it under `payload.data`; the provider `user_question`
 * payload is it, directly. Returns null for anything else (other plugins'
 * forms the pane cannot draw).
 */
export function parseQuestionData(data: unknown): QuestionFormData | null {
  if (!isRecord(data) || !Array.isArray(data.questions) || data.questions.length === 0) {
    return null;
  }
  const questions: QuestionSpec[] = [];
  for (const entry of data.questions) {
    const question = parseQuestion(entry);
    if (question === null) return null;
    questions.push(question);
  }
  return { questions };
}

interface QuestionAnswerState {
  selected: string[];
  other: boolean;
  otherText: string;
}

export function initialAnswerState(): QuestionAnswerState {
  return { selected: [], other: false, otherText: "" };
}

export function isAnswered(question: QuestionSpec, state: QuestionAnswerState): boolean {
  if (state.selected.length > 0) return true;
  return state.other && state.otherText.trim().length > 0;
}

export function buildAnswerValue(
  question: QuestionSpec,
  state: QuestionAnswerState,
): { selected: string[]; freeText?: string } {
  // Single-select "Other" answers carry only the free text; multi-select can
  // combine picked options with free text, mirroring the host form.
  const freeText = state.other ? state.otherText.trim() : undefined;
  const selected = state.other && !question.multiSelect ? [] : state.selected;
  const answer: { selected: string[]; freeText?: string } = { selected };
  if (freeText !== undefined && freeText.length > 0) answer.freeText = freeText;
  return answer;
}

function OptionRow({
  option,
  selected,
  multiSelect,
  disabled,
  onToggle,
}: {
  option: QuestionOption;
  selected: boolean;
  multiSelect: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onToggle}
        className="flex w-full min-w-0 items-start gap-2 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-state-hover focus-visible:bg-state-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={
            selected
              ? "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-primary bg-primary text-primary-foreground"
              : "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border border-input"
          }
          aria-hidden
        >
          {selected ? <Icon name="Check" className="size-2.5" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium leading-snug">{option.label}</span>
          {option.description !== undefined ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {option.description}
            </span>
          ) : null}
        </span>
      </button>
      {selected && !multiSelect && option.preview !== undefined ? (
        <pre className="mx-2 mb-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed text-foreground">
          {option.preview}
        </pre>
      ) : null}
    </div>
  );
}

function QuestionForm({
  questions,
  disabled,
  onSubmit,
}: {
  questions: QuestionSpec[];
  disabled: boolean;
  onSubmit: (answers: QuestionAnswers) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, QuestionAnswerState>>(() => {
    const initial: Record<string, QuestionAnswerState> = {};
    for (const question of questions) initial[question.id] = initialAnswerState();
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = useMemo(
    () => questions.every((question) => isAnswered(question, answers[question.id] ?? initialAnswerState())),
    [questions, answers],
  );

  const toggleOption = useCallback((question: QuestionSpec, value: string) => {
    setAnswers((current) => {
      const state = current[question.id] ?? initialAnswerState();
      let selected: string[];
      let other = state.other;
      if (question.multiSelect) {
        selected = state.selected.includes(value)
          ? state.selected.filter((entry) => entry !== value)
          : [...state.selected, value];
      } else {
        selected = state.selected.includes(value) ? [] : [value];
        other = false;
      }
      return { ...current, [question.id]: { ...state, selected, other } };
    });
  }, []);

  const toggleOther = useCallback((question: QuestionSpec) => {
    setAnswers((current) => {
      const state = current[question.id] ?? initialAnswerState();
      if (question.multiSelect) {
        return { ...current, [question.id]: { ...state, other: !state.other } };
      }
      return {
        ...current,
        [question.id]: { ...state, other: !state.other, selected: [] },
      };
    });
  }, []);

  const setOtherText = useCallback((questionId: string, text: string) => {
    setAnswers((current) => {
      const state = current[questionId] ?? initialAnswerState();
      return { ...current, [questionId]: { ...state, otherText: text } };
    });
  }, []);

  const submit = useCallback(() => {
    if (disabled || submitting || !allAnswered) return;
    const value: QuestionAnswers = {};
    for (const question of questions) {
      const state = answers[question.id] ?? initialAnswerState();
      if (!isAnswered(question, state)) return;
      value[question.id] = buildAnswerValue(question, state);
    }
    setSubmitting(true);
    onSubmit(value);
  }, [answers, allAnswered, disabled, onSubmit, questions, submitting]);

  const busy = disabled || submitting;

  return (
    <form
      className="flex min-w-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {questions.map((question, index) => {
        const state = answers[question.id] ?? initialAnswerState();
        return (
          <fieldset key={question.id} disabled={busy} className="min-w-0 border-t border-border px-3 py-2 first:border-t-0">
            <div className="mb-1 flex min-w-0 items-center gap-2">
              {question.shortLabel !== undefined ? (
                <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {question.shortLabel}
                </span>
              ) : null}
              {questions.length > 1 ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {index + 1} of {questions.length}
                </span>
              ) : null}
            </div>
            <legend className="sr-only">{question.prompt}</legend>
            <div className="text-sm font-semibold text-foreground">{question.prompt}</div>
            <div className="mt-1.5 space-y-0.5">
              {question.options.map((option) => (
                <OptionRow
                  key={option.value}
                  option={option}
                  selected={state.selected.includes(option.value)}
                  multiSelect={question.multiSelect}
                  disabled={busy}
                  onToggle={() => toggleOption(question, option.value)}
                />
              ))}
              {question.allowFreeText ? (
                <OptionRow
                  option={{ value: `${question.id}:other`, label: "Other" }}
                  selected={state.other}
                  multiSelect={question.multiSelect}
                  disabled={busy}
                  onToggle={() => toggleOther(question)}
                />
              ) : null}
            </div>
            {state.other && question.allowFreeText ? (
              <textarea
                aria-label={`Your answer for ${question.shortLabel ?? question.prompt}`}
                value={state.otherText}
                rows={2}
                autoFocus
                maxLength={MAX_FREE_TEXT_LENGTH}
                onChange={(event) => setOtherText(question.id, event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                }}
                placeholder="Type your own answer…"
                className="mt-1.5 w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              />
            ) : null}
          </fieldset>
        );
      })}
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Answering here unblocks the thread.
        </p>
        <Button type="submit" size="sm" disabled={busy || !allAnswered}>
          {submitting ? "Submitting…" : "Submit answer"}
        </Button>
      </div>
    </form>
  );
}

export interface PendingInteractionCardProps {
  threadId: string;
  /** Opens the thread in the main view (fallback for unrenderable forms). */
  onOpenInMainView: () => void;
}

export function PendingInteractionCard({ threadId, onOpenInMainView }: PendingInteractionCardProps) {
  const sdk = useSdk();
  const [interaction, setInteraction] = useState<PendingInteractionRow | null>(null);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const rows = await sdk.threads.interactions.list({ threadId });
      const pending =
        [...rows]
          .reverse()
          .find(
            (row) =>
              row.status === "pending" &&
              (row.payload.kind === "user_question" ||
                (row.payload.kind === "plugin" && row.origin?.kind === "plugin") ||
                // Provider extension requests (`<pluginId>/<name>`) are also
                // invisible in the pane; show the open-in-main-view fallback.
                (typeof row.payload.kind === "string" && row.payload.kind.includes("/"))),
          ) ?? null;
      setInteraction(pending);
      setDismissError(null);
    } catch {
      // Unknown/unavailable thread — no card rather than a broken pane.
      setInteraction(null);
    }
  }, [sdk, threadId]);

  useEffect(() => {
    setInteraction(null);
    setDismissError(null);
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const unsubscribe = sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          if (event.entity !== "thread") return;
          if (event.id !== undefined && event.id !== threadId) return;
          if (event.changes.includes("interactions-changed")) void refresh();
        },
      });
      return unsubscribe;
    } catch {
      // Some embedded contexts (screenshot harness) have no subscribe; the
      // card still works from its initial fetch and explicit refetches.
      return undefined;
    }
  }, [sdk, threadId, refresh]);

  const isUserQuestion = interaction?.payload.kind === "user_question";
  // Plugin forms (origin plugin) can be cancelled; everything else belongs to
  // the turn that raised it, so backing out means stopping the turn — the
  // same trade the host's own forms make.
  const dismissCancelsForm =
    interaction?.payload.kind === "plugin" && interaction.origin?.kind === "plugin";

  const questionData = useMemo(() => {
    if (interaction === null) return null;
    // The plugin form nests the question shape under `payload.data`; the
    // provider `user_question` payload IS the question shape.
    const source =
      interaction.payload.kind === "user_question"
        ? interaction.payload
        : interaction.payload.kind === "plugin"
          ? interaction.payload.data
          : null;
    if (source === null) return null;
    return parseQuestionData(source);
  }, [interaction]);

  const submitAnswer = useCallback(
    async (answers: QuestionAnswers) => {
      if (interaction === null) return;
      try {
        if (interaction.payload.kind === "user_question") {
          // Provider questions resolve with a discriminated user_answer
          // resolution — the same call the host's own form makes.
          await sdk.threads.interactions.resolve({
            threadId,
            interactionId: interaction.id,
            resolution: { kind: "user_answer", answers },
          });
        } else if (interaction.payload.kind === "plugin") {
          // Plugin forms submit the raw value the plugin renderer would.
          await sdk.threads.interactions.respond({
            threadId,
            interactionId: interaction.id,
            value: { answers },
          });
        }
      } catch (cause) {
        setDismissError(
          cause instanceof Error && cause.message.length > 0
            ? cause.message
            : "Submitting the answer failed.",
        );
      } finally {
        void refresh();
      }
    },
    [interaction, refresh, sdk, threadId],
  );

  const dismiss = useCallback(async () => {
    if (interaction === null) return;
    setDismissing(true);
    setDismissError(null);
    try {
      if (dismissCancelsForm) {
        await sdk.threads.interactions.cancel({ threadId, interactionId: interaction.id });
      } else {
        // A provider question belongs to the turn that raised it; backing
        // out means stopping the turn, exactly like the host's form.
        await sdk.threads.stop({ threadId });
      }
    } catch (cause) {
      setDismissError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Dismissing the question failed.",
      );
    } finally {
      setDismissing(false);
      void refresh();
    }
  }, [interaction, refresh, sdk, threadId]);

  if (interaction === null || interaction.payload.kind === "approval") return null;

  const title = isUserQuestion ? null : (interaction.payload as { title?: string }).title;

  return (
    <div
      role="region"
      aria-label="Pending question"
      data-testid="thread-board-pending-interaction"
      className="mx-3 mt-2 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex min-w-0 items-center gap-2 px-3 pb-1 pt-2">
        <Icon name="MessageQuestion" className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {questionData !== null
            ? questionData.questions.length === 1
              ? "Question"
              : `${questionData.questions.length} questions`
            : (title ?? "Question")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
          disabled={dismissing}
          onClick={() => void dismiss()}
          aria-label={
            dismissCancelsForm
              ? "Dismiss without answering — the agent proceeds with its best judgement"
              : "Dismiss without answering — stops the turn, like the main view"
          }
        >
          {dismissCancelsForm ? "Dismiss" : "Stop turn"}
        </Button>
      </div>
      {questionData !== null ? (
        <QuestionForm
          key={interaction.id}
          questions={questionData.questions}
          disabled={dismissing}
          onSubmit={(answers) => void submitAnswer(answers)}
        />
      ) : (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            This form isn&apos;t supported in the board pane.
          </p>
          <Button variant="outline" size="sm" onClick={onOpenInMainView}>
            Open in main view
          </Button>
        </div>
      )}
      {dismissError !== null ? (
        <p className="border-t border-border px-3 py-1.5 text-xs text-destructive-text">
          {dismissError}
        </p>
      ) : null}
    </div>
  );
}
