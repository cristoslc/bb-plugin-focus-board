// @vitest-environment jsdom
// The snooze picker dialog: one surface holding the preset ladder (quick
// picks that confirm immediately) and the custom datetime field (Confirm
// gated on a strictly future time). The menus carry a single "Snooze…"
// entry whose run lands here — this file pins what that run opens.
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SnoozeDialog } from "../components/snooze-dialog";
import { describeWakeAt } from "../lib/snooze";

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof SnoozeDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <SnoozeDialog
      threadTitle="Test thread"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe("snooze picker dialog", () => {
  it("carries the four preset quick-picks; a pick confirms its wake time immediately", () => {
    const { onConfirm } = renderDialog();
    for (const label of ["1 hour", "4 hours", "Tomorrow 9am", "1 week"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "4 hours" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const picked = onConfirm.mock.calls[0][0] as Date;
    const expected = new Date(Date.now() + 4 * 60 * 60 * 1000);
    expect(Math.abs(picked.getTime() - expected.getTime())).toBeLessThan(5000);
  });

  it("the custom field defaults to tomorrow 9am local and Confirm runs the picked time", () => {
    const { onConfirm } = renderDialog();
    const input = document.querySelector("[data-snooze-input]") as HTMLInputElement;
    const tomorrow9 = new Date();
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 0, 0, 0);
    expect(input.value).toBe(`${tomorrow9.getFullYear()}-${String(tomorrow9.getMonth() + 1).padStart(2, "0")}-${String(tomorrow9.getDate()).padStart(2, "0")}T09:00`);
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual(tomorrow9);
  });

  it("Confirm stays disabled for an empty or past custom time", () => {
    renderDialog();
    const input = document.querySelector("[data-snooze-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect((screen.getByRole("button", { name: "Snooze" }) as HTMLButtonElement).disabled).toBe(true);
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pad = (part: number) => String(part).padStart(2, "0");
    fireEvent.change(input, {
      target: {
        value: `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T09:00`,
      },
    });
    expect((screen.getByRole("button", { name: "Snooze" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Cancel closes without confirming", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("snooze picker dialog: edit mode (currentWakeAt set)", () => {
  it("titles Edit snooze, names the current wake, and presets confirm a changed wake", () => {
    const onConfirm = vi.fn();
    const onRemove = vi.fn();
    const currentWakeAt = Date.now() + 60 * 60 * 1000;
    render(
      <SnoozeDialog
        threadTitle="Test thread"
        currentWakeAt={currentWakeAt}
        onConfirm={onConfirm}
        onRemove={onRemove}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Edit snooze" })).toBeTruthy();
    expect(document.querySelector("[data-snooze-dialog]")?.textContent).toContain(
      `the current one is ${describeWakeAt(currentWakeAt, Date.now())}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow 9am" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("Remove wake-up call removes without confirming", () => {
    const onConfirm = vi.fn();
    const onRemove = vi.fn();
    render(
      <SnoozeDialog
        threadTitle="Test thread"
        currentWakeAt={Date.now() + 60 * 60 * 1000}
        onConfirm={onConfirm}
        onRemove={onRemove}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove wake-up call" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a fresh snooze keeps the Snooze thread title and hides the remove button", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Snooze thread" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove wake-up call" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});