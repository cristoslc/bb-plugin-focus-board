// @vitest-environment jsdom
// The wallpaper viewport in its merged shape: two layers. The base layer is
// the wallpaper image at its own natural aspect; the top layer is the
// mocked-up board — the paint's frame box (the WINDOW's ratio, the box the
// board actually paints into since issue #201) placed and sized over the
// image by the same crop math the board runs, so the operator sees which
// parts and how much of the image fill the board. Inside that window: a
// clipped copy of the image at the paint's scale, the sampled letterbox
// canvas behind it, and the board's real footprint as a porthole carrying
// the host chrome spread, the dim scrim, and the lane/card silhouettes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WallpaperViewport, averageEdgeColor, cropWindowOf, focusForCropWindowCenter, wallpaperPreviewStyle } from "../components/wallpaper-viewport";
import type { BoardGeometry } from "../components/wallpaper-viewport";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

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

/** The window-framed geometry: a 2:1 window whose board panel carves the
 *  right three quarters of it. */
const GEOMETRY: BoardGeometry = {
  windowAspect: 2,
  panel: { x: 0.25, y: 0, w: 0.75, h: 1 },
  lanes: [{ x: 0, y: 0, w: 0.3, h: 1 }],
  cards: [{ x: 0.05, y: 0.1, w: 0.4, h: 0.4 }],
};

afterEach(cleanup);

describe("cropWindowOf (pure crop math)", () => {
  it("a fully-fitted paint puts the whole window over the whole image", () => {
    expect(cropWindowOf({ boardAspect: 2, imageAspect: 2, fit: "contain", zoom: 1, focusX: 50, focusY: 50 })).toEqual({
      x: 0, y: 0, w: 1, h: 1,
    });
  });

  it("cover crops the overflow axis; the window keeps the board's ratio", () => {
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
    const focus = focusForCropWindowCenter({
      boardAspect: 2, imageAspect: 2, fit: "contain", zoom: 1,
      targetX: 0.2, targetY: 0.9, fallbackX: 30, fallbackY: 40,
    });
    expect(focus).toEqual({ focusX: 30, focusY: 40 });
  });
});

describe("averageEdgeColor (pure edge sampler)", () => {
  it("averages the four edge rings of the sampled image into a hex color", () => {
    const size = 4;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        data[i] = edge ? 255 : 0;
        data[i + 1] = 0;
        data[i + 2] = edge ? 0 : 255;
        data[i + 3] = 255;
      }
    }
    expect(averageEdgeColor(data, size)).toBe("#ff0000");
  });

  it("mixed edges average channel-wise; empty or undersized samples refuse", () => {
    const data = new Uint8ClampedArray([
      10, 20, 30, 255,
      10, 20, 30, 255,
      10, 20, 30, 255,
      10, 20, 30, 255,
    ]);
    expect(averageEdgeColor(data, 2)).toBe("#0a141e");
    expect(averageEdgeColor(new Uint8ClampedArray(3), 4)).toBeNull();
    expect(averageEdgeColor(new Uint8ClampedArray(16), 0)).toBeNull();
  });
});

