// @vitest-environment jsdom
// Decorator for the host's missing inline-code file links, gated on
// workspace existence. The host's thread view linkifies inline code
// naming workspace markdown files; this pane repaints that affordance
// onto the rendered DOM — but only after the path checks out against
// the thread's workspace, so dead names (a bare `.md`, a planned but
// never-written file) stay plain. These tests pin the DOM behavior:
// which code spans become candidates, which get decorated, how verdicts
// cache and retry, and the flag attribute the click-capture handler
// reads. Each test uses its own environment id to isolate the verdict
// cache.
import { describe, expect, it, vi } from "vitest";
import {
  collectInlineCodeCandidates,
  decorateVerifiedInlineCodeLinks,
  decoratedCodePath,
  type PathExistenceChecker,
} from "../components/decorate-inline-code";

function markdownMessage(html: string): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-markdown-preview", "");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

function checker(existing: Map<string, boolean>): {
  check: PathExistenceChecker;
  calls: string[][];
} {
  const calls: string[][] = [];
  const check: PathExistenceChecker = async (paths) => {
    calls.push(paths);
    return new Map(paths.map((path) => [path, existing.get(path) ?? false]));
  };
  return { check, calls };
}

describe("collectInlineCodeCandidates", () => {
  it("returns code spans naming workspace markdown files only", () => {
    const root = markdownMessage(
      "<p><code>docs/notes.md</code><code>8811dd9c</code><code>src/main.ts</code>" +
        "<code>docs/erd.mmd</code></p><pre><code>docs/block.md</code></pre>",
    );
    const candidates = collectInlineCodeCandidates(root);
    expect(candidates.map((candidate) => candidate.path)).toEqual([
      "docs/notes.md",
    ]);
  });
});

