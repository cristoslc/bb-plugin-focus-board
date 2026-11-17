// Pure classification behind the pane's file-link guard: which workspace
// entry a `file://` anchor names, and whether the host listing calls it a
// file or a directory.
import { describe, expect, it } from "vitest";
import {
  fileHrefPath,
  listedEntryKind,
  workspaceRelativeFromAbsolute,
} from "../lib/workspace-link";

describe("fileHrefPath", () => {
  it("reads a local file URL, decoded", () => {
    expect(fileHrefPath("file:///Users/cristos/p/bv-brain2/.worktrees")).toBe(
      "/Users/cristos/p/bv-brain2/.worktrees",
    );
    expect(fileHrefPath("file:///r/%40thread%3Athr_x")).toBe("/r/@thread:thr_x");
    expect(fileHrefPath("file:///r/a%20b.md")).toBe("/r/a b.md");
    expect(fileHrefPath("file://localhost/r/x.md")).toBe("/r/x.md");
  });

  it("refuses anything that is not a local file URL", () => {
    expect(fileHrefPath("https://example.com/x.md")).toBeNull();
    expect(fileHrefPath("//host/share/x")).toBeNull();
    expect(fileHrefPath("file://server/share/x")).toBeNull();
    expect(fileHrefPath("file:///r/%zz")).toBeNull();
    expect(fileHrefPath("file://")).toBe("/");
    expect(fileHrefPath("not a url")).toBeNull();
  });
});

describe("workspaceRelativeFromAbsolute", () => {
  it("makes an absolute path inside the root relative", () => {
    expect(workspaceRelativeFromAbsolute("/w/app", "/w/app/docs/erd.md")).toBe(
      "docs/erd.md",
    );
    expect(workspaceRelativeFromAbsolute("/w/app/", "/w/app/.worktrees")).toBe(
      ".worktrees",
    );
  });

  it("refuses the root itself, a sibling prefix, and relative input", () => {
    expect(workspaceRelativeFromAbsolute("/w/app", "/w/app")).toBe("");
    expect(workspaceRelativeFromAbsolute("/w/app", "/w/app-2/x.md")).toBeNull();
    expect(workspaceRelativeFromAbsolute("/w/app", "/etc/hosts")).toBeNull();
    expect(workspaceRelativeFromAbsolute("/w/app", "docs/erd.md")).toBeNull();
  });
});

describe("listedEntryKind", () => {
  const entries = [
    { name: "docs", kind: "directory" },
    { name: "erd.md", kind: "file" },
    { name: "socket", kind: "other" },
  ];

  it("reports the kind the host listing gives each entry", () => {
    expect(listedEntryKind(entries, "docs")).toBe("directory");
    expect(listedEntryKind(entries, "erd.md")).toBe("file");
  });

  it("reports null for a missing entry or an unknown kind", () => {
    expect(listedEntryKind(entries, "gone")).toBeNull();
    expect(listedEntryKind(entries, "socket")).toBeNull();
  });
});
