import type { GroupBy } from "./grouping";
import type { CSSProperties } from "react";
import {
  ARCHIVE_UNITS,
  DEFAULT_ARCHIVE_UNIT,
  DEFAULT_ARCHIVE_VALUE,
  type ArchiveUnit,
} from "../lib/duration";

/**
 * The "Nest child threads" toggle's localStorage persistence (R3). The
 * parsing lives here — pure, unit-testable without a DOM — so app.tsx only
 * wires localStorage access around it.
 */

export const NEST_CHILDREN_KEY = "focus-board:nestChildren";

/** Stored values are `"on"`/`"off"`; anything else (or nothing) defaults to ON. */
export function parseNestStored(raw: string | null): boolean {
  return raw === "off" ? false : true;
}

export function nestStoredValue(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

/**
 * The compact (mobile) header's filter-ribbon persistence. The collapsed
 * default is the point: on a phone the palette takes most of the screen, so
 * only New thread, the search field, the ribbon toggle, and the settings
 * gear stay visible and the View chip / filter dropdowns / Clear / thread
 * count hide inside the ribbon until expanded. Stored values are
 * `"open"`/`"closed"`; anything else (or nothing) defaults to closed. The
 * choice persists across viewports but only the compact header reads it.
 */
export const TOOLBAR_FILTER_RIBBON_KEY = "focus-board:toolbarFilterRibbon";

export function parseFilterRibbonStored(raw: string | null): boolean {
  return raw === "open";
}

export function filterRibbonStoredValue(open: boolean): "open" | "closed" {
  return open ? "open" : "closed";
}

/** The Group-by dropdown's localStorage persistence (D1). */
export const GROUP_BY_KEY = "focus-board:groupBy";

const ALLOWED_GROUP_BY: readonly GroupBy[] = [
  "none",
  "status",
  "recency",
  "project",
  "provider",
  "machine",
  "parent",
  "group",
];

/** Validate a stored group-by value; anything stale or unknown falls back to Attention. */
export function parseGroupStored(raw: string | null): GroupBy {
  return (ALLOWED_GROUP_BY as readonly string[]).includes(raw ?? "")
    ? (raw as GroupBy)
    : "status";
}

/** The parent-lane board lane-order toggle (D5a): recency (default) or project grouping. */
export const PARENT_LANE_ORDER_KEY = "focus-board:parentLaneOrder";

export type ParentLaneOrder = "recency" | "project";

const ALLOWED_PARENT_LANE_ORDER: readonly ParentLaneOrder[] = ["recency", "project"];

/** Validate the stored lane-order value; anything stale or unknown falls back to recency. */
export function parseParentLaneOrderStored(raw: string | null): ParentLaneOrder {
  return (ALLOWED_PARENT_LANE_ORDER as readonly string[]).includes(raw ?? "")
    ? (raw as ParentLaneOrder)
    : "recency";
}

/**
 * Collapsed family cards' persistence. The stored list holds the PARENT
 * thread ids whose nested child rows are collapsed; every id absent from it
 * renders expanded (the default), so the list only ever records deliberate
 * collapses. Tolerant like every other stored value: corrupt JSON, a
 * non-array, or non-string entries degrade to fewer (or zero) collapsed
 * families, never to a board that fails to load.
 */
export const COLLAPSED_FAMILIES_KEY = "focus-board:collapsedFamilies";

export function parseCollapsedFamiliesStored(raw: string | null): ReadonlySet<string> {
  if (raw === null || raw === "") return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

/** Sorted for a stable stored form, so equal sets round-trip byte-identical. */
export function collapsedFamiliesStoredValue(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}

/**
 * The localStorage access the board preferences share: every stored value
 * parses through its own tolerant reader above, and these three wrap the
 * raw window access (it can throw in embedded contexts) so callers keep one
 * implementation.
 */
export function readStored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null && (allowed as readonly string[]).includes(value)) {
      return value as T;
    }
  } catch {
    // localStorage can throw in embedded contexts; fall through to default.
  }
  return fallback;
}

export function readStoredText(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    // localStorage can throw in embedded contexts; fall through to default.
  }
  return fallback;
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Best effort only; the board still works without persistence.
  }
}

/**
 * The server-declared boolean setting backing the thread pane's Escape
 * behavior (see server.ts `escStopsRunningThread`). Only an explicit stored
 * `false` is off: while loading, unset (default applied host-side as true),
 * or an unexpected type, the default ON applies.
 */
export function escStopsRunningFromSetting(
  value: string | number | boolean | undefined,
): boolean {
  return value !== false;
}

