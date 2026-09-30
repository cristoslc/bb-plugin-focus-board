/**
 * Content-script glue for host-rendered link icons inside this plugin's
 * panel. The host's thread view appends an ExternalLink svg inside the
 * trailing anchor of linkified text (`svg[data-icon="ExternalLink"]`).
 * That icon is an atomic inline, so the boundary before it is a legal
 * line-break position and the glyph drops to its own line at wrap widths
 * (measured: ~8-9 of 221 swept widths per path length; filed upstream).
 *
 * Chromium ignores U+2060 at that boundary, so word joiners are not an
 * option. The working structure (proven by this plugin's pane decoration,
 * `decorate-inline-code.ts`) fuses the icon with the text's final
 * character inside one `white-space: nowrap` unit.
 *
 * Scope is deliberately narrow: only host icons inside this plugin's own
 * panel container (`[data-focus-board-panel]`), never anchors another
 * plugin decorated (they inject `<button>` markers), never code spans the
 * pane's own decoration already glued, and never a second pass over the
 * same anchor (idempotent marker attribute).
 */
/** Marks the nowrap glue unit this module creates. */
export const HOST_GLUE_ATTR = "data-focus-board-host-glue";

/** The content script sweeps only inside containers carrying this attr. */
export const HOST_PANEL_ATTR = "data-focus-board-panel";

const HOST_ICON_SELECTOR = 'svg[data-icon="ExternalLink"][data-icon-root]';

interface TerminalText {
	node: Text;
	/** Chars at the node's tail that move into the glue unit. */
	charCount: number;
}

/**
 * The anchor's last visible (non-whitespace-only) text node, excluding
 * anything inside the icon itself, plus how much of its tail belongs in
 * the glue unit: the final character, or — when the tail is whitespace —
 * the trailing space run plus the last visible letter before it, so the
 * icon never sits in a unit of invisible space.
 */
function terminalText(anchor: Element, icon: Element): TerminalText | null {
	let lastVisible: Text | null = null;
	// 4 == Node.TEXT_NODE.
	const walker = anchor.ownerDocument.createTreeWalker(anchor, 4);
	let node: Node | null;
	while ((node = walker.nextNode()) !== null) {
		const text = (node as Text).data;
		if (icon.contains(node) || text.trim() === "") continue;
		lastVisible = node as Text;
	}
	if (lastVisible === null) return null;
	const text = lastVisible.data;
	const trailingWhitespace = /\s+$/.exec(text);
	if (trailingWhitespace === null) return { node: lastVisible, charCount: 1 };
	const count = trailingWhitespace[0].length;
	return {
		node: lastVisible,
		charCount: count < text.length ? count + 1 : text.length,
	};
}

/**
 * Fuse `icon` (a host-rendered ExternalLink svg inside a link) with the
 * link text's final character under nowrap. Returns whether anything
 * changed. No-ops on ungluable or out-of-scope anchors.
 */
export function glueHostLinkIcon(owner: Document, icon: Element): boolean {
	const anchor = icon.closest("a");
	if (anchor === null) return false;
	// Already fused (idempotent repaints, or an earlier glue survived a
	// React reconciliation).
	if (anchor.querySelector(`[${HOST_GLUE_ATTR}]`) !== null) return false;
	// The pane's own decoration glues its code spans; two fused units in
	// one anchor would fight. Only the plugin's decoration may glue there.
	if (anchor.querySelector("code[data-focus-board-path-link]") !== null) return false;
	// Another plugin decorated this anchor (a `<button>`, e.g.
	// file-tree's reveal button): leave it alone entirely.
	if (anchor.querySelector("button") !== null) return false;
	const terminal = terminalText(anchor, icon);
	if (terminal === null || terminal.charCount <= 0) return false;
	const text = terminal.node.data;
	const glue = owner.createElement("span");
	glue.setAttribute(HOST_GLUE_ATTR, "");
	glue.style.whiteSpace = "nowrap";
	if (terminal.charCount === text.length) {
		// The terminal node moves whole, so the glue takes its exact slot —
		// no split, no duplicated character, position preserved.
		terminal.node.parentElement!.insertBefore(glue, terminal.node);
		glue.appendChild(terminal.node);
	} else {
		terminal.node.data = text.slice(0, text.length - terminal.charCount);
		glue.appendChild(owner.createTextNode(text.slice(text.length - terminal.charCount)));
		// The glue takes the slot right after the trimmed node: its parent
		// carries the terminal styling (e.g. a `<code>` box), and for a
		// plain anchor this is exactly where the icon stood.
		terminal.node.parentElement!.insertBefore(glue, terminal.node.nextSibling);
	}
	// The icon moves last, after every position bookkeeping is done.
	glue.appendChild(icon);
	return true;
}

/** Glue every host icon found inside this plugin's panel containers. */
export function glueSweep(owner: Document): void {
	for (const panel of Array.from(owner.querySelectorAll(`[${HOST_PANEL_ATTR}]`))) {
		for (const icon of Array.from(panel.querySelectorAll(HOST_ICON_SELECTOR))) {
			glueHostLinkIcon(owner, icon);
		}
	}
}

/**
 * Mount-time installer for the plugin's content script: one immediate
 * sweep, then a rAF-coalesced observer over the app shell. Returns a
 * disposer (also wired to `context.signal`) that stops watching.
 */
export function installHostLinkGlue(context: { signal: AbortSignal }): () => void {
	const sweep = () => glueSweep(document);
	sweep();
	let raf = 0;
	const observer = new MutationObserver(() => {
		if (raf !== 0) return;
		raf = window.requestAnimationFrame(() => {
			raf = 0;
			sweep();
		});
	});
	observer.observe(document.body, { childList: true, subtree: true });
	const dispose = () => {
		observer.disconnect();
		if (raf !== 0) window.cancelAnimationFrame(raf);
	};
	context.signal.addEventListener("abort", dispose, { once: true });
	return dispose;
}