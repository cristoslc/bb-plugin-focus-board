// @vitest-environment jsdom
// Ticket chips: each ref renders as [provider glyph][kind glyph] + ref text.
// The provider glyph names the source (GitHub's brand; a generic ticket
// mark when the provider cannot be named — unreachable from text scanning
// now that unvalidatable key-shaped refs never chip, and kept for chip
// sources that one day render without a text provider). The kind glyph
// separates issue from PR and carries the live state color once status
// lands: the old bare dot is gone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

const BASE = "https://github.com/owner/repo";

type CardProps = Parameters<typeof ThreadCard>[0];

function renderCard(title: string, overrides: Partial<CardProps> = {}) {
  const props = {
    thread: thread({ id: "thr_ref", displayTitle: title, updatedAt: 5000 }),
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    repoHrefBase: BASE,
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

function chip(): Element {
  const el = document.querySelector("[data-ticket-chip]");
  if (el === null) throw new Error("missing ticket chip");
  return el;
}

/** A glyph inside the chip, waiting through the extended-icon lazy load. */
async function chipIcon(name: string): Promise<Element> {
  return waitFor(() => {
    const el = chip().querySelector(`[data-icon="${name}"]`);
    if (el === null) throw new Error(`missing chip glyph ${name}`);
    return el;
  });
}

afterEach(cleanup);

describe("ticket chip icons — provider glyph", () => {
  it("a #N ref under a GitHub repo leads with the GitHub brand mark", async () => {
    renderCard("resolve #17: surface a thread's ticket");
    await chipIcon("GithubMark");
    // The mark links to the kind's list page; each ID links to its item.
    expect(chip().querySelector("[data-ticket-chip-mark]")?.getAttribute("href")).toBe(
      `${BASE}/issues`,
    );
    expect(chip().querySelector('[data-ticket-id="#17"]')?.getAttribute("href")).toBe(
      `${BASE}/issues/17`,
    );
    expect(chip().textContent).toContain("#17");
  });

  it("a PROJ-123 key ref renders no chip (word keys cannot validate)", async () => {
    renderCard("Fix PROJ-123 render bug");
    expect(document.querySelector("[data-ticket-chip]")).toBeNull();
  });
});

describe("linked store chips — distinct PR vs issue glyphs", () => {
  const linkedPull: import("../lib/link-metadata").GitHubItemLink = {
    tracker: "github",
    repo: "owner/repo",
    issue: 16,
    kind: "pull",
    href: `${BASE}/pull/16`,
    createdAt: "2026-10-09T00:00:00.000Z",
    source: "agent",
  };
  const linkedIssue: import("../lib/link-metadata").GitHubItemLink = {
    ...linkedPull,
    issue: 12,
    kind: "issue",
    href: `${BASE}/issues/12`,
  };

  it("a store-linked PR leads with the PR glyph before status lands", async () => {
    renderCard("Link thread to issue and update chip status", {
      linkedIssues: [linkedPull],
    });
    await chipIcon("PullRequest");
  });

  it("a store-linked issue keeps the issue glyph", async () => {
    renderCard("File issue on tag support for other threads", {
      linkedIssues: [linkedIssue],
    });
    await chipIcon("IssueOpen");
  });

  it("an external chip shows the favicon and no GitHub kind glyph", async () => {
    renderCard("Explain GLM-5 tag on thread", {
      linkedIssues: [
        {
          tracker: "external",
          url: "https://linear.app/t/PROJ-142",
          hostname: "linear.app",
          label: "PROJ-142",
          createdAt: "2026-10-09T00:00:00.000Z",
          source: "operator",
        },
      ],
    });
    const chipEl = await waitFor(() => {
      const el = document.querySelector("[data-ticket-chip]");
      if (el === null) throw new Error("missing chip");
      return el;
    });
    expect(chipEl.textContent).toContain("PROJ-142");
    expect(chipEl.querySelector('[data-icon="IssueOpen"]')).toBeNull();
    expect(chipEl.querySelector('[data-icon="PullRequest"]')).toBeNull();
    expect(chipEl.querySelector('[data-icon="GithubMark"]')).toBeNull();
    expect(chipEl.querySelector("img")).not.toBeNull();
  });

  it("a forgejo PR id leads with the PR glyph, beside the site favicon", async () => {
    renderCard("Fix render-configs.sh placeholder substitution", {
      repoHrefBase: "https://git.cove/cristos/Homelab",
      linkedIssues: [
        {
          tracker: "external",
          url: "https://git.cove/cristos/Homelab/pulls/42",
          hostname: "git.cove",
          createdAt: "2026-10-11T21:46:04.559Z",
          source: "agent",
        },
      ],
    });
    const chipEl = await waitFor(() => {
      const el = document.querySelector("[data-ticket-chip]");
      if (el === null) throw new Error("missing chip");
      return el;
    });
    // The id is its number, not the host; the glyph names its kind.
    expect(chipEl.querySelector('[data-ticket-id="#42"]')).not.toBeNull();
    expect(chipEl.textContent).toContain("#42");
    expect(chipEl.textContent).not.toContain("git.cove");
    expect(chipEl.querySelector('[data-icon="PullRequest"]')).not.toBeNull();
    expect(chipEl.querySelector('[data-icon="GithubMark"]')).toBeNull();
    expect(chipEl.querySelector("img")?.getAttribute("src")).toBe("https://git.cove/favicon.ico");
  });

  it("a forgejo PR and issue from the store share one row as two chips", async () => {
    renderCard("purge MetaMCP remnants", {
      repoHrefBase: "https://git.cove/cristos/Homelab",
      linkedIssues: [
        { tracker: "external", url: "https://git.cove/cristos/Homelab/pulls/42", hostname: "git.cove", createdAt: "a", source: "agent" },
        { tracker: "external", url: "https://git.cove/cristos/Homelab/issues/39", hostname: "git.cove", createdAt: "b", source: "agent" },
      ],
    });
    await waitFor(() => {
      if (document.querySelectorAll("[data-ticket-chip]").length < 2) throw new Error("want two chips");
    });
    const row = document.querySelector('[data-provider-row="git.cove"]');
    const chips = row?.querySelectorAll("[data-ticket-chip]") ?? [];
    expect(chips.length).toBe(2);
    expect(chips[0].querySelector('[data-ticket-id="#39"]')).not.toBeNull();
    expect(chips[1].querySelector('[data-ticket-id="#42"]')).not.toBeNull();
    expect(chips[0].querySelector('[data-icon="IssueOpen"]')).not.toBeNull();
    expect(chips[1].querySelector('[data-icon="PullRequest"]')).not.toBeNull();
  });

  it("a three-item Cove thread renders all three ids, each linking its own item", async () => {
    renderCard("purge MetaMCP remnants (issue #39)", {
      repoHrefBase: "https://git.cove/cristos/Homelab",
      linkedIssues: [
        { tracker: "external", url: "https://git.cove/cristos/Homelab/pulls/42", hostname: "git.cove", createdAt: "a", source: "agent" },
        { tracker: "external", url: "https://git.cove/cristos/Homelab/pulls/41", hostname: "git.cove", createdAt: "b", source: "agent" },
        { tracker: "external", url: "https://git.cove/cristos/Homelab/issues/39", hostname: "git.cove", createdAt: "c", source: "agent" },
      ],
    });
    const ids = await waitFor(() => {
      const els = document.querySelectorAll("[data-ticket-id]");
      if (els.length < 3) throw new Error(`only ${els.length} ids`);
      return els;
    });
    const hrefs = [...ids].map((el) => el.getAttribute("href"));
    expect(hrefs).toContain("https://git.cove/cristos/Homelab/pulls/42");
    expect(hrefs).toContain("https://git.cove/cristos/Homelab/pulls/41");
    expect(hrefs).toContain("https://git.cove/cristos/Homelab/issues/39");
  });

  it("a forgejo text ref's chip mark links the base's list page, not github.com", async () => {
    renderCard("resolve #7", { repoHrefBase: "https://git.cove/cristos/Homelab" });
    const mark = await waitFor(() => {
      const el = document.querySelector("[data-ticket-chip-mark]");
      if (el === null) throw new Error("missing mark");
      return el;
    });
    expect(mark.getAttribute("href")).toBe("https://git.cove/cristos/Homelab/issues");
    expect(mark.querySelector('[data-icon="GithubMark"]')).toBeNull();
  });

  it("a merged store-linked PR still shows the merge glyph purple", async () => {
    renderCard("Link thread to issue and update chip status", {
      linkedIssues: [linkedPull],
      statusFor: (repo, num) =>
        repo === "owner/repo" && num === 16 ? { kind: "pull", state: "MERGED" } : undefined,
    });
    await chipIcon("Merge");
  });
});

describe("ticket chip icons — issue vs PR glyph", () => {
  it("a kindless #N ref renders the open-issue glyph before status lands", async () => {
    renderCard("resolve #17: surface a thread's ticket");
    await chipIcon("IssueOpen");
  });

  it("a /pull/ URL renders the PR glyph even before status lands", async () => {
    renderCard(`merged https://github.com/owner/repo/pull/45`);
    await chipIcon("PullRequest");
    const issueGlyph = chip().querySelector('[data-icon="IssueOpen"]');
    expect(issueGlyph).toBeNull();
  });

  it("a PROJ-123 key ref renders no chip (word keys are never PRs, never chips)", async () => {
    renderCard("Fix PROJ-123 render bug");
    expect(document.querySelector("[data-ticket-chip]")).toBeNull();
  });

  it("live open-issue status colors the open-issue glyph emerald", async () => {
    renderCard("resolve #17", {
      statusFor: (repo, num) =>
        repo === "owner/repo" && num === 17 ? { kind: "issue", state: "OPEN" } : undefined,
    });
    const glyph = await chipIcon("IssueOpen");
    expect(glyph.getAttribute("class")).toContain("text-emerald-500");
    expect(glyph.getAttribute("aria-label")).toBe("issue OPEN");
  });

  it("live merged-PR status swaps in the merge glyph with the ids dimmed and struck", async () => {
    renderCard("resolve #17", {
      statusFor: (repo, num) =>
        repo === "owner/repo" && num === 17 ? { kind: "pull", state: "MERGED" } : undefined,
    });
    const glyph = await chipIcon("Merge");
    // The merged glyph carries no state color (open's emerald is the only
    // colored glyph); the merged id reads dimmed grey with a strikethrough,
    // and hover changes size, never color.
    expect(glyph.getAttribute("class") ?? "").not.toMatch(/text-purple-500/);
    const idSpan = chip().querySelector('[data-ticket-id="#17"] > span');
    expect(idSpan?.getAttribute("class") ?? "").toContain("line-through");
    expect(idSpan?.getAttribute("class") ?? "").toContain("opacity-60");
  });

  it("each id carries a hover bubble naming it, clear of the pointer", () => {
    renderCard("resolve #17");
    const anchor = chip().querySelector('[data-ticket-id="#17"]');
    const tip = anchor?.querySelector("[data-ticket-tip]");
    expect(tip?.textContent).toBe("#17");
    // The bubble sits above the id and reveals on that id's hover, so the
    // OS pays it no attention and the pointer can never cover it.
    expect(tip?.getAttribute("class") ?? "").toContain("bottom-full");
    expect(tip?.getAttribute("class") ?? "").toContain("group-hover/id:block");
    // The native title tooltip is gone (it renders under the pointer).
    expect(anchor?.getAttribute("title")).toBeNull();
    expect(anchor?.getAttribute("aria-label") ?? "").toContain("#17");
  });

  it("ids render in a three-track grid and enlarge on hover by transform", () => {
    renderCard("#101 #102 #103 #104 #105 #106 #107 #108 resolve");
    const grid = chip().querySelector("[data-ticket-chip] > [class*='grid-cols']");
    expect(grid).not.toBeNull();
    expect(grid?.className).toContain("grid-cols-[repeat(3,max-content)]");
    const ids = chip().querySelectorAll("[data-ticket-id]");
    expect(ids.length).toBeGreaterThanOrEqual(4);
    const anchor = ids[0];
    expect(anchor.getAttribute("class") ?? "").toContain("hover:scale-110");
    expect(anchor.getAttribute("class") ?? "").toContain("origin-left");
    expect(anchor.getAttribute("class") ?? "").not.toContain("hover:text-");
  });

  it("a single-id chip reserves one track — no phantom width from empty columns", () => {
    renderCard("Mark thread done rename worktree #32");
    const grid = chip().querySelector("[data-ticket-chip] > [class*='grid-cols']");
    expect(grid?.className).toContain("grid-cols-[max-content]");
    // Empty tracks would still collect their column gaps, leaving the chip
    // wider than its one id.
    expect(grid?.className).not.toContain("repeat(3");
    expect(chip().querySelectorAll("[data-ticket-id]")).toHaveLength(1);
  });

  it("a two-id chip reserves two tracks", () => {
    renderCard("Watch the pair #61 #62 settle");
    const grid = chip().querySelector("[data-ticket-chip] > [class*='grid-cols']");
    expect(grid?.className).toContain("grid-cols-[repeat(2,max-content)]");
    expect(grid?.className).not.toContain("repeat(3");
  });

  it("a single-row chip centers its content vertically; a wrapped chip stays top-anchored", () => {
    const single = renderCard("Follow-ups #17 #21 #30 chip mix");
    expect(chip().className).toContain("items-center");
    single.unmount();
    renderCard("#101 #102 #103 #104 #105 #106 #107 #108 resolve");
    expect(chip().className).toContain("items-start");
    expect(chip().className).not.toContain("items-center");
  });

  it("a chip with many ids wraps onto extra lines instead of overflowing", () => {
    renderCard("#101 #102 #103 #104 #105 #106 #107 #108 resolve");
    const chipEl = chip();
    const gridEl = chipEl.querySelector("[data-ticket-chip] > [class*='grid-cols']");
    expect(gridEl?.className).toContain("grid-cols-[repeat(3,max-content)]");
    expect(chipEl.className).not.toContain("flex-wrap");
  });

  it("live closed-PR status swaps in the closed-PR glyph muted", async () => {
    renderCard("resolve #17", {
      statusFor: (repo, num) =>
        repo === "owner/repo" && num === 17 ? { kind: "pull", state: "CLOSED" } : undefined,
    });
    const glyph = await chipIcon("PullRequestClosed");
    expect(glyph.getAttribute("class")).toContain("text-muted-foreground/50");
  });

  it("live closed-issue status swaps in the closed-issue glyph muted", async () => {
    renderCard("resolve #17", {
      statusFor: (repo, num) =>
        repo === "owner/repo" && num === 17 ? { kind: "issue", state: "CLOSED" } : undefined,
    });
    const glyph = await chipIcon("IssueClosed");
    expect(glyph.getAttribute("class")).toContain("text-muted-foreground/50");
  });
});