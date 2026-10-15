// @vitest-environment jsdom
// The plugin detail page's configuration section: the Appearance rows are
// mirrored from the settings modal onto bb's configuration page, holding
// their own state and writing the same localStorage keys the modal writes —
// a presentational mirror, never a second store.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CARD_TRANSPORT_KEY,
  LANE_DIRECTION_KEY,
  MOTION_PREF_KEY,
  WALLPAPER_KEY,
} from "../components/preferences";
import { AppearanceSettingsSection } from "../components/settings-section";

const seeded = (records: Record<string, string>) => {
  for (const [key, value] of Object.entries(records)) {
    window.localStorage.setItem(key, value);
  }
};

afterEach(cleanup);

describe("configuration-page Appearance section", () => {
  it("defaults to the zoom transport and system motion with nothing stored", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    const card = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')]
      .map((el) => el.textContent);
    expect(card).toEqual(["Zoom out / in", "Use my system setting", "Vertical"]);
    const unit = screen.getByLabelText("Motion");
    expect(unit).not.toBeNull();
  });

  it("renders the stored values (the modal's choices mirror here)", () => {
    seeded({
      [CARD_TRANSPORT_KEY]: "teleport",
      [MOTION_PREF_KEY]: "full",
      [LANE_DIRECTION_KEY]: "horizontal",
    });
    render(<AppearanceSettingsSection />);
    const checked = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')]
      .map((el) => el.textContent);
    expect(checked).toEqual(["Teleport", "Always play in full", "Horizontal"]);
  });

  it("a lane-direction pick writes the modal's localStorage key", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: "Horizontal" }));
    expect(window.localStorage.getItem(LANE_DIRECTION_KEY)).toBe("horizontal");
  });

  it("a transport pick writes the modal's localStorage key through the shared serializer", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(window.localStorage.getItem(CARD_TRANSPORT_KEY)).toBe("none");
    fireEvent.click(screen.getByRole("radio", { name: "Teleport" }));
    expect(window.localStorage.getItem(CARD_TRANSPORT_KEY)).toBe("teleport");
  });

  it("a motion pick writes the modal's localStorage key", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: "Always reduce" }));
    expect(window.localStorage.getItem(MOTION_PREF_KEY)).toBe("reduce");
  });

  it("hosts the wallpaper picker (the backdrop control the tab carries)", () => {
    seeded({
      [WALLPAPER_KEY]: JSON.stringify({ version: 1, global: null }),
    });
    render(<AppearanceSettingsSection />);
    expect(screen.queryByRole("textbox", { name: "Wallpaper image url" })).not.toBeNull();
  });
});