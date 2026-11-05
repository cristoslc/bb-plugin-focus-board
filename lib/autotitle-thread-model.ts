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
  /**
   * The conversation row's attachment summary (bb's timelineConversationRow
   * schema; optional here because probe rows and older fixtures lack it).
   * The pasted-opener recovery reads `localFilePaths` off the row the text
   * read could not use — see server.ts's threadOriginatingPrompt.
   */
  attachments?: {
    localFilePaths?: readonly string[];
    localImagePaths?: readonly string[];
  } | null;
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
 * The pasted-file opener a text-only read cannot see: the oldest user
 * conversation row whose `attachments.localFilePaths` name a stored paste
 * (bb saves a composer paste as a localFile part; the row's text is then
 * empty and `firstUserPromptFromTimeline` has nothing to return). Images
 * and assistant/system rows say nothing. Returns the oldest usable stored
 * path, or null when no row carried one — the caller only consults this
 * after the text tier missed.
 */
export function firstUserPromptFileFromTimeline(
  rows: readonly AutotitleTimelineRow[],
): string | null {
  const chronological = [...rows].sort(
    (a, b) =>
      (a.sourceSeqStart ?? a.createdAt ?? 0) -
      (b.sourceSeqStart ?? b.createdAt ?? 0),
  );
  for (const row of chronological) {
    if (row.kind !== "conversation" || row.role !== "user") continue;
    const storedPath = (row.attachments?.localFilePaths ?? []).find(
      (candidate) => typeof candidate === "string" && candidate.trim() !== "",
    );
    if (typeof storedPath === "string" && storedPath.trim() !== "") {
      return storedPath.trim();
    }
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

/**
 * The refusal wordings for the thread-model row's environment-readiness
 * gate (issue #378): bb's spawn into a torn-down environment answers raw
 * `HTTP 409: Environment unavailable`, and the fallback modal serves the
 * `thread_autotitle_services` reason as the row's blocker text — so every
 * verdict must name the actual blocker, and an inconclusive probe must
 * block the row rather than ever read as available. Pure, so the wording
 * is pinned without a host. bb's environment statuses: ready | error |
 * creating | provisioning | destroyed.
 */
export function environmentNotSpawnableReason(status: string): string {
  switch (status) {
    case "destroyed":
      return "This thread's environment is destroyed, so a title probe cannot spawn in it";
    case "error":
      return "This thread's environment is in the error state, so a title probe cannot spawn in it";
    case "creating":
    case "provisioning":
      return `This thread's environment is still ${status}, so a title probe cannot spawn in it yet`;
    default:
      return `This thread's environment is "${status}", not ready to spawn a title probe into`;
  }
}

export function environmentReadFailureReason(error: unknown): string {
  return `This thread's environment could not be read to verify a title probe spawn: ${error instanceof Error ? error.message : String(error)}`;
}

export function environmentStatusMissingReason(): string {
  return "This thread's environment row carries no status, so a title probe spawn could not be verified";
}