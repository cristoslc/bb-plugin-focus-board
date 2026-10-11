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

/** Resolve a git remote URL to an "owner/repo" GitHub slug; null when not GitHub. */
export function resolveRepoSlug(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const https = remote.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/);
  if (https) return https[1];
  const ssh = remote.match(/^git@github\.com:([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
  if (ssh) return ssh[1];
  return null;
}

/**
 * Forgejo/Gitea item base from a git remote (deterministic): any remote with
 * an owner/repo path on a host that is not github.com — bb's own forge serves
 * Forgejo there, and Forgejo identifies items as /issues/N pages. Returns
 * "https://<host>/<owner>/<repo>" (the base item URLs build on); null for
 * github remotes and remotes without an owner/repo path (nothing to
 * validate #N refs against there).
 */
export function forgejoItemBase(remote: string | null | undefined): string | null {
  if (!remote) return null;
  const https = remote.match(
    /^https:\/\/(?!github\.com)([\w.-]+(?::\d+)?)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
  );
  if (https) return `https://${https[1]}/${https[2]}/${https[3]}`;
  const ssh = remote.match(/^git@(?!github\.com)([^:]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}/${ssh[3]}`;
  return null;
}

/**
 * A Forgejo/Gitea ITEM URL: "https://host/owner/repo/issues/123" (or
 * /pulls/123 — Gitea names PRs "pulls"). Returns the repo base the item
 * sits in, the issue-vs-pull kind the path names, and the number; null for
 * github.com URLs (parseGithubItemUrl owns those) and anything else.
 * Forgejo identifies both kinds on those paths, exactly like its remote
 * shape above — so a Forgejo PR link stored from the link tool carries its
 * kind and base with no extra records.
 */
export function forgejoItemUrl(
  url: string,
): { base: string; kind: "issue" | "pull"; number: number } | null {
  const match = url.match(
    /^https:\/\/(?!github\.com)([\w.-]+(?::\d+)?)\/([\w.-]+)\/([\w.-]+?)\/(?<kind>issues|pulls)\/(?<num>\d+)\/?$/,
  );
  if (match === null) return null;
  const [, host, owner, repo] = match;
  return {
    base: `https://${host}/${owner}/${repo}`,
    kind: match.groups?.kind === "pulls" ? "pull" : "issue",
    number: Number(match.groups?.num),
  };
}

export interface TicketRef {
  /** The matched text, e.g. "https://github.com/owner/repo/issues/42" or "#482". */
  raw: string;
  /**
   * GitHub-identifiable refs (#N, URLs) and non-GitHub tracker items (Forgejo
   * remotes and the link store's external records). A `#N` on a non-GitHub
   * base is external: its chip names that tracker, never GitHub.
   */
  tracker: "github" | "external";
  /**
   * Issue vs PR when the raw text itself implies it (GitHub URL refs and
   * non-GitHub item URLs, where Forgejo/Gitea spell PRs `/pulls/N`). Plain
   * "#N" refs stay kindless on both trackers — issues and PRs share the
   * number space — and the chip defaults to the issue glyph until live
   * status corrects it.
   */
  kind?: "issue" | "pull";
  /** Item number for numeric refs (#123, item URL forms, on either tracker). */
  number?: number;
  /**
   * For non-GitHub tracker items: the site's hostname, so the chip can render
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
  // Hostname of a non-GitHub base (forgejo): the chip's favicon source. The
  // app builds the base from a regex-validated remote, so the URL parse
  // never fails in practice; a drifted base only loses the favicon, the
  // chip and its href stay.
  const baseHost = (() => {
    if (base === undefined) return null;
    try {
      const hostname = new URL(base).hostname;
      return hostname === "github.com" ? null : hostname;
    } catch {
      return null;
    }
  })();

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
        // A non-GitHub base (forgejo) makes this an external tracker ref:
        // the chip carries that site's favicon and links its list page,
        // never GitHub's mark. A GitHub base, or no base at all, keeps the
        // github shape.
        tracker: baseHost !== null ? "external" : "github",
        number: num,
        ...(base ? { href: `${base}/issues/${num}` } : {}),
        ...(baseHost !== null ? { hostname: baseHost } : {}),
      });
    }
  };

  scan(title);
  if (options.extraText && options.extraText !== title) scan(options.extraText);

  return refs;
}
