import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { HOST_PANEL_ATTR } from "./host-link-glue";
import { useIsCompactViewport } from "./ui/hooks/use-compact-viewport";
import {
  clampedWallpaperFocus,
  clampedWallpaperZoom,
  resolvedWallpaperUrl,
  type WallpaperFit,
  type WallpaperLayer,
} from "./preferences";

/** One measured element as a fraction of the reference box: x/y in [0, 1]
 *  from the box's top-left, w/h likewise. The viewport paints these
 *  directly as percentages, so no px math survives a preview resize. */
export interface RectFraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The live board's shape at measure time, read in the paint's frame space
 * (the window): the window's own aspect, the panel's footprint as fractions
 * of the window (the porthole the board carves out of the wallpaper), plus
 * the fraction-space rects of the visible lanes and threads' cards relative
 * to the panel box.
 */
export interface BoardGeometry {
  windowAspect: number;
  panel: RectFraction;
  lanes: readonly RectFraction[];
  cards: readonly RectFraction[];
}

/**
 * The board panel's geometry, read straight off the DOM: everything is a
 * getBoundingClientRect at read time, no layout is invented here. The panel's
 * box is read against the window's inner size, because that is the box the
 * board's own paint anchors to (issue #201's window framing). Null when
 * no panel paints in this document (or it paints with a zero box) — the
 * viewport then falls back to the window's own aspect.
 */
export function measureBoardGeometry(panel: Element | null): BoardGeometry | null {
  if (panel === null) return null;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  if (windowWidth <= 0 || windowHeight <= 0) return null;
  const box = panel.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const relative = (element: Element): RectFraction => {
    const rect = element.getBoundingClientRect();
    return {
      x: (rect.left - box.left) / box.width,
      y: (rect.top - box.top) / box.height,
      w: rect.width / box.width,
      h: rect.height / box.height,
    };
  };
  return {
    windowAspect: windowWidth / windowHeight,
    panel: {
      x: box.left / windowWidth,
      y: box.top / windowHeight,
      w: box.width / windowWidth,
      h: box.height / windowHeight,
    },
    lanes: Array.from(panel.querySelectorAll("[data-column-id]"), relative),
    cards: Array.from(panel.querySelectorAll("[data-thread-card]"), relative),
  };
}

/**
 * The live hook the picker renders from: one measure on mount, a settle
 * re-measure a beat later (cards may still be mid-teleport on open), then
 * window resizes and the panel's own ResizeObserver keep it fresh. jsdom
 * without ResizeObserver degrades to the resize listener only.
 */
export function useBoardGeometry(): BoardGeometry | null {
  const [geometry, setGeometry] = useState<BoardGeometry | null>(null);
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    const remeasure = () => {
      setGeometry(measureBoardGeometry(document.querySelector(`[${HOST_PANEL_ATTR}]`)));
    };
    remeasure();
    const settle = window.setTimeout(remeasure, 300);
    window.addEventListener("resize", remeasure);
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(remeasure);
      const panel = document.querySelector(`[${HOST_PANEL_ATTR}]`);
      if (panel !== null) observer.observe(panel);
    }
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    };
  }, []);
  return geometry;
}

/** The image-side fitted fractions of a paint: dw = the image's display
 *  width as a fraction of the board's width, dh likewise vertically.
 *  "contain" fits inside (a factor below 1 on the long axis); "cover"
 *  overflows (a factor above 1 on the long axis). */
function fittedFractions(
  boardAspect: number,
  imageAspect: number,
  fit: WallpaperFit | undefined,
): { dw: number; dh: number } {
  const ratio = imageAspect / boardAspect;
  if (fit === "cover") {
    return { dw: Math.max(1, ratio), dh: Math.max(1, 1 / ratio) };
  }
  return { dw: Math.min(1, ratio), dh: Math.min(1, 1 / ratio) };
}

