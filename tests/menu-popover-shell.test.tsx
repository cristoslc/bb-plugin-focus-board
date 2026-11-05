// @vitest-environment jsdom
// The shared right-click menu shell (components/menu-popover): the shell
// must use whatever height the window leaves it — a fixed pixel cap cuts a
// long menu to a partial-height popover even on a tall window — and it must
// read as a raised menu, not as one more card on the board.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MenuPopover } from "../components/menu-popover";

afterEach(cleanup);

function renderOpenMenu(entries = 3) {
  render(
    <MenuPopover open={{ x: 20, y: 20 }} onClose={() => {}} label="Thread actions" title="One thread">
      {Array.from({ length: entries }, (_, i) => (
        <button key={i} type="button" role="menuitem" onClick={() => {}}>
          Entry {i + 1}
        </button>
      ))}
    </MenuPopover>,
  );
  return screen.getByRole("menu");
}

function setViewport(height: number) {
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

describe("menu shell height", () => {
  it("allows the full window height (minus margins) when the window is tall", () => {
    setViewport(800);
    const menu = renderOpenMenu(40);
    expect(menu.style.maxHeight).toBe(`${800 - 16}px`);
  });

  it("still keeps a small margin on a short window", () => {
    setViewport(300);
    const menu = renderOpenMenu(40);
    expect(menu.style.maxHeight).toBe(`${300 - 16}px`);
  });
});

describe("menu shell stands apart from cards", () => {
  it("raises the shell above the card surface: the elevated shadow over the full-strength border cards use only at half", () => {
    setViewport(800);
    const menu = renderOpenMenu();
    expect(menu.className).toContain("shadow-lg");
    expect(menu.className).toContain("border-border");
    expect(menu.className).not.toContain("border-border/50");
  });

  it("separates the header line with its own rule so the shell reads as a menu, not a compact card", () => {
    setViewport(800);
    renderOpenMenu();
    const header = screen.getByText("One thread");
    expect(header.className).toContain("border-b");
  });
});

describe("menu shell behavior", () => {
  it("Escape closes the shell", () => {
    let closed = 0;
    render(
      <MenuPopover open={{ x: 20, y: 20 }} onClose={() => { closed += 1; }} label="Thread actions">
        <button type="button" role="menuitem">Entry</button>
      </MenuPopover>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closed).toBe(1);
  });

  it("a claimed Escape (the caller's own two-stage semantics) does not close the shell", () => {
    // The dropdown chips' contract: the first Escape acts inside the caller
    // (the chip wipes a typed filter; its create field cancels itself) and
    // the shell's close only comes from the caller's own hand.
    let closed = 0;
    render(
      <MenuPopover
        open={{ x: 20, y: 20 }}
        onClose={() => { closed += 1; }}
        label="Thread actions"
        onEscape={() => false}
      >
        <button type="button" role="menuitem">Entry</button>
      </MenuPopover>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closed).toBe(0);
  });

  it("a title is optional: the option-list popups render rows with no header line", () => {
    setViewport(800);
    render(
      <MenuPopover open={{ x: 20, y: 20 }} onClose={() => {}} label="View options">
        <button type="button" role="option">Focus</button>
      </MenuPopover>,
    );
    expect(document.querySelector(".border-b")).toBeNull();
  });

  it("the shell caps its height at the caller's rows cap when one is given", () => {
    setViewport(800);
    render(
      <MenuPopover open={{ x: 20, y: 20 }} onClose={() => {}} label="View options" maxHeight={320}>
        <button type="button" role="option">Focus</button>
      </MenuPopover>,
    );
    const menu = screen.getByRole("menu");
    expect(menu.style.maxHeight).toBe("320px");
  });
});