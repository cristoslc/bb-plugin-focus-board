// Which state writes a drag onto a state-change column performs.
//
// Pure module: no host, no SDK values, no React, so it can be unit-tested
// directly and stay honest about what a drop gesture means.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export interface UnreadDropWrites {
  /** The thread needs `setRead(threadId, false)`. */
  markUnread: boolean;
  /** The thread needs `setPinned(threadId, false)`. */
  unpin: boolean;
}

/**
 * What a drop onto the Unread column changes for `thread`.
 *
 * A pinned card dropped on Unread must leave the Pinned lane as part of the
 * same gesture: the column a card sits in is derived from its pin state, so
 * marking it unread while leaving the pin would put it straight back into
 * Pinned on the next grouping pass — the card would not appear to move at
 * all, and the drop would read as the board eating the gesture. Both writes
 * are skipped when the thread is already in the target state, so the gesture
 * is idempotent and a pointless write never reaches the host.
 */
export function unreadDropWrites(
  thread: Pick<PluginSidebarThread, "isUnread" | "isPinned">,
): UnreadDropWrites {
  return { markUnread: !thread.isUnread, unpin: thread.isPinned };
}