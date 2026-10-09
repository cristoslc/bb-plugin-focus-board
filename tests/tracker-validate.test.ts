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

  // Probe boundary (security audit 2026-10-09): the text ref that drives the
  // HTTP existence check comes from an untrusted thread title/branch, so the
  // check must never spend a request on loopback/private hosts, must not
  // follow redirects (a redirect could carry the probe anywhere, and login
  // walls must not confirm existence), and must confirm on 2xx only.
  it("a loopback https ref is refused without spending a fetch", async () => {
    const refs = [
      "https://localhost/owner/repo/issues/1",
      "https://app.localhost/owner/repo/issues/2",
      "https://127.0.0.1/owner/repo/issues/3",
    ];
    const d = deps({});
    expect(await validateTrackerUrls(refs, d)).toEqual({
      [refs[0]]: { confirmed: false },
      [refs[1]]: { confirmed: false },
      [refs[2]]: { confirmed: false },
    });
    expect(d.fetchedUrls).toEqual([]);
  });

  it("a private-range or link-local https IP ref is refused without a fetch", async () => {
    const refs = [
      "https://10.0.0.5/owner/repo/issues/1",
      "https://172.16.3.9/owner/repo/issues/2",
      "https://192.168.1.10/owner/repo/issues/3",
      "https://169.254.2.7/owner/repo/issues/4",
      "https://[::1]/owner/repo/issues/5",
    ];
    const d = deps({});
    expect(await validateTrackerUrls(refs, d)).toEqual({
      [refs[0]]: { confirmed: false },
      [refs[1]]: { confirmed: false },
      [refs[2]]: { confirmed: false },
      [refs[3]]: { confirmed: false },
      [refs[4]]: { confirmed: false },
    });
    expect(d.fetchedUrls).toEqual([]);
  });

  it("a refused ref caches as unconfirmed with the short TTL", async () => {
    const ref = "https://localhost/owner/repo/issues/1";
    const key = `tracker-validate:${ref}`;
    const kv: Record<string, { ok: boolean; at: number }> = {};
    const now = 10_000_000;
    const d = deps({
      kvGet: async (k) => kv[k],
      kvSet: async (k, v) => { kv[k] = v; },
      now: () => now,
    });
    expect(await validateTrackerUrls([ref], d)).toEqual({ [ref]: { confirmed: false } });
    expect(kv[key]).toEqual({ ok: false, at: now });
  });

  it("the existence check follows no redirects (manual redirect at the seam)", async () => {
    let seenRedirect: string | undefined;
    const d = deps({
      fetchImpl: async (url, init) => {
        seenRedirect = init?.redirect;
        return { status: 200 };
      },
    });
    expect(await validateTrackerUrls([FORGEJO_ISSUE], d)).toEqual({
      [FORGEJO_ISSUE]: { confirmed: true },
    });
    expect(seenRedirect).toBe("manual");
  });

  it("a redirect response (or an opaque redirect) never confirms the item", async () => {
    const d = deps({ fetchImpl: async () => ({ status: 0 }) });
    expect(await validateTrackerUrls([FORGEJO_ISSUE], d)).toEqual({
      [FORGEJO_ISSUE]: { confirmed: false },
    });
    const moved = deps({ fetchImpl: async () => ({ status: 302 }) });
    expect(await validateTrackerUrls([FORGEJO_ISSUE], moved)).toEqual({
      [FORGEJO_ISSUE]: { confirmed: false },
    });
  });
});