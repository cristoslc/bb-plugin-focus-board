/**
 * Ticket-reference detection for board cards ("mirror, don't integrate").
 *
 * Pure string work: find ticket references in thread titles and branch
 * names and turn them into optional link-outs. Zero credentials, zero SDK
 * surface. See docs/plans/2026-09-25-tracker-mirroring-ticket-id-detection-link-out.md
 * for the pattern set and false-positive guards.
 */

/** Resolve a git remote URL to an "owner/repo" slug; null when not GitHub. */
export function resolveRepoSlug(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const https = remote.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (https) return https[1];
  const ssh = remote.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  return null;
}

export interface TicketRef {
  /** The matched text, e.g. "PROJ-123", "#482". */
  raw: string;
  /** "generic" for PROJ-123 style keys, "github" for #N and GitHub URLs. */
  tracker: "generic" | "github";
  /**
   * Issue vs PR when the raw text itself implies it (GitHub URL refs).
   * Plain "#N" refs stay kindless — issues and PRs share GitHub's number
   * space — and the chip defaults to the issue glyph until live status
   * corrects it.
   */
  kind?: "issue" | "pull";
  /** Issue/PR number for numeric refs (#123, GitHub URL forms). */
  number?: number;
  /** Project key for PROJ-123 style refs, e.g. "PROJ". */
  key?: string;
  /** Direct href when resolvable; absent refs render as inert chips. */
  href?: string;
}

export interface TicketRefOptions {
  /** Refs are also searched in this text (e.g. the branch name), after the title. */
  extraText?: string;
  /** GitHub repo base ("https://github.com/owner/repo") when the project has one. */
  repoHrefBase?: string;
}

// PROJ-123: uppercase key (2+ chars, at least one letter) + hyphen + digits.
// Anchored with a leading \b word boundary so the key cannot start mid-word,
// and a trailing \b plus a (?![-\w]) lookahead so "PROJ-123x" and
// "PROJ-123-4" do not match. The key rule rejects dates (2026-09-25),
// versions (v1.2.3), and fragments (e2e-4).
const KEY_REF = /\b([A-Z][A-Z0-9]*[A-Z]|[A-Z][A-Z0-9]{1,})-(\d+)\b(?![-\w])/g;

// #1234: hash + digits, with a lookbehind rejecting hashes glued to letters
// or another hash ("abc#12", "##12") while still matching adjacent glued
// forms like "#12#13" (the digit of the previous ref is a legal lead-in).
// The match consumes only "#digits". GitHub issue numbers start at 1, so
// #0 is rejected below.
const HASH_REF = /(?<![#a-zA-Z])#(\d+)/g;

// Full GitHub issue/PR URLs. The path segment is captured (issues|pull) so
// the ref can carry its issue-vs-PR kind. The trailing fragment is allowed
// in the text but not captured into the ref.
const GITHUB_URL = /(?<raw>https:\/\/github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+)\/(?<kind>issues|pull)\/(?<num>\d+))(?:#[^\s]*)?/g;

function pushUnique(refs: TicketRef[], ref: TicketRef): void {
  if (!refs.some((existing) => existing.raw === ref.raw)) refs.push(ref);
}

/**
 * Find ticket references in `title` (and `options.extraText`, e.g. a branch
 * name), deduped by their raw text, in order of appearance.
 *
 * `options.repoHrefBase` is the project's GitHub base URL; when present,
 * numeric refs gain `{base}/issues/{n}` hrefs.
 */
export function findTicketRefs(title: string, options: TicketRefOptions = {}): TicketRef[] {
  const refs: TicketRef[] = [];
  const base = options.repoHrefBase?.replace(/\/+$/, "");

  const scan = (text: string): void => {
    if (!text) return;

    for (const match of text.matchAll(GITHUB_URL)) {
      const { raw, num, kind } = match.groups as {
        raw: string;
        num: string;
        kind: "issues" | "pull";
      };
      pushUnique(refs, {
        raw,
        tracker: "github",
        kind: kind === "pull" ? "pull" : "issue",
        number: Number(num),
        href: raw,
      });
    }

    for (const match of text.matchAll(KEY_REF)) {
      // Trailing boundary: \b already fails on "123x" (digit→letter is
      // word-internal), but it passes between a digit and a hyphen, so the
      // (?![-\w]) lookahead is what rejects "PROJ-123-4". Keep both.
      const [raw, key] = match;
      pushUnique(refs, { raw, tracker: "generic", key });
    }

    for (const match of text.matchAll(HASH_REF)) {
      const num = Number(match[1]);
      if (num === 0) continue; // GitHub numbers start at 1.
      pushUnique(refs, {
        raw: `#${match[1]}`,
        tracker: "github",
        number: num,
        ...(base ? { href: `${base}/issues/${num}` } : {}),
      });
    }
  };

  scan(title);
  if (options.extraText && options.extraText !== title) scan(options.extraText);

  return refs;
}
