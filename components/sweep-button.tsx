import { Icon } from "@/components/ui/icon";
import {
  SWEEP_DESTINATION_LABELS,
  SWEEP_SETTLED_WORDS,
  type SweepDestination,
} from "../lib/sweep";
import { cn } from "../lib/utils";

/** The running pill's aria-label word: what the sweep has done so far. */
export const settledSoFar = (destination: SweepDestination): string =>
  `${SWEEP_SETTLED_WORDS[destination]} so far`;

/**
 * The sweep pill. One component serves every sweepable surface — the Focus
 * view's column headers and the Parent view's row rail — so the affordance,
 * its states, and its wording cannot drift apart between the two boards.
 *
 * A sweepable lane or row carries the pill only while it has something to
 * propose: an armed sweep, a running one, or at least one eligible thread.
 * The manual arms (Pinned, Unread, the fresher idle buckets) therefore rest
 * bare until the operator arms them from the lane menu's "Sweep this lane…",
 * and a preselecting arm such as Done rests bare while its eligible set is
 * empty (ruling dl-20261105T165850-324f). With no pre-selection the button is
 * icon-only; armed, it confirms whatever the operator's live selection holds,
 * and an empty selection cannot confirm. The broom is the pill's only glyph
 * and the word "Sweep" appears nowhere: the word repeated on every column
 * header read as noise, and the broom plus the count (plus the destination,
 * armed) carries the meaning at a glance.
 */
export function SweepButton({
  eligibleCount,
  isArmed,
  run,
  destination,
  scope = "column",
  truncates = false,
  onArm,
  onConfirm,
}: {
  /** Threads past the threshold — the pre-selection a new sweep mode starts with. */
  eligibleCount: number;
  isArmed: boolean;
  run: { done: number; total: number } | null;
  /** Where a confirmed sweep sends this lane's or row's candidates. */
  destination: SweepDestination;
  /**
   * Which surface the accessible labels name. A column header's sweep and a
   * row rail's sweep are the same gesture on different things, so the
   * spoken sentence has to say which ("from this column" / "from this row").
   */
  scope?: "column" | "row";
  /**
   * The truncating form, for the Parent view's 104px rail: the pill gives up
   * width to the row label and the rail's count line instead of overflowing
   * into the lanes. The accessible name always carries the whole sentence.
   */
  truncates?: boolean;
  onArm: () => void;
  onConfirm: () => void;
}) {
  const destinationLabel = SWEEP_DESTINATION_LABELS[destination];
  const settledWord = settledSoFar(destination);
  if (run !== null) {
    return (
      <button
        type="button"
        data-sweep-button=""
        disabled
        aria-label={`Sweeping: ${run.done} of ${run.total} threads ${settledWord}`}
        className={cn(
          "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded bg-amber-500/90 px-1.5 text-[10px] font-medium text-amber-950",
          truncates ? "min-w-0 max-w-full" : "shrink-0 cursor-default",
        )}
      >
        <Icon name="Spinner" className="size-3 shrink-0 animate-spin" aria-hidden />
        <span className={truncates ? "truncate" : undefined}>
          {run.done} of {run.total}
        </span>
      </button>
    );
  }
  const inert = isArmed && eligibleCount === 0;
  return (
    <button
      type="button"
      data-sweep-button=""
      aria-pressed={isArmed}
      disabled={inert}
      aria-label={
        isArmed
          ? inert
            ? "Confirm sweep: no threads selected; click cards to add them"
            : `Confirm sweep of ${eligibleCount} threads from this ${scope} to ${destinationLabel}; click away to disarm`
          : eligibleCount > 0
            ? `Arm sweep for this ${scope}: ${eligibleCount} eligible threads`
            : "Enter sweep mode: click cards to select threads to sweep"
      }
      onClick={(event) => {
        event.stopPropagation();
        if (isArmed) onConfirm();
        else onArm();
      }}
      className={cn(
        "inline-flex h-5 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[10px] font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        truncates ? "min-w-0 max-w-full" : "shrink-0",
        isArmed
          ? "bg-amber-500/90 text-amber-950 hover:bg-amber-500"
          : "text-muted-foreground/70 hover:bg-accent/60 hover:text-foreground",
        inert && "cursor-default opacity-60",
      )}
    >
      <Icon name="Broom" className="size-3 shrink-0" aria-hidden />
      {isArmed || eligibleCount > 0 ? (
        <span className={truncates ? "truncate" : undefined}>
          {isArmed
            ? `${eligibleCount} → ${destinationLabel}`
            : eligibleCount}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The sweep's exit, beside the pill: during a run it stops before the next
 * action; in an idle armed mode it leaves sweep mode. One button serves both,
 * labeled per state, on both boards.
 */
export function SweepCancelButton({
  running,
  onClick,
}: {
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-sweep-cancel=""
      aria-label={running ? "Cancel sweep" : "Exit sweep mode"}
      title={
        running
          ? "Cancel: the current thread finishes, nothing else is swept"
          : "Exit sweep mode"
      }
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon name="X" className="size-3" aria-hidden />
    </button>
  );
}
