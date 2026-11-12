/**
 * The pure half of the release pipeline (`scripts/release-pipeline/plan.mjs`):
 * the finalize and re-arm transforms, the release-notes body, the storyboard
 * manifest's shape, and every refusal those steps make. No git, no clock, no
 * network — the fixture repo integration run lives in
 * `tests/release-pipeline.test.ts`.
 */
import { describe, expect, it } from "vitest";
import * as plan from "../scripts/release-pipeline/plan.mjs";

const CHANGELOG = `# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

#### Groups and family boxes

- **A group's frame follows its cards into Done.** The frame used to stop at the first done mark.
  - **A facet sub-bullet rides the same clip.** It never gets its own gif.

### Changed

### Fixed

#### Groups and family boxes

- **A Group-filtered board keeps every child of a matched family.** A cross-group child used to lose its row.

## [1.2.2] - 2026-11-01

### Added

- **An older release bullet.**
`;

describe("versions", () => {
  it("reads a dev candidate, a release, and a prerelease", () => {
    expect(plan.parseReleaseVersion("1.7.12-dev")).toMatchObject({
      version: "1.7.12",
      prerelease: "dev",
      dev: true,
    });
    expect(plan.parseReleaseVersion("1.7.12")).toMatchObject({ version: "1.7.12", prerelease: null, dev: false });
    expect(plan.parseReleaseVersion("2.0.0-rc.1").prerelease).toBe("rc.1");
  });

  it("refuses a stamp that is not semver", () => {
    expect(() => plan.parseReleaseVersion("1.7")).toThrow(/version:malformed/);
    expect(() => plan.parseReleaseVersion("latest")).toThrow(/version:malformed/);
  });

  it("bumps a patch by default and a minor on request", () => {
    expect(plan.bumpVersion("1.7.12")).toBe("1.7.13");
    expect(plan.bumpVersion("1.7.12", "minor")).toBe("1.8.0");
    expect(() => plan.bumpVersion("1.7.12", "major")).toThrow(/version:unknown-bump/);
  });

  it("names the tag a version ships under", () => {
    expect(plan.releaseTag("1.7.12")).toBe("v1.7.12");
    expect(plan.releaseTag("1.7.12-dev")).toBe("v1.7.12");
  });
});

