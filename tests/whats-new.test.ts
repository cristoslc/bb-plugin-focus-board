import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION,
  WHATS_NEW,
  compareVersions,
  entriesSince,
} from "../lib/whats-new";

const packageVersion = (): string =>
  (JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { version: string }).version;

describe("APP_VERSION stays in lockstep with package.json", () => {
  it("matches the package version", () => {
    // The board surfaces APP_VERSION, not package.json; if these drift, the
    // gift button would pulse for a version the user already has.
    expect(APP_VERSION).toBe(packageVersion());
  });

  it("has a WHATS_NEW entry for the current version", () => {
    // An update whose modal cannot describe itself is a silent update.
    expect(WHATS_NEW.some((entry) => entry.version === APP_VERSION)).toBe(true);
  });
});

describe("compareVersions", () => {
  it("orders major, minor, patch", () => {
    expect(compareVersions("0.5.0", "0.4.4")).toBeGreaterThan(0);
    expect(compareVersions("0.4.4", "0.5.0")).toBeLessThan(0);
    expect(compareVersions("0.4.4", "0.4.4")).toBe(0);
  });

  it("is segment-numeric, not lexicographic", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("treats a missing segment as 0", () => {
    expect(compareVersions("0.5", "0.5.0")).toBe(0);
    expect(compareVersions("0.5.1", "0.5")).toBeGreaterThan(0);
  });

  it("falls back to string comparison for non-numeric segments", () => {
    expect(compareVersions("0.5.0-beta", "0.5.0")).toBeLessThan(0);
    expect(compareVersions("0.5.0", "0.5.0-beta")).toBeGreaterThan(0);
  });
});

describe("entriesSince", () => {
  it("returns entries strictly newer than the stored version", () => {
    const entries = entriesSince("0.4.2");
    expect(entries.map((entry) => entry.version)).toEqual(["0.5.0", "0.4.4", "0.4.3"]);
  });

  it("returns everything newer, newest first, when far behind", () => {
    expect(entriesSince("0.1.0").map((entry) => entry.version)).toEqual(
      WHATS_NEW.map((entry) => entry.version),
    );
  });

  it("returns nothing when up to date", () => {
    expect(entriesSince(APP_VERSION)).toEqual([]);
  });

  it("returns nothing for a fresh install (null)", () => {
    // Everything is new on a first install; the first visit just records the
    // running version, so no entry qualifies as a delta.
    expect(entriesSince(null)).toEqual([]);
  });
});