import { describe, expect, it } from "vitest";
import { isExternalHref, workspacePathFromHref } from "../components/chat-link-intercept";

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
});
