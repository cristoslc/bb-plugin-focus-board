// Provider-grouped chip rows for the card's ticket chips.
//
// The operator's spec, turned into pure grouping over the flat TicketRef[]
// `cardTicketRefs` (lib/link-metadata) produces:
//
// - One provider per row: a row keys by provider ("github") or, for
//   external trackers, by hostname. GitHub issues and Forgejo PRs never
//   share a row — two providers, two rows.
// - Two item chips per row at most: the provider's issues chip and its PRs
//   chip. Placement is the card's job (components/thread-card): the issues
//   chip claims the first row's left within the midpoint cap, the PRs chip
//   the first row's right.
// - A third bucket per row: `tags`. An external link whose label is free
//   text names no tracker item, so it is a tag, and the card puts tags in a
//   bottom-right, right-anchored block (issue #104). An item number, a
//   Forgejo-shaped item URL, or a WORD-123 tracker key all name an item and
//   stay in the issue/PR chips.
// - Each chip holds the provider's IDs for that kind. Every ID links to its
//   own item; the provider mark links to that kind's LIST page — the repo's
//   filtered page where a base is known (a GitHub row: repo /issues|/pulls;
//   a Forgejo-shaped external: {base}/issues|/pulls), otherwise the
//   provider's global page (github.com/issues|/pulls). An unknown external
//   (no base, no Forgejo shape) keeps an inert mark — no guess URLs.
//
// Pure data work, no React: the component renders, and the toolbar search
// keeps matching the ungrouped `cardTicketRefs` set, so a "#38" query still
// finds every card whose chips show a #38.

import type { TicketRef } from "./tickets";
import { forgejoItemBase, forgejoItemUrl, resolveRepoSlug } from "./tickets";
import { parseGithubItemUrl } from "./link-metadata";

/** One chip inside a provider row: all the provider's IDs of one kind. */
export interface TicketChip {
  /** Which list page the chip belongs to (and which glyph leads it). */
  kind: "issue" | "pull";
  /** The chip's IDs, in appearance order (store links keep primary first). */
  refs: TicketRef[];
}

/** One provider's chips: renders as exactly one row, issues left, pulls right. */
export interface TicketChipRow {
  /** Row identity: "github", or the external provider's hostname. */
  key: string;
  provider: "github" | "external";
  /** External provider hostname (the favicon source). Absent on GitHub rows. */
  hostname?: string;
  /**
   * The repo base ("https://host/owner/repo") the filtered list pages build
   * on. The first ref in the group that carries one wins: one chip can hold
   * IDs from several repos of the same provider, and its mark filters to
   * the group's primary repo.
   */
  base?: string;
  /** The issues chip; absent when this provider contributes none. */
  issues?: TicketChip;
  /** The PRs chip; absent when this provider contributes none. */
  pulls?: TicketChip;
  /**
   * Free-text label chips: external links with no item number, so they name
   * no tracker item and earn no issue/PR glyph. The card renders one tag
   * chip per ref in its bottom-right block (issue #104). Absent when the
   * provider contributes none.
   */
  tags?: TicketRef[];
}

export interface TicketChipRowsOptions {
  /**
   * The project's repo base URL when it has one. A GitHub-shaped base
   * supplies the repo fallback for refs whose own href carries none
   * (preview renders of unvalidated "#N" text refs).
   */
  repoHrefBase?: string;
}

/**
 * Group flat ticket refs into provider rows. Rows appear in the refs' own
 * order (first appearance); issues and pulls chips inside a row also carry
 * appearance order. `repoHrefBase` only backstops a GitHub ref with no
 * parsable href — chips normally earn hrefs from a base or a full URL.
 */
