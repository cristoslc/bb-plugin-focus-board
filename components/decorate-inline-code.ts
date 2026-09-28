// DOM decoration for inline code that names a workspace markdown file.
//
// The host's own thread view renders such code spans as anchors (its
// markdown preview linkifies inline code whose text resolves to a local
// `.md`/`.markdown` file). The embedded `ThreadChat` in this pane never
// receives local-file link routing — the host wires that through the
// app-panel context, gated on the panel's environment matching the
// thread's, and a board pane spans many environments — so the same spans
// render as plain `<code>` here.
//
// We cannot re-render the host's markdown, so this module paints parity
// onto the rendered DOM instead: it marks qualifying `<code>` elements
// (underline, pointer cursor, trailing external-link icon) with the
// resolved workspace path, and the pane's click-capture handler claims
// clicks on them. The decoration appends INSIDE the code element, so if
// React re-renders and drops it, a re-scan simply repaints — the host's
// third-party file-tree plugin uses the same append-inside technique for
// its reveal buttons.
import { inlineCodeMarkdownPath } from "@/components/chat-link-intercept";

/** Marks a decorated code element; the attribute value is the workspace path. */
const PATH_FLAG = "data-focus-board-path-link";

const EXTERNAL_LINK_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

/** Workspace path stored on a decorated code element, or null. */
export function decoratedCodePath(code: Element): string | null {
	if (!code.hasAttribute(PATH_FLAG)) return null;
	const path = code.getAttribute(PATH_FLAG);
	return path === null || path === "" ? null : path;
}

/**
 * Scan every inline (non-block) code element under `root` and decorate the
 * ones whose text resolves to a workspace markdown file. Idempotent: already
 * decorated elements are skipped via the flag attribute, so repeated calls
 * (initial mount plus every DOM mutation) are cheap no-ops.
 */
export function decorateInlineCodeLinks(root: ParentNode): void {
	for (const code of Array.from(root.querySelectorAll("code"))) {
		if (code.hasAttribute(PATH_FLAG)) continue;
		// Block code renders inside <pre>; the host only ever linkifies
		// inline code, so block spans stay plain.
		if (code.closest("pre") !== null) continue;
		const text = code.textContent ?? "";
		const path = inlineCodeMarkdownPath(text);
		if (path === null) continue;
		code.setAttribute(PATH_FLAG, path);
		code.classList.add("cursor-pointer", "underline", "underline-offset-2");
		const doc = root.nodeType === 9 ? (root as Document) : root.ownerDocument;
		if (doc === null) return;
		const icon = doc.createElement("span");
		icon.setAttribute("data-focus-board-path-link-icon", "");
		icon.setAttribute("aria-hidden", "true");
		icon.className = "ml-1 inline size-3 align-[-0.125em] text-muted-foreground";
		icon.innerHTML = EXTERNAL_LINK_ICON;
		code.appendChild(icon);
	}
}