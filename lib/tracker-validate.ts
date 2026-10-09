/**
 * Text-ref validation for the board's chip rule ("validate against the
 * remotes"): a ticket chip earned by TEXT (a #N ref or a full GitHub URL in
 * the title/branch) may render only when something attached to the project
 * can confirm the item exists. Store links (lib/link-metadata) are trusted
 * by construction and skip this path.
 *
 * Validation sources, in order: (1) the GitHub plugin's sqlite cache —
 * authoritative for GitHub items when the plugin is installed (readGitHubStatuses,
 * lib/tracker-status); (2) an HTTP existence check for github cache misses and
 * for forgejo/other tracker URLs, which have no cache at all. Results cache in
 * the plugin KV with TTLs: confirmed 6h, failed 10min (a flaky check retries
 * far sooner than a good one is trusted).
 *
 * Server-only module (wired by server.ts): the deps carry the cache reader
 * and KV, injected so this orchestration stays testable without sqlite.
 */
import type { GitHubItemStatus } from "./tracker-status";
import { parseGithubItemUrl } from "./link-metadata";

export interface TrackerValidation {
  confirmed: boolean;
  /** kind/state ride only when a trusted source reported them (github cache). */
  kind?: string;
  state?: string;
}

/** A KV-cached validation outcome: the boolean + the wall-clock stamp. */
export type CachedValidation = { ok: boolean; at: number };

export const UP_TTL_MS = 6 * 60 * 60 * 1000;
export const DOWN_TTL_MS = 10 * 60 * 1000;

export type TrackerValidateDeps = {
  fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number }>;
  /** GitHub-plugin sqlite cache lookup (lib/tracker-status bound to its db path). */
  githubCacheStatuses: (repo: string, numbers: readonly number[]) => Record<number, GitHubItemStatus>;
  kvGet: (key: string) => Promise<CachedValidation | undefined>;
  kvSet: (key: string, value: CachedValidation) => Promise<void>;
  now: () => number;
};

function cachedReading(
  cached: CachedValidation | undefined,
  now: number,
): "fresh-ok" | "fresh-down" | "stale" | "none" {
  if (cached === undefined) return "none";
  const age = now - cached.at;
  if (cached.ok) return age <= UP_TTL_MS ? "fresh-ok" : "stale";
  return age <= DOWN_TTL_MS ? "fresh-down" : "stale";
}

/**
 * Validate a batch of https item URLs. The result carries one entry per
 * input URL; every failure mode (network down, unreachable host, bad input)
 * degrades to confirmed:false — chips that cannot be validated simply do
 * not render, the board never breaks on this path.
 */
export async function validateTrackerUrls(
  urls: readonly string[],
  deps: TrackerValidateDeps,
): Promise<Record<string, TrackerValidation>> {
  const out: Record<string, TrackerValidation> = {};
  const pending: Array<Promise<void>> = [];

  const validate = async (url: string): Promise<void> => {
    // GitHub items: the plugin's sqlite cache is authoritative when it has
    // the item; only a miss spends an HTTP check.
    const gh = parseGithubItemUrl(url);
    if (gh !== null) {
      const cachedStatus = deps.githubCacheStatuses(gh.repo, [gh.issue]);
      const status = cachedStatus[gh.issue];
      if (status !== undefined) {
        out[url] = { confirmed: true, kind: status.kind, state: status.state };
        return;
      }
    }
    // Everything else (github miss, forgejo, any tracker): HTTP existence.
    // GET, not HEAD: forgejo answers HEAD on item pages inconsistently, and
    // the page is small. 10s timeout; a hung host is an unconfirmed host.
    let ok = false;
    try {
      const response = await deps.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      ok = response.status > 0 && response.status < 400;
    } catch {
      ok = false;
    }
    out[url] = { confirmed: ok };
  };

  for (const url of urls) {
    const key = `tracker-validate:${url}`;
    const reading = cachedReading(await deps.kvGet(key), deps.now());
    if (reading === "fresh-ok") out[url] = { confirmed: true };
    else if (reading === "fresh-down") out[url] = { confirmed: false };
    else {
      pending.push(
        validate(url).then(() =>
          deps.kvSet(key, { ok: out[url].confirmed, at: deps.now() }),
        ),
      );
    }
  }
  await Promise.all(pending);
  return out;
}