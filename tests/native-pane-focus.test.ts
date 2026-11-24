// @vitest-environment jsdom
// Pressing a split pane's own container to focus it, as a pure DOM helper.
//
// This is the lever the card click needs for a pane that shows NO thread — a
// page route like Decisions. bb focuses a pane in the container element's own
// pointer handler (`onPointerDown` → `onFocusPane(paneId)` on the workspace
// route's pane chrome), and `scripts/screenshot/probe-pane-focus-lever.mjs`
// measures exactly that on the live host:
//
//   - a bubbling `pointerdown` at the container moves the focus and marks the
//     pane `data-focused="true"`: the board's pane loses it, the page pane
//     takes it (phase 2);
//   - without `bubbles`, nothing happens, because bb's handler is delegated
//     above the element (same phase);
//   - `mousedown` alone does nothing (same phase).
//
// The click still treats a press as a REQUEST, never as a fact: the caller
// waits for the layout to show the focus moved before it navigates.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { paneContainer, pressPaneContainer } from "../lib/native-pane-focus";

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
});

function paneElement(paneId: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-split-pane-id", paneId);
  document.body.append(el);
  return el;
}

describe("pressing a pane container", () => {
  it("presses the container of the named pane, and only that one", () => {
    const board = paneElement("pane-1");
    const target = paneElement("pane-2");
    const pressed: string[] = [];
    for (const [paneId, el] of [["pane-1", board], ["pane-2", target]] as const) {
      el.addEventListener("pointerdown", () => pressed.push(paneId));
    }

    expect(pressPaneContainer(document, "pane-2")).toBe("pressed");
    expect(pressed).toEqual(["pane-2"]);
  });

  it("dispatches a bubbling pointer press, the shape the host's handler sees", () => {
    const target = paneElement("pane-2");
    let seen: PointerEvent | null = null;
    // bb's handler is delegated: the listener sits ABOVE the container, so the
    // event must bubble for it to run at all (measured: a non-bubbling
    // `pointerdown` focuses nothing).
    document.addEventListener("pointerdown", (event) => {
      seen = event as PointerEvent;
    });

    pressPaneContainer(document, "pane-2");

    expect(seen).not.toBeNull();
    const event = seen as PointerEvent | null;
    expect(event?.type).toBe("pointerdown");
    expect(event?.bubbles).toBe(true);
    expect(event?.button).toBe(0);
    expect(event?.pointerId).toBe(1);
    expect(event?.target).toBe(target);
    expect(event?.defaultPrevented).toBe(false);
  });

  it("answers no-pane-element when the pane has no container, and presses nothing", () => {
    const other = paneElement("pane-1");
    let heard = 0;
    document.addEventListener("pointerdown", () => {
      heard += 1;
    });

    expect(pressPaneContainer(document, "pane-2")).toBe("no-pane-element");
    expect(heard).toBe(0);
    expect(other.hasAttribute("data-pressed")).toBe(false);
  });

  it("answers no-pane-element for a blank id rather than pressing an unnamed pane", () => {
    const container = paneElement("pane-2");
    let heard = 0;
    document.addEventListener("pointerdown", () => {
      heard += 1;
    });

    expect(pressPaneContainer(document, "")).toBe("no-pane-element");
    expect(pressPaneContainer(document, "   ")).toBe("no-pane-element");
    expect(heard).toBe(0);
    expect(container.isConnected).toBe(true);
  });

  it("finds the pane by id, whatever it sits beside", () => {
    paneElement("pane-1");
    const dragged = paneElement("pane-4");
    paneElement("pane-9");

    expect(paneContainer(document, "pane-4")).toBe(dragged);
  });
});
