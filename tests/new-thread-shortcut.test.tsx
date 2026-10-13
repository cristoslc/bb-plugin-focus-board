// @vitest-environment jsdom
// The board's New Thread shortcut: a configurable key (default "C") opens the
// New Thread composer while the overview board is showing with no pane open.
// It stays inert inside a pane, while typing in an editable target, inside a
// dialog, and under modifier chords — the same ownership rules the "/"
// search-focus shortcut follows (tests/search-focus-slash.test.tsx).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  newThreadShortcutKeyFromSetting,
} from "../components/preferences";
import { useNewThreadComposerShortcut } from "../hooks/use-new-thread-shortcut";

afterEach(cleanup);

function Harness({
  enabled,
  hotkey,
  onActivate,
}: {
  enabled: boolean;
  hotkey: string;
  onActivate: () => void;
}) {
  useNewThreadComposerShortcut({ enabled, hotkey, onActivate });
  return null;
}

function pressKey(key: string, init?: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
}

function harness(
  enabled: boolean,
  hotkey = "c",
): { onActivate: ReturnType<typeof vi.fn> } {
  const onActivate = vi.fn();
  render(
    <Harness enabled={enabled} hotkey={hotkey} onActivate={onActivate} />,
  );
  return { onActivate };
}

describe("useNewThreadComposerShortcut", () => {
  it("with no pane open, the configured key opens the composer and claims the event", () => {
    const { onActivate } = harness(true);
    const event = pressKey("c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches its key case-insensitively (an uppercase C is the same key)", () => {
    const { onActivate } = harness(true, "c");
    const event = pressKey("C", { shiftKey: true });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("honors the configured key, not a hard-coded one", () => {
    const { onActivate } = harness(true, "n");
    pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    pressKey("n");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("with the pane open (enabled false), the configured key does nothing", () => {
    const { onActivate } = harness(false);
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("keys other than the configured one do nothing", () => {
    const { onActivate } = harness(true);
    const event = pressKey("x");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a keystroke typed into an editable target stays text input", () => {
    const { onActivate } = harness(true);
    const scratch = document.createElement("textarea");
    document.body.appendChild(scratch);
    const typed = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    scratch.dispatchEvent(typed);
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a keystroke pressed inside an open dialog is left to the dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    const { onActivate } = harness(true);
    button.focus();
    const typed = new KeyboardEvent("keydown", {
      key: "c",
      bubbles: true,
      cancelable: true,
    });
    // dispatch from inside the dialog element so closest() sees the ancestor
    (button as EventTarget).dispatchEvent(typed);
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("modifier chords keep their platform meanings", () => {
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
    ]) {
      const { onActivate } = harness(true);
      const event = pressKey("c", extra);
      expect(onActivate).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      cleanup();
    }
  });

  it("an already-handled keystroke (defaultPrevented upstream) is not re-claimed", () => {
    const { onActivate } = harness(true);
    const capture = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", capture, { capture: true });
    const event = pressKey("c");
    document.removeEventListener("keydown", capture, { capture: true });
    expect(event.defaultPrevented).toBe(true);
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("newThreadShortcutKeyFromSetting", () => {
  it("unset (loading) falls back to the C default", () => {
    expect(newThreadShortcutKeyFromSetting(undefined)).toBe("c");
  });

  it("a non-string stored value falls back to the default, never a coercion", () => {
    for (const foreign of [true, false, 42, null]) {
      expect(newThreadShortcutKeyFromSetting(foreign as never)).toBe("c");
    }
  });

  it("an explicit empty string turns the shortcut off (null)", () => {
    expect(newThreadShortcutKeyFromSetting("")).toBe(null);
  });

  it("a single letter or digit is used, normalized to lowercase", () => {
    expect(newThreadShortcutKeyFromSetting("N")).toBe("n");
    expect(newThreadShortcutKeyFromSetting("z")).toBe("z");
    expect(newThreadShortcutKeyFromSetting("7")).toBe("7");
  });

  it("anything longer than one character is a foreign value: the default applies", () => {
    expect(newThreadShortcutKeyFromSetting("cn")).toBe("c");
    expect(newThreadShortcutKeyFromSetting("command")).toBe("c");
  });

  it("a foreign non-alphanumeric character falls back to the default", () => {
    for (const foreign of ["*", " ", "-", "/", "\\u00e9"]) {
      expect(newThreadShortcutKeyFromSetting(foreign)).toBe("c");
    }
  });
});