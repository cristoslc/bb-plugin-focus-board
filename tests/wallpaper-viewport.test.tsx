// @vitest-environment jsdom
// The wallpaper viewport in its final shape: two layers, no more. The base
// layer is the wallpaper image itself at its own aspect; the top layer is a
// mocked-up board — a rectangle at the BOARD's aspect ratio whose position
// and size over the image show exactly which parts and how much of the
// image will fill the board. Under "contain" the window can overhang the
// image (the bars become visible). Dragging reframes, pinching rezones,
// and the lane/card silhouettes ride inside the board window at scale.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WallpaperViewport, cropWindowOf, focusForCropWindowCenter } from "../components/wallpaper-viewport";
import type { BoardGeometry } from "../components/wallpaper-viewport";
import type { WallpaperLayer } from "../components/preferences";

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => rect(left, top, width, height),
  } as DOMRect;
}

function stubImageBoxRect(width: number, height: number): HTMLElement {
  const imageBox = document.querySelector("[data-wallpaper-imagebox]") as HTMLElement;
  Object.defineProperty(imageBox, "getBoundingClientRect", { value: () => rect(0, 0, width, height), configurable: true });
  return imageBox;
}

const GEOMETRY: BoardGeometry = {
  aspect: 2,
  lanes: [{ x: 0, y: 0, w: 0.3, h: 1 }],
  cards: [{ x: 0.05, y: 0.1, w: 0.4, h: 0.4 }],
};

afterEach(cleanup);

describe("cropWindowOf (pure crop math)", () => {
  it("a fully-fitted paint puts the whole board window over the whole image", () => {
    // equal aspects, contain, zoom 1: the board shows the entire image.
    expect(cropWindowOf({ boardAspect: 2, imageAspect: 2, fit: "contain", zoom: 1, focusX: 50, focusY: 50 })).toEqual({
      x: 0, y: 0, w: 1, h: 1,
    });
  });

  it("cover crops the overflow axis; the window keeps the board's ratio", () => {
    // board 2 wide, image 1.5: cover fills, cropping top/bottom.
    const windowRect = cropWindowOf({ boardAspect: 2, imageAspect: 1.5, fit: "cover", zoom: 1, focusX: 50, focusY: 50 });
    expect(windowRect).toEqual({ x: 0, y: 0.125, w: 1, h: 0.75 });
    // In image px: (w * imageAspect) / h must equal the board's aspect.
    expect((windowRect.w * 1.5) / windowRect.h).toBeCloseTo(2, 9);
  });

  it("contain can overhang the image: the board window is bigger than the image where bars go", () => {
    // image is wider than the board: it fills the width, bars stack below the
    // top-aligned image, so only the height overhangs.
    expect(cropWindowOf({ boardAspect: 1.5, imageAspect: 2, fit: "contain", zoom: 1, focusX: 0, focusY: 0 })).toEqual({
      x: 0, y: 0, w: 1, h: 1.3333333333333333,
    });
  });

  it("zoom shrinks the window from the middle at a neutral focal point", () => {
    expect(cropWindowOf({ boardAspect: 2, imageAspect: 1.5, fit: "cover", zoom: 2, focusX: 50, focusY: 50 })).toEqual({
      x: 0.25, y: 0.3125, w: 0.5, h: 0.375,
    });
  });

  it("an off-center focal point slides the window along the image", () => {
    // cover, equal aspects, zoom 2: kw = kh = 0.5; focal x 0 pins the window left.
    const windowRect = cropWindowOf({ boardAspect: 2, imageAspect: 2, fit: "cover", zoom: 2, focusX: 0, focusY: 100 });
    expect(windowRect).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 });
  });
});

describe("focusForCropWindowCenter (pure inverse)", () => {
  it("recovers the focal point that centers the window at a target image point", () => {
    const focus = focusForCropWindowCenter({
      boardAspect: 2, imageAspect: 1.5, fit: "cover", zoom: 2,
      targetX: 0.3, targetY: 0.7, fallbackX: 0, fallbackY: 0,
    });
    expect(focus.focusX).toBeCloseTo(10, 9);
    expect(focus.focusY).toBeCloseTo(82, 9);
  });

  it("a fully-fitted axis is frozen: dragging along it keeps the stored focal point", () => {
    // equal aspects at zoom 1: kw = kh = 1, bg-position has no free space.
    const focus = focusForCropWindowCenter({
      boardAspect: 2, imageAspect: 2, fit: "contain", zoom: 1,
      targetX: 0.2, targetY: 0.9, fallbackX: 30, fallbackY: 40,
    });
    expect(focus).toEqual({ focusX: 30, focusY: 40 });
  });
});

