// Pure helpers for the ✨ auto-rename's thread-model probe: when every
// registered AI service fails (or none is registered), the fallback can
// still generate a title with the thread's own provider/model by spawning
// a hidden probe thread, reading its reply off the timeline, and deleting
// it — see the useThreadModel path in server.ts's thread_autotitle. bb has
// no direct completion API for threads, so the probe-turn shape is the
// only plugin-facing route to the thread's model.

import { buildAutotitlePrompt } from "./autotitle";

/**
 * The probe prompt: the same bb-style title instructions the service
 * bridge serves (both paths must produce the same title style), plus a
 * no-tools guardrail — a probe is a real agent turn, and the one thing it
 * must never do is touch the workspace to "answer" the title question.
 */
export function buildAutotitleProbePrompt(threadPrompt: string): string {
  return `${buildAutotitlePrompt(threadPrompt)}\n\nNo tools: only write the title.`;
}

/** The slice of a timeline row the probe's reply reader needs. */
export interface AutotitleTimelineRow {
  kind: string;
  role?: string;
  text?: string;
  /** Source-thread conversation rows carry a sequence stamp (probe rows are stamped at read time). */
  sourceSeqStart?: number;
  createdAt?: number;
}

/**
 * The thread's ORIGINATING prompt, read off the source thread's timeline:
 * bb's own titling works from the spawn-time input, which prompt history
 * does not even carry (its rows are composer turns only — found live), so
 * the first usable user conversation row is the title source. Rows may
 * arrive newest-first; the oldest wins, by sourceSeqStart when stamped and
 * createdAt otherwise (stable sort keeps arrival order for ties). Null
 * means nothing usable; the caller falls back or fails loud.
 */
export function firstUserPromptFromTimeline(
  rows: readonly AutotitleTimelineRow[],
): string | null {
  const chronological = [...rows].sort(
    (a, b) =>
      (a.sourceSeqStart ?? a.createdAt ?? 0) -
      (b.sourceSeqStart ?? b.createdAt ?? 0),
  );
  for (const row of chronological) {
    if (row.kind !== "conversation" || row.role !== "user") continue;
    if (typeof row.text !== "string" || row.text.trim() === "") continue;
    return row.text;
  }
  return null;
}

/**
 * The probe's answer: the LAST assistant conversation row's text — user
 * loops (the probe prompt itself echoes as a user row), system rows, and
 * work rows all say nothing. Think blocks are stripped first, with bb's own
 * reply-cleanup semantics (`</think>/<thinking>`, an unclosed block
 * tolerating to end-of-text) — models narrate before the title. Null means
 * nothing usable; the caller fails loud.
 */
export function assistantTextFromTimeline(
  rows: readonly AutotitleTimelineRow[],
): string | null {
  let text: string | null = null;
  for (const row of rows) {
    if (row.kind !== "conversation" || row.role !== "assistant") continue;
    if (typeof row.text !== "string" || row.text.trim() === "") continue;
    text = row.text;
  }
  if (typeof text !== "string") return null;
  const stripped = text.replace(
    /<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/giu,
    "",
  );
  return stripped.trim() === "" ? null : stripped;
}

/** bb's transient ThreadStatus kinds; only idle/error end the poll. */
export function probeSettled(status: string): boolean {
  return status === "idle" || status === "error";
}