describe("finalizeChangelog", () => {
  const finalized = plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "2026-11-11" });

  it("opens a fresh empty [Unreleased] group with its three subsections", () => {
    expect(finalized.markdown).toContain(
      "## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n\n## [1.3.0] - 2026-11-11\n",
    );
  });

  it("renames the group to the version and its date", () => {
    expect(finalized.markdown).toContain("\n## [1.3.0] - 2026-11-11\n");
    expect(finalized.markdown).not.toContain("## [Unreleased]\n\n### Added\n\n#### Groups and family boxes");
  });

  it("carries the group's bullets into the published section verbatim", () => {
    const section = plan.extractReleaseSection(finalized.markdown, "1.3.0");
    expect(section.date).toBe("2026-11-11");
    expect(section.bullets).toEqual([
      "**A group's frame follows its cards into Done.** The frame used to stop at the first done mark.",
      "**A Group-filtered board keeps every child of a matched family.** A cross-group child used to lose its row.",
    ]);
    expect(section.body).toContain("  - **A facet sub-bullet rides the same clip.** It never gets its own gif.");
    expect(section.body).toContain("#### Groups and family boxes");
  });

  it("leaves the older published section untouched", () => {
    const older = plan.extractReleaseSection(finalized.markdown, "1.2.2");
    expect(older.date).toBe("2026-11-01");
    expect(older.bullets).toEqual(["**An older release bullet.**"]);
  });

  it("takes the commit summary from the group's first bullet lead", () => {
    expect(finalized.summary).toBe("A group's frame follows its cards into Done");
  });

  it("adds a missing Added subsection above the ones already there", () => {
    const group = "## [Unreleased]\n\n### Changed\n\n#### Groups and family boxes\n\n- **A changed bullet.**\n\n### Fixed\n";
    const withoutAdded = `# Changelog\n\n${group}\n## [1.2.2] - 2026-11-01\n`;
    const result = plan.finalizeChangelog({ markdown: withoutAdded, version: "1.3.0", date: "2026-11-11" });
    const section = plan.extractReleaseSection(result.markdown, "1.3.0");
    expect(section.body.split("\n").filter((line: string) => line.startsWith("### "))).toEqual([
      "### Added",
      "### Changed",
      "### Fixed",
    ]);
  });

  it("adds a missing Fixed subsection at the end", () => {
    const group = "## [Unreleased]\n\n### Added\n\n### Changed\n\n#### Groups and family boxes\n\n- **A changed bullet.**\n";
    const withoutFixed = `# Changelog\n\n${group}\n## [1.2.2] - 2026-11-01\n`;
    const result = plan.finalizeChangelog({ markdown: withoutFixed, version: "1.3.0", date: "2026-11-11" });
    const section = plan.extractReleaseSection(result.markdown, "1.3.0");
    expect(section.body.trimEnd().endsWith("### Fixed")).toBe(true);
    expect(section.bullets).toEqual(["**A changed bullet.**"]);
  });

  it("refuses a group with no bullets", () => {
    const empty = "# Changelog\n\n## [Unreleased]\n\n### Added\n\n### Changed\n\n### Fixed\n";
    expect(() => plan.finalizeChangelog({ markdown: empty, version: "1.3.0", date: "2026-11-11" })).toThrow(
      /changelog:unreleased-empty/,
    );
  });

  it("refuses a changelog with no [Unreleased] heading", () => {
    expect(() =>
      plan.finalizeChangelog({ markdown: "# Changelog\n\n## [1.2.2] - 2026-11-01\n", version: "1.3.0", date: "2026-11-11" }),
    ).toThrow(/changelog:unreleased-missing/);
  });

  it("refuses a version that already has a section", () => {
    expect(() => plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.2.2", date: "2026-11-11" })).toThrow(
      /changelog:published-version/,
    );
  });

  it("refuses a bullet that sits before the first subsection heading", () => {
    const bare = CHANGELOG.replace("### Added\n\n#### Groups and family boxes\n", "- **A bullet with no kind.**\n\n");
    expect(() => plan.finalizeChangelog({ markdown: bare, version: "1.3.0", date: "2026-11-11" })).toThrow(
      /changelog:bare-bullets/,
    );
  });

  it("refuses a subsection that is not Added, Changed or Fixed", () => {
    const foreign = CHANGELOG.replace("### Changed\n", "### Improved\n");
    expect(() => plan.finalizeChangelog({ markdown: foreign, version: "1.3.0", date: "2026-11-11" })).toThrow(
      /changelog:unknown-subsection/,
    );
  });

  it("refuses subsections out of the canonical order", () => {
    const ordered = CHANGELOG.replace("### Changed\n\n### Fixed\n", "### Fixed\n\n### Changed\n");
    expect(() => plan.finalizeChangelog({ markdown: ordered, version: "1.3.0", date: "2026-11-11" })).toThrow(
      /changelog:subsection-order/,
    );
  });

  it("refuses a version that still carries a suffix and a date that is not YYYY-MM-DD", () => {
    expect(() => plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0-dev", date: "2026-11-11" })).toThrow(
      /version:not-release/,
    );
    expect(() => plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "Nov 11" })).toThrow(
      /changelog:bad-date/,
    );
  });
});

