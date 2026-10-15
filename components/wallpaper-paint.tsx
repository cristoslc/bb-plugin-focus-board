import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { wallpaperBackgroundStyle, type WallpaperLayer } from "./preferences";

/**
 * The window-anchored paint frame: the wallpaper's box in the panel's own
 * coordinate space. left/top are the panel's (negative) viewport offset —
 * where the window's origin sits relative to the panel — and width/height
 * are the window's inner size, so the painted box equals the window's box.
 */
export interface WallpaperPaintFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Pure framing math (issue #201): the wallpaper paints into a box equal to
 * the browser window, anchored at the window's origin, so the crop derives
 * from the window's ratio and no panel-side sizing — a thread pane toggle, a
 * sidebar drag — can refit it; the pane and the panel edges merely carve the
 * (clipped) porthole the board shows. Null = nothing usable was measured
 * (no panel box, a zero-area panel or window); the caller then falls back to
 * the panel-scoped paint, the original inset-0 layer.
 */
export function wallpaperPaintFrame(
  panelRect: { left: number; top: number; width: number; height: number } | null,
  windowWidth: number,
  windowHeight: number,
): WallpaperPaintFrame | null {
  if (panelRect === null || windowWidth <= 0 || windowHeight <= 0) return null;
  if (panelRect.width <= 0 || panelRect.height <= 0) return null;
  // Canonical zero CSS values: -0 comes out of a 0 offset and reads the same
  // either way, so keep the frame's numbers canonical for stable style diffs.
  const left = panelRect.left === 0 ? 0 : -panelRect.left;
  const top = panelRect.top === 0 ? 0 : -panelRect.top;
  return { left, top, width: windowWidth, height: windowHeight };
}

function measureFrame(panel: Element | null): WallpaperPaintFrame | null {
  return wallpaperPaintFrame(
    panel === null ? null : panel.getBoundingClientRect(),
    window.innerWidth,
    window.innerHeight,
  );
}

/**
 * The live window frame for the paint layer: one measure on mount, a settle
 * re-measure a beat later, then window resizes and a ResizeObserver on the
 * panel root keep it fresh (the host resizes the panel without a resize
 * event when a sidebar is dragged). A re-measure that comes back unusable —
 * a transient zero-area box mid-remount — holds the last usable frame
 * instead of collapsing the paint to the fallback mid-flight. jsdom without
 * ResizeObserver degrades to the resize listener.
 */
export function useWallpaperPaintFrame(panelRef: RefObject<Element | null>): WallpaperPaintFrame | null {
  const [frame, setFrame] = useState<WallpaperPaintFrame | null>(() => measureFrame(panelRef.current));
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    const remeasure = () => {
      const next = measureFrame(panelRef.current);
      setFrame((previous) => next ?? previous);
    };
    remeasure();
    const settle = window.setTimeout(remeasure, 300);
    window.addEventListener("resize", remeasure);
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(remeasure);
      const panel = panelRef.current;
      if (panel !== null) observer.observe(panel);
    }
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    };
  }, [panelRef]);
  return frame;
}

/**
 * The board's wallpaper layer: an overflow-hidden clip wrapper scoped to the
 * panel, and inside it the paint child framed to the window's box — the
 * same crop math the picker's viewport previews (wallpaperBackgroundStyle).
 * Before the first usable measurement the paint is the panel-scoped
 * inset-0 layer, the pre-window-framing shape, so a mount never flashes an
 * unframed crop: the wrapper clips either way.
 */
export function WallpaperPaintLayer({
  layer,
  dark,
  panelRef,
}: {
  layer: WallpaperLayer | null;
  dark: boolean;
  panelRef: RefObject<Element | null>;
}) {
  const frame = useWallpaperPaintFrame(panelRef);
  if (layer === null) return null;
  const background: CSSProperties = wallpaperBackgroundStyle(layer, dark) ?? {};
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={frame === null ? "absolute inset-0" : "absolute"}
        style={{
          ...(frame === null
            ? null
            : { left: frame.left, top: frame.top, width: frame.width, height: frame.height }),
          ...background,
        }}
      />
    </div>
  );
}