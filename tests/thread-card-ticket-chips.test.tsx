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
    expect(chip().getAttribute("href")).toBe(`${BASE}/issues/17`);
    expect(chip().textContent).toContain("#17");
  });

  it("a PROJ-123 key ref renders no chip (word keys cannot validate)", async () => {
    renderCard("Fix PROJ-123 render bug");
    expect(document.querySelector("[data-ticket-chip]")).toBeNull();
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

  it("live merged-PR status swaps in the merge glyph in purple", async () => {
    renderCard("resolve #17", {
      statusFor: (repo, num) =>
        repo === "owner/repo" && num === 17 ? { kind: "pull", state: "MERGED" } : undefined,
    });
    const glyph = await chipIcon("Merge");
    expect(glyph.getAttribute("class")).toContain("text-purple-500");
    expect(glyph.getAttribute("aria-label")).toBe("pull MERGED");
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