/** The board's crop window over the image, as fractions of the image box in
 *  [0, 1] image space — values may leave [0, 1] where the board extends
 *  past an image edge (the letterbox bars). The window always carries the
 *  board's aspect ratio, whatever the fit, zoom, and focal point do. The
 *  board aspect is the WINDOW's ratio, because that is the box the board
 *  paints into (issue #201). */
export function cropWindowOf(opts: {
  boardAspect: number;
  imageAspect: number;
  fit?: WallpaperFit;
  zoom?: number;
  focusX?: number;
  focusY?: number;
}): RectFraction {
  const { dw, dh } = fittedFractions(opts.boardAspect, opts.imageAspect, opts.fit);
  const zoom = clampedWallpaperZoom(opts.zoom ?? 1);
  const kw = 1 / (zoom * dw);
  const kh = 1 / (zoom * dh);
  const fx = (opts.focusX ?? 50) / 100;
  const fy = (opts.focusY ?? 50) / 100;
  // background-position % puts (100−fx)% of the free space to the left, and
  // the transform scales around the board's focal percent, so the window
  // center lands at fx·(1−k) + 0.5·k in image space.
  const cx = fx + (0.5 - fx) * kw;
  const cy = fy + (0.5 - fy) * kh;
  return { x: cx - kw / 2, y: cy - kh / 2, w: kw, h: kh };
}

/** The inverse of `cropWindowOf`'s center: where must the focal percent sit
 *  for the window's center to reach a target image fraction. An axis whose
 *  window fraction is exactly 1 is fully fitted with no free background
 *  space, so dragging it cannot move anything — it keeps the stored value. */
export function focusForCropWindowCenter(opts: {
  boardAspect: number;
  imageAspect: number;
  fit?: WallpaperFit;
  zoom?: number;
  targetX: number;
  targetY: number;
  fallbackX: number;
  fallbackY: number;
}): { focusX: number; focusY: number } {
  const { dw, dh } = fittedFractions(opts.boardAspect, opts.imageAspect, opts.fit);
  const zoom = clampedWallpaperZoom(opts.zoom ?? 1);
  const kw = 1 / (zoom * dw);
  const kh = 1 / (zoom * dh);
  // fx·(1−k) + 0.5·k = target  =>  fx = (target − k/2)/(1 − k).
  const focusX = Math.abs(1 - kw) < 1e-9
    ? opts.fallbackX
    : clampedWallpaperFocus(((opts.targetX - kw / 2) / (1 - kw)) * 100);
  const focusY = Math.abs(1 - kh) < 1e-9
    ? opts.fallbackY
    : clampedWallpaperFocus(((opts.targetY - kh / 2) / (1 - kh)) * 100);
  return { focusX, focusY };
}

/**
 * Averages the four edge rings of a sampled image into one hex color: the
 * per-channel mean of every pixel that touches the sample's border. The
 * result is the letterbox canvas, so a bar looks like the image running
 * out instead of the theme background. Undersized samples refuse (null).
 */
