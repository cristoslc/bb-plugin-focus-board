// Unit F: tracker_validate — text-ref validation ("mirror, don't
// integrate" phase 3). A text ref (#N, GitHub URL) may only chip when
// something attached to the project can validate it: the GitHub plugin's
// sqlite cache first (authoritative when present), an HTTP existence
// check for cache misses and for forgejo items (no cache exists there).
// Red-first against the missing module.
import { describe, expect, it } from "vitest";
import {
  DOWN_TTL_MS,
  UP_TTL_MS,
  validateTrackerUrls,
  type TrackerValidateDeps,
} from "../lib/tracker-validate";

const GITHUB_ISSUE = "https://github.com/a/b/issues/12";
const FORGEJO_ISSUE = "https://forge.example.com/owner/repo/issues/7";

function deps(overrides: Partial<TrackerValidateDeps> = {}): TrackerValidateDeps & {
  fetchedUrls: string[];
} {
  const fetchedUrls: string[] = [];
  const base: TrackerValidateDeps & { fetchedUrls: string[] } = {
    fetchImpl: async (url) => {
      fetchedUrls.push(url);
      return { status: 200 };
    },
    githubCacheStatuses: () => ({}),
    kvGet: async () => undefined,
    kvSet: async () => {},
    now: () => 1_000_000,
    fetchedUrls,
  };
  return { ...base, ...overrides };
}

describe("validateTrackerUrls", () => {
  it("an empty url list validates nothing", async () => {
    expect(await validateTrackerUrls([], deps({}))).toEqual({});
  });

  it("a github cache hit confirms with kind and state, without fetching", async () => {
    const d = deps({
      githubCacheStatuses: (repo, numbers) =>
        repo === "a/b" && numbers.includes(12)
          ? { 12: { kind: "issue", state: "OPEN" } }
          : {},
    });
    const result = await validateTrackerUrls([GITHUB_ISSUE], d);
    expect(result[GITHUB_ISSUE]).toEqual({ confirmed: true, kind: "issue", state: "OPEN" });
  });

  it("a github cache miss falls back to an HTTP existence check", async () => {
    const d = deps({ fetchImpl: async () => ({ status: 200 }) });
    expect(await validateTrackerUrls([GITHUB_ISSUE], d)).toEqual({
      [GITHUB_ISSUE]: { confirmed: true },
    });
  });

  it("an HTTP 404 (or >=400) means unconfirmed", async () => {
    const d = deps({ fetchImpl: async () => ({ status: 404 }) });
    expect(await validateTrackerUrls([GITHUB_ISSUE], d)).toEqual({
      [GITHUB_ISSUE]: { confirmed: false },
    });
  });

  it("a network failure means unconfirmed (never throws)", async () => {
    const d = deps({ fetchImpl: async () => { throw new Error("offline"); } });
    expect(await validateTrackerUrls([FORGEJO_ISSUE], d)).toEqual({
      [FORGEJO_ISSUE]: { confirmed: false },
    });
  });

  it("a forgejo URL validates by HTTP alone (no github cache applies)", async () => {
    let cacheCalls = 0;
    const d = deps({
      githubCacheStatuses: () => { cacheCalls += 1; return {}; },
      fetchImpl: async () => ({ status: 200 }),
    });
    expect(await validateTrackerUrls([FORGEJO_ISSUE], d)).toEqual({
      [FORGEJO_ISSUE]: { confirmed: true },
    });
    expect(cacheCalls).toBe(0);
  });

  it("a fresh cached confirmation skips the fetch", async () => {
    const now = 10_000_000;
    const kv: Record<string, { ok: boolean; at: number }> = {
      [`tracker-validate:${GITHUB_ISSUE}`]: { ok: true, at: now - UP_TTL_MS + 1000 },
    };
    const d = deps({
      kvGet: async (key) => kv[key],
      kvSet: async (key, value) => { kv[key] = value; },
      now: () => now,
    });
    expect(await validateTrackerUrls([GITHUB_ISSUE], d)).toEqual({
      [GITHUB_ISSUE]: { confirmed: true },
    });
  });

  it("a stale cache entry refetches and refreshes the stamp", async () => {
    const now = 10_000_000;
    const kv: Record<string, { ok: boolean; at: number }> = {
      [`tracker-validate:${GITHUB_ISSUE}`]: { ok: true, at: now - UP_TTL_MS - 1 },
    };
    const d = deps({
      kvGet: async (key) => kv[key],
      kvSet: async (key, value) => { kv[key] = value; },
      now: () => now,
      fetchImpl: async () => ({ status: 200 }),
    });
    expect(await validateTrackerUrls([GITHUB_ISSUE], d)).toEqual({
      [GITHUB_ISSUE]: { confirmed: true },
    });
    expect(kv[`tracker-validate:${GITHUB_ISSUE}`]).toEqual({ ok: true, at: now });
  });

  it("a fresh failed check also caches, with the shorter TTL", async () => {
    const now = 10_000_000;
    const kv: Record<string, { ok: boolean; at: number }> = {
      [`tracker-validate:${GITHUB_ISSUE}`]: { ok: false, at: now - DOWN_TTL_MS + 1 },
    };
    let fetched = 0;
    const d = deps({
      kvGet: async (key) => kv[key],
      kvSet: async (key, value) => { kv[key] = value; },
      now: () => now,
      fetchImpl: async () => { fetched += 1; return { status: 200 }; },
    });
    expect(await validateTrackerUrls([GITHUB_ISSUE], d)).toEqual({
      [GITHUB_ISSUE]: { confirmed: false },
    });
    expect(fetched).toBe(0);
  });
});