/**
 * The server-declared string setting backing the board's New Thread
 * composer shortcut (see server.ts `newThreadShortcutKey`). Lowercased and
 * returned as the effective single key ("c" by default); an explicit empty
 * string is the operator's off choice and returns null; while loading,
 * unset, or a foreign stored shape (wrong type, more than one character,
 * a non-alphanumeric character — the host schema never stores one, so only
 * stale data could), the C default applies rather than trusting the value.
 */
export const DEFAULT_NEW_THREAD_SHORTCUT_KEY = "c";

const NEW_THREAD_SHORTCUT_PATTERN = /^[a-z0-9]$/;

export function newThreadShortcutKeyFromSetting(
  value: string | number | boolean | undefined,
): string | null {
  if (typeof value !== "string") return DEFAULT_NEW_THREAD_SHORTCUT_KEY;
  const normalized = value.toLowerCase();
  // An explicitly empty store is the off choice; whitespace-only or any
  // other malformed single field is a foreign value, never an off choice.
  if (normalized === "") return null;
  const trimmed = normalized.trim();
  return trimmed.length === 1 && NEW_THREAD_SHORTCUT_PATTERN.test(trimmed)
    ? trimmed
    : DEFAULT_NEW_THREAD_SHORTCUT_KEY;
}

/**
 * The settings modal's field draft, normalized the same way the runtime
 * read is: a valid single letter or digit lowercases to the key to write,
 * an empty draft is the off choice ("") , and anything else is invalid
 * (null) — the row surfaces the failure instead of writing a guess.
 */
export function parseNewThreadShortcutDraft(draft: string): string | null {
  const normalized = draft.trim().toLowerCase();
  if (normalized === "") return "";
  return NEW_THREAD_SHORTCUT_PATTERN.test(normalized) ? normalized : null;
}

/**
 * The card-transport appearance choice (the settings modal's Appearance tab),
 * localStorage-backed. `zoom` (the shrink-out/grow-in portal read) is the
 * shipped default — the operator flipped it in from the dissolve — so fresh
 * boards and any unparseable stored value play the zoom;
 * `teleport` deliberately selects the dissolve, and `none` relocates a card
 * instantly with no ghost and no wipe.
 */
export type CardTransportPref = "none" | "teleport" | "zoom";

export const CARD_TRANSPORT_KEY = "focus-board:cardTransport";

const ALLOWED_CARD_TRANSPORT: readonly CardTransportPref[] = ["none", "teleport", "zoom"];

const DEFAULT_CARD_TRANSPORT: CardTransportPref = "zoom";

export function parseCardTransportStored(raw: string | null): CardTransportPref {
  return (ALLOWED_CARD_TRANSPORT as readonly string[]).includes(raw ?? "")
    ? (raw as CardTransportPref)
    : DEFAULT_CARD_TRANSPORT;
}

export function cardTransportStoredValue(value: CardTransportPref): CardTransportPref {
  return value;
}

/**
 * The sweep threshold settings' frontend mirrors (server.ts declares the
 * four settings; the Behavior tab renders them). The caps mirror the
 * descriptor schemas as an input rail only: the host's schema stays the
 * authority, so a stale or foreign value falls back to the default here
 * instead of trusting it.
 */
export type SweepValueKey = "doneArchiveValue" | "idleArchiveValue";
export type SweepUnitKey = "doneArchiveUnit" | "idleArchiveUnit";

export type SweepSettingKey = SweepValueKey | SweepUnitKey;

export const SWEEP_CAPS: Record<SweepValueKey, number> = {
  doneArchiveValue: 365,
  idleArchiveValue: 3650,
};

/**
 * The effective threshold count behind a declared value: a stored integer
 * inside the key's cap is used as-is; loading (undefined) or anything else
 * falls back to `lib/duration`'s default, the same unset-means-default rule
 * the Escape reader follows — never a coercion of a bad value.
 */
export function sweepValueFromSetting(
  raw: number | string | boolean | undefined,
  key: SweepValueKey,
): number {
  if (
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= 1 &&
    raw <= SWEEP_CAPS[key]
  ) {
    return raw;
  }
  return DEFAULT_ARCHIVE_VALUE;
}

/** The effective unit behind a declared unit: a member of ARCHIVE_UNITS as-is, otherwise the default. */
export function sweepUnitFromSetting(
  raw: number | string | boolean | undefined,
): ArchiveUnit {
  return (ARCHIVE_UNITS as readonly string[]).includes(raw as string)
    ? (raw as ArchiveUnit)
    : DEFAULT_ARCHIVE_UNIT;
}

/**
 * The board motion preference: `system` defers to the OS media query (the
 * default), `reduce` forces the reduced-motion path on regardless, `full`
 * forces the full-motion path on regardless. Wired into the board's
 * transport wipe gating, which already has both branches.
 */
export type MotionPref = "system" | "reduce" | "full";

export const MOTION_PREF_KEY = "focus-board:motion";

const ALLOWED_MOTION: readonly MotionPref[] = ["system", "reduce", "full"];

