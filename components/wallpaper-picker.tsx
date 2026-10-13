import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { fetchOpenversePage } from "@/lib/openverse";
import {
  isAllowedWallpaperUrl,
  wallpaperBackgroundStyle,
  type WallpaperFit,
  type WallpaperLayer,
  type WallpaperSettings,
} from "./preferences";
import { useBoardGeometry, WallpaperViewport } from "./wallpaper-viewport";
import { usePrefersDarkScheme } from "./ui/hooks/use-media-query";
import {
  PICSUM_SEEDS,
  WALLPAPER_PRESETS,
  picsumThumbUrl,
  picsumWallpaperUrl,
  type OpenverseImage,
} from "./wallpaper-presets";

/**
 * Board wallpaper picker: the Appearance tab's wallpaper block (shipped
 * gradient presets, a Picsum shuffle strip, an Openverse search) above the
 * free-form image-url input and the dim-wash slider. Its contents render
 * inline in the modal's scrolling tab content — the control was once a
 * toolbar popover, but its only home now is the settings dialog. Edits
 * apply immediately (like the search box) and ride up as the versioned
 * settings document; the Remove row renders only while a wallpaper is
 * active. Every gallery write goes through the same store validation the
 * typed url does, so no source can smuggle in an url the document refuses.
 */
/** A layer's crop fields (fit/zoom/focal), omitted while they sit at their
 *  untouched defaults AND the stored layer never carried them — so a
 *  freshly-default document stores the exact compact shape it always did. */
function cropFields(
  fit: WallpaperFit,
  zoom: number,
  focusX: number,
  focusY: number,
  active: WallpaperLayer | null,
): Partial<WallpaperLayer> {
  const fields: Partial<WallpaperLayer> = {};
  if (fit !== "contain" || active?.fit !== undefined) fields.fit = fit;
  if (zoom !== 1 || active?.zoom !== undefined) fields.zoom = zoom;
  if (focusX !== 50 || active?.focusX !== undefined) fields.focusX = focusX;
  if (focusY !== 50 || active?.focusY !== undefined) fields.focusY = focusY;
  return fields;
}

