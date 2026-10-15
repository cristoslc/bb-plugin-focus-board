// @vitest-environment jsdom
// The window-anchored wallpaper paint: the board's wallpaper layer paints into
// a box equal to the browser window, offset by the plugin panel's viewport
// position, so the crop derives from the window's ratio and a thread pane
// toggle or sidebar drag only carves the porthole instead of refitting the
// image (issue #201). The measured frame falls back to the panel-scoped paint
// when nothing usable has been measured (still mounting, jsdom without real
// layout), which renders exactly the pre-window-framing layer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { RefObject } from "react";
import {
  WallpaperPaintLayer,
  useWallpaperPaintFrame,
  wallpaperPaintFrame,
} from "../components/wallpaper-paint";
import type { WallpaperLayer } from "../components/preferences";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => rect(left, top, width, height),
  } as DOMRect;
}

function stubWindow(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

const LAYER: WallpaperLayer = { url: "https://a/w.png", dim: 0.1, fit: "cover" };

afterEach(() => {
  cleanup();
  stubWindow(1024, 768);
});

describe("wallpaperPaintFrame (pure framing math)", () => {
  it("anchors the paint at the window's origin: the panel's viewport offset in, the window's box out", () => {
    expect(wallpaperPaintFrame(rect(320, 48, 960, 585), 1280, 633)).toEqual({
      left: -320,
      top: -48,
      width: 1280,
      height: 633,
    });
  });

  it("is blind to the panel's size, so no board resize can refit the crop", () => {
    // The thread pane opens/closes inside the panel; a sidebar drag shifts the
    // panel's box while the window holds. Whatever the panel's box reads, the
    // paint answers the window's box at the panel's own viewport position.
    expect(wallpaperPaintFrame(rect(320, 48, 960, 585), 1280, 633)).toEqual({
      left: -320, top: -48, width: 1280, height: 633,
    });
    expect(wallpaperPaintFrame(rect(320, 48, 2000, 300), 1280, 633)).toEqual({
      left: -320, top: -48, width: 1280, height: 633,
    });
    expect(wallpaperPaintFrame(rect(120, 0, 600, 500), 1280, 633)).toEqual({
      left: -120, top: 0, width: 1280, height: 633,
    });
  });

  it("returns null without measurements, and for a zero-area panel or window", () => {
    expect(wallpaperPaintFrame(null, 1280, 633)).toBeNull();
    expect(wallpaperPaintFrame(rect(320, 48, 0, 585), 1280, 633)).toBeNull();
    expect(wallpaperPaintFrame(rect(320, 48, 960, 585), 0, 633)).toBeNull();
    expect(wallpaperPaintFrame(rect(320, 48, 960, 585), 1280, 0)).toBeNull();
  });
});

describe("useWallpaperPaintFrame (panel-backed hook)", () => {
  it("measures the panel's viewport offset and the window's box, then follows resizes", () => {
    stubWindow(1280, 633);
    const panel = document.createElement("div");
    Object.defineProperty(panel, "getBoundingClientRect", {
      value: () => rect(320, 48, 960, 585),
      configurable: true,
    });
    const panelRef = { current: panel };
    function Probe() {
      const frame = useWallpaperPaintFrame(panelRef);
      return <div data-testid="probe">{frame === null ? "null" : JSON.stringify(frame)}</div>;
    }
    const view = render(<Probe />);
    expect(JSON.parse(view.getByTestId("probe").textContent ?? "")).toEqual({
      left: -320, top: -48, width: 1280, height: 633,
    });
    // The host resized the panel's box: the window frame answers the window's
    // box and the panel's viewport position, nothing else.
    stubWindow(1440, 900);
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(JSON.parse(view.getByTestId("probe").textContent ?? "")).toEqual({
      left: -320, top: -48, width: 1440, height: 900,
    });
  });

  it("falls back to null on a stale element and holds the last usable frame through a zero box", () => {
    stubWindow(1280, 633);
    const panel = document.createElement("div");
    let box: DOMRect = rect(320, 48, 960, 585);
    Object.defineProperty(panel, "getBoundingClientRect", { value: () => box, configurable: true });
    // A ref is stable by contract: hoisted, never rebuilt per render.
    const panelRef: RefObject<Element | null> = { current: panel };
    function Probe() {
      const frame = useWallpaperPaintFrame(panelRef);
      return <div data-testid="probe">{frame === null ? "null" : JSON.stringify(frame)}</div>;
    }
    const view = render(<Probe />);
    expect(view.getByTestId("probe").textContent).toBe(
      JSON.stringify({ left: -320, top: -48, width: 1280, height: 633 }),
    );
    // A transient zero-area panel (a host-driven remount beat) must not
    // collapse the paint back to the panel-scoped fallback.
    box = rect(0, 0, 0, 0);
    act(() => {
      fireEvent(window, new Event("resize"));
    });
    expect(view.getByTestId("probe").textContent).toBe(
      JSON.stringify({ left: -320, top: -48, width: 1280, height: 633 }),
    );
  });
});

describe("WallpaperPaintLayer (the board's wallpaper layer)", () => {
  it("paints into the window's box, offset by the panel's viewport position, clipped by the panel wrapper", () => {
    stubWindow(1280, 633);
    const panel = document.createElement("div");
    document.body.append(panel);
    Object.defineProperty(panel, "getBoundingClientRect", { value: () => rect(320, 48, 960, 585), configurable: true });
    const panelRef = { current: panel };
    const view = render(<WallpaperPaintLayer layer={LAYER} dark={false} panelRef={panelRef} />);
    const clip = view.container.firstElementChild as HTMLElement;
    expect(clip.className).toContain("overflow-hidden");
    const paint = clip.firstElementChild as HTMLElement;
    expect(paint.getAttribute("style")).toContain("left: -320px");
    expect(paint.getAttribute("style")).toContain("top: -48px");
    expect(paint.getAttribute("style")).toContain("width: 1280px");
    expect(paint.getAttribute("style")).toContain("height: 633px");
    expect(paint.getAttribute("style")).toContain('url("https://a/w.png")');
    expect(paint.getAttribute("style")).toContain("background-size: cover");
    expect(paint.className).not.toContain("inset-0");
  });

  it("with nothing measured yet, the paint is the panel-scoped inset-0 layer exactly as before", () => {
    const panelRef = { current: null };
    const view = render(<WallpaperPaintLayer layer={LAYER} dark={false} panelRef={panelRef} />);
    const clip = view.container.firstElementChild as HTMLElement;
    const paint = clip.firstElementChild as HTMLElement;
    expect(paint.className).toContain("inset-0");
    expect(paint.getAttribute("style")).toContain('url("https://a/w.png")');
    expect(paint.getAttribute("style")).not.toContain("width:");
  });
});