describe("wallpaper viewport", () => {
  it("models the window frame: the crop window is the window plane, and the board's porthole carries dim and silhouettes", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 2, focusX: 25, focusY: 75 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={2}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const root = document.querySelector("[data-wallpaper-viewport]") as HTMLElement;
    const imageBox = root.querySelector("[data-wallpaper-imagebox]") as HTMLElement;
    expect((imageBox.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("https://a/w.png");
    // The crop window: cover at zoom 2 about focal (25, 75) over an image
    // that matches the window's ratio. Its center lands at fx+(0.5-fx)*k =
    // (0.375, 0.625), so the corners are { x: .125, y: .375, w: .5, h: .5 }.
    const cropWindow = screen.getByLabelText("Wallpaper crop window") as HTMLElement;
    expect(cropWindow.getAttribute("style")).toContain("left: 12.5%");
    expect(cropWindow.getAttribute("style")).toContain("top: 37.5%");
    expect(cropWindow.getAttribute("style")).toContain("width: 50%");
    expect(cropWindow.getAttribute("style")).toContain("height: 50%");
    // The clipped paint copy spans the window at the paint's scale:
    // left = -x/w, top = -y/h, size = 1/w x 1/h.
    const copy = cropWindow.querySelector("[data-wallpaper-window-image]") as HTMLElement;
    expect(copy.getAttribute("style")).toContain("left: -25%");
    expect(copy.getAttribute("style")).toContain("top: -75%");
    expect(copy.getAttribute("style")).toContain("width: 200%");
    expect(copy.getAttribute("style")).toContain("height: 200%");
    // The porthole repeats the board's own footprint as fractions of the
    // window, and the host chrome outside it is the theme background.
    const porthole = cropWindow.querySelector("[data-wallpaper-porthole]") as HTMLElement;
    expect(porthole.getAttribute("style")).toContain("left: 25%");
    expect(porthole.getAttribute("style")).toContain("top: 0%");
    expect(porthole.getAttribute("style")).toContain("width: 75%");
    expect(porthole.getAttribute("style")).toContain("height: 100%");
    expect(porthole.getAttribute("style")).toContain("box-shadow");
    // Lanes and cards stay panel-relative and place inside the porthole.
    const lane = cropWindow.querySelector('[data-wallpaper-silhouette="lane"]') as HTMLElement;
    expect(lane.getAttribute("style")).toContain("width: 30%");
    expect(lane.getAttribute("style")).toContain("height: 100%");
    expect(porthole.contains(lane)).toBe(true);
    const card = cropWindow.querySelector('[data-wallpaper-silhouette="card"]') as HTMLElement;
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
        imageAspect={2}
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

  it("the board window paints the stored canvas color and a clipped copy of the image at the window's scale", () => {
    // contain overhang: window 1.5, image 2, focal top-left -> the window is
    // taller than the image, and the bars below the copy show the canvas.
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "contain", canvas: "#112233", focusX: 0, focusY: 0 }}
        dark={false}
        geometry={{ windowAspect: 1.5, panel: { x: 0, y: 0, w: 1, h: 1 }, lanes: [], cards: [] }}
        imageAspect={2}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const cropWindow = screen.getByLabelText("Wallpaper crop window") as HTMLElement;
    expect(cropWindow.style.backgroundColor).toBe("rgb(17, 34, 51)");
    const copy = cropWindow.querySelector("[data-wallpaper-window-image]") as HTMLElement;
    expect(copy.getAttribute("style")).toContain("left: 0%");
    expect(copy.getAttribute("style")).toContain("top: 0%");
    expect(copy.getAttribute("style")).toContain("width: 100%");
    expect(copy.getAttribute("style")).toContain("height: 75%");
  });

  it("under cover the clipped copy overflows past the window and the canvas never shows", () => {
    render(
      <WallpaperViewport
        layer={{ url: "https://a/w.png", dim: 0, fit: "cover", zoom: 2 }}
        dark={false}
        geometry={GEOMETRY}
        imageAspect={1.5}
        onFocusChange={vi.fn()}
        onZoomChange={vi.fn()}
      />,
    );
    const cropWindow = screen.getByLabelText("Wallpaper crop window") as HTMLElement;
    const copy = cropWindow.querySelector("[data-wallpaper-window-image]") as HTMLElement;
    expect(copy.getAttribute("style")).toContain("left: -50%");
    expect(copy.getAttribute("style")).toContain("width: 200%");
    // No canvas stored: the bars-less fallback rides the class.
    expect(cropWindow.className).toContain("bg-background");
  });

  it("falls back to the window's aspect with no board: no silhouettes or porthole, the window covering the image", () => {
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
    expect(root.querySelector("[data-wallpaper-silhouette]")).toBeNull();
    expect(root.querySelector("[data-wallpaper-porthole]")).toBeNull();
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
        geometry={null}
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

  it("sizes the preview to its container on a compact viewport (no rim overflow)", () => {
    // A phone-width picker cannot afford the desktop formula
    // `calc(min(100%, Xpx) + 48px)`: content-box plus 24px of padding each
    // side meant the preview painted 96px wider than the picker (the phone
    // report measured 254px of preview inside a 176px box). Compact sizes the
    // whole box with border-box, capped so the image itself stays under
    // VIEWPORT_MAX_HEIGHT (180px).
    expect(wallpaperPreviewStyle(2, true)).toEqual({
      boxSizing: "border-box",
      width: "min(100%, 408.00px)",
      padding: 24,
    });
    // The rim is inside the box, so the image keeps its 180px height cap:
    // 180px × aspect 2 = 360px of image plus 24px of rim on each side.
    expect(wallpaperPreviewStyle(2, true).width).toContain("408.00px");
  });

  it("keeps the desktop preview formula untouched (inverse)", () => {
    expect(wallpaperPreviewStyle(2, false)).toEqual({
      width: "calc(min(100%, 360.00px) + 48px)",
      padding: 24,
    });
  });

  it("renders the computed preview style on the root", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <WallpaperViewport
          layer={{ url: "https://a/w.png", dim: 0 }}
          dark={false}
          geometry={null}
          imageAspect={2}
          onFocusChange={vi.fn()}
          onZoomChange={vi.fn()}
        />
      </CompactViewportOverrideProvider>,
    );
    const root = document.querySelector("[data-wallpaper-viewport]") as HTMLElement;
    // jsdom's CSS parser cannot round-trip the calc()/min() expression, so
    // the contract is the shared style helper above plus the padding it
    // applies; the raw width string is proven in the pure test.
    expect(root.style.padding).toBe("24px");
  });
});