import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { PluginBrowserBbSdk } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse";
import { cn } from "@/lib/utils";

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
 * The form mirrors the host's `QuestionForm`: one question at a time behind a
 * tab strip (answered tabs strike through), number-key shortcuts, Enter
 * advances / submits, a collapsible banner so the transcript stays readable,
 * and a height-capped, internally-scrolling body. Payloads the pane cannot
 * render fall back to a pointer at the main view.
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

interface QuestionAnswerState {
  selected: string[];
  otherSelected: boolean;
  otherText: string;
}

const MAX_OPTIONS_PER_QUESTION = 4;
const MAX_FREE_TEXT_LENGTH = 4096;
const OTHER_LABEL = "Other…";
/** Textarea auto-grow bounds, matching the host's `$0`/`e2`. */
const TEXTAREA_MIN_HEIGHT = 84;
const TEXTAREA_MAX_HEIGHT = 158;
/** Host's `t2`: max height of a selected option's preview block. */
const PREVIEW_MAX_HEIGHT = 220;
/** Height cap for the scrollable question body; keeps the chat usable. */
const BODY_MAX_CLASS = "max-h-[45dvh]";

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
export function parseQuestionData(data: unknown): { questions: QuestionSpec[] } | null {
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

/**
 * Selections filtered to values the current option list actually offers —
 * the host does the same before validating and submitting, so a payload
 * change can never carry orphaned values out.
 */
export function knownSelections(
  question: QuestionSpec,
  selected: string[],
): string[] {
  const known = new Set(question.options.map((option) => option.value));
  return selected.filter((value) => known.has(value));
}

/** A question with at least one option defaults to picking, not typing. */
function hasOptions(question: QuestionSpec): boolean {
  return question.options.length > 0;
}

export function initialAnswerState(question: QuestionSpec): QuestionAnswerState {
  return { selected: [], otherSelected: !hasOptions(question), otherText: "" };
}

export function isAnswered(question: QuestionSpec, state: QuestionAnswerState): boolean {
  if (knownSelections(question, state.selected).length > 0) return true;
  return state.otherSelected && state.otherText.trim().length > 0;
}

export function buildAnswerValue(
  question: QuestionSpec,
  state: QuestionAnswerState,
): { selected: string[]; freeText?: string } {
  const trimmed = state.otherText.trim();
  const hasText = state.otherSelected && trimmed.length > 0;
  // Mirrors the host: single-select "Other" answers carry only the free
  // text; multi-select can combine picked options with free text.
  if (question.multiSelect) {
    const selected = knownSelections(question, state.selected);
    return hasText ? { selected, freeText: trimmed } : { selected };
  }
  return state.otherSelected
    ? hasText
      ? { selected: [], freeText: trimmed }
      : { selected: [] }
    : { selected: knownSelections(question, state.selected) };
}

export function buildAnswers(
  questions: QuestionSpec[],
  states: Record<string, QuestionAnswerState>,
): QuestionAnswers {
  const answers: QuestionAnswers = {};
  for (const question of questions) {
    const state = states[question.id] ?? initialAnswerState(question);
    answers[question.id] = buildAnswerValue(question, state);
  }
  return answers;
}

/** Tab label for a question; the host defaults to "Question N". */
export function tabLabel(question: QuestionSpec, index: number): string {
  return question.shortLabel ?? `Question ${index + 1}`;
}

/**
 * Maps a number key to the choice it selects for the visible question:
 * options in order, then Other when it renders. Digits beyond that are
 * unmapped. Returns null for keys with no target.
 */
export function choiceForDigitKey(
  question: QuestionSpec,
  key: string,
): { kind: "option"; value: string } | { kind: "other" } | null {
  const index = Number(key) - 1;
  if (!Number.isInteger(index) || index < 0) return null;
  const option = question.options[index];
  if (option !== undefined) return { kind: "option", value: option.value };
  // Other only takes a shortcut when it renders as a row.
  if (index === question.options.length && hasOptions(question) && question.allowFreeText) {
    return { kind: "other" };
  }
  return null;
}

/** The question visible at a given step, clamped to range. */
export function visibleQuestion(
  questions: QuestionSpec[],
  step: number,
): QuestionSpec | null {
  return questions[step] ?? null;
}

function OptionRow({
  option,
  selected,
  multiSelect,
  disabled,
  shortcut,
  onToggle,
}: {
  option: QuestionOption;
  selected: boolean;
  multiSelect: boolean;
  disabled: boolean;
  shortcut?: string;
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
          className={cn(
            "mt-0.5 flex size-3.5 shrink-0 items-center justify-center border",
            // This theme's `primary` is not a strong fill; the plugin's own
            // checkbox marks checked with foreground-on-background.
            selected ? "border-foreground bg-foreground text-background" : "border-input",
            multiSelect ? "rounded-[4px]" : "rounded-full",
          )}
          aria-hidden
        >
          {selected ? <Icon name="Check" className="size-2.5" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium leading-snug">
            {option.label}
            {shortcut !== undefined ? (
              <kbd className="ml-1.5 rounded-sm border border-border px-1 font-sans text-[10px] text-muted-foreground/70">
                {shortcut}
              </kbd>
            ) : null}
          </span>
          {option.description !== undefined ? (
            <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
              {option.description}
            </span>
          ) : null}
        </span>
      </button>
      {selected && !multiSelect && option.preview !== undefined ? (
        <pre
          className="mx-2 mb-1 max-h-[220px] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-2 font-mono text-xs leading-relaxed text-foreground"
          style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
        >
          {option.preview}
        </pre>
      ) : null}
    </div>
  );
}

/** Auto-grows the textarea between the host's min/max heights. */
function useAutoResize(disabled: boolean) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback(
    (element: HTMLTextAreaElement | null = ref.current) => {
      if (element === null || disabled) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(
        Math.max(element.scrollHeight, TEXTAREA_MIN_HEIGHT),
        TEXTAREA_MAX_HEIGHT,
      )}px`;
    },
    [disabled],
  );
  return { ref, resize };
}

function QuestionTabStrip({
  questions,
  states,
  step,
  onSelect,
  disabled,
}: {
  questions: QuestionSpec[];
  states: Record<string, QuestionAnswerState>;
  step: number;
  onSelect: (step: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {questions.map((question, index) => {
          const current = index === step;
          const answered = isAnswered(question, states[question.id] ?? initialAnswerState(question));
          return (
            <div
              key={question.id}
              className={
                current
                  ? "relative inline-flex h-7 shrink-0 items-center rounded-md bg-muted text-foreground"
                  : "relative inline-flex h-7 shrink-0 items-center rounded-md text-muted-foreground hover:bg-state-hover"
              }
            >
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-pressed={current}
                title={question.prompt}
                disabled={disabled}
                className="flex h-full min-w-0 items-center rounded-md px-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span
                  className={
                    answered
                      ? "max-w-[180px] truncate text-xs line-through"
                      : "max-w-[180px] truncate text-xs"
                  }
                >
                  {tabLabel(question, index)}
                </span>
              </button>
            </div>
          );
        })}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {step + 1} of {questions.length}
      </span>
    </div>
  );
}

function QuestionForm({
  questions,
  disabled,
  onSubmit,
  onCancel,
  cancelCancelsForm,
}: {
  questions: QuestionSpec[];
  disabled: boolean;
  onSubmit: (answers: QuestionAnswers) => void;
  onCancel: () => void;
  /** Labels the footer cancel: Dismiss (cancellable plugin form) vs Stop turn. */
  cancelCancelsForm: boolean;
}) {
  const coarse = usePointerCoarse();
  const [states, setStates] = useState<Record<string, QuestionAnswerState>>(() => {
    const initial: Record<string, QuestionAnswerState> = {};
    for (const question of questions) initial[question.id] = initialAnswerState(question);
    return initial;
  });
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const current = visibleQuestion(questions, step);
  const first = step === 0;
  const last = step === questions.length - 1;

  const allAnswered = useMemo(
    () =>
      questions.length > 0 &&
      questions.every((question) =>
        isAnswered(question, states[question.id] ?? initialAnswerState(question)),
      ),
    [questions, states],
  );

  const updateState = useCallback(
    (question: QuestionSpec, update: (state: QuestionAnswerState) => QuestionAnswerState) => {
      setStates((currentStates) => ({
        ...currentStates,
        [question.id]: update(currentStates[question.id] ?? initialAnswerState(question)),
      }));
    },
    [],
  );

  const toggleOption = useCallback(
    (question: QuestionSpec, value: string) => {
      updateState(question, (state) => {
        if (question.multiSelect) {
          const selected = state.selected.includes(value)
            ? state.selected.filter((entry) => entry !== value)
            : [...state.selected, value];
          return { ...state, selected };
        }
        return { ...state, selected: state.selected.includes(value) ? [] : [value], otherSelected: false };
      });
    },
    [updateState],
  );

  const toggleOther = useCallback(
    (question: QuestionSpec) => {
      updateState(question, (state) => {
        if (question.multiSelect) return { ...state, otherSelected: !state.otherSelected };
        return { ...state, selected: [], otherSelected: !state.otherSelected };
      });
    },
    [updateState],
  );

  const setOtherText = useCallback(
    (question: QuestionSpec, text: string) => {
      updateState(question, (state) => ({ ...state, otherText: text }));
    },
    [updateState],
  );

  const submit = useCallback(() => {
    if (disabled || submitting || !allAnswered) return;
    setSubmitting(true);
    onSubmit(buildAnswers(questions, states));
  }, [allAnswered, disabled, onSubmit, questions, states, submitting]);

  /** Next/submit: the host's single action behind its footer button. */
  const advanceOrSubmit = useCallback(() => {
    if (!last) {
      setStep((value) => Math.min(value + 1, questions.length - 1));
      return;
    }
    submit();
  }, [last, questions.length, submit]);

  // Number-key shortcuts for the visible question, host-style: global while
  // the form is enabled, ignored while typing in a field.
  useEffect(() => {
    if (disabled || current === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const choice = choiceForDigitKey(current, event.key);
      if (choice === null) return;
      event.preventDefault();
      if (choice.kind === "option") {
        toggleOption(current, choice.value);
        containerRef.current?.focus();
      } else {
        toggleOther(current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, disabled, toggleOption, toggleOther]);

  const busy = disabled || submitting;

  const { ref: textareaRef, resize: resizeTextarea } = useAutoResize(busy);
  const otherSelected = current !== null && (states[current.id] ?? initialAnswerState(current)).otherSelected;
  useLayoutEffect(() => {
    if (otherSelected) resizeTextarea();
  }, [otherSelected, resizeTextarea]);

  if (current === null) return null;
  const state = states[current.id] ?? initialAnswerState(current);
  const otherShortcutIndex = current.options.length; // 1-based digit for Other

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        // Enter on the container (not in a field) advances or submits,
        // mirroring the host; IME composition passes through.
        if (
          event.target !== event.currentTarget ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.key !== "Enter" ||
          event.shiftKey ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          busy
        ) {
          return;
        }
        event.preventDefault();
        advanceOrSubmit();
      }}
      className="flex min-h-0 flex-col"
    >
      {questions.length > 1 ? (
        <div className="border-t border-border px-3 pb-1 pt-2">
          <QuestionTabStrip
            questions={questions}
            states={states}
            step={step}
            onSelect={setStep}
            disabled={busy}
          />
        </div>
      ) : null}
      <div className={`min-h-0 touch-pan-y overflow-y-auto overscroll-contain border-t border-border ${BODY_MAX_CLASS}`}>
        <fieldset disabled={busy} className="min-w-0 px-3 py-2">
          <legend className="sr-only">{current.prompt}</legend>
          <div className="text-sm font-semibold text-foreground">{current.prompt}</div>
          <div className="mt-1.5 space-y-0.5">
            {current.options.map((option, index) => (
              <OptionRow
                key={option.value}
                option={option}
                selected={state.selected.includes(option.value)}
                multiSelect={current.multiSelect}
                disabled={busy}
                shortcut={String(index + 1)}
                onToggle={() => toggleOption(current, option.value)}
              />
            ))}
            {/* The host only renders an Other row when options exist; a
                free-text-only question opens with the textarea instead. */}
            {current.allowFreeText && hasOptions(current) ? (
              <OptionRow
                option={{ value: `${current.id}:other`, label: OTHER_LABEL }}
                selected={state.otherSelected}
                multiSelect={current.multiSelect}
                disabled={busy}
                shortcut={String(otherShortcutIndex + 1)}
                onToggle={() => toggleOther(current)}
              />
            ) : null}
          </div>
          {state.otherSelected && current.allowFreeText ? (
            <textarea
              ref={textareaRef}
              aria-label={`Your answer for ${current.shortLabel ?? current.prompt}`}
              value={state.otherText}
              rows={1}
              autoFocus={!coarse}
              autoComplete="off"
              maxLength={MAX_FREE_TEXT_LENGTH}
              onChange={(event) => {
                setOtherText(current, event.target.value);
                resizeTextarea(event.target);
              }}
              onKeyDown={(event) => {
                // Cmd/Ctrl+Enter submits from the textarea, like the host.
                if (
                  !event.nativeEvent.isComposing &&
                  event.key === "Enter" &&
                  (event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault();
                  advanceOrSubmit();
                  return;
                }
                event.stopPropagation();
              }}
              placeholder="Type your own answer…"
              className="mt-1.5 w-full resize-none overflow-y-auto rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:border-ring/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              style={{ minHeight: TEXTAREA_MIN_HEIGHT, maxHeight: TEXTAREA_MAX_HEIGHT }}
            />
          ) : null}
        </fieldset>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onCancel}
          aria-label={
            cancelCancelsForm
              ? "Dismiss without answering — the agent proceeds with its best judgement"
              : "Dismiss without answering — stops the turn, like the main view"
          }
        >
          {cancelCancelsForm ? "Dismiss" : "Stop turn"}
        </Button>
        <div className="flex items-center gap-2">
          {!first ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setStep((value) => Math.max(value - 1, 0))}
            >
              Back
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={busy || (last && !allAnswered)}
            onClick={advanceOrSubmit}
          >
            {submitting ? <Icon name="Spinner" className="size-3 animate-spin" aria-hidden /> : null}
            {last ? "Submit answer" : "Next"}
          </Button>
        </div>
      </div>
    </div>
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
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

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
      setActionError(null);
    } catch {
      // Unknown/unavailable thread — no card rather than a broken pane.
      setInteraction(null);
    }
  }, [sdk, threadId]);

  useEffect(() => {
    setInteraction(null);
    setActionError(null);
    setExpanded(true);
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
        setActionError(
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
    setActionError(null);
    try {
      if (dismissCancelsForm) {
        await sdk.threads.interactions.cancel({ threadId, interactionId: interaction.id });
      } else {
        // A provider question belongs to the turn that raised it; backing
        // out means stopping the turn, exactly like the host's form.
        await sdk.threads.stop({ threadId });
      }
    } catch (cause) {
      setActionError(
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : "Dismissing the question failed.",
      );
    } finally {
      setDismissing(false);
      void refresh();
    }
  }, [dismissCancelsForm, interaction, refresh, sdk, threadId]);

  if (interaction === null || interaction.payload.kind === "approval") return null;

  const title = isUserQuestion ? null : (interaction.payload as { title?: string }).title;
  // The server marks an in-flight resolution; the host disables from it too.
  const resolving = interaction.status === "resolving";
  const busy = dismissing || resolving;

  return (
    <section
      aria-label="Pending question"
      aria-expanded={expanded}
      data-testid="thread-board-pending-interaction"
      onKeyDown={(event) => {
        // Escape collapses the banner first (like the host) and keeps the
        // pane open; the pane's own Escape handler honors defaultPrevented.
        if (event.key === "Escape" && expanded && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          toggleRef.current?.focus();
        }
      }}
      className="mx-3 mt-2 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex min-h-9 min-w-0 items-center gap-2 pl-3 pr-1.5">
        <button
          ref={toggleRef}
          type="button"
          aria-controls="focus-board-question-body"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide details" : "Show details"}
          onClick={() => setExpanded((value) => !value)}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon
            name="ChevronDown"
            className={expanded ? "size-3.5 transition-transform duration-200 rotate-180" : "size-3.5 transition-transform duration-200"}
            aria-hidden
          />
        </button>
        <button
          type="button"
          aria-controls="focus-board-question-body"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          title={
            questionData !== null && questionData.questions.length === 1
              ? questionData.questions[0]?.prompt
              : undefined
          }
          className="flex min-h-7 min-w-0 flex-1 items-center rounded-md text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span
            className={
              expanded
                ? "min-w-0 whitespace-normal text-sm font-semibold text-foreground"
                : "min-w-0 truncate text-sm font-medium text-foreground"
            }
          >
            {questionData !== null
              ? questionData.questions.length === 1
                ? "Question"
                : `${questionData.questions.length} questions`
              : (title ?? "Question")}
          </span>
        </button>
      </div>
      {expanded ? (
        <div id="focus-board-question-body" className="pb-2">
          {questionData !== null ? (
            <QuestionForm
              key={interaction.id}
              questions={questionData.questions}
              disabled={busy}
              cancelCancelsForm={dismissCancelsForm}
              onCancel={() => void dismiss()}
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
          {actionError !== null ? (
            <p aria-live="polite" className="border-t border-border px-3 py-1.5 text-xs text-destructive-text">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
