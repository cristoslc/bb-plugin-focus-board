/**
 * The pure half of the release pipeline.
 *
 * `.agents/agents-md-detail/release.md` is the spec; this module is the
 * mechanical part of it: every file transform the finalize and re-arm commits
 * make, the notes body a release page carries, the demo-gif manifest's shape,
 * and every refusal decision those steps need. Nothing here reads a clock, a
 * git repo, the network, or the filesystem, so a test can drive the whole
 * decision surface without a fixture repo (the driver's dry run covers the
 * sequencing; `tests/release-pipeline-plan.test.ts` covers this file).
 *
 * Refusals throw `PlanError` with a stable `reason` slug. The driver prefixes
 * it with its step name (`release-pipeline:finalize:changelog:bare-bullets`),
 * which is what makes a nightly failure name itself in one line.
 */
import { parse as parseYaml } from "yaml";
import { leadFromBullet } from "../../lib/changelog-markdown.ts";

/** The Keep-a-Changelog subsections a release section must carry, in order. */
export const SUBSECTION_ORDER = ["Added", "Changed", "Fixed"];

/** A refusal with a stable slug and a reader-facing detail line. */
export class PlanError extends Error {
  /**
   * @param {string} reason stable slug, e.g. `changelog:unreleased-empty`
   * @param {string} detail what the operator must fix, in plain words
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`);
    this.name = "PlanError";
    this.reason = reason;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/**
 * Reads a version stamp. `1.7.12-dev` is a candidate: `version` is the
 * release number, `prerelease` is `dev`, and `dev` says the stamp still
 * carries the provisional suffix the dev branch wears between releases.
 */
export function parseReleaseVersion(raw) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(raw).trim());
  if (match === null) {
    throw new PlanError("version:malformed", `"${raw}" is not a semver release number`);
  }
  return {
    version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    dev: match[4] === "dev",
  };
}

/** The next release candidate: a patch bump unless the work says otherwise. */
export function bumpVersion(raw, kind = "patch") {
  const parsed = parseReleaseVersion(raw);
  if (kind === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  if (kind === "patch") return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  throw new PlanError("version:unknown-bump", `"${kind}" is not patch or minor`);
}

/** The tag a version ships under. */
export function releaseTag(version) {
  return `v${parseReleaseVersion(version).version}`;
}

/** A tag name as the pages spell it, whether the caller carried the `v` or not. */
export function tagName(tag) {
  return tag.startsWith("v") ? tag : `v${tag}`;
}

// ---------------------------------------------------------------------------
// CHANGELOG.md
// ---------------------------------------------------------------------------

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** The `## [Unreleased]` group's line indices inside a changelog. */
function unreleasedGroup(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## [Unreleased]"));
  if (start === -1) {
    throw new PlanError(
      "changelog:unreleased-missing",
      "CHANGELOG.md has no `## [Unreleased]` heading, so there is nothing to publish",
    );
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      end = index;
      break;
    }
  }
  return { lines, start, end, group: lines.slice(start + 1, end) };
}

/**
 * The column-0 bullets of a changelog fragment, each one's continuation lines
 * joined and its indented sub-bullets dropped. Matching a manifest entry and
 * checking coverage only ever needs the top-level bullets.
 */
export function sectionBullets(text) {
  const bullets = [];
  let current = null;
  const flush = () => {
    if (current !== null) bullets.push(current.trim());
    current = null;
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("- ")) {
      flush();
      current = line.slice(2);
      continue;
    }
    if (current === null) continue;
    if (line.trim() === "" || line.startsWith("#") || line.trimStart().startsWith("- ")) {
      flush();
      continue;
    }
    // A two-space continuation of the bullet's own prose.
    current = `${current} ${line.trim()}`;
  }
  flush();
  return bullets;
}

/** The condensed lead of a bullet, as a commit subject reads it (no period). */
export function summaryFromBullet(bullet) {
  return leadFromBullet(bullet).replace(/\.$/, "");
}

/**
 * Inserts whichever of Added/Changed/Fixed the group is missing, at its
 * canonical place. A group with a bullet before its first heading is refused
 * instead of guessed at: a bullet's kind is the writer's call, and a
 * mislabelled bullet lands in the wrong subsection of the published record.
 */
