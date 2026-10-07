// Unit A: lib/link-metadata pure helpers. Red-first against the stub
// module (fails at import before the module exists), then green.
import { describe, expect, it } from "vitest";
import {
  LINK_METADATA_KEY,
  linkHref,
  parseLinkedIssues,
  linkedTicketRefs,
  linkedRefKeys,
  clearLinkedIssues,
  stampLinkedIssues,
  type ThreadLink,
} from "../lib/link-metadata";
import type { JsonValue } from "@get-bb/plugin-sdk";

const LINK: ThreadLink = {
  repo: "cristoslc/bb-plugin-focus-board",
  issue: 12,
  kind: "issue",
  href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/12",
  createdAt: "2026-10-05T22:00:00.000Z",
  source: "operator",
};
const OTHER: ThreadLink = {
  repo: "cristoslc/bb-plugin-focus-board",
  issue: 9,
  kind: "pull",
  href: "https://github.com/cristoslc/bb-plugin-focus-board/pull/9",
  createdAt: "2026-10-05T21:00:00.000Z",
  source: "agent",
};

describe("parseLinkedIssues", () => {
  it("absent and null metadata mean unlinked → null", () => {
    expect(parseLinkedIssues(undefined)).toBeNull();
    expect(parseLinkedIssues(null)).toBeNull();
  });

  it("parses a well-formed array round-trip", () => {
    const value = [LINK, OTHER] as unknown as JsonValue;
    expect(parseLinkedIssues(value)).toEqual([LINK, OTHER]);
  });

  it("throws on a malformed present value (never coerces)", () => {
    expect(() => parseLinkedIssues("nope" as unknown as JsonValue)).toThrow(
      /linked issues/,
    );
    expect(() =>
      parseLinkedIssues([{ repo: "a/b", issue: 0, kind: "issue", href: "https://github.com/a/b/issues/0", createdAt: "2026-10-05T22:00:00.000Z", source: "auto" }] as unknown as JsonValue),
    ).toThrow(/issue/);
    expect(() =>
      parseLinkedIssues([{ repo: "a/b", issue: 12, kind: "war", href: "https://github.com/a/b/issues/12", createdAt: "2026-10-05T22:00:00.000Z", source: "auto" }] as unknown as JsonValue),
    ).toThrow(/kind/);
    expect(() =>
      parseLinkedIssues([{ repo: "a/b", issue: 12, kind: "issue", href: "https://gitlab.com/a/b/issues/12", createdAt: "2026-10-05T22:00:00.000Z", source: "auto" }] as unknown as JsonValue),
    ).toThrow(/href/);
    expect(() =>
      parseLinkedIssues([{ repo: "a/b", issue: 12, kind: "issue", href: "https://github.com/a/b/issues/12", createdAt: "not a date", source: "auto" }] as unknown as JsonValue),
    ).toThrow(/createdAt/);
    expect(() =>
      parseLinkedIssues([{ repo: "a/b", issue: 12, kind: "issue", href: "https://github.com/a/b/issues/12", createdAt: "2026-10-05T22:00:00.000Z", source: "ghost" }] as unknown as JsonValue),
    ).toThrow(/source/);
  });

  it("rejects a non-positive, non-integer issue number", () => {
    expect(() =>
      parseLinkedIssues([{ repo: "a/b", issue: 12.5, kind: "issue", href: "https://github.com/a/b/issues/12", createdAt: "2026-10-05T22:00:00.000Z", source: "auto" }] as unknown as JsonValue),
    ).toThrow(/issue/);
  });
});

describe("stampLinkedIssues", () => {
  it("puts the new link first (primary), preserving older entries", () => {
    const next = stampLinkedIssues([OTHER], LINK);
    expect(next[0].issue).toBe(12);
    expect(next[1].issue).toBe(9);
  });

  it("upserts by repo+issue: same number moves to front, keeps its stamp", () => {
    const next = stampLinkedIssues([{ ...LINK, createdAt: LINK.createdAt }, OTHER], {
      ...LINK,
      createdAt: "2026-10-06T00:00:00.000Z",
      source: "agent",
    });
    expect(next).toHaveLength(2);
    expect(next[0].issue).toBe(12);
    // Re-linking refreshes the stamp: the newest link wins the record.
    expect(next[0].createdAt).toBe("2026-10-06T00:00:00.000Z");
    // Same repo+number but a different kind is still the same item (GitHub
    // redirects /issues/N ↔ /pull/N); the refreshed record's kind wins.
    const sameNumber = stampLinkedIssues([{ ...LINK, kind: "issue" }], {
      ...LINK,
      kind: "pull",
    });
    expect(sameNumber).toHaveLength(1);
    expect(sameNumber[0].kind).toBe("pull");
  });

  it("tracks the same number from a different repo separately", () => {
    const crossRepo: ThreadLink = {
      ...LINK,
      repo: "cristoslc/research-keeper",
      href: "https://github.com/cristoslc/research-keeper/issues/12",
    };
    const next = stampLinkedIssues([LINK], crossRepo);
    expect(next.filter((l) => l.issue === 12)).toHaveLength(2);
  });
});

