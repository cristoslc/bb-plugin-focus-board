// Containment checks for the workspace_files_exist RPC. The frontend's
// classified paths are untrusted at the server boundary; these tests pin
// that only workspace-contained relative paths survive resolution.
import { describe, expect, it } from "vitest";
import { resolveWithinRoot } from "../lib/workspace-paths";

const ROOT = "/home/me/workspace";

describe("resolveWithinRoot", () => {
  it("resolves relative paths against the root", () => {
    expect(resolveWithinRoot(ROOT, "docs/notes.md")).toBe(
      "/home/me/workspace/docs/notes.md",
    );
    expect(resolveWithinRoot(ROOT, "./docs/notes.md")).toBe(
      "/home/me/workspace/docs/notes.md",
    );
    expect(resolveWithinRoot(ROOT, "docs/../docs/notes.md")).toBe(
      "/home/me/workspace/docs/notes.md",
    );
  });

  it("rejects absolute paths", () => {
    expect(resolveWithinRoot(ROOT, "/etc/passwd")).toBeNull();
  });

  it("rejects home-relative paths anywhere in the path", () => {
    expect(resolveWithinRoot(ROOT, "~/notes.md")).toBeNull();
    expect(resolveWithinRoot(ROOT, "~cris/notes.md")).toBeNull();
    expect(resolveWithinRoot(ROOT, "docs/~hidden.md")).toBeNull();
  });

  it("rejects `..` escapes past the root", () => {
    expect(resolveWithinRoot(ROOT, "../outside.md")).toBeNull();
    expect(resolveWithinRoot(ROOT, "docs/../../outside.md")).toBeNull();
  });

  it("rejects empty paths", () => {
    expect(resolveWithinRoot(ROOT, "")).toBeNull();
  });
});