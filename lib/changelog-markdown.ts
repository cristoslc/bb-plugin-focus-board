/**
 * Structural reader for the published sections of CHANGELOG.md.
 *
 * A published bullet carries exactly two structural levels beyond its prose,
 * and both are headings: the H2 (`## [0.5.21] - 2026-09-30`) names the
 * version, the H3 (`### Added` / `### Changed` / `### Fixed`) names the kind
 * of change. A bullet is free to run full-record length — mechanism,
 * forensics, doc links — because the What's-new modal never reads it: it
 * reads the bullet's opening sentence, which by house style begins with the
 * bolded lead span (no markup change, and no fake H4s inside list items to
 * break the Keep-a-Changelog format). `leadFromBullet` is the single seam
 * between the full record and the condensed modal; scripts/generate-
 * whats-new.mjs feeds every published bullet through it, and dev's
 * unreleased group does the same, so the modal is sentence-length
 * everywhere.
 *
 * The [Unreleased] group reader is `unreleased-changelog.ts`; that group has
 * its own parser because its pulse fingerprint digests the WHOLE bullets
 * (any change to the record re-pulses dev), while only the leads reach the
 * modal — the same split the release spoke documents.
 */

export interface PublishedSection {
  /** The bracketed label from the H2 heading; the `[Unreleased]` group is excluded. */
  version: string;
  /** The trailing date on the heading, when it has one. */
  date: string | null;
  /** `###` subsections in document order, each with its column-0 bullets, joined but unparsed into sentences. */
  subsections: { type: string; bullets: string[] }[];
}

export interface ChangelogSubsection {
  type: string;
  bullets: string[];
}

const H2 = /^## \[([^\]]+)\](?:\s*[—-]\s*(.*))?$/;
const H3 = /^### (.+)$/;

/** Parses every dated `## [version]` section, newest (document) order first. */
export function parsePublishedChangelog(markdown: string): PublishedSection[] {
  return parseSections(markdown).filter((section) => section.version !== "Unreleased");
}

/**
 * The What's-new condensation of one changelog bullet: its bolded lead
 * span when the bullet opens with one (house style guarantees it closes),
 * else the bullet's first sentence. Trailing ticket references ("(#8)")
 * are stripped and terminal punctuation is ensured, so the result reads
 * as a standalone one-liner with no internal bookkeeping.
 */
export function leadFromBullet(bullet: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(bullet);
  const lead = bold ? bold[1] : null;
  const rest = bold ? bullet.slice(bold[0].length).trimStart() : "";
  let item: string;
  if (lead === null) {
    item = firstSentence(bullet);
  } else if (/[.!?]$/.test(lead)) {
    // The bold lead closed its own sentence — it IS the first sentence.
    item = lead;
  } else {
    // The lead runs into the next fragment ("…newest first**, instead of"):
    // the item is the first full sentence starting from the lead.
    item = firstSentence(/^\s*[,;:)]/.test(rest) ? lead + rest : `${lead} ${rest}`);
  }
  item = item.replace(/\s*\(#[^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (item.length === 0) return "";
  return /[.!?]$/.test(item) ? item : `${item}.`;
}

function firstSentence(bullet: string): string {
  // A "." followed by a digit can never match (a trailing "0.4.5" is one
  // token); a punctuation mark followed by whitespace ends the sentence.
  const match = /^(.+?[.!?])(?=\s|$)/s.exec(bullet);
  return match ? match[1] : bullet.trim();
}

/** Same line-joining rules as the unreleased reader (two-space continuation, slash-token repair). */
function joinBullet(first: string, rest: string[]): string {
  let text = first;
  for (const line of rest) {
    const continuation = line.trim();
    text += ((continuation.startsWith("/") || text.endsWith("/")) ? "" : " ") + continuation;
  }
  return text;
}

/** Heading-to-heading section splitter shared by both surface readers. */
function parseSections(markdown: string): { version: string; date: string | null; subsections: ChangelogSubsection[] }[] {
  const sections: { version: string; date: string | null; subsections: ChangelogSubsection[] }[] = [];
  let current: { version: string; date: string | null; subsections: ChangelogSubsection[] } | null = null;
  let subsection: ChangelogSubsection | null = null;
  let bullet: { lines: string[] } | null = null;

  const flushBullet = () => {
    if (bullet !== null && subsection !== null) {
      subsection.bullets.push(joinBullet(bullet.lines[0], bullet.lines.slice(1)));
    }
    bullet = null;
  };

  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      flushBullet();
      if (current !== null) sections.push(current);
      const group = H2.exec(line);
      if (group === null) break; // a top-of-doc "## Changelog" style line ends the parse
      current = {
        version: group[1].trim(),
        date: group[2]?.trim() || null,
        subsections: [],
      };
      subsection = null;
      continue;
    }
    if (current === null) continue; // intro prose before the first section
    const sub = H3.exec(line);
    if (sub !== null) {
      flushBullet();
      subsection = { type: sub[1].trim(), bullets: [] };
      current.subsections.push(subsection);
      continue;
    }
    if (line.startsWith("- ")) {
      flushBullet();
      bullet = { lines: [line.slice(2)] };
      continue;
    }
    if (bullet !== null && (line === "" || !line.startsWith(" "))) {
      // A blank line or stray non-indented prose ends the bullet.
      flushBullet();
      continue;
    }
    if (bullet !== null) {
      // Two-space continuation of the current bullet.
      bullet.lines.push(line);
    }
  }
  flushBullet();
  if (current !== null) sections.push(current);
  return sections;
}