export function parseMotionStored(raw: string | null): MotionPref {
  return (ALLOWED_MOTION as readonly string[]).includes(raw ?? "")
    ? (raw as MotionPref)
    : "system";
}

export function motionStoredValue(value: MotionPref): MotionPref {
  return value;
}

/**
 * The board wallpaper's localStorage persistence. Versioned document with a
 * single GLOBAL layer for now; per-project / per-group overrides extend this
 * same document (version 2) instead of growing sibling keys, so every scope
 * keeps one parser.
 */
export const WALLPAPER_KEY = "focus-board:wallpaper";

/** One wallpaper layer: where the image lives, how strongly the theme
 *  background wash covers it, and how it fits the board's screen ratio
 *  (crop controls; all optional — a layer without them paints the
 *  letterboxed look, so older stored documents render unchanged). */
export type WallpaperFit = "contain" | "cover";

export interface WallpaperLayer {
  /** http(s) or data URL. Anything else is refused at parse time so a
   *  javascript:-style string can never reach a CSS url(). */
  url: string;
  /** The dark-scheme variant (optional): a matchMedia
   *  (prefers-color-scheme: dark) flip swaps the paint to this url. Same
   *  url rules as `url`; an invalid stored value degrades by dropping the
   *  FIELD only (the layer survives with the light url). */
  darkUrl?: string;
  /** Overlay opacity in [0, 0.9]; 0 = untinted image, high dim keeps cards readable. */
  dim: number;
  /** Paint fit: "contain" fits the whole image with letterbox bars (the
   *  default), "cover" fills the board and crops the overflow. A garbage
   *  stored value degrades to the default by dropping the FIELD. */
  fit?: WallpaperFit;
  /** Zoom factor in [1, 4]; 1 = unfitted, > 1 scales the painted image
   *  (with overflow clipped) around the focal point. */
  zoom?: number;
  /** Focal point as a horizontal percent in [0, 100]: with "cover" it
   *  picks the crop region, with zoom it anchors the scale, and with
   *  "contain" it shifts the letterboxed image. */
  focusX?: number;
  /** The focal point's vertical percent, same rules as `focusX`. */
  focusY?: number;
}

export interface WallpaperSettings {
  version: 1;
  global: WallpaperLayer | null;
}

export const NO_WALLPAPER: WallpaperSettings = { version: 1, global: null };

/** Dim bounds and the default for a layer that arrives without one. */
const WALLPAPER_DIM_MIN = 0;
const WALLPAPER_DIM_MAX = 0.9;
const WALLPAPER_DIM_DEFAULT = 0.35;

function clampWallpaperDim(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return WALLPAPER_DIM_DEFAULT;
  return Math.min(
    WALLPAPER_DIM_MAX,
    Math.max(WALLPAPER_DIM_MIN, raw),
  );
}

/** Zoom bounds for a stored zoom field; anything else degrades to unset. */
const WALLPAPER_ZOOM_MIN = 1;
const WALLPAPER_ZOOM_MAX = 4;

function parseWallpaperFit(raw: unknown): WallpaperFit | undefined {
  return raw === "contain" || raw === "cover" ? raw : undefined;
}

/** The zoom factor a paint or gesture may use, clamped into [1, 4]. */
export function clampedWallpaperZoom(raw: number): number {
  return Math.min(WALLPAPER_ZOOM_MAX, Math.max(WALLPAPER_ZOOM_MIN, raw));
}

function clampWallpaperZoom(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return clampedWallpaperZoom(raw);
}

/** The focal-axis percent a paint or gesture may use, clamped into [0, 100]. */
export function clampedWallpaperFocus(raw: number): number {
  return Math.min(100, Math.max(0, raw));
}

/** Focal-axis clamp: a percent in [0, 100]; garbage degrades to unset. */
function clampWallpaperFocus(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return clampedWallpaperFocus(raw);
}

/** True for http(s) and data image-reference URLs; everything else (a
 *  javascript:-style scheme, a plain word, an invalid URL) is refused so it
 *  can never reach a CSS url() or a committed wallpaper document. */
export function isAllowedWallpaperUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "data:";
  } catch {
    return false;
  }
}

