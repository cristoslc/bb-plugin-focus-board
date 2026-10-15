// @vitest-environment jsdom
// The wallpaper viewport: a scaled replica of the board panel (its real
// aspect ratio) painting the active wallpaper with the exact crop math the
// board uses, translucent lane and card silhouettes at scale, and the two
// controls that want spatial precision, a draggable focus rectangle with
// pinch-to-zoom on the preview itself.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WallpaperViewport } from "../components/wallpaper-viewport";
import type { BoardGeometry } from "../components/wallpaper-viewport";
import type { WallpaperLayer } from "../components/preferences";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => rect(left, top, width, height),
  } as DOMRect;
}

function stubViewportRect(width: number, height: number): HTMLElement {
  const root = document.querySelector("[data-wallpaper-viewport]") as HTMLElement;
  Object.defineProperty(root, "getBoundingClientRect", { value: () => rect(0, 0, width, height) });
  return root;
}

const GEOMETRY: BoardGeometry = {
  windowAspect: 2,
  panel: { x: 0.25, y: 0, w: 0.75, h: 1 },
  lanes: [{ x: 0, y: 0, w: 0.3, h: 1 }],
  cards: [{ x: 0.05, y: 0.1, w: 0.4, h: 0.4 }],
};

afterEach(cleanup);

describe("wallpaper viewport", () => {
  it("models the window frame: the paint spans the preview, and the board's porthole carries dim and silhouettes", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 2, focusX: 25, focusY: 75 }}
        dark={false}
        geometry={GEOMETRY}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const root = document.querySelector("[data-wallpaper-viewport]") as HTMLElement;
    expect(root.getAttribute("style")).toContain("aspect-ratio: 2");
    // The paint is the window frame's plane: one full-bleed layer.
    const paint = root.querySelector("[data-wallpaper-paint]") as HTMLElement;
    expect(paint.getAttribute("style")).toContain('url("https://a/w.png")');
    expect(paint.getAttribute("style")).toContain("background-size: cover");
    expect(paint.getAttribute("style")).toContain("transform: scale(2)");
    // The porthole repeats the board's own footprint as fractions of the
    // window, and the host chrome outside it is the theme background.
    const porthole = root.querySelector("[data-wallpaper-porthole]") as HTMLElement;
    expect(porthole.getAttribute("style")).toContain("left: 25%");
    expect(porthole.getAttribute("style")).toContain("top: 0%");
    expect(porthole.getAttribute("style")).toContain("width: 75%");
    expect(porthole.getAttribute("style")).toContain("height: 100%");
    expect(porthole.getAttribute("style")).toContain("box-shadow");
    // Lanes and cards stay panel-relative and place inside the porthole.
    const lane = root.querySelector('[data-wallpaper-silhouette="lane"]') as HTMLElement;
    expect(lane.getAttribute("style")).toContain("width: 30%");
    expect(lane.getAttribute("style")).toContain("height: 100%");
    expect(porthole.contains(lane)).toBe(true);
    const card = root.querySelector('[data-wallpaper-silhouette="card"]') as HTMLElement;
    expect(card.getAttribute("style")).toContain("left: 5%");
    expect(card.getAttribute("style")).toContain("top: 10%");
    expect(card.getAttribute("style")).toContain("width: 40%");
    expect(card.getAttribute("style")).toContain("height: 40%");
  });

  it("the porthole paints the dim scrim under the silhouettes, matching the board's scrim", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0.3 }}
        dark={false}
        geometry={GEOMETRY}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const dim = document.querySelector("[data-wallpaper-dim]") as HTMLElement;
    const porthole = document.querySelector("[data-wallpaper-porthole]") as HTMLElement;
    expect(porthole.contains(dim)).toBe(true);
    expect(porthole.querySelectorAll("[data-wallpaper-dim] ~ [data-wallpaper-silhouette]").length).toBeGreaterThan(0);
    expect(dim.getAttribute("style")).toContain("opacity: 0.3");
  });

  it("falls back to the window's aspect with no board and paints no silhouettes or porthole", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0 }}
        dark={false}
        geometry={null}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const root = document.querySelector("[data-wallpaper-viewport]") as HTMLElement;
    expect(root.getAttribute("style")).toContain(`aspect-ratio: ${String(window.innerWidth / window.innerHeight)}`);
    expect(root.querySelector("[data-wallpaper-silhouette]")).toBeNull();
    expect(root.querySelector("[data-wallpaper-porthole]")).toBeNull();
  });

  it("the focus rectangle marks the focal point and arrow keys nudge it", () => {
    const onFocusChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, zoom: 2, focusX: 50, focusY: 50 }}
        dark={false}
        geometry={null}
        onFocusChange={onFocusChange}
        onZoomChange={vi.fn()}
      />,
    );
    const handle = screen.getByRole("button", { name: "Wallpaper focus handle" });
    expect(handle.getAttribute("style")).toContain("left: 50%");
    expect(handle.getAttribute("style")).toContain("top: 50%");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(onFocusChange).toHaveBeenNthCalledWith(1, 48, 50);
    expect(onFocusChange).toHaveBeenNthCalledWith(2, 50, 52);
  });

  it("dragging the pointer moves the focal point to the pointer", () => {
    const onFocusChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0 }}
        dark={false}
        geometry={GEOMETRY}
        onFocusChange={onFocusChange}
        onZoomChange={vi.fn()}
      />,
    );
    const root = stubViewportRect(100, 100);
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 25, clientY: 75 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 50, clientY: 20 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 250, clientY: -20 }); // clamped to the box
    fireEvent.pointerUp(root, { pointerId: 1 });
    expect(onFocusChange.mock.calls).toEqual([
      [25, 75],
      [50, 20],
      [100, 0],
    ]);
  });

  it("a two-pointer pinch scales zoom from the starting spread, clamped, and freezes the focal drag", () => {
    const onFocusChange = vi.fn();
    const onZoomChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, zoom: 1 }}
        dark={false}
        geometry={GEOMETRY}
        onFocusChange={onFocusChange}
        onZoomChange={onZoomChange}
      />,
    );
    const root = stubViewportRect(100, 100);
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 0, clientY: 50 });
    fireEvent.pointerDown(root, { pointerId: 2, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 80, clientY: 50 });
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 160, clientY: 50 });
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 400, clientY: 50 }); // far past the max zoom
    fireEvent.pointerUp(root, { pointerId: 2 });
    expect(onZoomChange.mock.calls).toEqual([[2], [4], [4]]);
    // The press itself focused; the pinch never re-focused.
    expect(onFocusChange).toHaveBeenCalledTimes(1);
  });

  it("after a pinch ends, a remaining pointer keeps dragging focus on an already-pinch-zoomed factor", () => {
    const onFocusChange = vi.fn();
    const onZoomChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, zoom: 3 }}
        dark={false}
        geometry={GEOMETRY}
        onFocusChange={onFocusChange}
        onZoomChange={onZoomChange}
      />,
    );
    const root = stubViewportRect(100, 100);
    fireEvent.pointerDown(root, { pointerId: 1, clientX: 0, clientY: 50 });
    fireEvent.pointerDown(root, { pointerId: 2, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(root, { pointerId: 2, clientX: 80, clientY: 50 }); // ratio 2 x zoom 3 -> clamped 4
    fireEvent.pointerUp(root, { pointerId: 2 });
    fireEvent.pointerMove(root, { pointerId: 1, clientX: 30, clientY: 60 }); // back to focus drag
    expect(onZoomChange).toHaveBeenCalledWith(4);
    expect(onFocusChange).toHaveBeenLastCalledWith(30, 60);
  });
});