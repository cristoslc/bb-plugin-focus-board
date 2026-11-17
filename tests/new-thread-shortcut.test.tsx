// @vitest-environment jsdom
// The board's New Thread shortcut: a configurable letter (default "C") opens
// the New Thread composer only while the board's own pane holds host focus and
// the keystroke happens in the board's own surface. Both halves are load
// bearing: another pane focused means the letter is not the board's, and a
// keystroke in the board's panel while its pane is focused is the feature.
//
// Inside that arming, the editable rules still decide what the letter may
// claim: a typed letter in an input, textarea, select, contenteditable
// surface, dialog or floating menu inserts text. The rules live in
// lib/shortcut-ownership.ts; the "/" search shortcut follows the same ones
// (tests/search-focus-slash.test.tsx).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
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

/** The layout shape the host reports: every pane with its id and the thread it
 *  shows (null for a non-thread pane, which is what a plugin panel is). */
type PaneLayout = {
  panes: { paneId: string; threadId: string | null; isFocused: boolean }[];
};

/** A split with the board in pane-1 and a thread page in pane-2, focused on
 *  whichever pane the test names. */
function splitLayout(focusedPaneId: string): PaneLayout {
  return {
    panes: [
      { paneId: "pane-1", threadId: null, isFocused: focusedPaneId === "pane-1" },
      {
        paneId: "pane-2",
        threadId: "thr_other",
        isFocused: focusedPaneId === "pane-2",
      },
    ],
  };
}

/** The board's own panel root, inside the host's pane container for it, as
 *  bb renders a plugin panel. */
function boardPane(paneId = "pane-1"): HTMLElement {
  const container = mount(element("div", { "data-split-pane-id": paneId }));
  return element("div", { "data-focus-board-panel": "" }, container);
}

/** A surface beside the board: another pane the document-level listener also
 *  hears (a native thread page, another plugin app). */
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

function pressKey(key: string, init?: KeyboardEventInit): KeyboardEvent {
  return pressOn(document.body, key, init);
}

function Harness({
  enabled,
  hotkey,
  onActivate,
  panel,
  layout,
}: {
  enabled: boolean;
  hotkey: string;
  onActivate: () => void;
  panel: Element | null;
  layout: PaneLayout | null;
}) {
  // The refs app.tsx holds: the panel element and the latest layout read, both
  // stable identities the listener reads at keystroke time.
  const panelRef = useRef<Element | null>(panel);
  panelRef.current = panel;
  const splitLayoutRef = useRef<PaneLayout | null>(layout);
  splitLayoutRef.current = layout;
  useNewThreadComposerShortcut({
    enabled,
    hotkey,
    onActivate,
    panelRef,
    splitLayoutRef,
  });
  return null;
}

function harness(
  enabled: boolean,
  options: {
    hotkey?: string;
    layout?: PaneLayout | null;
    panel?: Element | null;
  } = {},
): { onActivate: ReturnType<typeof vi.fn>; panel: HTMLElement } {
  const panel = options.panel === undefined ? boardPane() : options.panel;
  const onActivate = vi.fn();
  render(
    <Harness
      enabled={enabled}
      hotkey={options.hotkey ?? "c"}
      onActivate={onActivate}
      panel={panel}
      layout={options.layout ?? null}
    />,
  );
  return { onActivate, panel: panel as HTMLElement };
}