function ensureSubsections(body) {
  const present = [];
  body.forEach((line, index) => {
    const match = /^### (.+)$/.exec(line);
    if (match !== null) present.push({ name: match[1].trim(), index });
  });
  for (const heading of present) {
    if (!SUBSECTION_ORDER.includes(heading.name)) {
      throw new PlanError(
        "changelog:unknown-subsection",
        `\`### ${heading.name}\` is not one of ${SUBSECTION_ORDER.join(", ")}`,
      );
    }
  }
  for (let index = 1; index < present.length; index += 1) {
    const previous = SUBSECTION_ORDER.indexOf(present[index - 1].name);
    const current = SUBSECTION_ORDER.indexOf(present[index].name);
    if (current < previous) {
      throw new PlanError(
        "changelog:subsection-order",
        `\`### ${present[index].name}\` sits after \`### ${present[index - 1].name}\`; the canonical order is ${SUBSECTION_ORDER.join(", ")}`,
      );
    }
  }
  const firstHeading = present.length === 0 ? body.length : present[0].index;
  const bare = body.slice(0, firstHeading).filter((line) => line.startsWith("- "));
  if (bare.length > 0) {
    throw new PlanError(
      "changelog:bare-bullets",
      `${bare.length} bullet(s) sit before the group's first subsection heading, starting "${bare[0].slice(0, 80)}"; file each under Added, Changed or Fixed`,
    );
  }

  const out = [...body];
  for (const name of SUBSECTION_ORDER) {
    if (out.some((line) => line === `### ${name}`)) continue;
    const rank = SUBSECTION_ORDER.indexOf(name);
    let insertAt = out.length;
    for (let index = 0; index < out.length; index += 1) {
      const match = /^### (.+)$/.exec(out[index]);
      if (match !== null && SUBSECTION_ORDER.indexOf(match[1].trim()) > rank) {
        insertAt = index;
        break;
      }
    }
    const separator = insertAt > 0 && out[insertAt - 1].trim() !== "" ? [""] : [];
    out.splice(insertAt, 0, ...separator, `### ${name}`, "");
  }
  return trimBlankEdges(out);
}

/**
 * The finalize commit's changelog transform: the `[Unreleased]` group is
 * renamed to `[X.Y.Z] - <date>` and a fresh empty group takes its place
 * above it. The published section keeps its bullets verbatim — nothing about
 * a release is composed here, which is what makes the What's-new entry and
 * the release notes derivations of the same text.
 *
 * Returns the new file plus the commit subject's summary, taken from the
 * group's first bullet (the historic shape: 1.7.10's subject was its first
 * Changed bullet's lead).
 */
export function finalizeChangelog({ markdown, version, date }) {
  const parsed = parseReleaseVersion(version);
  if (parsed.prerelease !== null) {
    throw new PlanError(
      "version:not-release",
      `${parsed.version}-${parsed.prerelease} still carries a prerelease suffix; the finalize strips it`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new PlanError("changelog:bad-date", `"${date}" is not a YYYY-MM-DD release date`);
  }
  if (extractReleaseSection(markdown, parsed.version) !== null) {
    throw new PlanError(
      "changelog:published-version",
      `CHANGELOG.md already carries a [${parsed.version}] section; a release is never re-published`,
    );
  }

  const { lines, start, end, group } = unreleasedGroup(markdown);
  const body = trimBlankEdges(group);
  const bullets = sectionBullets(body.join("\n"));
  if (bullets.length === 0) {
    throw new PlanError(
      "changelog:unreleased-empty",
      "the [Unreleased] group carries no bullets, so the release would describe nothing",
    );
  }
  const section = ensureSubsections(body);
  const summary = summaryFromBullet(bullets[0]);
  const fresh = ["## [Unreleased]", "", "### Added", "", "### Changed", "", "### Fixed", ""];
  const renamed = [`## [${parsed.version}] - ${date}`, "", ...section, ""];
  return {
    markdown: [...lines.slice(0, start), ...fresh, ...renamed, ...lines.slice(end)].join("\n"),
    summary,
    version: parsed.version,
  };
}

/**
 * One published section, heading excluded: its date, its body verbatim, and
 * the bullets a manifest match and the notes check both read.
 */
export function extractReleaseSection(markdown, version) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const heading = /^## \[[^\]]+\](?:\s*[—-]\s*(.*))?$/.exec(lines[start]);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      end = index;
      break;
    }
  }
  const body = trimBlankEdges(lines.slice(start + 1, end)).join("\n");
  return { heading: lines[start], date: heading?.[1]?.trim() || null, body, bullets: sectionBullets(body) };
}

// ---------------------------------------------------------------------------
// Release notes
// ---------------------------------------------------------------------------

