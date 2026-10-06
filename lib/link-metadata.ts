// Linked-issue helpers for the board's ticket chips.
//
// A "link" = per-thread plugin metadata in the board's own namespace: key
// "linkedIssues" → ThreadLink[] (first entry is the primary). This is the
// store threads and cards use when neither the title nor the branch name
// carries a text ticket ref: the builtin GitHub plugin persists its own
// thread↔issue links in bb.db rows under its own plugin namespace, which
// focus-board cannot read (no cross-plugin surface in BbPluginApi), so the
// board keeps its own record. These helpers are pure — no host, no SDK —
// so the RPC layer, the chip merge, and tests can drive them without a bb
// host.
import type { JsonValue } from "@get-bb/plugin-sdk";
import type { TicketRef } from "./tickets";

/** The board's linked-issues key inside its thread plugin-metadata namespace. */
export const LINK_METADATA_KEY = "linkedIssues";

/** One thread→GitHub item link. First entry in the array is the primary. */
export type ThreadLink = {
  /** "owner/repo" slug. */
  repo: string;
  /** Issue/PR number, positive integer. */
  issue: number;
  kind: "issue" | "pull";
  /** Full https URL; the chip uses it directly, so a stale href still opens. */
  href: string;
  /** ISO-8601 stamp of the link's write. */
  createdAt: string;
  /** Who wrote it: a thread agent (tool), the operator (CLI), auto-detect. */
  source: "agent" | "operator" | "auto";
};

const LINK_SOURCES = new Set(["agent", "operator", "auto"]);
const LINK_KINDS = new Set(["issue", "pull"]);

/**
 * Full URL for a linked item. GitHub redirects /issues/N ↔ /pull/N when the
 * kind is wrong, so a mislabeled kind still opens the right page.
 */
export function linkHref(repo: string, kind: "issue" | "pull", issue: number): string {
  return `https://github.com/${repo}/${kind === "pull" ? "pull" : "issues"}/${issue}`;
}

function parseLink(value: JsonValue, index: number): ThreadLink {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`linked issues: entry ${index}: expected object, got ${got}`);
  }
  const entry = value as { [key: string]: JsonValue };
  expect(entry["repo"], "repo", index, (v) => typeof v === "string" && v.includes("/") && /[\w.-]+\/[\w.-]+/.test(v));
  expect(entry["issue"], "issue", index, (v) => typeof v === "number" && Number.isInteger(v) && v > 0);
  expect(entry["kind"], "kind", index, (v) => typeof v === "string" && LINK_KINDS.has(v));
  expect(entry["href"], "href", index, (v) => typeof v === "string" && v.startsWith("https://github.com/"));
  expect(entry["createdAt"], "createdAt", index, (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)));
  expect(entry["source"], "source", index, (v) => typeof v === "string" && LINK_SOURCES.has(v));
  return {
    repo: entry["repo"] as string,
    issue: entry["issue"] as number,
    kind: entry["kind"] as ThreadLink["kind"],
    href: entry["href"] as string,
    createdAt: entry["createdAt"] as string,
    source: entry["source"] as ThreadLink["source"],
  };
}

function expect(
  value: JsonValue | undefined,
  field: string,
  index: number,
  ok: (value: unknown) => boolean,
): void {
  if (ok(value)) return;
  throw new Error(
    `linked issues: entry ${index}: invalid ${field} ${JSON.stringify(value)}`,
  );
}

/**
 * Parse a metadata value into ThreadLink[]. Absent (undefined) and null mean
 * "no links" → null. A malformed present value throws (fail loud, never
 * coerce): links must round-trip exactly between board, CLI, and agent tool,
 * so a wrong shape is a bug to surface, not data to paper over.
 */
export function parseLinkedIssues(value: JsonValue | undefined): ThreadLink[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error(
      `linked issues: expected array, got ${typeof value}`,
    );
  }
  return value.map(parseLink);
}

function sameItem(a: ThreadLink, b: ThreadLink): boolean {
  // GitHub redirects /issues/N ↔ /pull/N, so kind does not take part in
  // identity: repo + number is the item.
  return a.repo === b.repo && a.issue === b.issue;
}

/**
 * Upsert one link: a new item goes first (primary); a re-set item moves to
 * the front and carries the fresh stamp and source (the newest write wins
 * the record, matching the done store's refresh rule).
 */
export function stampLinkedIssues(
  existing: ThreadLink[] | null,
  link: ThreadLink,
): ThreadLink[] {
  return [link, ...(existing ?? []).filter((entry) => !sameItem(entry, link))];
}

/**
 * Remove one repo+number pair (number given), or everything (absent).
 * Returns null when nothing remains, so the caller can remove the key
 * rather than store an empty array.
 */
export function clearLinkedIssues(
  existing: ThreadLink[] | null,
  issue: number | undefined,
): ThreadLink[] | null {
  if (existing === null) return null;
  const remaining =
    issue === undefined
      ? []
      : existing.filter((entry) => entry.issue !== issue);
  return remaining.length === 0 ? null : remaining;
}

/**
 * Chip merge: turn link records into TicketRefs for the card's chip row.
 * Dedupe by href against the text refs a title/branch scan already found —
 * when the title carries the full URL, the scan's chip wins (same target,
 * richer raw text); when the title's "#12" has no href (no repo base), the
 * link's stored href still earns the chip.
 */
export function linkedTicketRefs(
  links: ThreadLink[] | null | undefined,
  textRefs: TicketRef[] = [],
): TicketRef[] {
  if (!links || links.length === 0) return [];
  const known = new Set(
    textRefs.filter((ref) => ref.href !== undefined).map((ref) => ref.href!),
  );
  const refs: TicketRef[] = [];
  for (const link of links) {
    if (known.has(link.href)) continue;
    refs.push({
      raw: `#${link.issue}`,
      tracker: "github",
      number: link.issue,
      href: link.href,
    });
  }
  return refs;
}