// lib/ticket-chips: pure grouping over flat ticket refs. One row per
// provider, at most two chips per row (issues left, pulls right), each chip
// holding the provider's ids of one kind; the mark links to the kind's list
// page when a base is known, GitHub's global page as the github fallback,
// and never a guessed URL for unknown externals.
import { describe, expect, it } from "vitest";
import {
  ticketChipRows,
  ticketChipIconHref,
  ticketChipIdText,
  ticketStatusRepo,
} from "../lib/ticket-chips";
import type { TicketRef } from "../lib/tickets";

function githubRef(overrides: Partial<TicketRef> = {}): TicketRef {
  return {
    raw: "#12",
    tracker: "github",
    kind: "issue",
    number: 12,
    href: "https://github.com/owner/repo/issues/12",
    ...overrides,
  };
}

function forgejoRef(overrides: Partial<TicketRef> = {}): TicketRef {
  return {
    raw: "https://forge.example/org/app/issues/7",
    tracker: "external",
    hostname: "forge.example",
    href: "https://forge.example/org/app/issues/7",
    ...overrides,
  };
}

describe("ticketChipRows — one row per provider", () => {
  it("a github ref and a forgejo ref land in two rows, appearance order", () => {
    const rows = ticketChipRows([
      githubRef(),
      forgejoRef({ raw: "FORGE-7", number: undefined }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].provider).toBe("github");
    expect(rows[0].key).toBe("github");
    expect(rows[0].hostname).toBeUndefined();
    expect(rows[1].provider).toBe("external");
    expect(rows[1].key).toBe("forge.example");
    expect(rows[1].hostname).toBe("forge.example");
  });

  it("interleaved providers keep every row keyed to its own provider", () => {
    const rows = ticketChipRows([
      forgejoRef({ raw: "FORGE-7", number: undefined }),
      githubRef({ raw: "#12", number: 12 }),
      forgejoRef({ raw: "FORGE-8", number: undefined, href: "https://forge.example/org/app/issues/8" }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["forge.example", "github"]);
  });

  it("two external trackers never share a row", () => {
    const rows = ticketChipRows([
      forgejoRef({ raw: "FORGE-7", number: undefined }),
      githubRef(),
      forgejoRef({ hostname: "linear.app", href: "https://linear.app/t/PROJ-1", raw: "PROJ-1", number: undefined }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["forge.example", "github", "linear.app"]);
  });

  it("an external row keeps provider external — never the github slug path", () => {
    const rows = ticketChipRows([forgejoRef()]);
    expect(rows[0].provider).toBe("external");
    expect(rows[0].base).toBe("https://forge.example/org/app");
  });
});

describe("ticketChipRows — chips hold one kind each", () => {
  it("a github issue and a github PR share one row as two chips", () => {
    const rows = ticketChipRows([
      githubRef(),
      githubRef({ raw: "#30", kind: "pull", number: 30, href: "https://github.com/owner/repo/pull/30" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].issues?.refs.map((ref) => ref.number)).toEqual([12]);
    expect(rows[0].pulls?.refs.map((ref) => ref.number)).toEqual([30]);
  });

  it("three github issues collapse into one issues chip in appearance order", () => {
    const rows = ticketChipRows([
      githubRef({ raw: "#12", number: 12, href: "https://github.com/owner/repo/issues/12" }),
      githubRef({ raw: "#30", number: 30, href: "https://github.com/owner/repo/issues/30" }),
      githubRef({ raw: "#44", number: 44, href: "https://github.com/owner/repo/issues/44" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].issues?.refs.map((ref) => ref.number)).toEqual([12, 30, 44]);
    expect(rows[0].pulls).toBeUndefined();
  });

  it("a kindless #N reads as an issue chip until status corrects", () => {
    const rows = ticketChipRows([githubRef({ kind: undefined, href: undefined })]);
    expect(rows[0].issues?.kind).toBe("issue");
    expect(rows[0].pulls).toBeUndefined();
  });

  it("a pulls-only row still holds its one chip (render pairs rows, never forces a twin)", () => {
    const rows = ticketChipRows([
      githubRef({ raw: "#30", kind: "pull", number: 30, href: "https://github.com/owner/repo/pull/30" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].issues).toBeUndefined();
    expect(rows[0].pulls?.refs.map((ref) => ref.number)).toEqual([30]);
  });

  it("a forgejo pulls URL lands in the row's pulls chip", () => {
    const rows = ticketChipRows([
      forgejoRef({ raw: "https://forge.example/org/app/pulls/7", href: "https://forge.example/org/app/pulls/7" }),
    ]);
    expect(rows[0].issues).toBeUndefined();
    expect(rows[0].pulls?.refs).toHaveLength(1);
  });

  it("an external ref carrying a kind lands in that kind's chip", () => {
    const rows = ticketChipRows([
      forgejoRef({ raw: "#42", kind: "pull", number: 42, href: "https://forge.example/org/app/pulls/42" }),
      forgejoRef({ raw: "#7", kind: "issue", number: 7, href: "https://forge.example/org/app/issues/7" }),
    ]);
    expect(rows[0].issues?.refs.map((ref) => ref.number)).toEqual([7]);
    expect(rows[0].pulls?.refs.map((ref) => ref.number)).toEqual([42]);
  });

  it("the pulls chip reads the pull kind from the URL when the ref has no kind", () => {
    const rows = ticketChipRows([
      forgejoRef({ raw: "git.cove", href: "https://forge.example/org/app/pulls/42" }),
    ]);
    expect(rows[0].issues).toBeUndefined();
    expect(rows[0].pulls?.refs).toHaveLength(1);
  });
});

describe("ticketChipRows — repo base selection", () => {
  it("cross-repo github refs share one row; the first ref's repo wins the base", () => {
    const rows = ticketChipRows([
      githubRef({ raw: "#12", number: 12, href: "https://github.com/owner/repo/issues/12" }),
      githubRef({ raw: "#9", number: 9, href: "https://github.com/other/lib/issues/9" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].base).toBe("https://github.com/owner/repo");
    expect(ticketChipIconHref(rows[0], "issues")).toBe("https://github.com/owner/repo/issues");
  });

  it("repoHrefBase backstops a kindless #N whose href it supplies", () => {
    const rows = ticketChipRows([githubRef({ kind: undefined, href: undefined })], {
      repoHrefBase: "https://github.com/proj/board",
    });
    expect(rows[0].base).toBe("https://github.com/proj/board");
  });

  it("a forgejo remote base backstops an external #N ref with no href", () => {
    const rows = ticketChipRows(
      [{ raw: "#7", tracker: "external", hostname: "forge.example", number: 7 }],
      { repoHrefBase: "https://forge.example/org/app" },
    );
    expect(rows[0].base).toBe("https://forge.example/org/app");
    expect(ticketChipIconHref(rows[0], "issues")).toBe("https://forge.example/org/app/issues");
  });
});

describe("ticketChipIconHref — the mark's list page", () => {
  it("a base-backed row links the kind's filtered page", () => {
    const rows = ticketChipRows([githubRef()]);
    expect(ticketChipIconHref(rows[0], "issues")).toBe("https://github.com/owner/repo/issues");
    expect(ticketChipIconHref(rows[0], "pull")).toBe("https://github.com/owner/repo/pulls");
    const forgejoRows = ticketChipRows([forgejoRef()]);
    expect(ticketChipIconHref(forgejoRows[0], "issues")).toBe(
      "https://forge.example/org/app/issues",
    );
  });

  it("a github row without a base falls back to github's global page", () => {
    const rows = ticketChipRows([githubRef({ href: undefined, kind: undefined })]);
    expect(rows[0].base).toBeUndefined();
    expect(ticketChipIconHref(rows[0], "issues")).toBe("https://github.com/issues");
    expect(ticketChipIconHref(rows[0], "pull")).toBe("https://github.com/pulls");
  });

  it("an unknown external row without a base stays inert — no guessed URL", () => {
    const rows = ticketChipRows([
      forgejoRef({ hostname: "linear.app", href: "https://linear.app/t/PROJ-1", raw: "PROJ-1", number: undefined }),
    ]);
    expect(rows[0].base).toBeUndefined();
    expect(ticketChipIconHref(rows[0], "issues")).toBeUndefined();
  });
});

describe("ticketChipIdText — ids, not addresses", () => {
  it("keeps short raws and labels verbatim", () => {
    expect(ticketChipIdText(githubRef({ raw: "#12" }))).toBe("#12");
    expect(ticketChipIdText(forgejoRef({ raw: "PROJ-142", number: undefined }))).toBe("PROJ-142");
  });

  it("an external ref with a number renders #N, never the host", () => {
    expect(
      ticketChipIdText(forgejoRef({ raw: "#42", number: 42, kind: "pull", href: "https://forge.example/org/app/pulls/42" })),
    ).toBe("#42");
  });

  it("shortens a scanned full github URL ref to its number", () => {
    expect(
      ticketChipIdText(
        githubRef({ raw: "https://github.com/owner/repo/issues/5", number: 5 }),
      ),
    ).toBe("#5");
  });

  it("a URL ref without a number falls back to the hostname, then the raw", () => {
    expect(tidTextFor({ raw: "https://x.example/a/b/1", number: undefined, hostname: "x.example", tracker: "external" })).toBe("x.example");
    expect(tidTextFor({ raw: "https://x.example/a/b/1", number: undefined, hostname: undefined, tracker: "external" })).toBe("https://x.example/a/b/1");
  });
});

function tidTextFor(partial: Partial<TicketRef>): string {
  return ticketChipIdText({ raw: "", tracker: "github", ...partial });
}

describe("ticketStatusRepo — which repo the status lookup asks", () => {
  it("an external ref takes no part in the github dot path", () => {
    expect(ticketStatusRepo(forgejoRef(), "proj/board")).toBeNull();
  });

  it("a github ref parses its repo from its href", () => {
    expect(ticketStatusRepo(githubRef(), "proj/board")).toBe("owner/repo");
  });

  it("a kindless #N without an href falls back to the project repo", () => {
    expect(ticketStatusRepo(githubRef({ href: undefined }), "proj/board")).toBe("proj/board");
    expect(ticketStatusRepo(githubRef({ href: undefined }), null)).toBeNull();
  });
});

describe("ticketChipRows — fail loud on data bugs", () => {
  it("an external ref without a hostname cannot name its provider and throws", () => {
    expect(() =>
      ticketChipRows([{ raw: "PROJ-1", tracker: "external" } as TicketRef]),
    ).toThrow(/PROJ-1/);
  });
});