describe("release notes", () => {
  const markdown = plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "2026-11-11" }).markdown;
  const notes = plan.renderReleaseNotes({
    markdown,
    version: "1.3.0",
    previousTag: "v1.2.2",
    repoUrl: "https://github.com/owner/repo",
  });

  it("retitles the section heading with the version and date", () => {
    expect(notes.split("\n")[0]).toBe("## Focus Board 1.3.0 (2026-11-11)");
  });

  it("keeps the section body verbatim", () => {
    const section = plan.extractReleaseSection(markdown, "1.3.0");
    expect(notes).toContain(section.body);
  });

  it("closes with the compare link against the previous tag", () => {
    const lines = notes.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toBe(
      "**Full changelog**: https://github.com/owner/repo/compare/v1.2.2...v1.3.0",
    );
  });

  it("refuses when the section or the previous tag is missing", () => {
    expect(() =>
      plan.renderReleaseNotes({ markdown, version: "1.9.9", previousTag: "v1.2.2", repoUrl: "https://github.com/o/r" }),
    ).toThrow(/notes:section-missing/);
    expect(() =>
      plan.renderReleaseNotes({ markdown, version: "1.3.0", previousTag: null, repoUrl: "https://github.com/o/r" }),
    ).toThrow(/notes:missing-previous-tag/);
  });

  it("passes its own shape check", () => {
    expect(
      plan.checkReleaseNotes({
        notes,
        markdown,
        version: "1.3.0",
        previousTag: "v1.2.2",
        repoUrl: "https://github.com/owner/repo",
      }),
    ).toEqual([]);
  });

  it("reports a wrong title, a missing bullet and a wrong closing line separately", () => {
    const broken = notes
      .replace("## Focus Board 1.3.0 (2026-11-11)", "## Focus Board 1.3.0")
      .replace("- **An older release bullet.**", "")
      .replace(/\*\*Full changelog\*\*.*$/m, "Thanks for reading.");
    const problems = plan.checkReleaseNotes({
      notes: broken,
      markdown,
      version: "1.3.0",
      previousTag: "v1.2.2",
      repoUrl: "https://github.com/owner/repo",
    });
    expect(problems.map((problem: { reason: string }) => problem.reason).sort()).toEqual([
      "notes:compare-link",
      "notes:heading",
    ]);
  });
});

describe("embedDemoCaptions", () => {
  const markdown = plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "2026-11-11" }).markdown;
  const notes = plan.renderReleaseNotes({
    markdown,
    version: "1.3.0",
    previousTag: "v1.2.2",
    repoUrl: "https://github.com/owner/repo",
  });
  const demos = [
    {
      bullet:
        "**A Group-filtered board keeps every child of a matched family.** A cross-group child used to lose its row.",
      caption: "The cross-group child keeps its row.",
      url: "https://github.com/owner/repo/releases/download/v1.3.0/filter.gif",
    },
  ];

  it("places the image and caption directly under the bullet it demonstrates", () => {
    const captioned = plan.embedDemoCaptions({ notes, demos });
    const lines = captioned.split("\n");
    const bulletLine = lines.findIndex((line) => line.startsWith("- **A Group-filtered board keeps"));
    expect(lines[bulletLine + 1]).toBe("");
    expect(lines[bulletLine + 2]).toBe(
      "![The cross-group child keeps its row.](https://github.com/owner/repo/releases/download/v1.3.0/filter.gif)",
    );
    expect(lines[bulletLine + 3]).toBe("");
  });

  it("keeps the compare link last and is stable across a re-run", () => {
    const once = plan.embedDemoCaptions({ notes, demos });
    const twice = plan.embedDemoCaptions({ notes, demos });
    expect(twice).toBe(once);
    const lines = once.trimEnd().split("\n");
    expect(lines[lines.length - 1]).toContain("**Full changelog**");
  });

  it("refuses an entry that matches no bullet", () => {
    expect(() =>
      plan.embedDemoCaptions({
        notes,
        demos: [{ bullet: "**A bullet nobody wrote.**", caption: "c", url: "https://example.test/x.gif" }],
      }),
    ).toThrow(/notes:bullet-unmatched/);
  });
});

