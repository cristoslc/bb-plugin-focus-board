// Pure helpers behind the thread pane's ✨ auto-rename button (see the
// thread_autotitle RPC in server.ts for the call wiring). The design brief:
// serve titles with WHATEVER AI service bb's own thread-title task is set
// to — bb routes titles and commit messages to a user-picked plugin service
// through Settings → AI services, and this plugin rides that selection via
// the cross-plugin RPC bridge instead of carrying its own key.

/** The trimmed prompt history rows `bb.sdk.threads.promptHistory` returns. */
export interface AutotitleHistoryEntry {
  input: ReadonlyArray<{
    type: string;
    text?: string;
    visibility?: "agent-only";
  }>;
}

/** The slice of bb's AI-services state the ✨ rename path needs. */
export interface AutotitleSelection {
  "thread-title": { mode: string; pluginId?: string; serviceId?: string };
}

/** How a resolved ✨ call should proceed, or why it refuses (fail loud). */
export type TitleSelectionOutcome =
  | { ok: true; pluginId: string; serviceId: string }
  | { ok: false; reason: string };

/**
 * bb's automatic mode resolves the ready service among registered ones at
 * title-generation time, inside bb core; a plugin cannot invoke that
 * decision, and bb cloud's completion runs only inside bb. So the ✨ path
 * serves exactly what the operator pinned: a plugin service, whose plugin
 * is reachable over the RPC bridge. Anything else is refused with the fix
 * named in the message.
 */
export function resolveTitleSelection(state: {
  selections: AutotitleSelection;
}): TitleSelectionOutcome {
  const selection = state.selections["thread-title"];
  if (selection?.mode !== "service" || typeof selection.pluginId !== "string") {
    return {
      ok: false,
      reason:
        "Title task is not set to a plugin AI service. Choose one under Settings → AI services → thread-title (bb cloud and automatic run inside bb and cannot be invoked from plugins).",
    };
  }
  if (typeof selection.serviceId !== "string") {
    return {
      ok: false,
      reason: `AI service selection is malformed: ${JSON.stringify(selection)}`,
    };
  }
  return {
    ok: true,
    pluginId: selection.pluginId,
    serviceId: selection.serviceId,
  };
}

/** Hard cap on prompt text sent for titling; titles come from beginnings. */
export const AUTOTITLE_PROMPT_MAX_CHARS = 4000;

/** Cap on the generated title; the instruction asks for ~40 but the cap is the guard. */
export const AUTOTITLE_TITLE_MAX_CHARS = 120;

/**
 * The thread's originating prompt, text parts only: images/files say
 * nothing titling can use, and agent-only parts are injected scaffolding,
 * not user intent. bb titles from the first prompt the same way.
 */
export function promptTextFromHistory(
  entries: readonly AutotitleHistoryEntry[],
): string | null {
  for (const entry of entries) {
    const text = entry.input
      .filter(
        (part) =>
          part.type === "text" &&
          typeof part.text === "string" &&
          part.visibility !== "agent-only",
      )
      .map((part) => part.text!.trim())
      .filter((text) => text !== "")
      .join(" ");
    if (text !== "") return text;
  }
  return null;
}

export function clampPromptText(
  text: string,
  maxChars: number = AUTOTITLE_PROMPT_MAX_CHARS,
): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}

/**
 * The ✨ title prompt: bb's own generateThreadMetadata guidance, then the
 * thread text as the payload. Models follow a trailing payload better than
 * a trailing instruction for this shape.
 */
export function buildAutotitlePrompt(threadPrompt: string): string {
  return [
    "You create concise titles for coding tasks.",
    "Reply with only the title: short, clear, sentence case, in the same language as the task.",
    "Keep it under about 40 characters. Summarize the task in your own words instead of copying its text.",
    "No quotes, no trailing punctuation, no explanation.",
    "",
    "The task:",
    clampPromptText(threadPrompt),
  ].join("\n");
}

/**
 * Turn a model reply into the title the rename commits: collapse all
 * whitespace (models love soft-wrapping one-line replies), strip one layer
 * of straight/curly wrapping quotes, and cap at 120 characters, cutting at
 * a word boundary. Null means "nothing usable" — the caller fails loud.
 */
export function cleanGeneratedTitle(
  raw: string,
  maxChars: number = AUTOTITLE_TITLE_MAX_CHARS,
): string | null {
  let title = raw.replace(/\s+/g, " ").trim();
  if (title.length >= 2) {
    const first = title[0];
    const last = title[title.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "“" && last === "”") ||
      (first === "'" && last === "'") ||
      (first === "‘" && last === "’") ||
      (first === "`" && last === "`")
    ) {
      title = title.slice(1, -1).trim();
    }
  }
  if (title.length > maxChars) {
    const slice = title.slice(0, maxChars);
    // Cut at the last space so the cap never bisects a word; a cap with
    // no space (long tokens) keeps the hard slice instead.
    const boundary = slice.lastIndexOf(" ");
    title = boundary > maxChars / 2 ? slice.slice(0, boundary) : slice;
  }
  return title === "" ? null : title;
}