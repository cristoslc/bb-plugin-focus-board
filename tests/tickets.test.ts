import { describe, expect, it } from "vitest";
import { findTicketRefs, resolveRepoSlug } from "../lib/tickets";

const BASE = "https://github.com/owner/repo";

describe("findTicketRefs — PROJ-123 style keys", () => {
  it("matches an uppercase key with digits", () => {
    expect(findTicketRefs("Fix PROJ-123 render bug")).toEqual([
      { raw: "PROJ-123", tracker: "generic", key: "PROJ" },
    ]);
  });

  it("matches multi-digit keys", () => {
    expect(findTicketRefs("AB2-9 done")).toEqual([
      { raw: "AB2-9", tracker: "generic", key: "AB2" },
    ]);
  });

  it("matches refs at string boundaries", () => {
    expect(findTicketRefs("ENG-482 initial work")[0]).toMatchObject({ raw: "ENG-482" });
    expect(findTicketRefs("done: ENG-482.")[0]).toMatchObject({ raw: "ENG-482" });
  });

  it("matches multiple refs in one title", () => {
    expect(findTicketRefs("Ship PROJ-1 and PROJ-2")).toEqual([
      { raw: "PROJ-1", tracker: "generic", key: "PROJ" },
      { raw: "PROJ-2", tracker: "generic", key: "PROJ" },
    ]);
  });
});

describe("findTicketRefs — false-positive guards", () => {
  it("does not match lowercase or mixed-case keys", () => {
    expect(findTicketRefs("fix eng-482 now")).toEqual([]);
  });

  it("does not match a key without a hyphen-number tail", () => {
    expect(findTicketRefs("PROJ and ENG")).toEqual([]);
  });

  it("does not match inside a longer word", () => {
    // XABC-1: the token starts with X, so the match inside is XABC-1, not ABC-1.
    expect(findTicketRefs("XABC-1")).toEqual([{ raw: "XABC-1", tracker: "generic", key: "XABC" }]);
    expect(findTicketRefs("abcPROJ-1")).toEqual([]);
  });

  it("does not match dates", () => {
    expect(findTicketRefs("planned 2026-09-25")).toEqual([]);
  });

  it("does not match version-ish tokens", () => {
    expect(findTicketRefs("bump v1.2.3")).toEqual([]);
  });

  it("does not match a bare hyphen-number fragment", () => {
    expect(findTicketRefs("e2e-4 and x-1 stay inert")).toEqual([]);
  });
});

describe("findTicketRefs — #N hash refs", () => {
  it("matches a hash number in a title", () => {
    expect(findTicketRefs("close #1284", { repoHrefBase: BASE })).toEqual([
      { raw: "#1284", tracker: "github", number: 1284, href: `${BASE}/issues/1284` },
    ]);
  });

  it("matches #N in a branch name", () => {
    expect(findTicketRefs("fix/#1284-token")[0]).toMatchObject({ raw: "#1284", number: 1284 });
  });

  it("dedupes identical refs from title and branch", () => {
    const refs = findTicketRefs("#42 landing", { extraText: "branch fix/#42", repoHrefBase: BASE });
    expect(refs).toEqual([{ raw: "#42", tracker: "github", number: 42, href: `${BASE}/issues/42` }]);
  });

  it("rejects #0 (GitHub numbers start at 1)", () => {
    expect(findTicketRefs("issue #0")).toEqual([]);
  });

  it("resolves hrefs for .git-suffixed remotes (round-trip through slug)", () => {
    // Regression: remotes ending in .git must produce clean /issues/N hrefs.
    const slug = resolveRepoSlug("https://github.com/owner/repo.git");
    expect(findTicketRefs("close #1284", { repoHrefBase: `https://github.com/${slug}` })).toEqual([
      { raw: "#1284", tracker: "github", number: 1284, href: "https://github.com/owner/repo/issues/1284" },
    ]);
  });

  it("matches adjacent glued hash refs (#1#2)", () => {
    expect(findTicketRefs("fix #12#13").map((ref) => ref.raw)).toEqual(["#12", "#13"]);
  });

  it("does not match hash followed by non-digits", () => {
    expect(findTicketRefs("use #tag and ## in md")).toEqual([]);
  });

  it("does not match hash glued to a word", () => {
    expect(findTicketRefs("abc#12")).toEqual([]);
  });

  it("has no href without a repo base", () => {
    expect(findTicketRefs("close #1284")).toEqual([{ raw: "#1284", tracker: "github", number: 1284 }]);
  });
});

describe("findTicketRefs — GitHub URL forms", () => {
  it("matches an issue URL and marks it kind issue", () => {
    expect(findTicketRefs("see https://github.com/owner/repo/issues/123")).toEqual([
      {
        raw: "https://github.com/owner/repo/issues/123",
        tracker: "github",
        kind: "issue",
        number: 123,
        href: "https://github.com/owner/repo/issues/123",
      },
    ]);
  });

  it("matches a pull URL and marks it kind pull", () => {
    expect(findTicketRefs("https://github.com/owner/repo/pull/45#discussion")).toEqual([
      {
        raw: "https://github.com/owner/repo/pull/45",
        tracker: "github",
        kind: "pull",
        number: 45,
        href: "https://github.com/owner/repo/pull/45",
      },
    ]);
  });

  it("leaves plain #N refs kindless — status resolves issue vs PR later", () => {
    // A bare "#17" sits in the shared GitHub number space (issues and PRs
    // share it), so the text alone cannot say; the ref stays kindless and
    // the chip defaults to the issue glyph until live status corrects it.
    expect(findTicketRefs("resolve #17", { repoHrefBase: BASE })).toEqual([
      { raw: "#17", tracker: "github", number: 17, href: `${BASE}/issues/17` },
    ]);
  });

  it("does not match non-github issue URLs", () => {
    expect(findTicketRefs("see https://gitlab.com/owner/repo/issues/123")).toEqual([]);
  });
});

describe("resolveRepoSlug", () => {
  it("extracts owner/repo from GitHub remotes", () => {
    expect(resolveRepoSlug("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(resolveRepoSlug("git@github.com:owner/repo.git")).toBe("owner/repo");
    expect(resolveRepoSlug("https://github.com/owner/repo")).toBe("owner/repo");
  });

  it("returns null for non-GitHub remotes", () => {
    expect(resolveRepoSlug("https://gitlab.com/owner/repo.git")).toBeNull();
    expect(resolveRepoSlug(null)).toBeNull();
  });
});

describe("findTicketRefs — combined behavior", () => {
  it("combines title and branch refs in order", () => {
    const refs = findTicketRefs("PROJ-7", { extraText: "fix/proj-7-#9", repoHrefBase: BASE });
    expect(refs).toEqual([
      { raw: "PROJ-7", tracker: "generic", key: "PROJ" },
      { raw: "#9", tracker: "github", number: 9, href: `${BASE}/issues/9` },
    ]);
  });

  it("returns empty for titles with no refs", () => {
    expect(findTicketRefs("just a normal title", { extraText: "main" })).toEqual([]);
  });
});
