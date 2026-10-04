// @vitest-environment jsdom
// The thread pane's title editor carries a ✨ auto-rename button inside the
// input's own rectangle: clicking it asks the server for a generated title
// and commits the rename when one arrives. Failure keeps the editor open
// with the error surfaced on the button (fail loud, no silent degrade).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditableTitle } from "../components/thread-pane";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: (): ReactNode => null,
  useSdk: () => ({}),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
}));

afterEach(cleanup);

function renderEditor({
  onAutotitle,
}: {
  onAutotitle: () => Promise<string>;
}) {
  const onRename = vi.fn(async () => {});
  render(
    createElement(EditableTitle, {
      title: "Old title",
      onRename,
      onAutotitle,
    }),
  );
  // Enter edit mode first.
  fireEvent.click(screen.getByTitle("Rename thread"));
  return { onRename };
}

describe("title editor auto-rename button", () => {
  it("shows the ✨ button inside the input's rectangle once editing", () => {
    renderEditor({ onAutotitle: async () => "New title" });
    const button = screen.getByRole("button", { name: /auto-rename/i });
    const input = screen.getByRole("textbox", { name: "Thread title" });
    // The button and input share a wrapper, so the button can sit inside
    // the rectangle the input draws.
    expect(button.parentElement).toBe(input.parentElement!);
  });

  it("reserves input padding so typed text cannot run under the button", () => {
    renderEditor({ onAutotitle: async () => "New title" });
    const input = screen.getByRole("textbox", { name: "Thread title" });
    expect(input.className).toMatch(/pr-\S+/);
  });

  it("clicking ✨ commits the generated rename and closes the editor", async () => {
    const onAutotitle = vi.fn(async () => "Generated title");
    const { onRename } = renderEditor({ onAutotitle });
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Generated title"));
    // Committing closes the editor: the rename happened without Enter.
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Thread title" }),
      ).toBeNull(),
    );
  });

  it("shows a spinner while generating and blocks re-clicks", async () => {
    let resolve!: (title: string) => void;
    const onAutotitle = vi.fn(
      () => new Promise<string>((r) => (resolve = r)),
    );
    renderEditor({ onAutotitle });
    const button = screen.getByRole("button", { name: /auto-rename/i });
    fireEvent.click(button);
    // In flight: the button disables so a second click cannot stack requests.
    await waitFor(() => expect(button.disabled).toBe(true));
    resolve("Generated title");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "Thread title" })).toBeNull(),
    );
    expect(onAutotitle).toHaveBeenCalledTimes(1);
  });

  it("a failed generation leaves the editor open with the error on the button", async () => {
    const onAutotitle = vi.fn(async () => {
      throw new Error("OpenRouter: 401 invalid key");
    });
    renderEditor({ onAutotitle });
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /401 invalid key/ })).toBeTruthy(),
    );
    // The editor never self-committed a rename off the failed attempt.
    expect(screen.getByRole("textbox", { name: "Thread title" })).toBeTruthy();
  });
});