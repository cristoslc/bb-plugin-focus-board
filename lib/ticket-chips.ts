// Provider-grouped chip rows for the card's ticket chips.
//
// The operator's spec, turned into pure grouping over the flat TicketRef[]
// `cardTicketRefs` (lib/link-metadata) produces:
//
// - One provider per row: a row keys by provider ("github") or, for
//   external trackers, by hostname. GitHub issues and Forgejo PRs never
//   share a row — two providers, two rows.
// - At most two chips per row: the provider's issues chip first (left) and
//   its PRs chip second (right). With no issues at all, the PRs chip still
//   starts at the left — a single-chip row places its one chip left, and
//   the render pairs rows as [issues, pulls] so the wrapping reflow drops
//   the right chip onto the next line when labels run long (that next line
//   keeps the same provider).
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
    let row = byKey.get(key);
    if (row === undefined) {
      row = { key, provider: github ? "github" : "external", ...(hostname !== undefined ? { hostname } : {}) };
      byKey.set(key, row);
      rows.push(row);
    }
    if (row.base === undefined && base !== undefined) row.base = base;
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