export function averageEdgeColor(data: Uint8ClampedArray, size: number): string | null {
  if (!Number.isInteger(size) || size <= 0) return null;
  if (data.length < size * size * 4) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
      const i = (y * size + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
  }
  if (count === 0) return null;
  const channel = (sum: number) => Math.round(sum / count).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

interface ImageMeasure {
  status: "loading" | "error";
  ratio: number;
}

/** Reads the wallpaper image's natural aspect (an <img> load reports it
 *  without any pixel access, so no CORS is involved). jsdom never loads
 *  images, so the ratio stays 0 and callers fall back until a real browser
 *  reports. A failure is loud: the error state renders a message. */
function useWallpaperImageRatio(url: string): ImageMeasure {
  const [measure, setMeasure] = useState<ImageMeasure>({ status: "loading", ratio: 0 });
  useEffect(() => {
    let alive = true;
    setMeasure({ status: "loading", ratio: 0 });
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setMeasure({ status: "loading", ratio: image.naturalWidth / image.naturalHeight });
      } else {
        setMeasure({ status: "error", ratio: 0 });
      }
    };
    image.onerror = () => {
      if (alive) setMeasure({ status: "error", ratio: 0 });
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return measure;
}

/**
 * Samples the wallpaper's averaged edge color once per resolved url: a
 * CORS-clean copy loads (`crossOrigin="anonymous"`), draws into a small
 * offscreen canvas, and `averageEdgeColor` reads its border. A host
 * without CORS headers, a tainted canvas, or a missing 2d context yields
 * null — the canvas field then stays unset and the bars keep the theme
 * background (the sampling is best-effort; the paint never needs pixels).
 */
function useWallpaperEdgeColor(url: string): string | null {
  const [color, setColor] = useState<string | null>(null);
  useEffect(() => {
    if (url === "") {
      setColor(null);
      return;
    }
    let alive = true;
    setColor(null);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!alive || image.naturalWidth === 0 || image.naturalHeight === 0) return;
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (context === null) return;
      try {
        context.drawImage(image, 0, 0, size, size);
        const sampled = averageEdgeColor(context.getImageData(0, 0, size, size).data, size);
        if (alive && sampled !== null) setColor(sampled);
      } catch {
        // A tainted canvas (no CORS headers from the host) cannot be read;
        // the canvas field stays unset and the theme shows in the bars.
        return;
      }
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return color;
}

/** The preview's height cap: the widest the image paints before the width
 *  shrinks to hold the image's exact aspect. */
const VIEWPORT_MAX_HEIGHT = 180;
/** The rim around the image box where a board window may overhang (bar
 *  space) without colliding with neighboring picker content. */
const VIEWPORT_RIM = 24;

/**
 * The preview box's own size. The image is capped at VIEWPORT_MAX_HEIGHT
 * tall, and the rim around it leaves the crop window room to overhang.
 *
 * Desktop keeps the shipped content-box formula untouched: the padding adds
 * to the declared width, so the preview is always 96px wider than the image
 * cap it names. That overhang is harmless in the desktop dialog's wide panel
 * and changing it would shift a shipped surface's pixels.
 *
 * A compact viewport cannot afford it — the rim alone pushed the preview
 * past a phone-width picker (measured: 254px of preview inside a 176px
 * picker) — so the box takes `border-box` and its declared width carries the
 * rim inside the container's width, keeping the image under the same 180px
 * height cap.
 */
export function wallpaperPreviewStyle(
  imageAspect: number,
  compact: boolean,
): CSSProperties {
  const imageCap = (VIEWPORT_MAX_HEIGHT * imageAspect).toFixed(2);
  if (compact) {
    return {
      boxSizing: "border-box",
      width: `min(100%, ${(VIEWPORT_MAX_HEIGHT * imageAspect + VIEWPORT_RIM * 2).toFixed(2)}px)`,
      padding: VIEWPORT_RIM,
    };
  }
  return {
    width: `calc(min(100%, ${imageCap}px) + ${VIEWPORT_RIM * 2}px)`,
    padding: VIEWPORT_RIM,
  };
}

interface ViewportProps {
  /** The painted layer (null = no wallpaper: an empty outline). */
  layer: WallpaperLayer | null;
  dark: boolean;
  geometry: BoardGeometry | null;
  /** Test seams: the image's natural aspect / sampled edge color, both
   *  normally measured live in the browser. */
  imageAspect?: number;
  canvasColor?: string | null;
  onFocusChange: (x: number, y: number) => void;
  onZoomChange: (zoom: number) => void;
  /** Fired once the sampler has an edge color for the resolved url; the
   *  picker persists it into the layer's `canvas` field (deduped there). */
  onCanvasChange?: (color: string) => void;
}

/**
 * Two layers, no more. The base layer is the wallpaper image at its own
 * natural aspect. The top layer is the mocked-up board: the paint's frame
 * box (the window's ratio, the box the board actually paints into) placed
 * and sized over the image by the same crop math the board runs
 * (cropWindowOf), so the operator sees which parts and how much of the
 * image fill the board — the bars showing as window overhang. Inside that
 * window: a clipped copy of the image at the paint's scale, the sampled
 * letterbox canvas behind it, and the board's real footprint as a porthole
 * carrying the host chrome spread, the dim scrim, and the lane and card
 * silhouettes. One pointer drags the frame, two pinch zoom; the window
 * answers arrow keys.
 */
export function WallpaperViewport({
  layer,
  dark,
  geometry,
  imageAspect,
  canvasColor,
  onFocusChange,
  onZoomChange,
  onCanvasChange,
}: ViewportProps) {
  const imageBoxRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const isCompactViewport = useIsCompactViewport();
  const boardAspect = geometry?.windowAspect ?? window.innerWidth / window.innerHeight;
  const resolvedUrl = layer === null ? "" : resolvedWallpaperUrl(layer, dark);
  const measured = useWallpaperImageRatio(resolvedUrl);
  const sampledColor = useWallpaperEdgeColor(resolvedUrl);
  const edgeColor = canvasColor !== undefined ? canvasColor : sampledColor;
  // Once the sampler reports for this url, hand the color up; the picker
  // dedupes against the stored field, so this settles after one commit.
  useEffect(() => {
    if (layer !== null && edgeColor !== null && edgeColor !== layer.canvas) {
      onCanvasChange?.(edgeColor);
    }
  }, [edgeColor, layer, onCanvasChange]);
  const ratio = imageAspect ?? measured.ratio;
  const imageAspectValue = ratio > 0 ? ratio : boardAspect;
  const failed = layer !== null && imageAspect === undefined && measured.status === "error" && measured.ratio === 0;
  const windowRect =
    layer === null
      ? { x: 0, y: 0, w: 1, h: 1 }
      : cropWindowOf({
          boardAspect,
          imageAspect: imageAspectValue,
          fit: layer.fit,
          zoom: layer.zoom,
          focusX: layer.focusX,
          focusY: layer.focusY,
        });
  const dragFocusTo = (clientX: number, clientY: number) => {
    const rect = imageBoxRef.current?.getBoundingClientRect();
    if (rect === undefined || rect === null || rect.width <= 0 || rect.height <= 0) return;
    const next = focusForCropWindowCenter({
      boardAspect,
      imageAspect: imageAspectValue,
      fit: layer?.fit,
      zoom: layer?.zoom,
      targetX: clampedWallpaperFocus(((clientX - rect.left) / rect.width) * 100) / 100,
      targetY: clampedWallpaperFocus(((clientY - rect.top) / rect.height) * 100) / 100,
      fallbackX: layer?.focusX ?? 50,
      fallbackY: layer?.focusY ?? 50,
    });
    onFocusChange(next.focusX, next.focusY);
  };
  const pointerDown = (event: ReactPointerEvent) => {
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === "function") element.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      dragFocusTo(event.clientX, event.clientY);
    } else if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: layer?.zoom ?? 1 };
    }
  };
  const pointerMove = (event: ReactPointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinchStart.current !== null) {
      const start = pinchStart.current;
      const [a, b] = Array.from(pointers.current.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (start.distance > 0) {
        onZoomChange(clampedWallpaperZoom(start.zoom * (distance / start.distance)));
      }
    } else if (pointers.current.size === 1) {
      dragFocusTo(event.clientX, event.clientY);
    }
  };
  const pointerEnd = (event: ReactPointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  };
  return (
    <div
      data-wallpaper-viewport=""
      aria-label="Wallpaper viewport preview"
      className="relative mx-auto select-none"
      style={wallpaperPreviewStyle(imageAspectValue, isCompactViewport)}
    >
      {layer === null ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          No wallpaper
        </div>
      ) : failed ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          The wallpaper image failed to load, so the crop preview can't show it.
        </div>
      ) : (
        <div
          ref={imageBoxRef}
          data-wallpaper-imagebox=""
          className="relative touch-none cursor-crosshair"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
        >
          <img src={resolvedWallpaperUrl(layer, dark)} alt="" draggable={false} className="block w-full" />
          <div
            data-wallpaper-crop-window=""
            aria-label="Wallpaper crop window"
            title="The board over the image: drag on the preview to reframe, pinch to zoom"
            tabIndex={0}
            className={`absolute rounded-md border-2 border-ring outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              layer.canvas === undefined ? "bg-background" : ""
            }`}
            style={{
              left: `${windowRect.x * 100}%`,
              top: `${windowRect.y * 100}%`,
              width: `${windowRect.w * 100}%`,
              height: `${windowRect.h * 100}%`,
              backgroundColor: layer.canvas ?? edgeColor ?? undefined,
              overflow: "hidden",
            }}
            onKeyDown={(event) => {
              const step = 2;
              const focusX = layer.focusX ?? 50;
              const focusY = layer.focusY ?? 50;
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                onFocusChange(clampedWallpaperFocus(focusX - step), focusY);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                onFocusChange(clampedWallpaperFocus(focusX + step), focusY);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                onFocusChange(focusX, clampedWallpaperFocus(focusY - step));
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                onFocusChange(focusX, clampedWallpaperFocus(focusY + step));
              }
            }}
          >
            {/* The image as the board paints it, clipped to the window:
                fraction u of the image sits at (u − x)/w of the window, so
                the full image copy spans from −x/w, scaled by 1/w. Its
                overhang shows the canvas bars exactly where they paint. */}
            <img
              data-wallpaper-window-image=""
              src={resolvedWallpaperUrl(layer, dark)}
              alt=""
              draggable={false}
              className="absolute max-w-none"
              style={{
                left: `${(-windowRect.x / windowRect.w) * 100}%`,
                top: `${(-windowRect.y / windowRect.h) * 100}%`,
                width: `${(1 / windowRect.w) * 100}%`,
                height: `${(1 / windowRect.h) * 100}%`,
              }}
            />
            {geometry === null ? null : (
              <div
                data-wallpaper-porthole=""
                aria-hidden
                // The giant spread marks the host chrome around the board region:
                // the shadow covers the paint everywhere the board does not carve a
                // porthole out of the window plane, and the window's own
                // overflow-hidden keeps the spread inside the frame.
                className="absolute overflow-hidden rounded-md border border-foreground/10"
                style={{
                  left: `${geometry.panel.x * 100}%`,
                  top: `${geometry.panel.y * 100}%`,
                  width: `${geometry.panel.w * 100}%`,
                  height: `${geometry.panel.h * 100}%`,
                  boxShadow: "0 0 0 100000px var(--background)",
                }}
              >
                <div
                  data-wallpaper-dim=""
                  aria-hidden
                  className="absolute inset-0"
                  style={{ backgroundColor: "var(--background)", opacity: layer.dim }}
                />
                {geometry.lanes.map((lane, index) => (
                  <div
                    key={`lane-${index}-${lane.x}-${lane.y}`}
                    data-wallpaper-silhouette="lane"
                    aria-hidden
                    className="absolute rounded-md border border-foreground/10 bg-foreground/5"
                    style={{ left: `${lane.x * 100}%`, top: `${lane.y * 100}%`, width: `${lane.w * 100}%`, height: `${lane.h * 100}%` }}
                  />
                ))}
                {geometry.cards.map((card, index) => (
                  <div
                    key={`card-${index}-${card.x}-${card.y}`}
                    data-wallpaper-silhouette="card"
                    aria-hidden
                    className="absolute rounded-sm bg-foreground/20"
                    style={{ left: `${card.x * 100}%`, top: `${card.y * 100}%`, width: `${card.w * 100}%`, height: `${card.h * 100}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}