function parseWallpaperLayer(raw: unknown): WallpaperLayer | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as { url?: unknown; dim?: unknown; darkUrl?: unknown; fit?: unknown; zoom?: unknown; focusX?: unknown; focusY?: unknown };
  if (typeof record.url !== "string") return null;
  const url = record.url.trim();
  if (url === "" || !isAllowedWallpaperUrl(url)) return null;
  // Per-key tolerance like every other stored value: a bad darkUrl drops the
  // FIELD, never the layer (dark mode then falls back to the light url).
  let darkUrl: string | undefined;
  if (typeof record.darkUrl === "string") {
    const dark = record.darkUrl.trim();
    if (dark !== "" && isAllowedWallpaperUrl(dark)) darkUrl = dark;
  }
  // A missing dim takes the default; a garbage-typed dim drops the whole
  // layer, so no stale image ever renders untinted by accident.
  // The crop fields follow the darkUrl tolerance instead: a garbage value
  // drops the FIELD only, so an old layer survives a partial corruption.
  if (record.dim === undefined) {
    return darkUrl === undefined ? { url, dim: WALLPAPER_DIM_DEFAULT } : { url, dim: WALLPAPER_DIM_DEFAULT, darkUrl };
  }
  if (typeof record.dim !== "number" || !Number.isFinite(record.dim)) return null;
  const layer: WallpaperLayer = darkUrl === undefined
    ? { url, dim: clampWallpaperDim(record.dim) }
    : { url, dim: clampWallpaperDim(record.dim), darkUrl };
  const fit = parseWallpaperFit(record.fit);
  if (fit !== undefined) layer.fit = fit;
  const zoom = clampWallpaperZoom(record.zoom);
  if (zoom !== undefined) layer.zoom = zoom;
  const focusX = clampWallpaperFocus(record.focusX);
  if (focusX !== undefined) layer.focusX = focusX;
  const focusY = clampWallpaperFocus(record.focusY);
  if (focusY !== undefined) layer.focusY = focusY;
  return layer;
}

/**
 * The url a wallpaper layer paints right now: the dark variant while the OS
 * prefers dark, the light url otherwise (and whenever no dark variant exists).
 */
export function resolvedWallpaperUrl(
  layer: Pick<WallpaperLayer, "url" | "darkUrl">,
  isDark: boolean,
): string {
  return isDark ? layer.darkUrl ?? layer.url : layer.url;
}

/**
 * The style object the panel root paints a wallpaper with. A layer without
 * crop controls paints the original letterbox exactly (contain, no-repeat,
 * centered, no transform); stored fit/zoom/focal fields upgrade the paint:
 * "cover" fills the panel and crops, the focal point picks the crop region
 * (and anchors the zoom), zoom > 1 scales around that point — the caller
 * clips the overflow with an overflow-hidden wrapper. URL escaped so quotes
 * and backslashes can never break out of url().
 * Null = no wallpaper (the caller paints no background style at all).
 */
export function wallpaperBackgroundStyle(
  layer: WallpaperLayer | null,
  isDark: boolean,
): CSSProperties | null {
  if (layer === null) return null;
  const url = resolvedWallpaperUrl(layer, isDark).replace(/["\\]/gu, "\\$&");
  const fit = layer.fit ?? "contain";
  const zoom = clampWallpaperZoom(layer.zoom) ?? 1;
  const focusX = clampWallpaperFocus(layer.focusX);
  const focusY = clampWallpaperFocus(layer.focusY);
  const style: CSSProperties = {
    backgroundImage: `url("${url}")`,
    backgroundSize: fit === "cover" ? "cover" : "contain",
    backgroundRepeat: "no-repeat",
    backgroundPosition: focusX === undefined && focusY === undefined ? "center" : `${focusX ?? 50}% ${focusY ?? 50}%`,
  };
  if (zoom > 1) {
    const origin =
      focusX === undefined && focusY === undefined ? "50% 50%" : `${focusX ?? 50}% ${focusY ?? 50}%`;
    style.transform = `scale(${zoom})`;
    style.transformOrigin = origin;
  }
  return style;
}

/**
 * Validate a stored wallpaper document with the same tolerance as every
 * other stored preference: corruption, a foreign version, or a rejected url
 * degrades to NO_WALLPAPER rather than a board that fails to load.
 */
export function parseWallpaperStored(raw: string | null): WallpaperSettings {
  if (raw === null || raw === "") return NO_WALLPAPER;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return NO_WALLPAPER;
    const record = parsed as { version?: unknown; global?: unknown };
    if (record.version !== 1) return NO_WALLPAPER;
    if (record.global === null) return NO_WALLPAPER;
    const layer = parseWallpaperLayer(record.global);
    return layer === null ? NO_WALLPAPER : { version: 1, global: layer };
  } catch {
    return NO_WALLPAPER;
  }
}

/** The layer the board currently paints behind itself (null = none). */
export function wallpaperLayerOf(settings: WallpaperSettings): WallpaperLayer | null {
  return settings.global;
}

/** Sorted and trimmed for a stable stored form, like collapsedFamilies. */
export function wallpaperStoredValue(settings: WallpaperSettings): string {
  if (settings.global === null) return JSON.stringify({ version: 1, global: null });
  const layer = parseWallpaperLayer(settings.global) ?? null;
  return JSON.stringify({ version: 1, global: layer });
}
