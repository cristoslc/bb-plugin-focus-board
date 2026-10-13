// @vitest-environment jsdom
// The wallpaper picker as the settings' Appearance tab hosts it: shipped
// gradient presets, a Picsum strip, an Openverse search, a free-form https
// url field, and a dim slider, rendered inline in the tab content (no
// trigger, no popover). Every edit commits immediately as a versioned
// settings document; the Remove row (rendered only while a wallpaper is
// active) drops it back to global: null. The toolbar mounts no picker — that
// absence is pinned by tests/board-toolbar-layout.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WallpaperPicker } from "../components/wallpaper-picker";
import { WALLPAPER_PRESETS } from "../components/wallpaper-presets";
import type { WallpaperSettings } from "../components/preferences";

function renderPicker(
  wallpaper: WallpaperSettings,
): { onWallpaperChange: ReturnType<typeof vi.fn>; unmount: () => void } {
  const onWallpaperChange = vi.fn();
  const view = render(
    <WallpaperPicker wallpaper={wallpaper} onWallpaperChange={onWallpaperChange} />,
  );
  return { onWallpaperChange, unmount: () => view.unmount() };
}

const NO_WALLPAPER: WallpaperSettings = { version: 1, global: null };

afterEach(cleanup);

describe("wallpaper picker (Appearance tab content)", () => {
  it("renders the url input and dim slider inline — no trigger, no popover", () => {
    renderPicker(NO_WALLPAPER);
    expect(screen.getByRole("textbox", { name: "Wallpaper image url" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Wallpaper dim" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Wallpaper" })).toBeNull();
  });

  it("typing a url commits it as the global wallpaper, preserving the shown dim", () => {
    const { onWallpaperChange } = renderPicker({ version: 1, global: null });
    const input = screen.getByRole("textbox", { name: "Wallpaper image url" });
    fireEvent.change(input, { target: { value: "https://example.com/w.png" } });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35 },
    });
  });

  it("typing a non-http/data string is refused: nothing changes and the input reads invalid", () => {
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Wallpaper image url" }), {
      target: { value: "javascript:alert(1)" },
    });
    expect(onWallpaperChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Wallpaper image url" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("the dim slider changes only the dim of the active wallpaper", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35 },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper dim" }), {
      target: { value: "0.6" },
    });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6 },
    });
  });

  it("Remove is rendered only while a wallpaper is active and commits global: null", () => {
    const first = renderPicker(NO_WALLPAPER);
    expect(screen.queryByRole("button", { name: "Remove wallpaper" })).toBeNull();

    first.unmount();
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove wallpaper" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({ version: 1, global: null });
  });

  it("renders the shipped preset swatches and commits one on click, keeping the shown dim", () => {
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    const count = screen.getAllByRole("button", { name: /Wallpaper preset: / }).length;
    expect(count).toBeGreaterThanOrEqual(8);
    fireEvent.click(screen.getByRole("button", { name: "Wallpaper preset: Acadia" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: {
        url: expect.stringMatching(/^data:image\/svg\+xml/),
        dim: 0.35,
        darkUrl: expect.stringMatching(/^data:image\/svg\+xml/),
      },
    });
  });

  it("marks the active preset (aria-pressed) so the stored url is visible in the grid", () => {
    // No wallpaper: nothing pressed.
    const first = renderPicker(NO_WALLPAPER);
    for (const button of screen.getAllByRole("button", { name: /Wallpaper preset: / })) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    first.unmount();

    cleanup();
    const acadia = WALLPAPER_PRESETS.find((preset) => preset.label === "Acadia");
    if (acadia === undefined) throw new Error("missing Acadia preset");
    renderPicker({ version: 1, global: { url: acadia.url, dim: 0.35, darkUrl: acadia.darkUrl } });
    expect(
      screen.getByRole("button", { name: "Wallpaper preset: Acadia" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders Picsum thumbnails; clicking one commits its 1920x1080 url", () => {
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    const expected = screen.getAllByRole("button", { name: /Picsum: / }).length;
    expect(expected).toBe(8);
    fireEvent.click(screen.getByRole("button", { name: "Picsum: focus-board-3" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://picsum.photos/seed/focus-board-3/1920/1080", dim: 0.35 },
    });
  });

  it("an active dim is kept when a preset or Picsum thumb commits (not the 0.35 default)", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Picsum: focus-board-3" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://picsum.photos/seed/focus-board-3/1920/1080", dim: 0.6 },
    });
  });
  it("the dim slider preserves an active layer's dark variant", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35, darkUrl: "https://example.com/w-dark.png" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper dim" }), {
      target: { value: "0.6" },
    });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6, darkUrl: "https://example.com/w-dark.png" },
    });
  });

  it("the dim slider preserves the stored canvas letterbox color too", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35, canvas: "#112233" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper dim" }), {
      target: { value: "0.6" },
    });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6, canvas: "#112233" },
    });
  });

  it("the fit toggle commits fit: cover carrying the layer's url, dim, dark variant, and set crop fields", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: {
        url: "https://example.com/w.png",
        dim: 0.5,
        darkUrl: "https://example.com/w-dark.png",
        zoom: 1.5,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wallpaper fit: fill" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: {
        url: "https://example.com/w.png",
        dim: 0.5,
        darkUrl: "https://example.com/w-dark.png",
        zoom: 1.5,
        fit: "cover",
      },
    });
  });

  it("the fit toggle commits fit: contain when the active layer already stores a cover", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5, fit: "cover" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Wallpaper fit: letterbox" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5, fit: "contain" },
    });
  });

  it("the fit toggle marks the stored mode with aria-pressed and no-ops while no wallpaper is active", () => {
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    const letterbox = screen.getByRole("button", { name: "Wallpaper fit: letterbox" });
    expect(letterbox.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Wallpaper fit: fill" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Wallpaper fit: fill" }));
    expect(onWallpaperChange).not.toHaveBeenCalled();
  });

  it("the zoom slider commits a zoom factor and no-ops while no wallpaper is active", () => {
    const none = renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper zoom" }), { target: { value: "2" } });
    expect(none.onWallpaperChange).not.toHaveBeenCalled();
    none.unmount();
    const withActive = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5 },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper zoom" }), { target: { value: "2" } });
    expect(withActive.onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5, zoom: 2 },
    });
  });

  it("the board viewport preview renders only while a wallpaper is active", () => {
    const noWallpaper = renderPicker(NO_WALLPAPER);
    expect(document.querySelector("[data-wallpaper-viewport]")).toBeNull();
    noWallpaper.unmount();
    renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5 },
    });
    expect(document.querySelector("[data-wallpaper-viewport]")).not.toBeNull();
  });

  it("dragging the viewport reframes the crop window, committing focal percentages that carry the layer's fields", () => {
    const withActive = renderPicker({
      version: 1,
      global: {
        url: "https://example.com/w.png",
        dim: 0.5,
        darkUrl: "https://example.com/w-dark.png",
        fit: "cover",
        zoom: 2,
      },
    });
    const imageBox = document.querySelector("[data-wallpaper-imagebox]") as HTMLElement;
    Object.defineProperty(imageBox, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });
    fireEvent.pointerDown(imageBox, { pointerId: 1, clientX: 30, clientY: 70 });
    expect(withActive.onWallpaperChange).toHaveBeenCalledTimes(1);
    const layer = (withActive.onWallpaperChange.mock.calls[0]?.[0] as { global: Record<string, unknown> }).global;
    expect(layer).toEqual({
      url: "https://example.com/w.png",
      dim: 0.5,
      darkUrl: "https://example.com/w-dark.png",
      fit: "cover",
      zoom: 2,
      focusX: expect.any(Number),
      focusY: expect.any(Number),
    });
    // The unloaded image falls back to the board's aspect, so cover zoom 2
    // gives kw = kh = 0.5; the pointer at (30, 70) centers the window there
    // -> focal (10, 90). Rounded here: the inverse carries fp noise.
    expect(Math.round(layer.focusX as number)).toBe(10);
    expect(Math.round(layer.focusY as number)).toBe(90);
  });

  it("pinching the viewport commits the scaled zoom, carrying the layer's fields", () => {
    const withActive = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5, zoom: 2 },
    });
    const imageBox = document.querySelector("[data-wallpaper-imagebox]") as HTMLElement;
    Object.defineProperty(imageBox, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });
    fireEvent.pointerDown(imageBox, { pointerId: 1, clientX: 0, clientY: 50 });
    fireEvent.pointerDown(imageBox, { pointerId: 2, clientX: 40, clientY: 50 });
    fireEvent.pointerMove(imageBox, { pointerId: 2, clientX: 80, clientY: 50 });
    // The press itself focused (focal x clamps to 0); the pinch then doubles
    // the stored zoom 2 into the max 4. The mock parent never commits back,
    // so focusY stays unstored and is omitted at its default.
    expect(withActive.onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.5, zoom: 4, focusX: 0 },
    });
  });

  it("typing a url while a wallpaper is active keeps its dark variant and stored crop controls", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: {
        url: "https://example.com/old.png",
        dim: 0.4,
        darkUrl: "https://example.com/old-dark.png",
        fit: "cover",
        zoom: 2,
      },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Wallpaper image url" }), {
      target: { value: "https://example.com/new.png" },
    });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: {
        url: "https://example.com/new.png",
        dim: 0.4,
        darkUrl: "https://example.com/old-dark.png",
        fit: "cover",
        zoom: 2,
      },
    });
  });

  it("a preset click while active carries the shown dim and the stored crop controls", () => {
    const { onWallpaperChange } = renderPicker({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6, fit: "cover", zoom: 2 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Picsum: focus-board-3" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: {
        url: "https://picsum.photos/seed/focus-board-3/1920/1080",
        dim: 0.6,
        fit: "cover",
        zoom: 2,
      },
    });
  });

  it("a preset swatch previews the current scheme's variant and flips live with the OS scheme", () => {
    const listeners: Array<() => void> = [];
    const state = { matches: false };
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return state.matches;
      },
      addEventListener(_type: string, listener: () => void) {
        listeners.push(listener);
      },
      removeEventListener: vi.fn(),
    }));
    const acadia = WALLPAPER_PRESETS.find((preset) => preset.label === "Acadia");
    if (acadia === undefined) throw new Error("missing Acadia preset");
    const view = renderPicker(NO_WALLPAPER);
    const swatchStyle = () =>
      screen.getByRole("button", { name: "Wallpaper preset: Acadia" }).getAttribute("style") ?? "";
    expect(swatchStyle()).toContain(acadia.url);
    expect(swatchStyle()).not.toContain(acadia.darkUrl);
    act(() => {
      state.matches = true;
      for (const listener of listeners) listener();
    });
    expect(swatchStyle()).toContain(acadia.darkUrl);
    act(() => {
      state.matches = false;
      for (const listener of listeners) listener();
    });
    expect(swatchStyle()).not.toContain(acadia.darkUrl);
    view.unmount();
    vi.unstubAllGlobals();
  });
});