/** The compare link that closes every release body. */
export function compareLine({ repoUrl, previousTag, version }) {
  if (!previousTag) {
    throw new PlanError(
      "notes:missing-previous-tag",
      "no earlier release tag was found on main, so the notes have nothing to compare against",
    );
  }
  return `**Full changelog**: ${repoUrl}/compare/${tagName(previousTag)}...${releaseTag(version)}`;
}

/**
 * The release page body: the version's changelog section verbatim under a
 * retitled heading, closed by the previous tag's compare link
 * (release.md section 4, v0.5.21's shape).
 */
export function renderReleaseNotes({ markdown, version, previousTag, repoUrl }) {
  const section = extractReleaseSection(markdown, version);
  if (section === null) {
    throw new PlanError("notes:section-missing", `CHANGELOG.md has no [${version}] section to publish`);
  }
  if (section.date === null) {
    throw new PlanError("notes:missing-date", `the [${version}] heading carries no date`);
  }
  return `## Focus Board ${version} (${section.date})\n\n${section.body}\n\n${compareLine({ repoUrl, previousTag, version })}\n`;
}

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** The bullet block (its own line plus continuations and sub-bullets). */
function bulletBlock(lines, bulletText) {
  const needle = normalize(bulletText);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("- ")) continue;
    const joined = [lines[index].slice(2)];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (lines[next].trim() === "" || lines[next].startsWith("#")) break;
      joined.push(lines[next].trim());
    }
    if (!normalize(joined.join(" ")).startsWith(needle)) continue;
    let end = index;
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === "" || line.startsWith("#") || line.startsWith("- ")) break;
      end = next;
    }
    return { start: index, end };
  }
  return null;
}

/**
 * Places each demo's one-line caption and image directly under the bullet it
 * demonstrates (the wallpaper precedent, release.md section 4). The body is
 * rebuilt from the pristine section every time, so re-running the step cannot
 * stack a second image under the same bullet.
 */
export function embedDemoCaptions({ notes, demos }) {
  const lines = notes.split("\n");
  for (const demo of demos) {
    const block = bulletBlock(lines, demo.bullet);
    if (block === null) {
      throw new PlanError(
        "notes:bullet-unmatched",
        `no bullet in the release body starts with "${demo.bullet}"`,
      );
    }
    const caption = normalize(demo.caption);
    const image = `![${caption}](${demo.url})`;
    const insertAt = block.end + 1;
    const trailer = lines[insertAt] === undefined || lines[insertAt].trim() === "" ? [] : [""];
    lines.splice(insertAt, 0, "", image, ...trailer);
  }
  return lines.join("\n");
}

/**
 * The shape `verify` holds a published release to: the retitled heading, the
 * section's every bullet still present, and the compare link last. Each
 * departure is one problem, so a wrong body reports every wrong part at once.
 */