describe("useNewThreadComposerShortcut", () => {
  it("with the board's pane focused and nothing clicked yet, the configured key opens the composer and claims the event", () => {
    // The operator's ruling: "focused" is the board's pane holding host focus.
    // Nothing has been clicked, so the keystroke lands on the body; no element
    // anywhere owns the keyboard, so that keystroke is the board's.
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
    const event = pressKey("c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("a single-pane layout (no split reported) is the board's own pane", () => {
    const { onActivate } = harness(true);
    const event = pressKey("c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches its key case-insensitively (an uppercase C is the same key)", () => {
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
    const event = pressKey("C", { shiftKey: true });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("honors the configured key, not a hard-coded one", () => {
    const { onActivate } = harness(true, {
      hotkey: "n",
      layout: splitLayout("pane-1"),
    });
    pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    pressKey("n");
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("with the in-board pane open (enabled false), the configured key does nothing", () => {
    const { onActivate } = harness(false, { layout: splitLayout("pane-1") });
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("keys other than the configured one do nothing", () => {
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
    const event = pressKey("x");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a keystroke typed into an editable target stays text input", () => {
    const { onActivate, panel } = harness(true, {
      layout: splitLayout("pane-1"),
    });
    const target = element("textarea", {}, panel);
    const typed = pressOn(target, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a keystroke typed into a rich-text editor inserts the letter", () => {
    // The operator's bug: bb's composers are contenteditable, not textareas,
    // so the old guards let the hotkey claim every letter typed in one.
    const { onActivate, panel } = harness(true, {
      layout: splitLayout("pane-1"),
    });
    const editor = element("div", { contenteditable: "true" }, panel);
    const typed = pressOn(editor, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a keystroke typed into a rich-text editor's inner block inserts the letter", () => {
    const { onActivate, panel } = harness(true, {
      layout: splitLayout("pane-1"),
    });
    const editor = element("div", { contenteditable: "true" }, panel);
    const typed = pressOn(element("p", {}, editor), "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a div declared a textbox owns the letter", () => {
    const { onActivate, panel } = harness(true, {
      layout: splitLayout("pane-1"),
    });
    const textbox = element("div", { role: "textbox" }, panel);
    const typed = pressOn(textbox, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("a keystroke pressed in a pane that is not the board's does nothing", () => {
    // Another pane in bb shares the document, so a document-level listener
    // hears its keystrokes. The letter belongs to that pane's surface.
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
    const plain = element("div", {}, foreignPane());
    const event = pressOn(plain, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a keystroke pressed in a foreign pane's rich-text editor does nothing", () => {
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
    const editor = element("div", { contenteditable: "true" }, foreignPane());
    const event = pressOn(editor, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a keystroke on the board's own surface opens the composer", () => {
    const { onActivate, panel } = harness(true, {
      layout: splitLayout("pane-1"),
    });
    const event = pressOn(element("div", {}, panel), "c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("with a thread pane focused beside the board, the letter on nothing does nothing", () => {
    // The operator's narrowing: the letter is the board's only while the
    // board's own pane is the focused pane. A card click hands the thread to
    // bb's native pane and leaves `openThread` null, so the layout read is the
    // only thing that says the keyboard is parked beside the board.
    const { onActivate } = harness(true, { layout: splitLayout("pane-2") });
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("with a thread pane focused beside the board, a keystroke in the board's panel does nothing", () => {
    // Both halves are load bearing: a panel that is on screen in an unfocused
    // pane is not a surface that owns the keyboard.
    const { onActivate, panel } = harness(true, {
      layout: splitLayout("pane-2"),
    });
    const event = pressOn(element("div", {}, panel), "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a board panel the host does not name as a pane stays out of a split layout", () => {
    // A layout is reported but the panel sits outside every pane container
    // (another host version, a different mount): the board cannot prove it
    // holds focus, so it stands down rather than guess.
    const panelWithoutPane = mount(
      element("div", { "data-focus-board-panel": "" }),
    );
    const { onActivate } = harness(true, {
      layout: splitLayout("pane-1"),
      panel: panelWithoutPane,
    });
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("a layout with no focused pane leaves the letter alone", () => {
    const layout: PaneLayout = {
      panes: [
        { paneId: "pane-1", threadId: null, isFocused: false },
        { paneId: "pane-2", threadId: "thr_other", isFocused: false },
      ],
    };
    const { onActivate } = harness(true, { layout });
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("without a mounted panel there is no board to arm", () => {
    const { onActivate } = harness(true, { panel: null });
    const event = pressKey("c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("the layout read is live: focusing the thread pane takes the key away", () => {
    const onActivate = vi.fn();
    const panel = boardPane();
    const view = render(
      <Harness
        enabled
        hotkey="c"
        onActivate={onActivate}
        panel={panel}
        layout={splitLayout("pane-1")}
      />,
    );
    pressKey("c");
    expect(onActivate).toHaveBeenCalledTimes(1);
    view.rerender(
      <Harness
        enabled
        hotkey="c"
        onActivate={onActivate}
        panel={panel}
        layout={splitLayout("pane-2")}
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
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
    button.focus();
    // dispatch from inside the dialog element so closest() sees the ancestor
    const typed = pressOn(button, "c");
    expect(onActivate).not.toHaveBeenCalled();
    expect(typed.defaultPrevented).toBe(false);
  });

  it("modifier chords keep their platform meanings", () => {
    for (const extra of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
    ]) {
      const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
      const event = pressKey("c", extra);
      expect(onActivate).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      cleanup();
    }
  });

  it("an already-handled keystroke (defaultPrevented upstream) is not re-claimed", () => {
    const { onActivate } = harness(true, { layout: splitLayout("pane-1") });
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
