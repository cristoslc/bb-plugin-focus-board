/**
 * Ticket-reference detection for board cards ("mirror, don't integrate").
 *
 * One rule above the pattern set: a text ref chips only when something
 * attached to the project can validate it. GitHub remotes validate #N and
 * issue/PR URLs (href from the repo base, dot from the GitHub plugin's
 * cache), and the board's own link store validates its explicit links. A
 * WORD-123 shape ("PROJ-123", "GLM-5") carries a tracker key only a
 * Jira-style board link could validate — and bb projects expose no
 * tracker links today, so key-shaped text matches nothing. Revisit when
 * a project can carry a board attachment.
 *
 * Pure string work: find ticket references in thread titles and branch
 * names and turn them into optional link-outs. Zero credentials, zero SDK
 * surface. See docs/plans/2026-09-25-tracker-mirroring-ticket-id-detection-link-out.md
 * for the original pattern set and false-positive guards.
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
  /** The matched text, e.g. "https://github.com/owner/repo/issues/42" or "#482". */
  raw: string;
  /** GitHub-identifiable refs (#N, URLs) and external tracker items from the link store. */
  tracker: "github" | "external";
  /**
   * Issue vs PR when the raw text itself implies it (GitHub URL refs).
   * Plain "#N" refs stay kindless — issues and PRs share GitHub's number
   * space — and the chip defaults to the issue glyph until live status
   * corrects it.
   */
  kind?: "issue" | "pull";
  /** Issue/PR number for numeric refs (#123, GitHub URL forms). */
  number?: number;
  /**
   * For external tracker items: the site's hostname, so the chip can render
   * the site's favicon (Unit G). Absent on GitHub refs.
   */
  hostname?: string;
  /** Direct href when resolvable; absent refs render as inert chips. */
  href?: string;
}

export interface TicketRefOptions {
  /** Refs are also searched in this text (e.g. the branch name), after the title. */
  extraText?: string;
  /** GitHub repo base ("https://github.com/owner/repo") when the project has one. */
  repoHrefBase?: string;
}

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
