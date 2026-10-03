import {
  useCallback,
  useEffect,
  useState,
} from "react";

import { ARCHIVE_UNITS } from "@/lib/duration";
import {
  DEFAULT_SWEEP_CONFIG,
  DONE_ARCHIVE_VALUE_CAP,
  IDLE_ARCHIVE_VALUE_CAP,
  type SweepConfig,
  type SweepConfigPatch,
} from "@/lib/sweep-config";
import { cn } from "@/lib/utils";
import {
  COARSE_POINTER_INPUT_HEIGHT_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { Input } from "@/components/ui/input";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";

/**
 * The sweep thresholds section on the plugin's settings detail page. bb's
 * host-rendered settings form draws one control per declared setting and
 * has no composite row, so each threshold's `[number] [unit]` pair renders
 * here instead: number input immediately left of the unit select, the pair
 * right-aligned, and the digits right-aligned so the count sits against the
 * unit it counts. Values persist through the plugin's own RPC (the
 * server's `sweep-config` KV row) — not through declarative settings.
 *
 * Dependencies arrive as props (config, save callback) so tests render the
 * section without SDK hooks; app.tsx supplies the wired wrapper.
 */

/** One threshold arm's static presentation facts. */
const ARMS = [
  {
    key: "done",
    valueKey: "doneArchiveValue",
    unitKey: "doneArchiveUnit",
    cap: DONE_ARCHIVE_VALUE_CAP,
    label: "Archive Done threads after",
    description:
      "How long a thread stays Done before the sweep offers to archive it. Default 2 days.",
  },
  {
    key: "idle",
    valueKey: "idleArchiveValue",
    unitKey: "idleArchiveUnit",
    cap: IDLE_ARCHIVE_VALUE_CAP,
    label: "Mark long-idle threads Done after",
    description:
      "How long a thread stays quiet before the sweep offers to mark it Done. Default 2 days.",
  },
] as const;

export type SweepThresholdsSettingsProps = {
  /** The effective stored config; null while it loads (defaults render,
   *  disabled). */
  config: SweepConfig | null;
  /** Load failure text; rendered in place of a silent blank section. */
  loadError: string | null;
  /** Persist a patch; resolves with the server's effective config, rejects
   *  with a message for the inline error line. */
  onSave: (patch: SweepConfigPatch) => Promise<SweepConfig>;
};

const SELECT_CLASS = cn(
  "rounded-md border border-input bg-transparent pl-2 pr-2",
  CONTROL_HOVER_TRANSITION,
  COARSE_POINTER_INPUT_HEIGHT_CLASS,
  COARSE_POINTER_TEXT_BASE_CLASS,
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

/** One `[number] [unit]` row. Owns its drafts; commits the count on
 *  blur/Enter and the unit on change, failing loud inline. */
function ThresholdRow({
  arm,
  value,
  unit,
  disabled,
  onCommit,
}: {
  arm: (typeof ARMS)[number];
  value: number;
  unit: string;
  disabled: boolean;
  onCommit: (
    valueKey: (typeof arm)["valueKey"] | (typeof arm)["unitKey"],
    value: number | string,
  ) => Promise<void>;
}) {
  const [valueDraft, setValueDraft] = useState(String(value));
  const [unitDraft, setUnitDraft] = useState(unit);
  const [rowError, setRowError] = useState<string | null>(null);

  // Follow prop changes only while the row is not being edited, so a save
  // resolving (or another panel's write landing) refreshes the fields
  // without clobbering mid-typing state.
  useEffect(() => {
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest("[data-threshold-row]") !== null) return;
    setValueDraft(String(value));
    setUnitDraft(unit);
  }, [value, unit]);

  const commitValue = async () => {
    const parsed = Number(valueDraft);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > arm.cap) {
      setRowError(`Count must be a whole number between 1 and ${arm.cap}.`);
      setValueDraft(String(value));
      return;
    }
    if (parsed === value) {
      setValueDraft(String(value));
      return;
    }
    try {
      await onCommit(arm.valueKey, parsed);
      setRowError(null);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : String(error));
      setValueDraft(String(value));
    }
  };

  const changeUnit = async (next: string) => {
    setUnitDraft(next);
    try {
      await onCommit(arm.unitKey, next);
      setRowError(null);
    } catch (error) {
      setRowError(error instanceof Error ? error.message : String(error));
      setUnitDraft(unit);
    }
  };

  return (
    <div
      data-threshold-row={arm.key}
      className="flex items-start justify-between gap-6 py-3"
    >
      <div className="min-w-0">
        <div className={cn("font-medium", COARSE_POINTER_TEXT_BASE_CLASS)}>
          {arm.label}
        </div>
        <div className={cn("text-muted-foreground", COARSE_POINTER_TEXT_SM_CLASS)}>
          {arm.description}
        </div>
        {rowError !== null && (
          <p data-sweep-row-error className="mt-1 text-[11px] text-destructive">
            {rowError}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Input
          data-sweep-value={arm.key}
          type="number"
          inputMode="numeric"
          min={1}
          max={arm.cap}
          step={1}
          disabled={disabled}
          className="w-16 text-right"
          aria-label={arm.label}
          value={valueDraft}
          onChange={(event) => setValueDraft(event.target.value)}
          onBlur={commitValue}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        <select
          data-sweep-unit={arm.key}
          aria-label={`${arm.label} (unit)`}
          disabled={disabled}
          className={SELECT_CLASS}
          value={unitDraft}
          onChange={(event) => void changeUnit(event.target.value)}
        >
          {ARCHIVE_UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SweepThresholdsSettings({
  config,
  loadError,
  onSave,
}: SweepThresholdsSettingsProps) {
  const shown = config ?? DEFAULT_SWEEP_CONFIG;
  const disabled = config === null;
  const onCommit = useCallback(
    async (key: string, value: number | string) => {
      await onSave({ [key]: value } as SweepConfigPatch);
    },
    [onSave],
  );

  return (
    <div className="text-sm">
      {loadError !== null && (
        <p data-sweep-load-error className="mb-2 text-[11px] text-destructive">
          {loadError}
        </p>
      )}
      <div className="divide-y">
        {ARMS.map((arm) => (
          <ThresholdRow
            key={arm.key}
            arm={arm}
            value={shown[arm.valueKey]}
            unit={shown[arm.unitKey]}
            disabled={disabled}
            onCommit={onCommit}
          />
        ))}
      </div>
    </div>
  );
}
