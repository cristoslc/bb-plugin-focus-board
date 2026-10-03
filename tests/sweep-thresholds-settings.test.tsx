// @vitest-environment jsdom
// The sweep thresholds settings section: each threshold draws as ONE row —
// `[number] [unit]` side by side, the number immediately left of the unit —
// counts commit on blur/Enter and are validated inline, units commit on
// change, and every failure reverts the draft and says so instead of
// silently keeping a value the server refused.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SweepThresholdsSettings } from "../components/sweep-thresholds-settings";
import type { SweepConfig, SweepConfigPatch } from "../lib/sweep-config";

const CONFIG: SweepConfig = {
  doneArchiveValue: 2,
  doneArchiveUnit: "days",
  idleArchiveValue: 3,
  idleArchiveUnit: "weeks",
};

function valueInput(arm: "done" | "idle"): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(`[data-sweep-value="${arm}"]`);
  if (input === null) throw new Error(`missing value input for ${arm}`);
  return input;
}

function unitSelect(arm: "done" | "idle"): HTMLSelectElement {
  const select = document.querySelector<HTMLSelectElement>(`[data-sweep-unit="${arm}"]`);
  if (select === null) throw new Error(`missing unit select for ${arm}`);
  return select;
}

function rowError(arm: "done" | "idle"): string | null {
  const row = document.querySelector(`[data-threshold-row="${arm}"]`);
  const line = row?.querySelector("[data-sweep-row-error]");
  return line?.textContent ?? null;
}

function renderSection(overrides: {
  config?: SweepConfig | null;
  loadError?: string | null;
  onSave?: (patch: SweepConfigPatch) => Promise<SweepConfig>;
} = {}) {
  const onSave =
    overrides.onSave ??
    (async (patch: SweepConfigPatch) => ({ ...CONFIG, ...patch }));
  const view = render(
    <SweepThresholdsSettings
      config={overrides.config === undefined ? CONFIG : overrides.config}
      loadError={overrides.loadError ?? null}
      onSave={onSave}
    />,
  );
  return { onSave, ...view };
}

afterEach(cleanup);

describe("the sweep thresholds section", () => {
  it("renders both arms as [number] [unit] pairs, number before unit", () => {
    renderSection();
    for (const arm of ["done", "idle"] as const) {
      const row = document.querySelector(`[data-threshold-row="${arm}"]`);
      if (row === null) throw new Error(`missing row ${arm}`);
      const controls = row.querySelectorAll("[data-sweep-value], [data-sweep-unit]");
      expect(controls).toHaveLength(2);
      // Side by side in one row: the count field first, the unit select
      // immediately after it.
      expect(controls[0].getAttribute("data-sweep-value")).toBe(arm);
      expect(controls[1].getAttribute("data-sweep-unit")).toBe(arm);
    }
    expect(valueInput("done").value).toBe("2");
    expect(unitSelect("done").value).toBe("days");
    expect(valueInput("idle").value).toBe("3");
    expect(unitSelect("idle").value).toBe("weeks");
  });

  it("commits an edited count on blur and reports the effective config", async () => {
    const onSave = vi.fn(async (patch: SweepConfigPatch) => ({ ...CONFIG, ...patch }));
    renderSection({ onSave });
    fireEvent.change(valueInput("done"), { target: { value: "14" } });
    fireEvent.blur(valueInput("done"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ doneArchiveValue: 14 }));
    await waitFor(() => expect(valueInput("done").value).toBe("14"));
  });

  it("commits an edited count on Enter", async () => {
    const onSave = vi.fn(async (patch: SweepConfigPatch) => ({ ...CONFIG, ...patch }));
    renderSection({ onSave });
    const input = valueInput("idle");
    input.focus();
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ idleArchiveValue: 9 }));
  });

  it("rejects an out-of-range count inline without calling the save", async () => {
    const onSave = vi.fn(async (patch: SweepConfigPatch) => ({ ...CONFIG, ...patch }));
    renderSection({ onSave });
    fireEvent.change(valueInput("done"), { target: { value: "366" } });
    fireEvent.blur(valueInput("done"));
    expect(onSave).not.toHaveBeenCalled();
    expect(rowError("done")).toContain("between 1 and 365");
    // The draft reverts to the stored value.
    expect(valueInput("done").value).toBe("2");
  });

  it("commits a unit change immediately", async () => {
    const onSave = vi.fn(async (patch: SweepConfigPatch) => ({ ...CONFIG, ...patch }));
    renderSection({ onSave });
    fireEvent.change(unitSelect("done"), { target: { value: "hours" } });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ doneArchiveUnit: "hours" }));
    await waitFor(() => expect(unitSelect("done").value).toBe("hours"));
  });

  it("reverts a unit change and shows the server's refusal", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("the server refused the write");
    });
    renderSection({ onSave });
    fireEvent.change(unitSelect("idle"), { target: { value: "hours" } });
    await waitFor(() => expect(rowError("idle")).toContain("the server refused the write"));
    expect(unitSelect("idle").value).toBe("weeks");
  });

  it("renders defaults disabled while the config loads", () => {
    renderSection({ config: null });
    expect(valueInput("done").disabled).toBe(true);
    expect(unitSelect("idle").disabled).toBe(true);
    expect(valueInput("done").value).toBe("2");
  });

  it("shows a load failure instead of failing silently", () => {
    renderSection({ loadError: "Could not load the sweep thresholds." });
    expect(screen.getByText("Could not load the sweep thresholds.")).toBeTruthy();
  });

  it("follows a config change once no row is being edited", async () => {
    const { rerender } = renderSection();
    rerender(
      <SweepThresholdsSettings
        config={{ ...CONFIG, doneArchiveValue: 7 }}
        loadError={null}
        onSave={async (patch) => ({ ...CONFIG, ...patch })}
      />,
    );
    await waitFor(() => expect(valueInput("done").value).toBe("7"));
  });
});