describe("version stamps", () => {
  const packageJson = '{\n  "name": "x",\n  "version": "1.3.0-dev",\n  "type": "module"\n}\n';
  const lock = '{\n  "name": "x",\n  "version": "1.3.0-dev",\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "1.3.0-dev"\n    },\n    "node_modules/y": {\n      "version": "2.0.0"\n    }\n  }\n}\n';
  const whatsNew = 'export const APP_VERSION = "1.3.0-dev";\n\nconst other = 1;\n';

  it("strips the suffix from package.json, the lockfile and APP_VERSION", () => {
    expect(plan.setPackageVersion({ text: packageJson, from: "1.3.0-dev", to: "1.3.0" })).toContain('"version": "1.3.0"');
    const nextLock = plan.setLockVersion({ text: lock, from: "1.3.0-dev", to: "1.3.0" });
    expect(nextLock).not.toContain("1.3.0-dev");
    expect(nextLock).toContain('"version": "2.0.0"');
    expect(plan.setAppVersion({ text: whatsNew, from: "1.3.0-dev", to: "1.3.0" })).toBe(
      'export const APP_VERSION = "1.3.0";\n\nconst other = 1;\n',
    );
  });

  it("refuses a stamp the file does not carry the expected number of times", () => {
    expect(() => plan.setPackageVersion({ text: packageJson, from: "9.9.9", to: "1.3.0" })).toThrow(
      /stamp:unexpected-count/,
    );
    expect(() => plan.setLockVersion({ text: lock, from: "9.9.9", to: "1.3.0" })).toThrow(/stamp:unexpected-count/);
    expect(() => plan.setAppVersion({ text: whatsNew, from: "9.9.9", to: "1.3.0" })).toThrow(/stamp:app-version/);
  });

  it("adds the new version to the entries-since expectation once", () => {
    const test = [
      'describe("entriesSince", () => {',
      '  const entries = entriesSince("0.4.2");',
      "  expect(entries.map((entry) => entry.version)).toEqual([",
      '    "1.2.2",',
      '    "1.1.0",',
      "  ]);",
      "});",
      "",
    ].join("\n");
    const next = plan.addExpectedVersion({ text: test, version: "1.3.0" });
    expect(next).toContain('toEqual([\n      "1.3.0",\n    "1.2.2",');
    expect(plan.addExpectedVersion({ text: next, version: "1.3.0" })).toBe(next);
  });

  it("refuses a test file whose anchor or list moved", () => {
    expect(() => plan.addExpectedVersion({ text: "// nothing here\n", version: "1.3.0" })).toThrow(
      /stamp:entries-anchor/,
    );
    expect(() =>
      plan.addExpectedVersion({
        text: 'const entries = entriesSince("0.4.2");\nexpect(entries.map((entry) => entry.version)).toEqual([\n  notAVersion,\n]);\n',
        version: "1.3.0",
      }),
    ).toThrow(/stamp:entries-list/);
  });
});

