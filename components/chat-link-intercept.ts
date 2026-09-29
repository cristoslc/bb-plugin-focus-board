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

/**
 * The host's own thread view linkifies inline code that names a workspace
 * markdown file: the rendered `code` element's text is re-parsed as a local
 * file link and turned into an anchor. That behavior lives in the host's
 * markdown preview, but it only runs when the host supplies local-file link
 * routing — which the embedded `ThreadChat` in this pane never receives
 * (routing is wired through the app-panel context and gated on the panel's
 * environment matching the thread's; a board pane lists many environments).
 *
 * This function mirrors the host's gate so the pane can claim the same
 * clicks and paint the same affordance. A code span qualifies when it is a
 * single trimmed token (no surrounding whitespace, no newlines), survives
 * the same suffix/segment reduction as an href (`:12`, `:12-20`, `#L12-L20`,
 * `./`, `../`), and names a `.md`/`.markdown` file — the host only ever
 * autolinks markdown files from inline code, never other extensions, never
 * commit hashes, never `~`-home paths.
 */
export function inlineCodeMarkdownPath(text: string): string | null {
	// Decoration glue: decorateCode joins its trailing icon with word
	// joiners inside the code element. If a host re-render strips the
	// decoration but leaves the joiners, this gate must still recognize
	// the span so the repaint scan can re-decorate it. A real host path
	// never contains U+2060.
	const joined = text.replace(/\u2060/gu, "");
	if (joined === "" || joined.trim() !== joined) return null;
	if (joined.includes("\n") || joined.includes("\r")) return null;
	// Defensive cap so a pathological giant code span can never drive the
	// decorator's scans; the host has no bound but real paths stay short.
	if (joined.length > 512) return null;
	// Scheme-qualified and protocol-relative urls are not workspace paths,
	// even when they end in `.md`.
	if (isExternalHref(joined)) return null;
	// Home-relative paths (`~/.agents/AGENTS.md`) cannot resolve inside the
	// workspace root, and the host's relative-link parser rejects them too.
	if (/^~(?:[^/]*\/|$)/u.test(joined)) return null;
	const path = workspacePathFromHref(joined);
	if (path === null) return null;
	return /\.(?:md|markdown)$/iu.test(path) ? path : null;
}
