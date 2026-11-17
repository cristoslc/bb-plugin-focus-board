// Link destinations that name a workspace entry, classified without trusting
// the frontend.
//
// bb renders a message's file and directory references as `file://` anchors
// (an inline code path that exists, a mention token, a pasted absolute path).
// Its own preview cannot show a directory, so the pane classifies the
// destination first: a workspace file keeps BB's preview, a directory opens
// in the operator's preferred editor, and anything outside the workspace
// stays inert. These helpers are the pure half; the server RPC wires them to
// the host daemon and refuses untrusted escapes exactly like the
// existence-check RPC does.
import { isAbsolute, resolve, sep } from "node:path";

/** The absolute filesystem path a `file:` href names, or null when the href
 *  is not a well-formed local file URL (wrong scheme, a UNC-style host, a
 *  malformed escape). Only `file:///…` and `file://localhost/…` qualify. */
export function fileHrefPath(href: string): string | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	if (url.protocol !== "file:") return null;
	if (url.hostname !== "" && url.hostname !== "localhost") return null;
	let decoded: string;
	try {
		decoded = decodeURIComponent(url.pathname);
	} catch {
		return null;
	}
	return decoded === "" ? null : decoded;
}

/** The workspace-relative form of an absolute path that sits inside `root`,
 *  or null when it sits outside (a trailing separator on `root` is
 *  tolerated). The result is a `/`-joined relative path, which
 *  `resolveWithinRoot` re-validates at the boundary. */
export function workspaceRelativeFromAbsolute(
	root: string,
	absolutePath: string,
): string | null {
	if (!isAbsolute(absolutePath)) return null;
	const resolvedRoot = resolve(root);
	const resolvedPath = resolve(absolutePath);
	if (resolvedPath === resolvedRoot) return "";
	if (!resolvedPath.startsWith(resolvedRoot + sep)) return null;
	return resolvedPath
		.slice(resolvedRoot.length + 1)
		.split(sep)
		.join("/");
}

/** The entry kind a host directory listing reports for `name`, or null when
 *  the listing does not carry it (the entry is missing or unreadable). */
export function listedEntryKind(
	entries: readonly { name: string; kind: string }[],
	name: string,
): "file" | "directory" | null {
	const entry = entries.find((candidate) => candidate.name === name);
	if (entry === undefined) return null;
	if (entry.kind === "file") return "file";
	if (entry.kind === "directory") return "directory";
	return null;
}
