import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectNodeModules } from "../scripts/check-node-modules.mjs";

const tmpRoots: string[] = [];

function makeRoot(kind: "absent" | "dir" | "self-symlink" | "external-symlink") {
  const root = path.join(
    os.tmpdir(),
    `fnm-guard-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(root, { recursive: true });
  tmpRoots.push(root);
  if (kind === "dir") {
    mkdirSync(path.join(root, "node_modules"));
  } else if (kind === "self-symlink") {
    symlinkSync(path.join(root, "node_modules"), path.join(root, "node_modules"));
  } else if (kind === "external-symlink") {
    symlinkSync(
      "/nonexistent/elsewhere/node_modules",
      path.join(root, "node_modules"),
    );
  }
  return root;
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("check-node-modules preflight", () => {
  it("absent node_modules is OK (fresh checkout or isolated worktree)", () => {
    const verdict = inspectNodeModules(makeRoot("absent"));
    expect(verdict.ok).toBe(true);
  });

  it("a real node_modules directory is OK", () => {
    const verdict = inspectNodeModules(makeRoot("dir"));
    expect(verdict.ok).toBe(true);
  });

  it("a self-pointing node_modules symlink FAILS (the vanished-board regression)", () => {
    const root = makeRoot("self-symlink");
    const verdict = inspectNodeModules(root);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("symlink");
  });

  it("any node_modules symlink FAILS, even pointing outside the repo", () => {
    const root = makeRoot("external-symlink");
    const verdict = inspectNodeModules(root);
    expect(verdict.ok).toBe(false);
  });

  it("a failing verdict names the repair commands", () => {
    const verdict = inspectNodeModules(makeRoot("self-symlink"));
    expect(verdict.reason).toContain("rm node_modules");
    expect(verdict.reason).toContain("npm ci");
  });
});

describe("repo root guard wiring", () => {
  it("this checkout's own node_modules passes the preflight", () => {
    const verdict = inspectNodeModules(path.resolve(__dirname, ".."));
    expect(verdict.ok).toBe(true);
  });
});