describe("Openverse search in the wallpaper picker", () => {
  type SearchEntry =
    | { ok: true; body: unknown }
    | { fail: number }
    | { reject: string };

  // The mocked Openverse endpoint answers per requested page, read off the
  // url, so re-search and reset tests can distinguish pages from each other.
  function mockFetch(script: SearchEntry | ((url: string) => SearchEntry)): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: unknown, _init?: unknown) => {
      const entry = typeof script === "function" ? script(String(url)) : script;
      if ("reject" in entry) return Promise.reject(new Error(entry.reject));
      if ("fail" in entry) return Promise.resolve({ ok: false, status: entry.fail });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(entry.body) });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function openverseBody(page: number, titles: readonly string[], pageCount = 20): unknown {
    return {
      page,
      page_count: pageCount,
      results: titles.map((title, index) => ({
        id: `ov-${page}-${index}`,
        title,
        url: `https://example.com/page-${page}-${index}.jpg`,
        thumbnail: `https://api.openverse.org/v1/images/ov-${page}-${index}/thumb/`,
        license: "by",
        license_version: "2.0",
        creator: "Ada",
      })),
    };
  }

  /** The page a mocked Openverse url asks for (1 when the param is absent). */
  function requestedPage(url: string): number {
    const match = /[?&]page=(\d+)/.exec(url);
    return match === null ? 1 : Number(match[1]);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searching hits api.openverse.org and renders clickable results (bad urls dropped)", async () => {
    const fetchMock = mockFetch((url) => ({
      ok: true,
      body: {
        page: requestedPage(url),
        page_count: 20,
        results: [
          {
            id: "ov-1",
            title: "Sunset Beach",
            url: "https://example.com/sunset.jpg",
            thumbnail: "https://api.openverse.org/v1/images/ov-1/thumb/",
            license: "by",
            license_version: "2.0",
            creator: "Ada",
          },
          {
            id: "ov-2",
            title: "Not an image",
            url: "not-a-url",
            thumbnail: null,
            license: "",
            license_version: "",
            creator: "",
          },
        ],
      },
    }));
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openverse.org/v1/images/?q=mountain%20lake&page_size=12&page=1",
      expect.anything(),
    );
    expect(screen.getByText("page 1 of 20")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not an image (unknown license)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/sunset.jpg", dim: 0.35 },
    });
  });

  it("a same-query re-search fetches the next page and replaces the list", async () => {
    const fetchMock = mockFetch((url) => {
      const page = requestedPage(url);
      return { ok: true, body: openverseBody(page, [page === 1 ? "Sunset Beach" : "Forest Fog"]) };
    });
    renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Forest Fog (CC BY 2.0)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Forest Fog (CC BY 2.0)" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeNull();
    expect(screen.getByText("page 2 of 20")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.openverse.org/v1/images/?q=mountain%20lake&page_size=12&page=2",
      expect.anything(),
    );
  });

  it("editing the query resets re-search to page 1", async () => {
    const fetchMock = mockFetch((url) => {
      const page = requestedPage(url);
      return { ok: true, body: openverseBody(page, [`Result P${page}`]) };
    });
    renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "one lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Result P1 (CC BY 2.0)" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Result P2 (CC BY 2.0)" })).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "two lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Result P1 (CC BY 2.0)" })).toBeTruthy());
    expect(screen.getByText("page 1 of 20")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.openverse.org/v1/images/?q=two%20lake&page_size=12&page=1",
      expect.anything(),
    );
  });

  it("a failed next-page search keeps the page, so a retry re-attempts it (still advancing)", async () => {
    const fetchMock = mockFetch((url) =>
      requestedPage(url) === 1
        ? { ok: true, body: openverseBody(1, ["Sunset Beach"]) }
        : { reject: "too far" },
    );
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText(/Openverse search failed: too far/)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.openverse.org/v1/images/?q=mountain%20lake&page_size=12&page=2",
      expect.anything(),
    );
    expect(screen.getByText(/Openverse search failed: too far/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeNull();
    expect(onWallpaperChange).not.toHaveBeenCalled();
  });

  it("a click past the response's last page refuses the fetch and marks the end of results", async () => {
    const fetchMock = mockFetch((url) => ({
      ok: true,
      body: openverseBody(requestedPage(url), ["Sunset Beach"], 2),
    }));
    renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("page 2 of 2")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("page 2 of 2 (last page)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeTruthy();
    expect(screen.queryByText(/Openverse search failed/)).toBeNull();
  });

  it("an empty result set renders a visible no-results line", async () => {
    mockFetch({ ok: true, body: { results: [] } });
    renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "nothing matches" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("No images found for “nothing matches”.")));
  });

  it("a failed search renders the failure (with the reason) and commits nothing", async () => {
    mockFetch({ reject: "network gone" });
    const { onWallpaperChange } = renderPicker(NO_WALLPAPER);
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText(/Openverse search failed/)).toBeTruthy());
    expect(onWallpaperChange).not.toHaveBeenCalled();
  });
});