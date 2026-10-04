import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { presetWakeAt, type SnoozePreset } from "../lib/snooze";

/**
 * The picker's quick-pick row: the same four presets the menus used to
 * carry flat, relocated here so one menu entry ("Snooze…") opens one
 * surface that holds the whole ladder plus the custom field.
 */
const PICKER_PRESETS: readonly { kind: SnoozePreset; label: string }[] = [
  { kind: "1h", label: "1 hour" },
  { kind: "4h", label: "4 hours" },
  { kind: "tomorrow9", label: "Tomorrow 9am" },
  { kind: "1week", label: "1 week" },
];

/**
 * Local-input format for `datetime-local` ("YYYY-MM-DDTHH:mm"): the input
 * wants wall-clock parts, never a UTC ISO string, so the default (tomorrow
 * 09:00) round-trips in the operator's timezone.
 */
function formatLocalInput(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface SnoozeDialogProps {
  /** The thread being snoozed; names it in the copy. */
  threadTitle: string;
  /**
   * Confirm with the picked wake time. The dialog unmounts via `onCancel`
   * (or any close path) — the parent owns the open state by rendering it.
   */
  onConfirm: (wakeAt: Date) => void;
  onCancel: () => void;
}

/**
 * The "Pick a time…" snooze dialog: a `datetime-local` picker defaulting to
 * tomorrow 09:00 local. Confirm is gated on a parsed time strictly in the
 * future — a past or empty value would be a snooze that wakes immediately or
 * never, so the button stays disabled instead.
 */
export function SnoozeDialog({ threadTitle, onConfirm, onCancel }: SnoozeDialogProps) {
  const [value, setValue] = useState<string>(() => {
    const when = new Date();
    when.setDate(when.getDate() + 1);
    when.setHours(9, 0, 0, 0);
    return formatLocalInput(when);
  });
  const parsed = value === "" ? NaN : new Date(value).getTime();
  const valid = !Number.isNaN(parsed) && parsed > Date.now();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" aria-describedby={undefined} data-snooze-dialog="">
        <DialogHeader>
          <DialogTitle>Snooze thread</DialogTitle>
          <DialogDescription className="truncate">
            “{threadTitle}” becomes unread at the chosen time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {PICKER_PRESETS.map((preset) => (
            <Button
              key={preset.kind}
              variant="outline"
              size="sm"
              data-snooze-preset={preset.kind}
              onClick={() => onConfirm(presetWakeAt(preset.kind, new Date()))}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Or pick a specific time:</p>
        <input
          type="datetime-local"
          aria-label="Wake time"
          data-snooze-input=""
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        />
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} data-snooze-cancel="">
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => {
              if (!valid) return;
              onConfirm(new Date(parsed));
            }}
            data-snooze-confirm=""
          >
            Snooze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}