describe("decorateVerifiedInlineCodeLinks", () => {
  it("decorates inline code whose path exists in the workspace", async () => {
    const root = markdownMessage(
      "<p><code>docs/rfcs/rfc-support-triage-process.md</code></p>",
    );
    const exists = checker(
      new Map([["docs/rfcs/rfc-support-triage-process.md", true]]),
    );
    await decorateVerifiedInlineCodeLinks(root, "env-exists", exists.check);
    const code = root.querySelector("code")!;
    expect(decoratedCodePath(code)).toBe(
      "docs/rfcs/rfc-support-triage-process.md",
    );
    expect(code.classList.contains("underline")).toBe(true);
    expect(code.classList.contains("cursor-pointer")).toBe(true);
    expect(
      code.querySelector("[data-focus-board-path-link-icon]"),
    ).not.toBeNull();
    expect(exists.calls).toEqual([["docs/rfcs/rfc-support-triage-process.md"]]);
  });

  it("leaves paths the workspace does not have plain, including a bare `.md`", async () => {
    const root = markdownMessage(
      "<p><code>.md</code><code>docs/planned.md</code></p>",
    );
    const exists = checker(new Map());
    await decorateVerifiedInlineCodeLinks(root, "env-missing", exists.check);
    for (const code of root.querySelectorAll("code")) {
      expect(decoratedCodePath(code)).toBeNull();
      expect(
        code.querySelector("[data-focus-board-path-link-icon]"),
      ).toBeNull();
    }
    expect(exists.calls).toEqual([[".md", "docs/planned.md"]]);
  });

  it("caches verdicts per environment: settled paths re-scan without checks", async () => {
    const root = markdownMessage("<p><code>docs/notes.md</code></p>");
    const exists = checker(new Map([["docs/notes.md", true]]));
    await decorateVerifiedInlineCodeLinks(root, "env-cache", exists.check);
    await decorateVerifiedInlineCodeLinks(root, "env-cache", exists.check);
    const code = root.querySelector("code")!;
    expect(
      code.querySelectorAll("[data-focus-board-path-link-icon]"),
    ).toHaveLength(1);
    expect(decoratedCodePath(code)).toBe("docs/notes.md");
    expect(exists.calls).toHaveLength(1);
  });

  it("re-checks the same path under a different environment", async () => {
    const exists = checker(new Map([["docs/notes.md", true]]));
    const first = markdownMessage("<p><code>docs/notes.md</code></p>");
    await decorateVerifiedInlineCodeLinks(first, "env-a", exists.check);
    // A fresh element: the first node carries the PATH_FLAG after its
    // decoration, so it no longer scans as a candidate.
    const second = markdownMessage("<p><code>docs/notes.md</code></p>");
    await decorateVerifiedInlineCodeLinks(second, "env-b", exists.check);
    expect(exists.calls).toEqual([["docs/notes.md"], ["docs/notes.md"]]);
  });

  it("does not cache a failed checker run as missing: the next scan retries", async () => {
    const root = markdownMessage("<p><code>docs/notes.md</code></p>");
    const failing = vi.fn(() => Promise.reject(new Error("server down")));
    await decorateVerifiedInlineCodeLinks(
      root,
      "env-fail",
      failing as unknown as PathExistenceChecker,
    );
    expect(decoratedCodePath(root.querySelector("code")!)).toBeNull();
    // The cooldown reads the failed batch as missing without re-checking,
    // so a downed server is not hammered on every frame.
    await decorateVerifiedInlineCodeLinks(
      root,
      "env-fail",
      failing as unknown as PathExistenceChecker,
    );
    expect(failing).toHaveBeenCalledTimes(1);
    // The failure is scoped, not sticky: a working checker still
    // decorates the same relative path under a fresh environment id.
    const working = checker(new Map([["docs/notes.md", true]]));
    const otherRoot = markdownMessage("<p><code>docs/notes.md</code></p>");
    await decorateVerifiedInlineCodeLinks(otherRoot, "env-fail-b", working.check);
    expect(decoratedCodePath(otherRoot.querySelector("code")!)).toBe(
      "docs/notes.md",
    );
  });

  it("keeps the code text intact after decoration", async () => {
    const root = markdownMessage("<p><code>docs/notes.md</code></p>");
    const exists = checker(new Map([["docs/notes.md", true]]));
    await decorateVerifiedInlineCodeLinks(root, "env-text", exists.check);
    expect(root.querySelector("code")!.textContent).toBe("docs/notes.md");
  });

  it("decorates inside a scoped subtree, mirroring the pane's observer root", async () => {
    const chat = document.createElement("div");
    chat.innerHTML = "<p><code>notes.md</code></p>";
    document.body.appendChild(chat);
    const exists = checker(new Map([["notes.md", true]]));
    await decorateVerifiedInlineCodeLinks(chat, "env-scope", exists.check);
    expect(decoratedCodePath(chat.querySelector("code")!)).toBe("notes.md");
  });

  it("matches the exact markup observed in the live bb 0.44.0 pane", async () => {
    // Shapes captured from the running app: agent-message markdown renders
    // as <p class="mb-2"> inside [data-markdown-preview] > .group/message,
    // with plain <code class="rounded bg-muted/70 ..."> spans. The real
    // path decorates once verified; the commit-sha and block-code spans
    // never even become candidates.
    const root = markdownMessage(
      '<div class="group/message"><p class="mb-2">Reflowed ' +
        '<code class="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs">' +
        "docs/rfcs/rfc-support-triage-process.md</code> so each paragraph is a " +
        "single logical line. Committed as " +
        '<code class="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs">' +
        "8811dd9c</code>.</p>" +
        '<pre><code class="bb-code-highlight">const x = 1</code></pre></div>',
    );
    const exists = checker(
      new Map([["docs/rfcs/rfc-support-triage-process.md", true]]),
    );
    await decorateVerifiedInlineCodeLinks(root, "env-live", exists.check);
    const [pathCode, shaCode, blockCode] = root.querySelectorAll("code");
    expect(decoratedCodePath(pathCode)).toBe(
      "docs/rfcs/rfc-support-triage-process.md",
    );
    expect(pathCode.className).toContain("underline");
    expect(
      pathCode.querySelector("[data-focus-board-path-link-icon]"),
    ).not.toBeNull();
    expect(decoratedCodePath(shaCode)).toBeNull();
    expect(decoratedCodePath(blockCode)).toBeNull();
    // Only the one real candidate ever reached the checker.
    expect(exists.calls).toEqual([["docs/rfcs/rfc-support-triage-process.md"]]);
  });
});