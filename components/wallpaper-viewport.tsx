import { useEffect, useRef, useState } from "react";
import { HOST_PANEL_ATTR } from "./host-link-glue";
import {
  clampedWallpaperFocus,
  clampedWallpaperZoom,
  wallpaperBackgroundStyle,
  type WallpaperLayer,
} from "./preferences";

/** One measured element as a fraction of the panel box: x/y in [0, 1]
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
 * to the panel box. */
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

/** The preview's height cap: the widest the preview paints before the
 *  width shrinks to hold the board's exact aspect. */
const VIEWPORT_MAX_HEIGHT = 180;

interface ViewportProps {
  /** The painted layer (null = no wallpaper: an empty board outline). */
  layer: WallpaperLayer | null;
  dark: boolean;
  geometry: BoardGeometry | null;
  onFocusChange: (x: number, y: number) => void;
  onZoomChange: (zoom: number) => void;
}

/**
 * A scaled replica of the paint's frame, the window: painted with the exact
 * crop math the board uses (wallpaperBackgroundStyle), with the board's
 * real footprint as a porthole carving out of the window plane — the host
 * chrome outside it (a spread shadow, clipped by the frame), the wallpaper
 * dim scrim and the translucent lane and card silhouettes at scale inside
 * it, and a draggable focus rectangle. Gestures speak percentages and
 * zoom factors — one pointer drags the focal point, two pinch zoom — and
 * the rectangle answers arrow keys for keyboard users.
 */
export function WallpaperViewport({ layer, dark, geometry, onFocusChange, onZoomChange }: ViewportProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);
  const panel = geometry?.panel ?? null;
  const aspect = geometry?.windowAspect ?? window.innerWidth / window.innerHeight;
  const moveFocusTo = (clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect === undefined || rect === null || rect.width <= 0 || rect.height <= 0) return;
    onFocusChange(
      clampedWallpaperFocus(((clientX - rect.left) / rect.width) * 100),
      clampedWallpaperFocus(((clientY - rect.top) / rect.height) * 100),
    );
  };
  return (
    <div
      ref={rootRef}
      data-wallpaper-viewport=""
      aria-label="Wallpaper viewport preview"
      className="relative touch-none select-none overflow-hidden rounded-md border border-border bg-background/40 cursor-crosshair"
      style={{
        aspectRatio: String(aspect),
        width: `calc(min(100%, ${(VIEWPORT_MAX_HEIGHT * aspect).toFixed(2)}px))`,
        marginInline: "auto",
      }}
      onPointerDown={(event) => {
        const element = event.currentTarget;
        if (typeof element.setPointerCapture === "function") element.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.current.size === 1) {
          moveFocusTo(event.clientX, event.clientY);
        } else if (pointers.current.size === 2) {
          const [a, b] = Array.from(pointers.current.values());
          pinchStart.current = {
            distance: Math.hypot(a.x - b.x, a.y - b.y),
            zoom: layer?.zoom ?? 1,
          };
        }
      }}
      onPointerMove={(event) => {
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
          moveFocusTo(event.clientX, event.clientY);
        }
      }}
      onPointerUp={(event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinchStart.current = null;
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId);
        if (pointers.current.size < 2) pinchStart.current = null;
      }}
    >
      {layer !== null ? (
        <div data-wallpaper-paint="" className="absolute inset-0" style={wallpaperBackgroundStyle(layer, dark) ?? undefined} />
      ) : null}
      {panel === null ? null : (
        <div
          data-wallpaper-porthole=""
          aria-hidden
          // The giant spread marks the host chrome around the board region:
          // the shadow covers the paint everywhere the board does not carve a
          // porthole out of the window plane, and the preview's own
          // overflow-hidden keeps the spread inside the frame.
          className="absolute overflow-hidden rounded-md border border-foreground/10"
          style={{
            left: `${panel.x * 100}%`,
            top: `${panel.y * 100}%`,
            width: `${panel.w * 100}%`,
            height: `${panel.h * 100}%`,
            boxShadow: "0 0 0 100000px var(--background)",
          }}
        >
          {layer !== null ? (
            <div
              data-wallpaper-dim=""
              aria-hidden
              className="absolute inset-0"
              style={{ backgroundColor: "var(--background)", opacity: layer.dim }}
            />
          ) : null}
          {(geometry?.lanes ?? []).map((lane, index) => (
            <div
              key={`lane-${index}-${lane.x}-${lane.y}`}
              data-wallpaper-silhouette="lane"
              aria-hidden
              className="absolute rounded-md border border-foreground/10 bg-foreground/5"
              style={{ left: `${lane.x * 100}%`, top: `${lane.y * 100}%`, width: `${lane.w * 100}%`, height: `${lane.h * 100}%` }}
            />
          ))}
          {(geometry?.cards ?? []).map((card, index) => (
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
      {layer !== null ? (
        <button
          type="button"
          aria-label="Wallpaper focus handle"
          title="The focal point: drag on the preview to move it, pinch to zoom"
          className="absolute size-16 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-ring bg-ring/10"
          style={{ left: `${layer.focusX ?? 50}%`, top: `${layer.focusY ?? 50}%` }}
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
        />
      ) : null}
    </div>
  );
}