describe("clearLinkedIssues", () => {
  it("clears everything when no number is given", () => {
    expect(clearLinkedIssues([LINK, OTHER], undefined)).toBeNull();
  });

  it("clears one number across repos", () => {
    const next = clearLinkedIssues([LINK, OTHER], 12);
    expect(next).toEqual([OTHER]);
  });

  it("clearing an unlinked number keeps the rest", () => {
    const next = clearLinkedIssues([OTHER], 12);
    expect(next).toEqual([OTHER]);
  });

  it("clearing the last link returns null so the key can be removed", () => {
    expect(clearLinkedIssues([LINK], 12)).toBeNull();
  });
});

describe("linkHref", () => {
  it("builds the full URL from repo, kind, and number", () => {
    expect(linkHref("a/b", "issue", 12)).toBe("https://github.com/a/b/issues/12");
    expect(linkHref("a/b", "pull", 9)).toBe("https://github.com/a/b/pull/9");
  });
});

describe("linkedTicketRefs (chip merge)", () => {
  it("turns links into TicketRefs carrying the stored href", () => {
    const refs = linkedTicketRefs([LINK, OTHER]);
    expect(refs).toEqual([
      {
        raw: "#12",
        tracker: "github",
        number: 12,
        href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/12",
      },
      {
        raw: "#9",
        tracker: "github",
        number: 9,
        href: "https://github.com/cristoslc/bb-plugin-focus-board/pull/9",
      },
    ]);
  });

  it("skips a link whose href a text ref already renders", () => {
    const textRefs = [
      {
        raw: "https://github.com/cristoslc/bb-plugin-focus-board/issues/12",
        tracker: "github" as const,
        number: 12,
        href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/12",
      },
    ];
    expect(linkedTicketRefs([LINK], textRefs)).toEqual([]);
  });

  it("renders a link whose text duplicate lacks an href (no repo base)", () => {
    const textRefs = [
      { raw: "#12", tracker: "github" as const, number: 12 },
    ];
    expect(linkedTicketRefs([LINK], textRefs)).toHaveLength(1);
  });

  it("does not skip a text URL ref pointing at a different issue", () => {
    const textRefs = [
      {
        raw: "https://github.com/cristoslc/bb-plugin-focus-board/issues/4",
        tracker: "github" as const,
        number: 4,
        href: "https://github.com/cristoslc/bb-plugin-focus-board/issues/4",
      },
    ];
    const refs = linkedTicketRefs([LINK], textRefs);
    expect(refs.map((r) => r.number)).toEqual([12]);
  });
});

describe("key contract", () => {
  it("uses the documented metadata key", () => {
    expect(LINK_METADATA_KEY).toBe("linkedIssues");
  });
});

describe("raw-dedupe among emitted links", () => {
  it("emits one chip per raw text: a cross-repo same-number pair keeps the primary", () => {
    // stampLinkedIssues dedupes per repo+number, but two different repos can
    // still carry the same number; both would emit raw "#12" and the chip row
    // keys chips by raw. First entry (primary) wins.
    const cross = { ...LINK, href: "https://github.com/other/repo/issues/12", createdAt: "2026-10-05T23:00:00.000Z" };
    const refs = linkedTicketRefs([LINK, cross]);
    expect(refs).toHaveLength(1);
    expect(refs[0].href).toBe(LINK.href);
  });

  it("dedupes against an emitted ref, not just the input order", () => {
    const newer = { ...LINK, createdAt: "2026-10-05T23:00:00.000Z" };
    expect(linkedTicketRefs([newer, LINK] as ThreadLink[])).toHaveLength(1);
  });
});

describe("linkedRefKeys", () => {
  it("maps links to owner-repo#number strings for the status fetch", () => {
    expect(linkedRefKeys([LINK, OTHER])).toEqual([
      "cristoslc/bb-plugin-focus-board#12",
      "cristoslc/bb-plugin-focus-board#9",
    ]);
  });

  it("returns nothing for an absent or empty record", () => {
    expect(linkedRefKeys(null)).toEqual([]);
    expect(linkedRefKeys([])).toEqual([]);
  });
});