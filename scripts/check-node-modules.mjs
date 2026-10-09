/**
 * Preflight guard: repo-root node_modules must never be a symlink.
 *
 * Regression background: bb serves this plugin from the main checkout and
 * rebuilds the frontend bundle on reload. When node_modules there became a
 * symlink (the worktrees' shared-deps shortcut run with cwd set to the main
 * checkout), every import failed to resolve and the board silently vanished.
 *
 * Wired as the `pretest` script and the first step of `npm run build`, so any
 * build or test run in a corrupted checkout fails loudly with the repair.
 * Exits 0 when healthy (including a fresh checkout with no node_modules).
 */
import { lstatSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} root absolute path of the checkout root
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function inspectNodeModules(root) {
  const nodeModules = path.join(root, "node_modules");
  let st;
  try {
    st = lstatSync(nodeModules);
  } catch {
    return { ok: true }; // absent: fresh checkout, CI, or isolated worktree
  }
  if (!st.isSymbolicLink()) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      `node_modules is a symlink to ${JSON.stringify(readlinkSync(nodeModules))} ` +
      `(lstat ${JSON.stringify(nodeModules)}). A node_modules symlink breaks the ` +
      `frontend bundle: every dependency import fails to resolve and the plugin ` +
      `board silently disappears from bb. Repair with: rm node_modules && npm ci. ` +
      `Never create node_modules symlinks in this repo (see AGENTS.md, ` +
      `"node_modules — never a symlink in any checkout").`,
  };
}

function main() {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const verdict = inspectNodeModules(root);
  if (!verdict.ok) {
    const lines = [
      "FAIL: node_modules guard",
      "",
      verdict.reason,
    ];
    for (const line of lines) process.stderr.write(`${line}\n`);
    process.exit(1);
  }
}

// Only run as CLI, not when imported by the unit tests.
if (
  typeof process.send !== "function" &&
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}