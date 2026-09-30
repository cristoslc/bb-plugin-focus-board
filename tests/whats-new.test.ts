import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION,
  CURRENT_UNRELEASED_FINGERPRINT,
  WHATS_NEW,
  compareVersions,
  whatsNewEntriesFor,
  entriesSince,
  hasUnseenWhatsNew,
  isPrereleaseVersion,
  unreleasedFingerprint,
} from "../lib/whats-new";
import {
  parseUnreleasedChangelog,
} from "../lib/unreleased-changelog";
import { UNRELEASED_ITEMS } from "../lib/unreleased-changelog.generated";

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

  it("has a WHATS_NEW entry for the current released version", () => {
    // A released version whose modal cannot describe itself is a silent
    // update. A -dev build is not a release — its "entry" lives in the
    // changelog's [Unreleased] group and gets its WHATS_NEW entry when the
    // finalize commit strips the suffix, and the pulse guard keeps dev
    // quiet rather than a placeholder entry doing it.
    if (isPrereleaseVersion(APP_VERSION)) return;
    expect(WHATS_NEW.some((entry) => entry.version === APP_VERSION)).toBe(true);
  });

  it("recognizes prerelease suffixes", () => {
    expect(isPrereleaseVersion("0.6.0-dev")).toBe(true);
    expect(isPrereleaseVersion("0.6.0-beta.2")).toBe(true);
    expect(isPrereleaseVersion("0.6.0")).toBe(false);
  });
});

const FULL_CHANGELOG_FIXTURE = `# Changelog

All notable changes.

## [Unreleased]

### Added

- **First.** Multi
  line continuation.

- **Second.** Plain.

### Changed

- **Third.** After a subsection.

## [0.5.21] - 2026-09-30

### Fixed

- **Old.** Released work stays out.
`;

const EMPTY_UNRELEASED_FIXTURE = `## [Unreleased]

_Nothing unreleased — bullets land here as work merges._

### Added

### Changed

### Fixed

## [0.5.21] - 2026-09-30
`;

describe("parseUnreleasedChangelog", () => {
  it("extracts bullets from the group, unwrapped and unbolded", () => {
    const parsed = parseUnreleasedChangelog(FULL_CHANGELOG_FIXTURE);
    expect(parsed.items).toEqual([
      "First. Multi line continuation.",
      "Second. Plain.",
      "Third. After a subsection.",
    ]);
  });

  it("returns nothing for the current committed state if the group is empty", () => {
    expect(parseUnreleasedChangelog(EMPTY_UNRELEASED_FIXTURE).items).toEqual([]);
  });

  it("returns nothing when there is no [Unreleased] group", () => {
    expect(parseUnreleasedChangelog("# Changelog\npublished only\n").items).toEqual([]);
  });

  it("stops at the next release section", () => {
    const parsed = parseUnreleasedChangelog(
      "## [Unreleased]\n\n- **New.** Unreleased work\n\n## [0.5.21] - 2026-09-30\n\n- **Old.** Released work\n",
    );
    expect(parsed.items).toEqual(["New. Unreleased work"]);
  });
});

describe("unreleasedFingerprint", () => {
  it("is stable and order-sensitive", () => {
    const first = ["One item."];
    expect(unreleasedFingerprint(first)).toBe(unreleasedFingerprint([...first]));
    expect(unreleasedFingerprint(first)).not.toBe(
      unreleasedFingerprint(["Two items.", "Different one."]),
    );
  });

  it("distinguishes the empty group from anything non-empty", () => {
    expect(unreleasedFingerprint([])).not.toBe(unreleasedFingerprint(["One item."]));
  });
});

describe("hasUnseenWhatsNew", () => {
  // Mirrors the app.tsx wiring — this constant is the embedded group's fp.
  it("pulses on the unreleased group for prerelease builds, keyed to content", () => {
    const fp = unreleasedFingerprint(["An unreleased bullet."]);
    const state = {
      runningVersion: "0.6.0-dev",
      lastSeenVersion: "0.6.0-dev",
      unreleasedFingerprint: fp,
    };
    // Same content: seen. The version alone can never make a dev build pulse.
    expect(hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: fp })).toBe(false);
    // A changelog landing changes the content: pulse again, even in-session.
    expect(
      hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: "00000000" }),
    ).toBe(true);
    // Unseen before the first open — but the loader stamps silently, so this
    // is only the pre-effect state, which the app treats as fresh.
    expect(hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: null })).toBe(false);
  });

  it("keeps version-based pulse semantics for stable builds", () => {
    expect(
      hasUnseenWhatsNew({
        runningVersion: "0.6.0",
        lastSeenVersion: "0.5.21",
        unreleasedFingerprint: CURRENT_UNRELEASED_FINGERPRINT,
        lastSeenUnreleasedFingerprint: null,
      }),
    ).toBe(true);
    expect(
      hasUnseenWhatsNew({
        runningVersion: "0.6.0",
        lastSeenVersion: "0.6.0",
        unreleasedFingerprint: CURRENT_UNRELEASED_FINGERPRINT,
        lastSeenUnreleasedFingerprint: null,
      }),
    ).toBe(false);
  });
});

describe("whatsNewEntriesFor", () => {
  it("leads a prerelease build with its unreleased group, then the published feed", () => {
    // The committed [Unreleased] group's shape is whatever the changelog
    // holds right now — assert structure, not emptiness; lastSeen null means
    // the fresh-install rules give no published delta.
    if (UNRELEASED_ITEMS.length > 0) {
      const head = { version: "0.6.0-dev", unreleased: true, items: UNRELEASED_ITEMS };
      expect(whatsNewEntriesFor("0.6.0-dev", true, null)).toEqual([head]);
      expect(whatsNewEntriesFor("0.6.0-dev", false, null)).toEqual([head, ...WHATS_NEW]);
    } else {
      expect(whatsNewEntriesFor("0.6.0-dev", true, null)).toEqual([]);
      expect(whatsNewEntriesFor("0.6.0-dev", false, null)).toEqual([...WHATS_NEW]);
    }
  });

  it("keeps stable-build behavior", () => {
    expect(whatsNewEntriesFor("0.6.0", true, "0.4.2")).toEqual(entriesSince("0.4.2"));
    expect(whatsNewEntriesFor("0.6.0", false, null)).toEqual([...WHATS_NEW]);
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
    expect(entries.map((entry) => entry.version)).toEqual([
      "0.5.21",
      "0.5.20",
      "0.5.19",
      "0.5.18",
      "0.5.17",
      "0.5.16",
      "0.5.15",
      "0.5.14",
      "0.5.13",
      "0.5.12",
      "0.5.11",
      "0.5.10",
      "0.5.9",
      "0.5.8",
      "0.5.7",
      "0.5.6",
      "0.5.5",
      "0.5.4",
      "0.5.3",
      "0.5.2",
      "0.5.1",
      "0.5.0",
      "0.4.4",
      "0.4.3",
    ]);
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