export function WallpaperPicker({
  wallpaper,
  onWallpaperChange,
}: {
  wallpaper: WallpaperSettings;
  onWallpaperChange: (next: WallpaperSettings) => void;
}) {
  const active = wallpaper.global;
  const dark = usePrefersDarkScheme();
  const geometry = useBoardGeometry();
  const [query, setQuery] = useState<string>(active?.url ?? "");
  const [dim, setDim] = useState<number>(active?.dim ?? 0.35);
  const [fit, setFit] = useState<WallpaperFit>(active?.fit ?? "contain");
  const [zoom, setZoom] = useState<number>(active?.zoom ?? 1);
  const [focusX, setFocusX] = useState<number>(active?.focusX ?? 50);
  const [focusY, setFocusY] = useState<number>(active?.focusY ?? 50);
  // Follows the committed state when a commit lands elsewhere too
  // (Remove writes through); the scratch pad only matters mid-edit.
  useEffect(() => {
    setQuery(active?.url ?? "");
    setDim(active?.dim ?? 0.35);
    setFit(active?.fit ?? "contain");
    setZoom(active?.zoom ?? 1);
    setFocusX(active?.focusX ?? 50);
    setFocusY(active?.focusY ?? 50);
  }, [active?.url, active?.dim, active?.fit, active?.zoom, active?.focusX, active?.focusY]);
  // One writer for every edit of the active layer: the url, dim, and crop
  // fields carried from the stored layer (or the scratch pad for the
  // control being edited) ride along so no edit drops another's setting.
  const commitActive = (override: Partial<WallpaperLayer>) => {
    if (active === null) return;
    const nextFit = override.fit ?? fit;
    const nextZoom = override.zoom ?? zoom;
    const nextFocusX = override.focusX ?? focusX;
    const nextFocusY = override.focusY ?? focusY;
    const layer: WallpaperLayer = {
      url: override.url ?? active.url,
      dim: override.dim ?? active.dim,
    };
    if (active.darkUrl !== undefined) layer.darkUrl = active.darkUrl;
    const nextCanvas = override.canvas ?? active.canvas;
    if (nextCanvas !== undefined) layer.canvas = nextCanvas;
    Object.assign(layer, cropFields(nextFit, nextZoom, nextFocusX, nextFocusY, active));
    onWallpaperChange({ version: 1, global: layer });
  };
  const commitUrl = (nextUrl: string, nextDim: number) => {
    const url = nextUrl.trim();
    if (url === "") {
      // Clearing the input while a wallpaper is active removes it; with no
      // active wallpaper a cleared scratch pad commits nothing.
      if (active !== null) onWallpaperChange({ version: 1, global: null });
      return;
    }
    if (active !== null) {
      // Editing the url keeps the layer's dark variant and crop settings,
      // like the dim slider keeps them.
      commitActive({ url, dim: nextDim });
      return;
    }
    onWallpaperChange({ version: 1, global: { url, dim: nextDim } });
  };
  const commitFromGallery = (url: string, darkUrl?: string) => {
    if (!isAllowedWallpaperUrl(url)) return;
    const layer: WallpaperLayer = darkUrl === undefined ? { url, dim } : { url, dim, darkUrl };
    Object.assign(layer, cropFields(fit, zoom, focusX, focusY, active));
    onWallpaperChange({ version: 1, global: layer });
  };
  return (
    <div className="rounded-md border border-border bg-popover p-2">
      <div className="grid grid-cols-4 gap-1">
        {WALLPAPER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            aria-label={`Wallpaper preset: ${preset.label}`}
            aria-pressed={active?.url === preset.url}
            title={preset.label}
            onClick={() => commitFromGallery(preset.url, preset.darkUrl)}
            className="aspect-video rounded-sm border border-border transition-colors hover:ring-2 hover:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={
              wallpaperBackgroundStyle(
                {
                  url: preset.url,
                  darkUrl: preset.darkUrl,
                  dim: 0,
                },
                dark,
              ) ?? undefined
            }
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {PICSUM_SEEDS.map((seed) => (
          <button
            key={seed}
            type="button"
            aria-label={`Picsum: ${seed}`}
            title="Random photo (picsum.photos)"
            onClick={() => commitFromGallery(picsumWallpaperUrl(seed))}
            className="overflow-hidden rounded-sm border border-border transition-colors hover:ring-2 hover:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={picsumThumbUrl(seed)}
              alt=""
              className="aspect-video w-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>
      <OpenverseSearch onPick={commitFromGallery} />
      <div className="mt-2 border-t border-border pt-2">
        {active !== null ? (
          <WallpaperViewport
            layer={active}
            dark={dark}
            geometry={geometry}
            onFocusChange={(x, y) => {
              setFocusX(x);
              setFocusY(y);
              commitActive({ focusX: x, focusY: y });
            }}
            onZoomChange={(zoom) => {
              setZoom(zoom);
              commitActive({ zoom });
            }}
            onCanvasChange={(color) => {
              if (color !== active.canvas) commitActive({ canvas: color });
            }}
          />
        ) : null}
        <Input
          value={query}
          onChange={(event) => {
            const nextUrl = event.target.value;
            setQuery(nextUrl);
            const trimmed = nextUrl.trim();
            if (trimmed === "" || isAllowedWallpaperUrl(trimmed)) {
              commitUrl(trimmed, dim);
            }
          }}
          aria-label="Wallpaper image url"
          aria-invalid={
            query.trim() !== "" && !isAllowedWallpaperUrl(query.trim())
              ? "true"
              : undefined
          }
          placeholder="Image url (https://…)"
          className="h-7 text-xs"
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Dim</span>
          <input
            type="range"
            role="slider"
            aria-label="Wallpaper dim"
            min={0}
            max={0.9}
            step={0.05}
            value={dim}
            onChange={(event) => {
              const nextDim = Number(event.target.value);
              setDim(nextDim);
              commitActive({ dim: nextDim });
            }}
            className="flex-1 accent-[var(--primary)]"
          />
        </label>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">Fit</span>
          <div className="flex shrink-0 overflow-hidden rounded-sm border border-border">
            <button
              type="button"
              aria-label="Wallpaper fit: letterbox"
              aria-pressed={fit === "contain"}
              title="Contain the whole image (letterbox bars fill the gap)"
              onClick={() => {
                setFit("contain");
                commitActive({ fit: "contain" });
              }}
              className={`px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground ${
                fit === "contain" ? "bg-accent text-foreground" : ""
              }`}
            >
              Letterbox
            </button>
            <button
              type="button"
              aria-label="Wallpaper fit: fill"
              aria-pressed={fit === "cover"}
              title="Fill the board and crop the overflow"
              onClick={() => {
                setFit("cover");
                commitActive({ fit: "cover" });
              }}
              className={`px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground ${
                fit === "cover" ? "bg-accent text-foreground" : ""
              }`}
            >
              Fill
            </button>
          </div>
          <span className="ml-1 shrink-0">Zoom</span>
          <input
            type="range"
            role="slider"
            aria-label="Wallpaper zoom"
            min={1}
            max={4}
            step={0.25}
            value={zoom}
            onChange={(event) => {
              const nextZoom = Number(event.target.value);
              setZoom(nextZoom);
              commitActive({ zoom: nextZoom });
            }}
            className="min-w-0 flex-1 accent-[var(--primary)]"
          />
        </div>
        {active !== null ? (
          <button
            type="button"
            onClick={() => {
              onWallpaperChange({ version: 1, global: null });
            }}
            className="mt-2 flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="X" className="size-3.5 shrink-0" aria-hidden />
            Remove wallpaper
          </button>
        ) : null}
      </div>
    </div>
  );
}

type OpenverseSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; images: readonly OpenverseImage[]; page: number }
  | { status: "end"; images: readonly OpenverseImage[]; page: number; pageCount: number }
  | { status: "error"; message: string };

/**
 * How far the current query's paging has advanced: successfully fetched
 * pages and the response's page_count (null until a response carries it).
 * Reset when the query text changes; a failed fetch touches neither field,
 * so a retry re-attempts the same page (never skipping an unseen page).
 */
interface OpenversePaging {
  pages: number;
  pageCount: number | null;
}

/**
 * The Openverse panel of the picker: type a query, press Search, click a
 * result. A Search click with an unchanged query fetches the next page;
 * editing the query resets to page 1. Network failures render their reason
 * (the picker never hides a failed search behind an empty grid) and commit
 * nothing; a click past the response's last page re-renders the last
 * results with an end mark instead of a fetch the API would refuse.
 */
function OpenverseSearch({
  onPick,
}: {
  onPick: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [paging, setPaging] = useState<OpenversePaging>({ pages: 0, pageCount: null });
  const [state, setState] = useState<OpenverseSearchState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // A closing or torn-down picker cancels the in-flight search so a stale
    // response can never land in a reopened picker.
    return () => {
      controllerRef.current?.abort();
    };
  }, []);
  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed === "") return;
    const page = paging.pages + 1;
    if (paging.pageCount !== null && page > paging.pageCount) {
      // End of results: Openverse only serves page_count pages (for the
      // keyless client this is its pagination-depth cap), so re-render the
      // last page with an end mark rather than a fetch it refuses (HTTP
      // 401). The paging position is kept, retrying here repeats the mark.
      const images = state.status === "done" || state.status === "end" ? state.images : [];
      setState({ status: "end", images, page: paging.pages, pageCount: paging.pageCount });
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    try {
      const { images, pageCount } = await fetchOpenversePage(trimmed, page, {
        signal: controller.signal,
      });
      setState({ status: "done", images, page });
      setPaging({ pages: page, pageCount });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center gap-1">
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // Any edit retargets the search: the next click fetches page 1.
            setPaging({ pages: 0, pageCount: null });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
          aria-label="Search Openverse"
          placeholder="Openverse search…"
          className="h-7 flex-1 text-xs"
        />
        <button
          type="button"
          aria-label="Search"
          title="Search Openverse"
          onClick={() => void runSearch()}
          disabled={query.trim() === "" || state.status === "loading"}
          className="inline-flex h-7 shrink-0 items-center justify-center rounded-sm px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Icon name="Search" className="size-3.5" aria-hidden />
        </button>
      </div>
      {state.status === "loading" ? <div className="mt-1 text-[10px] text-muted-foreground">Searching…</div> : null}
      {state.status === "error" ? (
        <div className="mt-1 text-[10px] text-destructive">Openverse search failed: {state.message}</div>
      ) : null}
      {state.status === "done" || state.status === "end" ? (
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {state.status === "end"
              ? `page ${state.page} of ${state.pageCount} (last page)`
              : paging.pageCount === null
                ? `page ${state.page}`
                : `page ${state.page} of ${paging.pageCount}`}
          </span>
          {state.status === "end" ? <span>no further results</span> : null}
        </div>
      ) : null}
      {state.status === "done" || state.status === "end" ? (
        state.images.length === 0 ? (
          <div className="mt-1 text-[10px] text-muted-foreground">No images found for “{query.trim()}”.</div>
        ) : (
          <div className="mt-1 grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
            {state.images.map((image) => (
              <button
                key={image.id}
                type="button"
                aria-label={`${image.title} (${image.license})`}
                title={`${image.title}${image.creator === null ? "" : ` by ${image.creator}`} — ${image.license}`}
                onClick={() => onPick(image.url)}
                className="overflow-hidden rounded-sm border border-border transition-colors hover:ring-2 hover:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {image.thumb === null ? (
                  <span className="flex aspect-video w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">
                    open image
                  </span>
                ) : (
                  <img src={image.thumb} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}