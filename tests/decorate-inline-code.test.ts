// @vitest-environment jsdom
// Decorator for the host's missing inline-code file links. The host's
// thread view linkifies inline code naming workspace markdown files; this
// pane repaints that affordance onto the rendered DOM. These tests pin the
// DOM behavior: which code spans get decorated, idempotency under repeated
// scans (the MutationObserver re-scans on every mutation), and the flag
// attribute the click-capture handler reads.
import { describe, expect, it } from "vitest";
import {
  decorateInlineCodeLinks,
  decoratedCodePath,
} from "../components/decorate-inline-code";

function markdownMessage(html: string): HTMLElement {
  const container = document.createElement("div");
  container.setAttribute("data-markdown-preview", "");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

describe("decorateInlineCodeLinks", () => {
  it("decorates inline code naming a workspace markdown file", () => {
    const root = markdownMessage(
      "<p><code>docs/rfcs/rfc-support-triage-process.md</code></p>",
    );
    decorateInlineCodeLinks(root);
    const code = root.querySelector("code");
    expect(code).not.toBeNull();
    expect(decoratedCodePath(code!)).toBe(
      "docs/rfcs/rfc-support-triage-process.md",
    );
    expect(code!.classList.contains("underline")).toBe(true);
    expect(code!.classList.contains("cursor-pointer")).toBe(true);
    expect(code!.querySelector("[data-focus-board-path-link-icon]")).not.toBeNull();
  });

  it("leaves non-markdown code, commit hashes, and block code alone", () => {
    const root = markdownMessage(
      "<p><code>8811dd9c</code><code>src/main.ts</code><code>docs/erd.mmd</code></p>" +
        "<pre><code>docs/notes.md</code></pre>",
    );
    decorateInlineCodeLinks(root);
    for (const code of root.querySelectorAll("code")) {
      expect(decoratedCodePath(code)).toBeNull();
      expect(code.querySelector("[data-focus-board-path-link-icon]")).toBeNull();
    }
  });

  it("is idempotent: repeated scans do not stack icons or reset the path", () => {
    const root = markdownMessage("<p><code>docs/notes.md</code></p>");
    decorateInlineCodeLinks(root);
    decorateInlineCodeLinks(root);
    const code = root.querySelector("code")!;
    expect(code.querySelectorAll("[data-focus-board-path-link-icon]")).toHaveLength(1);
    expect(decoratedCodePath(code)).toBe("docs/notes.md");
  });

  it("keeps the code text intact after decoration (clicks classify the same)", () => {
    const root = markdownMessage("<p><code>docs/notes.md</code></p>");
    decorateInlineCodeLinks(root);
    const code = root.querySelector("code")!;
    // The appended icon is textless, so textContent still classifies to the
    // same path — the click handler's fallback works on decorated elements.
    expect(code.textContent).toBe("docs/notes.md");
  });

  it("decorates inside a scoped subtree, mirroring the pane's observer root", () => {
    const outer = document.createElement("div");
    const chat = document.createElement("div");
    chat.innerHTML = "<p><code>notes.md</code></p>";
    outer.appendChild(chat);
    document.body.appendChild(outer);
    decorateInlineCodeLinks(chat);
    expect(decoratedCodePath(chat.querySelector("code")!)).toBe("notes.md");
  });

  it("matches the exact markup observed in the live bb 0.44.0 pane", () => {
    // Shapes captured from the running app: agent-message markdown renders
    // as <p class="mb-2"> inside [data-markdown-preview] > .group/message,
    // with plain <code class="rounded bg-muted/70 ..."> spans. The path
    // span must decorate; the commit-sha and block-code spans must not.
    const root = markdownMessage(
      '<div class="group/message"><p class="mb-2">Reflowed ' +
        '<code class="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs">' +
        "docs/rfcs/rfc-support-triage-process.md</code> so each paragraph is a " +
        "single logical line. Committed as " +
        '<code class="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs">' +
        "8811dd9c</code>.</p>" +
        '<pre><code class="bb-code-highlight">const x = 1</code></pre></div>',
    );
    decorateInlineCodeLinks(root);
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
  });
});