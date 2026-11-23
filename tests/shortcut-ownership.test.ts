// @vitest-environment jsdom
// The board's single-key ownership rule (lib/shortcut-ownership.ts), tested as
// a rule rather than through a hook: both shortcuts ("/" focuses board search,
// the configurable letter opens the New Thread composer) read it, so a hole
// here is a hole in both (tests/search-focus-slash.test.tsx and
// tests/new-thread-shortcut.test.tsx pin the gestures themselves).
//
// The arming half — the board's own pane is the focused pane in the host's
// split layout — and the target half — the keystroke happens in the board's own
// surface — are load bearing separately, and the OSS report of 2026-11-23
// ("/" dead with another pane open) was the second half refusing a keystroke
// bb had aimed at its own pane container. The host facts come from
// scripts/screenshot/probe-board-shortcut-focus.mjs on the installed 0.50.1
// build: the pane container carries `data-split-pane-id="<paneId>"` and
// `tabindex="-1"`, and a click anywhere inside the board focuses it.
import { afterEach, describe, expect, it } from "vitest";
import {
  boardOwnsKeystroke,
  boardPaneIsFocused,
  editableTargetOwnsKey,
  type SplitPaneLayoutView,
} from "../lib/shortcut-ownership";

/** Scratch DOM this suite appends to document.body; removed per test so one
 *  case's surface never owns the next one's keys. */
const scratch: HTMLElement[] = [];

afterEach(() => {
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

/** A split with the board in pane-1 and a thread page in pane-2, focused on
 *  whichever pane the test names (the host's report, threadId null for a
 *  plugin panel). */
function splitLayout(focusedPaneId: string | null): SplitPaneLayoutView {
  return {
    panes: [
      {
        paneId: "pane-1",
        threadId: null,
        isFocused: focusedPaneId === "pane-1",
      },
      {
        paneId: "pane-2",
        threadId: "thr_other",
        isFocused: focusedPaneId === "pane-2",
      },
    ],
  };
}

/** The board's panel root inside the host's pane container for it. */
function boardPane(paneId = "pane-1"): { panel: HTMLElement; container: HTMLElement } {
  const container = mount(
    element("div", { "data-split-pane-id": paneId, tabindex: "-1" }),
  );
  const panel = element("div", { "data-focus-board-panel": "" }, container);
  return { panel, container };
}

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe("boardPaneIsFocused", () => {
  it("names the board's pane by the container around the panel", () => {
    const { panel } = boardPane();
    expect(boardPaneIsFocused(splitLayout("pane-1"), panel)).toBe(true);
  });

  it("stands down when the layout's focused pane is the other one", () => {
    const { panel } = boardPane();
    expect(boardPaneIsFocused(splitLayout("pane-2"), panel)).toBe(false);
  });

  it("stands down when the layout names no focused pane", () => {
    const { panel } = boardPane();
    expect(boardPaneIsFocused(splitLayout(null), panel)).toBe(false);
  });

  it("stands down when the host does not name the panel's pane", () => {
    const panel = mount(element("div", { "data-focus-board-panel": "" }));
    expect(boardPaneIsFocused(splitLayout("pane-1"), panel)).toBe(false);
  });

  it("a null layout is a single pane, which is the board's", () => {
    const { panel } = boardPane();
    expect(boardPaneIsFocused(null, panel)).toBe(true);
  });

  it("no panel mounted is never a surface that owns a keystroke", () => {
    expect(boardPaneIsFocused(null, null)).toBe(false);
    expect(boardPaneIsFocused(splitLayout("pane-1"), null)).toBe(false);
  });
});

describe("boardOwnsKeystroke", () => {
  it("a keystroke inside the board's panel is the board's", () => {
    const { panel } = boardPane();
    const target = element("div", {}, panel);
    const event = keydown("/");
    target.dispatchEvent(event);
    expect(
      boardOwnsKeystroke(event, { panel, layout: splitLayout("pane-1") }),
    ).toBe(true);
  });

  it("a keystroke aimed at the host's pane container for the board is the board's", () => {
    // The report's shape: bb focuses its pane container on pointerdown, so
    // after a click inside the board the target is the container ABOVE the
    // panel root. It is the pane the layout named as the board's.
    const { panel, container } = boardPane();
    container.focus();
    expect(document.activeElement).toBe(container);
    expect(
      boardOwnsKeystroke(keydown("/"), { panel, layout: splitLayout("pane-1") }),
    ).toBe(true);
  });

  it("host chrome inside the board's pane is the board's", () => {
    const { panel, container } = boardPane();
    const headerButton = element("button", { type: "button" }, container);
    const event = keydown("/");
    headerButton.dispatchEvent(event);
    expect(
      boardOwnsKeystroke(event, { panel, layout: splitLayout("pane-1") }),
    ).toBe(true);
  });

  it("the other pane's container is never the board's", () => {
    const { panel } = boardPane();
    const other = mount(
      element("div", { "data-split-pane-id": "pane-2", tabindex: "-1" }),
    );
    const event = keydown("/");
    other.dispatchEvent(event);
    expect(
      boardOwnsKeystroke(event, { panel, layout: splitLayout("pane-1") }),
    ).toBe(false);
  });

  it("a body keystroke is the board's only while its pane holds focus", () => {
    const { panel } = boardPane();
    const onBody = () => {
      const event = keydown("/");
      document.body.dispatchEvent(event);
      expect(event.target).toBe(document.body);
      return event;
    };
    expect(
      boardOwnsKeystroke(onBody(), { panel, layout: splitLayout("pane-1") }),
    ).toBe(true);
    expect(
      boardOwnsKeystroke(onBody(), { panel, layout: splitLayout("pane-2") }),
    ).toBe(false);
  });

  it("a typed key inside an editable target stays text, even in the board's pane", () => {
    const { panel, container } = boardPane();
    for (const editable of [
      element("input", {}, container),
      element("textarea", {}, container),
      element("div", { contenteditable: "true" }, container),
      element("div", { role: "textbox" }, container),
    ]) {
      const event = keydown("/");
      editable.dispatchEvent(event);
      expect(editableTargetOwnsKey(editable)).toBe(true);
      expect(
        boardOwnsKeystroke(event, { panel, layout: splitLayout("pane-1") }),
      ).toBe(false);
    }
  });

  it("a dialog or an open menu owns its keys", () => {
    const { panel, container } = boardPane();
    const dialog = element("div", { role: "dialog" }, container);
    const inDialog = element("div", {}, dialog);
    const dialogEvent = keydown("/");
    inDialog.dispatchEvent(dialogEvent);
    expect(
      boardOwnsKeystroke(dialogEvent, { panel, layout: splitLayout("pane-1") }),
    ).toBe(false);
    const menu = element("div", { "data-radix-popper-content-wrapper": "" }, container);
    const inMenu = element("div", {}, menu);
    const menuEvent = keydown("/");
    inMenu.dispatchEvent(menuEvent);
    expect(
      boardOwnsKeystroke(menuEvent, { panel, layout: splitLayout("pane-1") }),
    ).toBe(false);
  });
});