describe("the storyboard manifest", () => {
  const valid = `version: 1.3.0
demos:
  - bullet: "**A group's frame follows its cards into Done.**"
    gif: docs/screenshots/release-demos/v1.3.0-group-frame.gif
    caption: "Marking a member done draws the group frame in Done."
    steps: release-demos/v1.3.0.mjs#group-frame
  - bullet: "**A Group-filtered board keeps every child of a matched family.**"
    gif: docs/screenshots/release-demos/v1.3.0-filter.gif
    caption: "Filtering to a group keeps its cross-group child nested."
    steps:
      - "goto ?groupBy=group&groups=grp_gf_alpha"
      - "the parent card renders both children"
`;

  it("reads a manifest with a reference and an inline step outline", () => {
    const storyboard = plan.parseStoryboard(valid);
    expect(storyboard.version).toBe("1.3.0");
    expect(storyboard.demos).toHaveLength(2);
    expect(storyboard.demos[0].steps).toBe("release-demos/v1.3.0.mjs#group-frame");
    expect(storyboard.demos[1].steps).toEqual([
      "goto ?groupBy=group&groups=grp_gf_alpha",
      "the parent card renders both children",
    ]);
    expect(storyboard.skips).toEqual([]);
  });

  it("refuses a typo'd key instead of ignoring it", () => {
    expect(() => plan.parseStoryboard(valid.replace("caption:", "capton:"))).toThrow(/manifest:unknown-key/);
    expect(() => plan.parseStoryboard("version: 1.3.0\ndemo: []\n")).toThrow(/manifest:unknown-key/);
  });

  it("refuses a demo missing a field, a non-gif asset, and a multiline caption", () => {
    expect(() =>
      plan.parseStoryboard(valid.replace('    caption: "Marking a member done draws the group frame in Done."\n', "")),
    ).toThrow(/manifest:missing-field/);
    expect(() => plan.parseStoryboard(valid.replace(".gif", ".mp4"))).toThrow(/manifest:not-a-gif/);
    expect(() =>
      plan.parseStoryboard(valid.replace('caption: "Marking a member done draws the group frame in Done."', 'caption: "two\\nlines"')),
    ).toThrow(/manifest:caption-multiline/);
  });

  it("refuses an empty step list and unparseable yaml", () => {
    expect(() => plan.parseStoryboard(valid.replace("    steps: release-demos/v1.3.0.mjs#group-frame\n", "    steps: []\n"))).toThrow(
      /manifest:steps/,
    );
    expect(() => plan.parseStoryboard("version: [\n")).toThrow(/manifest:yaml/);
  });

  it("holds the manifest to the section it describes", () => {
    const markdown = plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "2026-11-11" }).markdown;
    const section = plan.extractReleaseSection(markdown, "1.3.0");
    const storyboard = plan.parseStoryboard(valid);
    const validated = plan.validateStoryboard({ storyboard, bullets: section.bullets, version: "1.3.0" });
    expect(validated.problems).toEqual([]);
    expect(validated.demos.map((demo: { bulletText: string }) => demo.bulletText)).toEqual(section.bullets);
  });

  it("reports a bullet with no demo and no skip, so a skip is never silent", () => {
    const markdown = plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "2026-11-11" }).markdown;
    const section = plan.extractReleaseSection(markdown, "1.3.0");
    const storyboard = plan.parseStoryboard(valid.replace(/  - bullet: "\*\*A Group-filtered[\s\S]*$/, ""));
    const validated = plan.validateStoryboard({ storyboard, bullets: section.bullets, version: "1.3.0" });
    expect(validated.problems.map((problem: { reason: string }) => problem.reason)).toEqual([
      "manifest:bullets-unaccounted",
    ]);
    expect(validated.problems[0].detail).toContain("A Group-filtered board");
  });

  it("refuses an ambiguous match, a duplicate claim and a version mismatch", () => {
    const markdown = plan.finalizeChangelog({ markdown: CHANGELOG, version: "1.3.0", date: "2026-11-11" }).markdown;
    const section = plan.extractReleaseSection(markdown, "1.3.0");
    const ambiguous = plan.parseStoryboard(valid.replace('bullet: "**A group\'s frame follows its cards into Done.**"', 'bullet: "**A "'));
    expect(
      plan
        .validateStoryboard({ storyboard: ambiguous, bullets: section.bullets, version: "1.3.0" })
        .problems.map((problem: { reason: string }) => problem.reason),
    ).toContain("manifest:bullet-ambiguous");

    const duplicate = plan.parseStoryboard(
      valid + '  - bullet: "**A Group-filtered board keeps every child of a matched family.**"\n    gif: a.gif\n    caption: "dup"\n    steps: "x"\n',
    );
    expect(
      plan
        .validateStoryboard({ storyboard: duplicate, bullets: section.bullets, version: "1.3.0" })
        .problems.map((problem: { reason: string }) => problem.reason),
    ).toContain("manifest:bullet-duplicate");

    const mismatched = plan.parseStoryboard(valid.replace("version: 1.3.0", "version: 1.4.0"));
    expect(
      plan
        .validateStoryboard({ storyboard: mismatched, bullets: section.bullets, version: "1.3.0" })
        .problems.map((problem: { reason: string }) => problem.reason),
    ).toContain("manifest:version-mismatch");
  });
});
