import { existsSync, lstatSync, readlinkSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the recurring "Focus Board plugin vanished" incident.
 *
 * bb serves the plugin from the main checkout (`~/Documents/code/bb-plugin-focus-board`)
 * and rebuilds its frontend bundle on reload. When `node_modules` there is a
 * symlink — the worktrees' shared-deps shortcut (`ln -s <main>/node_modules node_modules`)
 * run from inside the main checkout — every import fails to resolve and the
 * bundle rebuild dies with hundreds of "Could not resolve" errors, which bb
 * shows as a silently missing board.
 *
 * Invariant: at the repo root, `node_modules` must be a real directory or be
 * absent (fresh checkout / CI). Never a symlink.
 */
describe("node_modules environment guard", () => {
  it("repo-root node_modules is never a symlink (bundle-loss regression)", () => {
    const nodeModules = path.resolve(__dirname, "..", "node_modules");
    if (!existsSync(nodeModules)) {
      return; // absent is fine: fresh checkout, CI, or an isolated worktree
    }
    const st = lstatSync(nodeModules);
    expect(
      st.isSymbolicLink(),
      `node_modules is a symlink to ${
        st.isSymbolicLink() ? readlinkSync(nodeModules) : ""
      }. Delete it and run npm ci before building, or the frontend bundle loses all imports (see AGENTS.md worktree rules).`,
    ).toBe(false);
  });
});