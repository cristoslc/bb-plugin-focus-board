import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APP_VERSION,
  CURRENT_UNRELEASED_FINGERPRINT,
  EMPTY_UNRELEASED_FINGERPRINT,
  LAST_SEEN_UNRELEASED_ITEMS_KEY,
  WHATS_NEW,
  compareVersions,
  currentUnreleasedLeads,
  unreleasedItemFingerprints,
  unseenUnreleasedLeads,
  whatsNewEntriesFor,
  entriesSince,
  hasUnseenWhatsNew,
  isPrereleaseVersion,
  unreleasedFingerprint,
  groupWhatsNewItems,
} from "../lib/whats-new";
import {
  parseUnreleasedChangelog,
} from "../lib/unreleased-changelog";
import { leadFromBullet, parsePublishedChangelog } from "../lib/changelog-markdown";
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
  it("extracts bullets from the group as text-plus-children records", () => {
    const parsed = parseUnreleasedChangelog(FULL_CHANGELOG_FIXTURE);
    expect(parsed.items).toEqual([
      { text: "**First.** Multi line continuation.", children: [] },
      { text: "**Second.** Plain.", children: [] },
      { text: "**Third.** After a subsection.", children: [] },
    ]);
  });

  it("keeps two-space-indent sub-bullets as children of their bullet", () => {
    // A grouped bullet is one col-zero lead with related sub-bullets under
    // it; each child joins its own continuations and stays its own record.
    const markdown = [
      "## [Unreleased]",
      "",
      "### Changed",
      "",
      "- **Sweep rebuild.** The flow is opt-in now.",
      "  - **Sweep mode is manual.** Enter any time.",
      "  - **A sweep can be cancelled,** and the undo restores",
      "    exactly the ids the run archived.",
    ].join("\n");
    const parsed = parseUnreleasedChangelog(markdown);
    expect(parsed.items).toEqual([
      {
        text: "**Sweep rebuild.** The flow is opt-in now.",
        children: [
          "**Sweep mode is manual.** Enter any time.",
          "**A sweep can be cancelled,** and the undo restores exactly the ids the run archived.",
        ],
      },
    ]);
  });

  it("extracts published sub-bullets as children of their bullet", () => {
    const parsed = parsePublishedChangelog(FULL_CHANGELOG_FIXTURE);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].subsections[0].bullets).toEqual([
      { text: "**Old.** Released work stays out.", children: [] },
    ]);
  });

  it("attaches #### surface headings to published bullets as groups", () => {
    // The finalize rename keeps a section's #### surface headings, so the
    // published What's-new entry groups the same way the dev entry did.
    const markdown = [
      "## [1.2.0] - 2026-10-11",
      "",
      "### Fixed",
      "",
      "#### Wallpaper",
      "",
      "- **Openverse paging.** Walk the result pages.",
      "",
      "### Changed",
      "",
      "#### Wallpaper",
      "",
      "- **Dim slider.** Keeps cards readable.",
    ].join("\n");
    const parsed = parsePublishedChangelog(markdown);
    expect(parsed[0].subsections[0].bullets).toEqual([
      { text: "**Openverse paging.** Walk the result pages.", children: [], group: "Wallpaper" },
    ]);
    expect(parsed[0].subsections[1].bullets).toEqual([
      { text: "**Dim slider.** Keeps cards readable.", children: [], group: "Wallpaper" },
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
    expect(parsed.items).toEqual([
      { text: "**New.** Unreleased work", children: [] },
    ]);
  });

  it("carries #### surface headings as the bullet's group, persisting across subsections", () => {
    // A `#### <surface>` heading tags every following bullet until the next
    // such heading; it deliberately persists across ### subsection lines so
    // one feature's Added/Changed/Fixed bullets end up in one modal group.
    const markdown = [
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "#### Wallpaper",
      "",
      "- **Walls.** Paint the board.",
      "",
      "### Changed",
      "",
      "- **Openverse paging.** Walk the result pages.",
      "",
      "#### The composer",
      "",
      "- **Maximize.** Hands off to the main view.",
    ].join("\n");
    expect(parseUnreleasedChangelog(markdown).items).toEqual([
      { text: "**Walls.** Paint the board.", children: [], group: "Wallpaper" },
      { text: "**Openverse paging.** Walk the result pages.", children: [], group: "Wallpaper" },
      { text: "**Maximize.** Hands off to the main view.", children: [], group: "The composer" },
    ]);
  });

  it("leaves bullets before any #### heading ungrouped", () => {
    const markdown = [
      "## [Unreleased]",
      "",
      "### Added",
      "",
      "- **Ungrouped.** No surface heading above me.",
      "",
      "#### Wallpaper",
      "",
      "- **Tagged.** I follow a surface heading.",
    ].join("\n");
    const parsed = parseUnreleasedChangelog(markdown);
    expect(parsed.items[0]).toEqual({ text: "**Ungrouped.** No surface heading above me.", children: [] });
    expect(parsed.items[1]).toEqual({
      text: "**Tagged.** I follow a surface heading.",
      children: [],
      group: "Wallpaper",
    });
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
    // Same content and opened: seen. The version alone can never make a dev
    // build pulse.
    expect(hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: fp })).toBe(false);
    // A changelog landing changes the content: pulse again, even in-session.
    expect(
      hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: "00000000" }),
    ).toBe(true);
    // Never opened (null snapshot) with standing bullets: pulse — the group
    // standing in the build advertises itself until the reader opens once.
    expect(hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: null })).toBe(true);
  });

  it("never pulses an empty unreleased group", () => {
    const empty = unreleasedFingerprint([]);
    expect(empty).toBe(EMPTY_UNRELEASED_FINGERPRINT);
    const state = {
      runningVersion: "0.6.0-dev",
      lastSeenVersion: "0.6.0-dev",
      unreleasedFingerprint: empty,
    };
    expect(hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: null })).toBe(false);
    expect(hasUnseenWhatsNew({ ...state, lastSeenUnreleasedFingerprint: empty })).toBe(false);
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
    // the fresh-install rules give no published delta. The group's bullets
    // reach the modal as their lead sentences (leadFromBullet), the same
    // seam the published feed derives through.
    if (UNRELEASED_ITEMS.length > 0) {
      const head = {
        version: "0.6.0-dev",
        unreleased: true,
        items: UNRELEASED_ITEMS.map((item) => ({
          lead: leadFromBullet(item.text),
          children: item.children.map(leadFromBullet).filter(Boolean),
          ...(item.group ? { group: item.group } : {}),
        })),
      };
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

const CHANGELOG = readFileSync(
  fileURLToPath(new URL("../CHANGELOG.md", import.meta.url)),
  "utf8",
);

describe("WHATS_NEW derives from CHANGELOG.md's published sections", () => {
  const sections = parsePublishedChangelog(CHANGELOG);

  it("covers every published section, versions sorted newest first", () => {
    // Subset, not equality: WHATS_NEW may also hold legacy hand-written
    // entries for versions (0.5.6–0.5.12) the changelog has no section for.
    const covered = new Set(WHATS_NEW.map((entry) => entry.version));
    for (const section of sections) {
      expect(covered.has(section.version)).toBe(true);
    }
    for (let i = 1; i < WHATS_NEW.length; i += 1) {
      // Strictly descending: the feed must never order two entries alike.
      expect(compareVersions(WHATS_NEW[i].version, WHATS_NEW[i - 1].version)).toBeLessThan(0);
    }
  });

  it("gives every entry an item set of sentence leads plus children", () => {
    for (const entry of WHATS_NEW) {
      expect(entry.items.length).toBeGreaterThan(0);
      for (const item of entry.items) {
        // Every lead is the bullet's first sentence: terminal punctuation,
        // no stray bold markup, and — unlike a bullet — no doc links.
        expect(item.lead).toMatch(/[.!?]$/);
        expect(item.lead).not.toMatch(/\*\*/);
        for (const child of item.children ?? []) {
          expect(child).toMatch(/[.!?]$/);
          expect(child).not.toMatch(/\*\*/);
        }
      }
    }
  });

  it("scrapes the lead through the bold span, then the first sentence", () => {
    // Lead closes its own sentence: the lead is the item.
    expect(leadFromBullet("**Surface ready.** Full mechanics live here.")).toBe("Surface ready.");
    // Lead runs on: the item is the first full sentence from the lead.
    expect(leadFromBullet("**Sorts by done date, newest**, instead of by activity."))
      .toBe("Sorts by done date, newest, instead of by activity.");
    // Ticket refs never reach the modal.
    expect(leadFromBullet("**Renamed to Focus Board** (#8): package renamed.")).toBe("Renamed to Focus Board: package renamed.");
    // No bold and unbroken sentence: first sentence.
    expect(leadFromBullet("One plain sentence. Then elaboration.")).toBe("One plain sentence.");
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
      "1.7.3",
      "1.7.2",
      "1.7.1",
      "1.7.0",
      "1.6.0",
      "1.5.0",
      "1.4.0",
      "1.3.1",
      "1.3.0",
      "1.2.0",
      "1.1.0",
      "1.0.0",
      "0.9.0",
      "0.8.0",
      "0.7.0",
      "0.6.0",
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
      "0.4.6",
      "0.4.5",
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

describe("groupWhatsNewItems", () => {
  const item = (lead: string, group?: string) => ({ lead, group });

  it("merges same-surface items across subsection order into first-appearance groups", () => {
    // Added and Changed bullets tagged with the same #### surface heading
    // land in one modal group, in the order the changelog states them.
    const groups = groupWhatsNewItems([
      item("Boxes.", "Groups and family boxes"),
      item("Wallpaper.", "Wallpaper"),
      item("Openverse paging.", "Wallpaper"),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Groups and family boxes", "Wallpaper"]);
    expect(groups[1].items.map((i) => i.lead)).toEqual(["Wallpaper.", "Openverse paging."]);
  });

  it("keeps a group's item order stable across its later reappearance", () => {
    const groups = groupWhatsNewItems([
      item("First.", "A"),
      item("Mid.", "A"),
      item("Other.", "B"),
      item("Later.", "A"),
    ]);
    expect(groups[0].items.map((i) => i.lead)).toEqual(["First.", "Mid.", "Later."]);
  });

  it("keeps ungrouped entries flat: one null-label group", () => {
    // Legacy published entries carry no groups; the modal renders them
    // exactly as before.
    const groups = groupWhatsNewItems([item("One."), item("Two.")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].items.map((i) => i.lead)).toEqual(["One.", "Two."]);
  });

  it("lands ungrouped items in a trailing unlabeled group when siblings are tagged", () => {
    const groups = groupWhatsNewItems([item("Tagged.", "A"), item("Loose.")]);
    expect(groups.map((g) => g.label)).toEqual(["A", null]);
    expect(groups[1].items.map((i) => i.lead)).toEqual(["Loose."]);
  });
});

describe("per-line unseen tracking for the dev [Unreleased] amber", () => {
  it("exposes the localStorage key and round-trips the stored fingerprint list", () => {
    expect(LAST_SEEN_UNRELEASED_ITEMS_KEY).toBe("focus-board:lastSeenUnreleasedItems");
    expect(unreleasedItemFingerprints(["a", "b"])).toEqual(
      [unreleasedFingerprint(["a"]), unreleasedFingerprint(["b"])],
    );
  });

  it("a null stored list means the reader has never opened it — every line is new", () => {
    const leads = ["New since encoding.", "Another line."];
    const unseen = unseenUnreleasedLeads(leads, null);
    expect([...unseen]).toEqual(unreleasedItemFingerprints(leads));
  });

  it("only leads whose fingerprint is missing from the stored list come back unseen", () => {
    const seenLead = "Seen on the last open.";
    const freshLead = "Landed since.";
    const stored = unreleasedItemFingerprints([seenLead]);
    const unseen = unseenUnreleasedLeads([seenLead, freshLead], stored);
    expect([...unseen]).toEqual([unreleasedFingerprint([freshLead])]);
  });

  it("currentUnreleasedLeads mirrors the feed's unreleased items (one lead per bullet including children)", () => {
    // The stored list is written from these same leads at open time; if the
    // derivation drifts from what the feed renders, amber lies.
    const leads = currentUnreleasedLeads();
    const entry = whatsNewEntriesFor(APP_VERSION, false, null).find(
      (e) => e.unreleased === true,
    );
    if (entry === undefined) return; // a stable build feeds no [Unreleased] entry; the amber per-line tracking lives on prerelease lines alone (the finalized-unprepped window, issue #236's landing)
    const feedLeads = (entry?.items ?? []).flatMap((item) => [
      item.lead,
      ...(item.children ?? []),
    ]);
    expect(leads).toEqual(feedLeads);
  });
});