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
  loadFallbackServices,
}: {
  onAutotitle: (target?: { pluginId: string; serviceId: string }) => Promise<string>;
  loadFallbackServices?: () => Promise<{
    selected: { pluginId: string; serviceId: string } | null;
    services: Array<{
      pluginId: string;
      serviceId: string;
      displayName: string;
      ready: boolean;
      message: string | null;
    }>;
  }>;
}) {
  const onRename = vi.fn(async () => {});
  render(
    createElement(EditableTitle, {
      title: "Old title",
      onRename,
      onAutotitle,
      loadFallbackServices,
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
    // A loader with an empty menu is the no-bridge-degrades shape: the modal
    // still opens, so the background (editor included) is aria-hidden while
    // it is up — query the editor by label, the button by attribute.
    renderEditor({
      onAutotitle,
      loadFallbackServices: async () => ({ selected: null, services: [] }),
    });
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    await waitFor(() =>
      expect(
        document.querySelector(`[aria-label*="401 invalid key"]`),
      ).not.toBeNull(),
    );
    expect(screen.getByLabelText("Thread title")).toBeTruthy();
  });
});
describe("title editor width", () => {
  it("spans the editor wrapper so no dead space sits between box and ✨", () => {
    renderEditor({ onAutotitle: async () => "New title" });
    const input = screen.getByRole("textbox", { name: "Thread title" });
    // The wrapper hosts the absolutely-placed ✨; an input without w-full
    // keeps its intrinsic ~20ch width and leaves the gap the width bug was.
    expect(input.className).toMatch(/\bw-full\b/);
  });
});

describe("auto-rename fallback modal", () => {
  const FALLBACK = {
    selected: { pluginId: "openrouter-inference", serviceId: "default" },
    services: [
      { pluginId: "openrouter-inference", serviceId: "default", displayName: "OpenRouter", ready: true, message: null },
      { pluginId: "other-plugin", serviceId: "alt", displayName: "Other service", ready: true, message: null },
      { pluginId: "bb-ai", serviceId: "cloud", displayName: "bb cloud", ready: false, message: "Sign in to your bb account" },
    ],
  };

  function failingRender(overrides?: {
    onAutotitle?: (target?: { pluginId: string; serviceId: string }) => Promise<string>;
  }) {
    return renderEditor({
      onAutotitle:
        overrides?.onAutotitle ??
        (async () => {
          throw new Error("OpenRouter: 401 invalid key");
        }),
      loadFallbackServices: async () => FALLBACK,
    });
  }

  it("a failed generation auto-opens a modal naming the reason", async () => {
    failingRender();
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    const modal = await screen.findByRole("dialog");
    expect(modal).toBeTruthy();
    expect(screen.getByText(/401 invalid key/)).toBeTruthy();
  });

  it("offers ready alternatives and routes the pick through the override", async () => {
    const onAutotitle = vi.fn(
      async (target?: { pluginId: string; serviceId: string }) => {
        if (target === undefined) throw new Error("OpenRouter: 401 invalid key");
        expect(target).toEqual({ pluginId: "other-plugin", serviceId: "alt" });
        return "Other title";
      },
    );
    const { onRename } = failingRender({ onAutotitle });
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    const option = await screen.findByRole("button", { name: /Other service/ });
    fireEvent.click(option);
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Other title"));
    // Success closes editor and modal.
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Thread title" }),
      ).toBeNull(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onAutotitle).toHaveBeenCalledTimes(2);
  });

  it("lists not-ready services as disabled rows naming their blocker", async () => {
    failingRender();
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    const row = await screen.findByRole("button", { name: /bb cloud/ });
    expect(row.disabled).toBe(true);
    expect(screen.getByText(/Sign in to your bb account/)).toBeTruthy();
  });

  it("excludes the failed selected service from the alternatives", async () => {
    failingRender();
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /^OpenRouter$/ })).toBeNull();
  });

  it("names why the thread's active model is not offered", async () => {
    failingRender();
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    await screen.findByRole("dialog");
    const row = screen.getByRole("button", { name: /active model/i });
    expect(row.disabled).toBe(true);
    expect(screen.getByText(/cannot invoke/i)).toBeTruthy();
  });

  it("lets the user rename manually from the modal", async () => {
    const onAutotitle = vi.fn(
      async () => {
        throw new Error("OpenRouter: 401 invalid key");
      },
    );
    const { onRename } = failingRender({ onAutotitle });
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    const manual = await screen.findByRole("textbox", { name: "Manual title" });
    fireEvent.change(manual, { target: { value: "Manual title" } });
    fireEvent.click(screen.getByRole("button", { name: /use this title/i }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("Manual title"));
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Thread title" }),
      ).toBeNull(),
    );
  });

  it("closes the modal without closing the editor", async () => {
    failingRender();
    fireEvent.click(screen.getByRole("button", { name: /auto-rename/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The editor stays open so the rename attempt is not lost.
    expect(screen.getByRole("textbox", { name: "Thread title" })).toBeTruthy();
  });
});
