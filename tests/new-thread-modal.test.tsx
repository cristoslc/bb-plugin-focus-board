// @vitest-environment jsdom
// The board's in-board new-thread composer modal: renders bb's host
// NewThreadComposer inside the responsive dialog, spawns through the SDK on
// submit, closes and hands the new thread to the board on success, and keeps
// the modal (and the composer's draft) on failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NewThreadModal } from "../components/new-thread-modal";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";

const spawn = vi.fn();
const onOpenChange = vi.fn();
const onSpawned = vi.fn();

// The submit request is opaque to the modal (it forwards verbatim to
// spawn), so the test builds a minimal one and casts.
const REQUEST = {
  projectId: "proj_1",
  input: [],
} as unknown as NewThreadRequest;

// The spawn result fields the modal and the board's provisional pane row
// read; extra ThreadResponse fields are irrelevant here.
const SPAWNED = {
  id: "thr_new",
  title: null,
  titleFallback: "Fresh thread",
  status: "pending" as const,
  projectId: "proj_1",
};

let lastComposerProps: Record<string, unknown> | null = null;
let lastSubmitPromise: Promise<void> | null = null;

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // A stub composer: records the props it was seeded with and offers a
  // button that fires onSubmit, the way the host composer would on submit.
  experimental_NewThreadComposer: (props: Record<string, unknown>): ReactNode => {
    lastComposerProps = props;
    return createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          lastSubmitPromise = Promise.resolve(
            (props.onSubmit as (request: NewThreadRequest) => Promise<void>)(REQUEST),
          );
        },
      },
      "Stub composer submit",
    );
  },
  useSdk: () => ({ threads: { spawn } }),
}));

beforeEach(() => {
  spawn.mockReset();
  spawn.mockResolvedValue(SPAWNED);
  onOpenChange.mockReset();
  onSpawned.mockReset();
  lastComposerProps = null;
  lastSubmitPromise = null;
});

afterEach(cleanup);

function renderModal(
  {
    open = true,
    defaultProjectId,
    focusRequest,
  }: { open?: boolean; defaultProjectId?: string; focusRequest?: number } = {},
) {
  return render(
    createElement(NewThreadModal, {
      open,
      onOpenChange,
      defaultProjectId,
      focusRequest,
      onSpawned,
    }),
  );
}

const submitButton = () => {
  const button = document.querySelector<HTMLButtonElement>(
    'button[type="button"]:not([aria-label="Close"])',
  );
  if (button === null) throw new Error("stub composer submit button not rendered");
  return button;
};

describe("NewThreadModal", () => {
  it("renders the composer only while open", () => {
    const view = renderModal({ open: true });
    expect(view.getByText("Stub composer submit")).toBeTruthy();
    view.rerender(
      createElement(NewThreadModal, {
        open: false,
        onOpenChange,
        onSpawned,
      }),
    );
    expect(view.queryByText("Stub composer submit")).toBeNull();
  });

  it("seeds the composer with the project from the board filter", () => {
    renderModal({ defaultProjectId: "proj_a", focusRequest: 3 });
    expect(lastComposerProps).not.toBeNull();
    expect(lastComposerProps?.defaultProjectId).toBe("proj_a");
    expect(lastComposerProps?.focusRequest).toBe(3);
  });

  it("spawns on submit, closes the modal, and hands the thread to the board", async () => {
    renderModal();
    fireEvent.click(submitButton());
    await waitFor(() => {
      expect(onSpawned).toHaveBeenCalledWith(SPAWNED);
    });
    expect(spawn).toHaveBeenCalledWith(REQUEST);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("on failure keeps the modal open, reports the error, and keeps the draft", async () => {
    spawn.mockRejectedValue(new Error("spawn failed"));
    renderModal();
    fireEvent.click(submitButton());
    // The SDK keeps the composer draft only when onSubmit throws, so the
    // rejection must propagate out of the modal's handler.
    await expect(lastSubmitPromise).rejects.toThrow("spawn failed");
    await waitFor(() => {
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(onSpawned).not.toHaveBeenCalled();
    // The composer must still be mounted so the kept draft stays editable.
    expect(document.querySelector('button[type="button"]')).not.toBeNull();
  });
});
