import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  THREAD_OPEN_TARGET_LABELS,
  type ThreadOpenTarget,
} from "@/lib/thread-open-target";
import { cn } from "@/lib/utils";

/**
 * The one-time question the board asks a fresh install: where should a card
 * click put its thread?
 *
 * It is the in-flow half of the `threadOpenTarget` setting (server.ts): the
 * board paints first and the dialog arrives after it, once bb's settings store
 * has answered and the host has settled as one that can split. Answering
 * writes the same declared value the configuration page and the gear modal
 * edit, and closing without answering keeps the shipping behaviour, the split
 * pane. The board stores that default the moment the dialog opens, so a reload
 * mid-answer never asks twice (app.tsx owns that write).
 *
 * The copy avoids the board's own vocabulary ("native", "split layout",
 * "in-panel"): an operator picks where the thread appears, not a mechanism.
 * The two labels come from the shared table so this dialog, the modal row, and
 * any future surface cannot name the same choice differently.
 */
export function OpenPreferenceDialog({
  open,
  onAnswer,
  onDismiss,
  error = null,
}: {
  open: boolean;
  /** Called with the chosen surface; the board writes it and closes. */
  onAnswer: (target: ThreadOpenTarget) => void;
  /** Closing without choosing keeps today's behaviour (the split pane). */
  onDismiss: () => void;
  /** A failed write's reason, shown inline so the answer is never lost quietly. */
  error?: string | null;
}) {
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent className="max-w-lg" data-open-preference-dialog>
        <DialogHeader>
          <DialogTitle>Where should threads open?</DialogTitle>
          <DialogDescription>
            A card opens its thread beside the board or inside it. Pick the one
            you want, and change it any time in Focus Board settings.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <ChoiceButton
            target="beside"
            hint="Keeps what the board does today."
            onAnswer={onAnswer}
            current
          />
          <ChoiceButton target="panel" onAnswer={onAnswer} />
        </div>
        {error !== null && (
          <p className="text-xs text-destructive" role="alert">
            Saving failed: {error}
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            aria-label="Keep the current setup"
            onClick={onDismiss}
            className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Keep the current setup
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One choice: the user-facing label, where the thread ends up, and a
 *  "Default" mark on the shipping behaviour. */
function ChoiceButton({
  target,
  hint,
  onAnswer,
  current = false,
}: {
  target: ThreadOpenTarget;
  hint?: string;
  onAnswer: (target: ThreadOpenTarget) => void;
  current?: boolean;
}) {
  const detail =
    target === "beside"
      ? "The thread opens in its own pane next to the board, so you can read it and keep the board in view."
      : "The thread opens inside the board's panel, and the window stays a single pane.";
  return (
    <button
      type="button"
      aria-label={THREAD_OPEN_TARGET_LABELS[target]}
      onClick={() => onAnswer(target)}
      className={cn(
        "flex flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        current
          ? "border-primary/60 bg-accent/40 hover:bg-accent/60"
          : "border-input hover:bg-accent/40",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        {THREAD_OPEN_TARGET_LABELS[target]}
        {current ? (
          <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            Default
          </span>
        ) : null}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {detail}
      </span>
      {hint !== undefined ? (
        <span className="text-[11px] text-muted-foreground/80">{hint}</span>
      ) : null}
    </button>
  );
}