describe("wallpaper viewport", () => {
  it("paints the image itself and the board window over it, silhouettes inside the window", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", focusX: 50, focusY: 50 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={1.5}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const imageBox = document.querySelector("[data-wallpaper-imagebox]") as HTMLElement;
    const image = imageBox.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://a/w.png");
    const cropWindow = screen.getByLabelText("Wallpaper crop window") as HTMLElement;
    expect(cropWindow.getAttribute("style")).toContain("left: 0%");
    expect(cropWindow.getAttribute("style")).toContain("top: 12.5%");
    expect(cropWindow.getAttribute("style")).toContain("width: 100%");
    expect(cropWindow.getAttribute("style")).toContain("height: 75%");
    const lane = cropWindow.querySelector('[data-wallpaper-silhouette="lane"]') as HTMLElement;
    expect(lane.getAttribute("style")).toContain("width: 30%");
    expect(lane.getAttribute("style")).toContain("height: 100%");
    const card = cropWindow.querySelector('[data-wallpaper-silhouette="card"]') as HTMLElement;
    expect(card.getAttribute("style")).toContain("left: 5%");
    expect(card.getAttribute("style")).toContain("top: 10%");
  });

  it("an image whose ratio is not yet known falls back to the board's aspect so the window stays exact", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0 }}
        dark={false}
        geometry={GEOMETRY}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const root = document.querySelector("[data-wallpaper-viewport]") as HTMLElement;
    // imageAspect falls back to the board's 2, contain fits fully: window covers everything.
    expect(root.getAttribute("style")).toContain("400"); // cap 200 x the board's aspect fallback of 2
    const cropWindow = screen.getByLabelText("Wallpaper crop window");
    expect(cropWindow.getAttribute("style")).toContain("width: 100%");
    expect(cropWindow.getAttribute("style")).toContain("height: 100%");
  });

  it("the crop window takes arrow keys for keyboard users", () => {
    const onFocusChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, zoom: 2, focusX: 50, focusY: 50 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={1.5}
        onFocusChange={onFocusChange}
        onZoomChange={vi.fn()}
      />,
    );
    const cropWindow = screen.getByLabelText("Wallpaper crop window");
    fireEvent.keyDown(cropWindow, { key: "ArrowLeft" });
    fireEvent.keyDown(cropWindow, { key: "ArrowDown" });
    expect(onFocusChange).toHaveBeenNthCalledWith(1, 48, 50);
    expect(onFocusChange).toHaveBeenNthCalledWith(2, 50, 52);
  });

  it("dragging reframes: the pointer position becomes the window's center", () => {
    const onFocusChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 2 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={1.5}
        onFocusChange={onFocusChange}
        onZoomChange={vi.fn()}
      />,
    );
    const imageBox = stubImageBoxRect(100, 100);
    fireEvent.pointerDown(imageBox, { pointerId: 1, clientX: 30, clientY: 70 });
    fireEvent.pointerMove(imageBox, { pointerId: 1, clientX: 50, clientY: 20 });
    fireEvent.pointerUp(imageBox, { pointerId: 1 });
    // Rounded: the exact floats come out of the inverse with fp noise.
    const calls = onFocusChange.mock.calls.map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(calls).toEqual([
      [10, 82],
      [50, 2],
    ]);
  });

  it("a two-pointer pinch scales zoom from the starting spread while the focal drag is frozen", () => {
    const onFocusChange = vi.fn();
    const onZoomChange = vi.fn();
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 1 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={4}
        onFocusChange={onFocusChange}
        onZoomChange={onZoomChange}
      />,
    );
    const imageBox = stubImageBoxRect(100, 100);
    fireEvent.pointerDown(imageBox, { pointerId: 1, clientX: 0, clientY: 50 });
    fireEvent.pointerDown(imageBox, { pointerId: 2, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(imageBox, { pointerId: 2, clientX: 80, clientY: 50 });
    fireEvent.pointerMove(imageBox, { pointerId: 2, clientX: 400, clientY: 50 }); // far past max zoom
    fireEvent.pointerUp(imageBox, { pointerId: 2 });
    expect(onZoomChange.mock.calls).toEqual([[2], [4]]);
    // The initial press focused (focal x clamps to the edge); the pinch re-focused nothing.
    expect(onFocusChange).toHaveBeenCalledTimes(1);
    expect(onFocusChange).toHaveBeenCalledWith(0, 50);
  });

  it("after a pinch ends, the remaining pointer drags focus on the still-stored zoom factor", () => {
    const onFocusChange = vi.fn();
    const onZoomChange = vi.fn();
    const view = render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 1 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={4}
        onFocusChange={onFocusChange}
        onZoomChange={onZoomChange}
      />,
    );
    const imageBox = stubImageBoxRect(100, 100);
    fireEvent.pointerDown(imageBox, { pointerId: 1, clientX: 0, clientY: 50 });
    fireEvent.pointerDown(imageBox, { pointerId: 2, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(imageBox, { pointerId: 2, clientX: 80, clientY: 50 });
    fireEvent.pointerUp(imageBox, { pointerId: 2 });
    // The real parent commits the zoom and re-renders; the harness replays that:
    view.rerender(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 2 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={4}
        onFocusChange={onFocusChange}
        onZoomChange={onZoomChange}
      />,
    );
    fireEvent.pointerMove(imageBox, { pointerId: 1, clientX: 35, clientY: 60 });
    expect(onZoomChange).toHaveBeenCalledWith(2);
    const [lastX, lastY] = onFocusChange.mock.calls.at(-1) ?? [NaN, NaN];
    expect(Math.round(lastX)).toBe(30);
    expect(Math.round(lastY)).toBe(70);
  });
});