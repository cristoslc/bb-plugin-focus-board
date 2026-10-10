import { useCallback, useEffect, useState } from "react";
import {
  experimental_NewThreadComposer as NewThreadComposer,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { ThreadPaneThread } from "@/components/thread-pane";

/**
 * The fields of `threads.spawn`'s thread record that the board consumes for
 * the provisional pane row while the sidebar cache has not caught up yet.
 */
export interface SpawnedThread {
  id: string;
  title: string | null;
  titleFallback: string | null;
  status: ThreadPaneThread["status"];
  projectId: string;
}

/**
 * The board's own new-thread composer: bb's host compose surface in a
 * responsive dialog over the board and pane, so starting a thread never
 * leaves the board (and never opens bb's new-thread window). On submit the
 * request forwards verbatim to `threads.spawn`, which attributes the thread
 * to this plugin; the board opens the spawned thread in the pane.
 *
 * A parent preset (`parentThreadId`, from the card/pane "New child thread…"
 * actions) changes nothing about the compose surface — the child's prompt,
 * project and provider are the operator's choice as ever — except that the
 * spawned thread gains `parentThreadId`, making it a child of that thread
 * (the board nests it under its parent card). The dialog titles itself and
 * names the parent so the operator can see what will nest where.
 */
export function NewThreadModal({
  open,
  onOpenChange,
  defaultProjectId,
  defaultEnvironment,
  focusRequest,
  parentThreadId,
  parentThreadTitle,
  onMaximize,
  onSpawned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  /**
   * Seeds the composer's environment picker (from the preset parent's
   * worktree checkout, so the child lands where the parent runs); absent
   * seeds nothing and the composer resolves its own default.
   */
  defaultEnvironment?: NewThreadRequest["environment"];
  focusRequest?: number;
  /** The thread the new thread will spawn under; absent spawns at the root. */
  parentThreadId?: string;
  /** The parent's display title, for the dialog's "will nest under" hint. */
  parentThreadTitle?: string;
  /**
   * Maximize: expand this composer into bb's main new-thread view. The app
   * supplies the hand-off (seeds ride along, the stored prompt draft moves
   * — lib/compose-maximize) and omits it while a child preset is armed,
   * since the main view cannot spawn a nested thread; the button renders
   * only when the hand-off exists.
   */
  onMaximize?: () => void;
  onSpawned: (thread: SpawnedThread) => void;
}) {
  const sdk = useSdk();
  const [spawnFailed, setSpawnFailed] = useState(false);
  // A stale error must not greet the next open.
  useEffect(() => {
    if (!open) setSpawnFailed(false);
  }, [open]);

  // SDK contract: the composer clears its draft when onSubmit resolves and
  // KEEPS it when it throws. A failed create must therefore surface the
  // error AND rethrow — swallowing it would silently wipe what the user
  // typed.
  const handleSubmit = useCallback(
    async (request: NewThreadRequest) => {
      // The compose surface does not know about parentage, so the child
      // parameter rides here: a parent preset adds `parentThreadId` to the
      // verbatim request — the one field `CreateThreadRequest` takes that
      // makes the spawned thread a child. No parent preset: the request
      // forwards verbatim, byte-for-byte the plain new-thread flow.
      const spawnArgs = parentThreadId !== undefined
        ? { ...request, parentThreadId }
        : request;
      try {
        const thread = await sdk.threads.spawn(spawnArgs);
        onOpenChange(false);
        onSpawned(thread);
      } catch (error) {
        setSpawnFailed(true);
        throw error;
      }
    },
    [sdk, onOpenChange, onSpawned, parentThreadId],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The composer's control row needs real width — bb's guidance is that
      it does not fit a ~420px column, so the dialog runs wider than the
      pane's default. */}
      <DialogContent className="max-w-3xl">
        {onMaximize ? (
          // Next to the dialog's own close (right-4): maximize expands this
          // composer into bb's main new-thread view — seeds and prompt text
          // ride along — without spending the draft on a spawn.
          <button
            type="button"
            onClick={onMaximize}
            aria-label="Maximize new thread"
            title="Open in the main new-thread view"
            className="absolute right-12 top-4 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon name="Maximize2" className="size-4" aria-hidden />
          </button>
        ) : null}
        <DialogHeader>
          <DialogTitle>{parentThreadId !== undefined ? "New child thread" : "New thread"}</DialogTitle>
          <DialogDescription>
            {parentThreadId !== undefined
              ? "Spawns under the named thread. Your draft is saved as you type, even if you close and come back later."
              : "Your draft is saved as you type, even if you close and come back later."}
          </DialogDescription>
          {parentThreadId !== undefined ? (
            // The nesting the submit will produce, named up front: the
            // operator sees where the child will land before spending the
            // prompt.
            <p
              data-new-child-hint=""
              className="text-xs font-medium text-muted-foreground"
            >
              <Icon name="Fork" className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
              Will nest under{" "}
              <span className="text-foreground">{parentThreadTitle ?? parentThreadId}</span>
            </p>
          ) : null}
        </DialogHeader>
        {spawnFailed ? (
          <p role="alert" className="text-sm text-destructive">
            bb could not start the thread. Your draft is kept — try again.
          </p>
        ) : null}
        <div className="max-h-[70vh] min-h-0 overflow-y-auto">
          <NewThreadComposer
            defaultProjectId={defaultProjectId}
            {...(defaultEnvironment !== undefined ? { defaultEnvironment } : {})}
            focusRequest={focusRequest}
            onSubmit={handleSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