export function ticketChipRows(
  refs: readonly TicketRef[],
  options: TicketChipRowsOptions = {},
): TicketChipRow[] {
  const rows: TicketChipRow[] = [];
  const byKey = new Map<string, TicketChipRow>();
  const fallbackRepo = options.repoHrefBase === undefined ? null : resolveRepoSlug(options.repoHrefBase);
  // The forgejo sibling of fallbackRepo: a non-GitHub project remote backstops
  // an external ref whose own href is missing (a kindless text ref the scan
  // could not build an item URL for), so its chip still finds the list page.
  const fallbackForgejo = options.repoHrefBase === undefined ? null : forgejoItemBase(options.repoHrefBase);
  for (const ref of refs) {
    const github = ref.tracker === "github";
    let key: string;
    let hostname: string | undefined;
    let base: string | undefined;
    let kind: "issue" | "pull";
    if (github) {
      key = "github";
      const repo =
        (ref.href !== undefined ? parseGithubItemUrl(ref.href)?.repo : undefined) ??
        fallbackRepo ??
        undefined;
      if (repo !== undefined) base = `https://github.com/${repo}`;
      kind = ref.kind ?? "issue"; // kindless "#N" reads as an issue until status lands
    } else {
      // An external ref without a hostname is a data bug — its chip could
      // not even name its provider. Fail loud, never invent one.
      if (ref.hostname === undefined) {
        throw new Error(`ticket chips: external ref without hostname: ${ref.raw}`);
      }
      key = ref.hostname;
      hostname = ref.hostname;
      const item = ref.href !== undefined ? forgejoItemUrl(ref.href) : null;
      // The item URL wins the base (it names this ref's own repo); a ref the
      // store built without one falls back to the project's item base. The
      // ref's own kind, when hydrated, outranks the URL parse (the same
      // answer either way, but the hydrated shape is the record's truth).
      base = item?.base ?? fallbackForgejo ?? undefined;
      kind = ref.kind ?? item?.kind ?? "issue";
    }
    const namesItem = ticketRefNamesItem(ref);
    let row = byKey.get(key);
    if (row === undefined) {
      row = { key, provider: github ? "github" : "external", ...(hostname !== undefined ? { hostname } : {}) };
      byKey.set(key, row);
      rows.push(row);
    }
    if (row.base === undefined && base !== undefined) row.base = base;
    // A free-text label names no tracker item, so it is a tag, not a chip in
    // the issue/PR pair (issue #104). An item number, an item URL, or a
    // WORD-123 tracker key all name an item; a bare word ("triage",
    // "focus-board") does not.
    if (!namesItem) {
      (row.tags ??= []).push(ref);
      continue;
    }
    let chip: TicketChip | undefined = kind === "pull" ? row.pulls : row.issues;
    if (chip === undefined) {
      chip = { kind, refs: [] };
      if (kind === "pull") row.pulls = chip;
      else row.issues = chip;
    }
    chip.refs.push(ref);
  }
  return rows;
}

/**
 * A tracker key's shape: "PROJ-142", "MOBDEVLONG-100323" — the WORD-123 form
 * docs/plans/2026-09-25-tracker-mirroring-ticket-id-detection-link-out.md
 * defines (an uppercase key of two or more characters, a hyphen, digits). A
 * hyphenated lowercase slug ("focus-board", "release-v2-alpha") is not a key.
 */
const TRACKER_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

/**
 * True when `ref` names a tracker item rather than carrying a free-text label:
 * a GitHub ref, an external ref with an item number or an item URL, or an
 * external label shaped like a tracker key. The card keeps these in its
 * issue/PR chips (issue #104).
 */
export function ticketRefNamesItem(ref: TicketRef): boolean {
  if (ref.tracker === "github") return true;
  if (ref.number !== undefined) return true;
  if (ref.href !== undefined && forgejoItemUrl(ref.href) !== null) return true;
  return TRACKER_KEY.test(ticketChipIdText(ref));
}

/**
 * The provider mark's link target: the repo's filtered list page where a
 * base is known, otherwise GitHub's own global page. Unknown external
 * trackers return undefined — the mark renders inert rather than guessing
 * at a list URL the provider does not have.
 */
export function ticketChipIconHref(row: TicketChipRow, kind: "issue" | "pull"): string | undefined {
  const path = kind === "pull" ? "pulls" : "issues";
  if (row.base !== undefined) return `${row.base}/${path}`;
  return row.provider === "github" ? `https://github.com/${path}` : undefined;
}

/**
 * The text an ID renders as: refs already carry a short raw ("#12", a
 * "PROJ-142" label) — only a scanned full GitHub URL ref shortens to its
 * number, so the grouped chip holds IDs, not addresses.
 */
export function ticketChipIdText(ref: TicketRef): string {
  if (!ref.raw.includes("/")) return ref.raw;
  if (ref.number !== undefined) return `#${ref.number}`;
  return ref.hostname ?? ref.raw;
}

/**
 * The repo a live-status lookup queries for `ref`: a GitHub ref parses its
 * repo from its href (full URLs and base-built "#N" hrefs both carry it),
 * falling back to the thread's project repo; external refs take no part in
 * the GitHub dot path and answer null. This is what lets cross-repo store
 * links find their status instead of being asked under the project repo.
 */
export function ticketStatusRepo(ref: TicketRef, projectRepo: string | null): string | null {
  if (ref.tracker !== "github") return null;
  if (ref.href !== undefined) {
    const parsed = parseGithubItemUrl(ref.href);
    if (parsed !== null) return parsed.repo;
  }
  return projectRepo;
}