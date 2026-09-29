import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * The board's "needs you" state rides bb's sidebar thread rows
 * (`hasPendingInteraction`). The server clears that flag the moment an
 * interaction settles (see `settleInteractionTerminalState` — the SQL flag is
 * `EXISTS ... status = 'pending'`), but rows the board renders come from
 * the host's sidebar cache, which does not always pick the settle event up
 * in time: a card can sit in the Needs-you column after the user already
 * answered (observed 2026-09-29 on thr_6fzk5sjz79, answered via the host's
 * main-view form at 22:39:45 while the board row kept the stale flag).
 *
 * This module is the plugin-side guard: `thread:changed` events with the
 * `interactions-changed` kind carry the new flag in `metadata`, and the same
 * events drive the pane's question card, so they demonstrably reach plugin
 * surfaces. The board verifies each event and overlays the verified flag on
 * the sidebar rows until the sidebar catches up.
 */

/** Thread id → verified `hasPendingInteraction`. */
export type InteractionFlagStore = ReadonlyMap<string, boolean>;

export interface InteractionFlagChange {
  threadId: string;
  /**
   * The event's carried flag, or null when the payload omits it and the
   * caller must verify against `threads.interactions.list` first.
   */
  hasPendingInteraction: boolean | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Extracts one per-thread flag change from a realtime `thread:changed`
 * event. Returns null for everything the guard must ignore: non-thread
 * entities, events with no thread id (nothing to verify against), events
 * that do not touch interactions, and unparseable payloads.
 */
export function interactionFlagChangeFromEvent(
  event: unknown,
): InteractionFlagChange | null {
  if (!isRecord(event)) return null;
  if (event.entity !== "thread") return null;
  if (typeof event.id !== "string" || event.id.length === 0) return null;
  if (!Array.isArray(event.changes)) return null;
  if (!event.changes.includes("interactions-changed")) return null;
  const metadata = isRecord(event.metadata) ? event.metadata : null;
  const carried = metadata?.["hasPendingInteraction"];
  return {
    threadId: event.id,
    hasPendingInteraction: typeof carried === "boolean" ? carried : null,
  };
}

/**
 * Server truth for one thread, from the interaction rows `threads
 * .interactions.list` returns: pending exactly when a row still sits in
 * `pending` status — the same predicate the server's flag SQL applies.
 */
export function pendingFromInteractionRows(
  rows: readonly { status: string }[],
): boolean {
  return rows.some((row) => row.status === "pending");
}

/**
 * Overlays verified flags on the sidebar rows. Rows without an override,
 * and overrides that already agree with the sidebar row (the sidebar caught
 * up), pass through by reference so the rest of the board memoizes as
 * before.
 */
export function applyInteractionFlags<T extends PluginSidebarThread>(
  threads: readonly T[],
  flags: InteractionFlagStore,
): T[] {
  if (flags.size === 0) return [...threads];
  return threads.map((row) => {
    const flag = flags.get(row.id);
    if (flag === undefined || flag === row.hasPendingInteraction) return row;
    return { ...row, hasPendingInteraction: flag };
  });
}