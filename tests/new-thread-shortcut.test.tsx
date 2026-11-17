// @vitest-environment jsdom
// The board's New Thread shortcut: a configurable key (default "C") opens the
// New Thread composer while the overview board is showing with no pane open.
// It stays inert while typing in an editable target (inputs, textareas,
// selects, and rich-text contenteditable surfaces — the composer and the
// thread pane's editors are the latter), inside a pane that is not the
// board's, inside a dialog, and under modifier chords — the same ownership
// rules the "/" search-focus shortcut follows
// (tests/search-focus-slash.test.tsx). The rules live in
// lib/shortcut-ownership.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  newThreadShortcutKeyFromSetting,
} from "../components/preferences";
import { useNewThreadComposerShortcut } from "../hooks/use-new-thread-shortcut";

/** Scratch DOM the tests append to document.body (panes, editors, dialogs).
 *  Removed per test so one case's surface never owns the next one's keys. */
const scratch: HTMLElement[] = [];

afterEach(() => {
  cleanup();
  for (const node of scratch.splice(0)) node.remove();
});

function mount(element: HTMLElement): HTMLElement {
  document.body.appendChild(element);
  scratch.push(element);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (parent !== undefined) parent.appendChild(node);
  return node;
}

/** The board's own panel root, as app.tsx renders it. */
function boardPanel(): HTMLElement {
  return mount(element("div", { "data-focus-board-panel": "" }));
}

/** A surface beside the board: another pane the document-level listener also
 *  hears (a native thread pane, another plugin app). */
function foreignPane(): HTMLElement {
  return mount(element("div", { "data-testid": "foreign-pane" }));
}

function pressOn(
  target: EventTarget,
  key: string,
  init?: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function Harness({
  enabled,
  hotkey,
  onActivate,
  threadPaneFocused,
}: {
  enabled: boolean;
  hotkey: string;
  onActivate: () => void;
  threadPaneFocused: boolean;
}) {
  useNewThreadComposerShortcut({
    enabled,
    hotkey,
    onActivate,
    threadPaneFocused,
  });
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
  threadPaneFocused = false,
): { onActivate: ReturnType<typeof vi.fn> } {
  const onActivate = vi.fn();
  render(
    <Harness
      enabled={enabled}
      hotkey={hotkey}
      onActivate={onActivate}
      threadPaneFocused={threadPaneFocused}
    />,
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

  it("a keystroke typed into a rich-text editor inserts the letter", () => {
    // The operator's bug: bb's composers are contenteditable, not textareas,
    // so the old guards let the hotkey claim every letter typed in one.
    const { onActivate } = harness(true);
    const editor = element("div", { contenteditable: "true" });
    boardPanel().appendChild(editor);
    const typed = pressOn(editor, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a keystroke typed into a rich-text editor's inner block inserts the letter", () => {
    const { onActivate } = harness(true);
    const editor = element("div", { contenteditable: "true" });
    const paragraph = element("p", {}, editor);
    boardPanel().appendChild(editor);
    const typed = pressOn(paragraph, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a div declared a textbox owns the letter", () => {
    const { onActivate } = harness(true);
    const textbox = element("div", { role: "textbox" });
    boardPanel().appendChild(textbox);
    const typed = pressOn(textbox, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a keystroke pressed in a pane that is not the board's does nothing", () => {
    // Another pane in bb shares the document, so a document-level listener
    // hears its keystrokes. The letter belongs to that pane's surface.
    const { onActivate } = harness(true);
    const pane = foreignPane();
    const plain = element("div", {}, pane);
    const event = pressOn(plain, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a keystroke pressed in a foreign pane's rich-text editor does nothing", () => {
    const { onActivate } = harness(true);
    const editor = element("div", { contenteditable: "true" }, foreignPane());
    const event = pressOn(editor, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a keystroke on the board's own surface with nothing focused inside it opens the composer", () => {
    // The feature: the board is where the keystroke happened, so the letter
    // is the board's to act on even though no element holds focus.
    const { onActivate } = harness(true);
    const panel = boardPanel();
    const event = pressOn(element("div", {}, panel), "c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("with a native thread pane focused beside the board, a keystroke on nothing does nothing", () => {
    // The native-pane half: a card click hands the thread to bb's own pane
    // and leaves `openThread` null, so the layout is the only read that says
    // the keyboard is parked beside the board. Nothing is focused in that
    // state, so the keystroke lands on the body — no text is being typed
    // anywhere, and the board leaves it alone.
    const { onActivate } = harness(true, "c", true);
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("with a native thread pane focused, a keystroke on the board's own surface still opens the composer", () => {
    // The board is where the keystroke happened, so the letter is still the
    // board's: the layout read only decides the no-focus case.
    const { onActivate } = harness(true, "c", true);
    const event = pressOn(element("div", {}, boardPanel()), "c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("the layout read is live: closing the native pane gives the key back", () => {
    const onActivate = vi.fn();
    const view = render(
      <Harness
        enabled
        hotkey="c"
        onActivate={onActivate}
        threadPaneFocused
      />,
    );
    pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    view.rerender(
      <Harness
        enabled
        hotkey="c"
        onActivate={onActivate}
        threadPaneFocused={false}
      />,
    );
    pressKey("c");
    expect(onActivate).toHaveBeenCalledTimes(1);
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