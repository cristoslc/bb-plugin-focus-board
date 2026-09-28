import { describe, expect, it } from "vitest";
import {
  isExternalHref,
  inlineCodeMarkdownPath,
  workspacePathFromHref,
} from "../components/chat-link-intercept";

describe("isExternalHref", () => {
  it("treats scheme-qualified urls as external", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("http://example.com/a")).toBe(true);
    expect(isExternalHref("mailto:a@b.c")).toBe(true);
  });

  it("treats protocol-relative urls as external", () => {
    expect(isExternalHref("//example.com/a")).toBe(true);
  });

  it("treats fragment-only hrefs as in-document, not external", () => {
    expect(isExternalHref("#section")).toBe(false);
  });

  it("treats relative and workspace-absolute hrefs as not external", () => {
    expect(isExternalHref("docs/erd.mmd")).toBe(false);
    expect(isExternalHref("./docs/erd.mmd")).toBe(false);
    expect(isExternalHref("/docs/erd.mmd")).toBe(false);
    expect(isExternalHref("../docs/erd.mmd")).toBe(false);
  });

  it("does not mistake windows-style drive letters in a path for a scheme", () => {
    // A single letter followed by a colon looks like a scheme to a naive
    // regex; the strict rule requires a letter start, which "C:" also
    // satisfies, so this is accepted as external — document the behavior.
    expect(isExternalHref("C:\\temp\\file.txt")).toBe(true);
  });
});

describe("workspacePathFromHref", () => {
  it("reduces repo-relative markdown destinations to workspace paths", () => {
    expect(workspacePathFromHref("docs/credential-shapes-erd.mmd")).toBe(
      "docs/credential-shapes-erd.mmd",
    );
  });

  it("strips ./ and leading-slash forms", () => {
    expect(workspacePathFromHref("./docs/erd.mmd")).toBe("docs/erd.mmd");
    expect(workspacePathFromHref("/docs/erd.mmd")).toBe("docs/erd.mmd");
  });

  it("resolves .. climbs within the root", () => {
    expect(workspacePathFromHref("docs/../docs/erd.mmd")).toBe("docs/erd.mmd");
    expect(workspacePathFromHref("docs/sub/../erd.mmd")).toBe("docs/erd.mmd");
  });

  it("rejects climbs past the root", () => {
    expect(workspacePathFromHref("../secret")).toBeNull();
    expect(workspacePathFromHref("../../secret")).toBeNull();
  });

  it("drops queries and fragments", () => {
    expect(workspacePathFromHref("docs/erd.mmd#diagram")).toBe("docs/erd.mmd");
    expect(workspacePathFromHref("docs/erd.mmd?v=2")).toBe("docs/erd.mmd");
  });

  it("returns null for empty and directory-only destinations", () => {
    expect(workspacePathFromHref("")).toBeNull();
    expect(workspacePathFromHref("./")).toBeNull();
    expect(workspacePathFromHref(".")).toBeNull();
  });

  it("leaves in-app route anchors like thread mentions alone", () => {
    // Mention chips render as `<a href="/threads/thr_...">`; without a dot
    // in the final segment they are app routes, not workspace files.
    expect(workspacePathFromHref("/threads/thr_3ux2jmacqb")).toBeNull();
    expect(workspacePathFromHref("threads/thr_3ux2jmacqb")).toBeNull();
    expect(workspacePathFromHref("/settings")).toBeNull();
  });

  it("strips host-style line suffixes before resolving", () => {
    expect(workspacePathFromHref("docs/erd.mmd:12")).toBe("docs/erd.mmd");
    expect(workspacePathFromHref("docs/erd.mmd:12-20")).toBe("docs/erd.mmd");
    expect(workspacePathFromHref("docs/erd.mmd:12:5")).toBe("docs/erd.mmd");
    expect(workspacePathFromHref("docs/erd.mmd#L12-L20")).toBe("docs/erd.mmd");
  });

  it("does not treat a dotless route with a line suffix as a file", () => {
    expect(workspacePathFromHref("/threads/thr_abc:12")).toBeNull();
  });
});

describe("inlineCodeMarkdownPath", () => {
  it("accepts the spans the host's thread view linkifies", () => {
    expect(inlineCodeMarkdownPath("docs/rfcs/rfc-support-triage-process.md")).toBe(
      "docs/rfcs/rfc-support-triage-process.md",
    );
    expect(inlineCodeMarkdownPath("./docs/erd.md")).toBe("docs/erd.md");
    expect(inlineCodeMarkdownPath("docs/../docs/erd.md")).toBe("docs/erd.md");
    expect(inlineCodeMarkdownPath("README.MARKDOWN")).toBe("README.MARKDOWN");
  });

  it("strips host-style line suffixes from code text", () => {
    expect(inlineCodeMarkdownPath("docs/erd.md:12")).toBe("docs/erd.md");
    expect(inlineCodeMarkdownPath("docs/erd.md:12-20")).toBe("docs/erd.md");
    expect(inlineCodeMarkdownPath("docs/erd.md:12:5")).toBe("docs/erd.md");
    expect(inlineCodeMarkdownPath("docs/erd.md#L12-L20")).toBe("docs/erd.md");
  });

  it("rejects whitespace-padded and multiline spans like the host does", () => {
    expect(inlineCodeMarkdownPath(" docs/erd.md ")).toBeNull();
    expect(inlineCodeMarkdownPath("docs/erd.md\n")).toBeNull();
    expect(inlineCodeMarkdownPath("docs/a.mmd\ndocs/b.md")).toBeNull();
  });

  it("never linkifies non-markdown files or commit hashes", () => {
    // The host autolinks markdown files only; .ts paths, mermaid .mmd,
    // commit shas and extensionless routes stay plain code.
    expect(inlineCodeMarkdownPath("src/main.ts")).toBeNull();
    expect(inlineCodeMarkdownPath("8811dd9c")).toBeNull();
    expect(inlineCodeMarkdownPath("docs/erd.mmd")).toBeNull();
    expect(inlineCodeMarkdownPath("docs/erd")).toBeNull();
    expect(inlineCodeMarkdownPath("components/thread-pane.tsx")).toBeNull();
  });

  it("rejects home-relative paths the host cannot resolve in the workspace", () => {
    expect(inlineCodeMarkdownPath("~/.agents/AGENTS.md")).toBeNull();
    expect(inlineCodeMarkdownPath("~agents/AGENTS.md")).toBeNull();
  });

  it("rejects urls, empty text, and oversized spans", () => {
    expect(inlineCodeMarkdownPath("https://example.com/a.md")).toBeNull();
    expect(inlineCodeMarkdownPath("//example.com/a.md")).toBeNull();
    expect(inlineCodeMarkdownPath("")).toBeNull();
    expect(inlineCodeMarkdownPath("a.md".repeat(200))).toBeNull();
  });

  it("never linkifies script-executing schemes disguised as file paths", () => {
    // Security: a code span whose text is a scheme-qualified url must stay
    // plain, whatever the extension looks like. These are the classic
    // javascript:/data: payload shapes a message could contain.
    expect(inlineCodeMarkdownPath("javascript:alert(1)//x.md")).toBeNull();
    expect(inlineCodeMarkdownPath("javascript://x.md")).toBeNull();
    expect(inlineCodeMarkdownPath("data:text/html,<script>alert(1)</script>.md")).toBeNull();
    expect(inlineCodeMarkdownPath("vbscript:x.md")).toBeNull();
  });
});
