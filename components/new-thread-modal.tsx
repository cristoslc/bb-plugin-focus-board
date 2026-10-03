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
 */
export function NewThreadModal({
  open,
  onOpenChange,
  defaultProjectId,
  focusRequest,
  onSpawned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
  focusRequest?: number;
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
      try {
        const thread = await sdk.threads.spawn(request);
        onOpenChange(false);
        onSpawned(thread);
      } catch (error) {
        setSpawnFailed(true);
        throw error;
      }
    },
    [sdk, onOpenChange, onSpawned],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The composer's control row needs real width — bb's guidance is that
      it does not fit a ~420px column, so the dialog runs wider than the
      pane's default. */}
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New thread</DialogTitle>
          <DialogDescription>
            Compose and start a thread without leaving the board.
          </DialogDescription>
        </DialogHeader>
        {spawnFailed ? (
          <p role="alert" className="text-sm text-destructive">
            bb could not start the thread. Your draft is kept — try again.
          </p>
        ) : null}
        <div className="max-h-[70vh] min-h-0 overflow-y-auto">
          <NewThreadComposer
            defaultProjectId={defaultProjectId}
            focusRequest={focusRequest}
            onSubmit={handleSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
