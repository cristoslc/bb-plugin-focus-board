// The state dot a card (and the parent-lane board's cells) carries: one span
// painted from the shared dot vocabulary in components/dot-grid, its colour
// the thread's own state (grouping.ts threadState), with the Clear-error
// acknowledgment (issue #157) settled quiet like every other error arm.
//
// Its own module because two boards and the grid draw it: the column board
// (components/board), the parent-lane board, and the ungrouped card grid all
// take the same dot, so none of them owns a private copy that can drift.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { DOT_CLASS } from "./dot-grid";
import { threadState } from "./grouping";
import { cn } from "@/lib/utils";

export function StateDot({
  thread,
  errorAcks = new Set<string>(),
}: {
  thread: PluginSidebarThread;
  /** Clear-error acknowledgment ids (issue #157): an acked error dot sits quiet. */
  errorAcks?: ReadonlySet<string>;
}) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT_CLASS[threadState(thread, errorAcks)] ?? "bg-muted-foreground/30",
      )}
      aria-hidden
    />
  );
}
