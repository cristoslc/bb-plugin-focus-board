// Workspace path containment for the pane's existence-check RPC.
//
// The frontend sends workspace-relative paths classified from message
// markdown. Those are untrusted input at the server boundary, so every
// path is re-resolved against the environment's workspace root here and
// anything that escapes the root (absolute, `~`, `..` escapes) is
// rejected rather than stat-ed.
import { isAbsolute, resolve, sep } from "node:path";

/**
 * Resolve a workspace-relative path against `root` and return the
 * absolute path, or null when the input escapes the root: absolute
 * paths, home-relative (`~`), and `..` segments that climb out of the
 * workspace are all rejected. Paths that stay inside the root (including
 * `./` and inner `..` hops) resolve normally.
 */
export function resolveWithinRoot(
	root: string,
	relativePath: string,
): string | null {
	if (relativePath === "" || isAbsolute(relativePath)) return null;
	// A `~` anywhere in the path is rejected, not just a leading one: the
	// host linkifier only ever rejects a leading `~`, but shell expansion
	// ambiguity is reason enough to refuse these at the server boundary.
	if (relativePath.split("/").some((segment) => segment.startsWith("~"))) {
		return null;
	}
	const absolute = resolve(root, relativePath);
	if (absolute !== root && !absolute.startsWith(root + sep)) return null;
	return absolute;
}