export function checkReleaseNotes({ notes, markdown, version, previousTag, repoUrl }) {
  const problems = [];
  const section = extractReleaseSection(markdown, version);
  if (section === null) {
    return [{ reason: "notes:section-missing", detail: `CHANGELOG.md has no [${version}] section` }];
  }
  const lines = notes.split("\n");
  const heading = `## Focus Board ${version} (${section.date ?? ""})`;
  if (normalize(lines[0] ?? "") !== normalize(heading)) {
    problems.push({
      reason: "notes:heading",
      detail: `the body opens "${lines[0] ?? ""}", not "${heading}"`,
    });
  }
  const last = [...lines].reverse().find((line) => line.trim() !== "") ?? "";
  const expectedLast = compareLine({ repoUrl, previousTag, version });
  if (normalize(last) !== normalize(expectedLast)) {
    problems.push({ reason: "notes:compare-link", detail: `the body closes "${last}", not "${expectedLast}"` });
  }
  const body = normalize(notes);
  const missing = section.bullets.filter((bullet) => !body.includes(normalize(bullet)));
  if (missing.length > 0) {
    problems.push({
      reason: "notes:bullet-missing",
      detail: `${missing.length} bullet(s) from the [${version}] section are absent from the body, starting "${missing[0].slice(0, 80)}"`,
    });
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Version stamps
// ---------------------------------------------------------------------------

/**
 * Rewrites the N occurrences of a `"version": "<from>"` stamp and refuses
 * when the count is not the one the file is known to carry: a lockfile that
 * moved shape must stop the release, not be guessed at.
 */
function rewriteStamp({ text, from, to, expected, file }) {
  const needle = `"version": ${JSON.stringify(from)}`;
  const count = text.split(needle).length - 1;
  if (count !== expected) {
    throw new PlanError(
      "stamp:unexpected-count",
      `${file} carries ${count} \`${needle}\` stamp(s), expected ${expected}`,
    );
  }
  return text.split(needle).join(`"version": ${JSON.stringify(to)}`);
}

/** `package.json`: the root version stamp, once. */
export function setPackageVersion({ text, from, to }) {
  return rewriteStamp({ text, from, to, expected: 1, file: "package.json" });
}

/** `package-lock.json`: the root stamp and the `packages[""]` stamp. */
export function setLockVersion({ text, from, to }) {
  return rewriteStamp({ text, from, to, expected: 2, file: "package-lock.json" });
}

/** `lib/whats-new.ts`: `APP_VERSION`, which the modal's pulse reads. */
export function setAppVersion({ text, from, to }) {
  const needle = `export const APP_VERSION = ${JSON.stringify(from)};`;
  const count = text.split(needle).length - 1;
  if (count !== 1) {
    throw new PlanError(
      "stamp:app-version",
      `lib/whats-new.ts carries ${count} \`${needle}\` line(s), expected 1`,
    );
  }
  return text.split(needle).join(`export const APP_VERSION = ${JSON.stringify(to)};`);
}

/**
 * `tests/whats-new.test.ts` pins the full entries-since list, so every
 * published version has to appear at its top. The edit is anchored on the
 * one call and one list the test has carried since 1.x, and refuses when the
 * anchor or the list's first line is not the shape it knows.
 */
export function addExpectedVersion({ text, version }) {
  const anchor = 'const entries = entriesSince("0.4.2");';
  if (text.split(anchor).length - 1 !== 1) {
    throw new PlanError(
      "stamp:entries-anchor",
      `tests/whats-new.test.ts must carry exactly one \`${anchor}\``,
    );
  }
  const listOpen = text.indexOf("toEqual([", text.indexOf(anchor));
  if (listOpen === -1) {
    throw new PlanError("stamp:entries-list", "the entries-since expectation has no toEqual([ list");
  }
  const firstLineStart = text.indexOf("\n", listOpen) + 1;
  const firstLineEnd = text.indexOf("\n", firstLineStart);
  const firstLine = text.slice(firstLineStart, firstLineEnd);
  if (!/^\s*"\d+\.\d+\.\d+",\s*$/.test(firstLine)) {
    throw new PlanError(
      "stamp:entries-list",
      `the entries-since list opens "${firstLine.trim()}", not a version entry`,
    );
  }
  if (firstLine.trim() === `"${version}",`) return text;
  return `${text.slice(0, firstLineStart)}      "${version}",\n${text.slice(firstLineStart)}`;
}

// ---------------------------------------------------------------------------
// The storyboard manifest
// ---------------------------------------------------------------------------

const DEMO_KEYS = new Set(["bullet", "gif", "caption", "steps"]);
const SKIP_KEYS = new Set(["bullet", "reason"]);
const ROOT_KEYS = new Set(["version", "demos", "skips"]);

function refuseUnknownKeys({ object, allowed, where }) {
  const unknown = Object.keys(object).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new PlanError(
      "manifest:unknown-key",
      `${where} carries ${unknown.map((key) => `"${key}"`).join(", ")}; allowed keys are ${[...allowed].join(", ")}`,
    );
  }
}

function requireText({ value, where }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlanError("manifest:missing-field", `${where} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Reads `docs/releases/<version>/storyboard.yaml`. The manifest is the one
 * thing the nightly agent authors rather than the driver: which demonstrable
 * bullets get a gif, the exact step outline for each demo, and a named reason
 * for every skip. This parser only holds its shape.
 */
export function parseStoryboard(text, { source = "storyboard.yaml" } = {}) {
  let document;
  try {
    document = parseYaml(text);
  } catch (error) {
    throw new PlanError("manifest:yaml", `${source} does not parse: ${error.message}`);
  }
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new PlanError("manifest:shape", `${source} must be a YAML mapping`);
  }
  refuseUnknownKeys({ object: document, allowed: ROOT_KEYS, where: source });

  const version = requireText({ value: document.version, where: `${source}: version` });
  parseReleaseVersion(version);

  const rawDemos = document.demos ?? [];
  const rawSkips = document.skips ?? [];
  if (!Array.isArray(rawDemos)) throw new PlanError("manifest:shape", `${source}: demos must be a list`);
  if (!Array.isArray(rawSkips)) throw new PlanError("manifest:shape", `${source}: skips must be a list`);

  const demos = rawDemos.map((entry, index) => {
    const where = `${source}: demos[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PlanError("manifest:shape", `${where} must be a mapping`);
    }
    refuseUnknownKeys({ object: entry, allowed: DEMO_KEYS, where });
    const bullet = requireText({ value: entry.bullet, where: `${where}.bullet` });
    const gif = requireText({ value: entry.gif, where: `${where}.gif` });
    if (!gif.endsWith(".gif")) {
      throw new PlanError("manifest:not-a-gif", `${where}.gif is "${gif}"; a demo asset is a .gif`);
    }
    const caption = requireText({ value: entry.caption, where: `${where}.caption` });
    if (/\n/.test(caption)) {
      throw new PlanError("manifest:caption-multiline", `${where}.caption must be one line`);
    }
    const steps = entry.steps;
    const stepsOk =
      (typeof steps === "string" && steps.trim() !== "") ||
      (Array.isArray(steps) && steps.length > 0 && steps.every((step) => typeof step === "string" && step.trim() !== ""));
    if (!stepsOk) {
      throw new PlanError(
        "manifest:steps",
        `${where}.steps must be a capture-steps reference or a non-empty list of steps`,
      );
    }
    return {
      bullet,
      gif,
      caption,
      steps: Array.isArray(steps) ? steps.map((step) => step.trim()) : steps.trim(),
    };
  });

  const skips = rawSkips.map((entry, index) => {
    const where = `${source}: skips[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PlanError("manifest:shape", `${where} must be a mapping`);
    }
    refuseUnknownKeys({ object: entry, allowed: SKIP_KEYS, where });
    return {
      bullet: requireText({ value: entry.bullet, where: `${where}.bullet` }),
      reason: requireText({ value: entry.reason, where: `${where}.reason` }),
    };
  });

  return { version, demos, skips };
}

/**
 * Holds a manifest to the release section it describes: every entry names one
 * bullet, no bullet is claimed twice, and every bullet of the section is
 * either demonstrated or skipped with a reason — the "skip gifs are never
 * silent" rule, mechanized. Every departure is collected, so one run reports
 * the whole gap.
 */
export function validateStoryboard({ storyboard, bullets, version }) {
  const problems = [];
  if (storyboard.version !== version) {
    problems.push({
      reason: "manifest:version-mismatch",
      detail: `the manifest names ${storyboard.version}, the release is ${version}`,
    });
  }
  const claimed = new Map();

  const resolve = (entry, where) => {
    const needle = normalize(entry.bullet);
    const matches = bullets.filter((bullet) => normalize(bullet).includes(needle));
    if (matches.length === 0) {
      problems.push({
        reason: "manifest:bullet-unmatched",
        detail: `${where} "${entry.bullet}" matches no bullet in the [${version}] section`,
      });
      return null;
    }
    if (matches.length > 1) {
      problems.push({
        reason: "manifest:bullet-ambiguous",
        detail: `${where} "${entry.bullet}" matches ${matches.length} bullets; quote more of it`,
      });
      return null;
    }
    if (claimed.has(matches[0])) {
      problems.push({
        reason: "manifest:bullet-duplicate",
        detail: `${where} "${entry.bullet}" claims a bullet ${claimed.get(matches[0])} already claims`,
      });
      return null;
    }
    claimed.set(matches[0], where);
    return matches[0];
  };

  const demos = [];
  storyboard.demos.forEach((demo, index) => {
    const bullet = resolve(demo, `demos[${index}]`);
    if (bullet !== null) demos.push({ ...demo, bulletText: bullet });
  });
  const skips = [];
  storyboard.skips.forEach((skip, index) => {
    const bullet = resolve(skip, `skips[${index}]`);
    if (bullet !== null) skips.push({ ...skip, bulletText: bullet });
  });

  const unaccounted = bullets.filter((bullet) => !claimed.has(bullet));
  if (unaccounted.length > 0) {
    problems.push({
      reason: "manifest:bullets-unaccounted",
      detail: `${unaccounted.length} bullet(s) have neither a demo nor a skip: ${unaccounted
        .map((bullet) => `"${normalize(bullet).slice(0, 60)}"`)
        .join(", ")}`,
    });
  }

  return { demos, skips, problems };
}
