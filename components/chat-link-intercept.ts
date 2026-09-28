// Relative-link rescue for embedded ThreadChat surfaces.
//
// The host's `ThreadChat` renders markdown links with their raw destination,
// so a message like `[ERD](docs/erd.mmd)` produces
// `<a href="docs/erd.mmd">`. The browser then resolves that against the bb
// app's origin and the user lands on an error page. The host's own thread
// view owns message link routing; a plugin-embedded chat does not, so this
// module classifies anchor hrefs and reduces them to workspace-root-relative
// paths that `navigate.experimental_openFilePreview` can open against the
// thread's environment.

/**
 * True when the href is absolute (scheme-qualified or protocol-relative) and
 * the browser should own it. Fragment-only hrefs (`#...`) are in-document and
 * also left alone.
 */
export function isExternalHref(href: string): boolean {
	if (href.startsWith("#")) return false;
	if (href.startsWith("//")) return true;
	// A valid scheme is letter followed by letters/digits/+/-/. then a colon.
	return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
}

/**
 * Reduce a relative href to a workspace-root-relative path. Markdown authors
 * write repo-relative paths (and sometimes `./` or `../` forms), so every
 * relative href is treated as anchored at the workspace root; `..` segments
 * climb within the root and a climb past it yields null (traversal is not a
 * workspace path). Returns null for empty results, queries, and fragments.
 *
 * Only file-looking destinations qualify: the final segment must contain a
 * dot (or start with one), matching how the host's own markdown local-file
 * routing identifies files. This keeps in-app route anchors such as thread
 * mention chips (`/threads/thr_...`) and extensionless routes on native
 * routing instead of hijacking them as nonexistent workspace files.
 */
export function workspacePathFromHref(href: string): string | null {
	// Drop any query/fragment; workspace paths have neither.
	const withoutQuery = href.split(/[?#]/, 1)[0];
	if (withoutQuery === "") return null;
	// The host also accepts line/column suffixes like `:12`, `:12-20`, and
	// `:12:5`; strip them the same way so `docs/x.mmd:12` still resolves.
	const raw = withoutQuery.replace(/:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/u, "");
	const segments: string[] = [];
	for (const part of raw.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(part);
	}
	if (segments.length === 0) return null;
	const basename = segments[segments.length - 1] ?? "";
	if (!(basename.startsWith(".") || basename.includes("."))) return null;
	return segments.join("/");
}
