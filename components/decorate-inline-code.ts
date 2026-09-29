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
// onto the rendered DOM instead: it classifies `<code>` elements, checks
// the candidate path against the thread's live workspace, and marks only
// VERIFIED files (underline, pointer cursor, trailing external-link
// icon) with the resolved workspace path; the pane's click-capture
// handler claims clicks on those. Files that do not exist — a bare
// `.md`, a path the model only planned — stay plain instead of inviting
// a dead preview. The decoration appends INSIDE the code element, so if
// React re-renders and drops it, a re-scan simply repaints — the host's
// third-party file-tree plugin uses the same append-inside technique
// for its reveal buttons.
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

const PATH_FLAG_ICON_ATTR = "data-focus-board-path-link-icon";

/** U+2060 WORD JOINER: forbids line breaks around the icon it glues. */
const WORD_JOINER = "\u2060";

/** Attach the path flag, link styling, and trailing icon to one code element.
 * The icon glues to the code text with word joiners on both sides: an atomic
 * inline after the path text is a legal break position, so on a narrow pane
 * the glyph could wrap onto its own line (and pull the following `)` apart
 * with it). A U+2060 joiner before and after the icon forbids those breaks,
 * so the glyph always moves together with the code's last fragment. */
export function decorateCode(code: Element, path: string): void {
	code.setAttribute(PATH_FLAG, path);
	code.classList.add("cursor-pointer", "underline", "underline-offset-2");
	if (code.querySelector(`[${PATH_FLAG_ICON_ATTR}]`) !== null) return;
	const doc = code.ownerDocument;
	if (doc === null) return;
	const icon = doc.createElement("span");
	icon.setAttribute(PATH_FLAG_ICON_ATTR, "");
	icon.setAttribute("aria-hidden", "true");
	icon.className = "ml-1 inline size-3 align-[-0.125em] text-muted-foreground";
	icon.innerHTML = EXTERNAL_LINK_ICON;
	code.appendChild(doc.createTextNode(WORD_JOINER));
	code.appendChild(icon);
	code.appendChild(doc.createTextNode(WORD_JOINER));
}

export interface InlineCodeCandidate {
	code: Element;
	path: string;
}

/**
 * Scan every inline (non-block) code element under `root` and return the
 * ones whose text resolves to a workspace markdown file, decorated or
 * not. Verdict bookkeeping is the caller's (see
 * `decorateVerifiedInlineCodeLinks`), so this stays a pure classifier.
 */
export function collectInlineCodeCandidates(
	root: ParentNode,
): InlineCodeCandidate[] {
	const candidates: InlineCodeCandidate[] = [];
	for (const code of Array.from(root.querySelectorAll("code"))) {
		if (code.hasAttribute(PATH_FLAG)) continue;
		// Block code renders inside <pre>; the host only ever linkifies
		// inline code, so block spans stay plain.
		if (code.closest("pre") !== null) continue;
		const text = code.textContent ?? "";
		const path = inlineCodeMarkdownPath(text);
		if (path === null) continue;
		candidates.push({ code, path });
	}
	return candidates;
}

/**
 * Resolve a batch of workspace paths to existence for one environment.
 * The map holds a boolean per requested path; a rejection means the
 * check itself failed (network, server error) and no verdict was
 * reached for any path in the batch.
 */
export type PathExistenceChecker = (
	paths: string[],
) => Promise<Map<string, boolean>>;

/** Verdict cache: true/false after a successful check, a failure
 * timestamp while a failed batch cools down before it is retried. */
type Verdict = boolean | number;

const VERDICT_CACHE_CAP = 5000;
const VERDICT_SEP = "\u0000";
const FAILURE_RETRY_MS = 30_000;
const verdicts = new Map<string, Verdict>();

function verdictKey(environmentId: string, path: string): string {
	return `${environmentId}${VERDICT_SEP}${path}`;
}

/** Known verdict, or undefined when unknown. A failed check reads as
 * false while it cools down (no re-request), then expires to unknown. */
function lookupVerdict(environmentId: string, path: string): boolean | undefined {
	const key = verdictKey(environmentId, path);
	const verdict = verdicts.get(key);
	if (verdict === undefined) return undefined;
	if (typeof verdict === "number") {
		if (Date.now() - verdict < FAILURE_RETRY_MS) return false;
		verdicts.delete(key);
		return undefined;
	}
	return verdict;
}

/**
 * Decorate the inline code under `root` whose path exists in the
 * thread's workspace. Idempotent: decorated elements are skipped, and
 * per-environment verdicts are cached so repeat scans (initial mount
 * plus every DOM mutation) issue no further checks for settled paths.
 * A failed checker run is not cached as `false`: its paths read as
 * missing while they cool down (so a downed server is not hammered
 * every frame) and are re-checked after the cooldown expires.
 */
export async function decorateVerifiedInlineCodeLinks(
	root: ParentNode,
	environmentId: string,
	exists: PathExistenceChecker,
): Promise<void> {
	const candidates = collectInlineCodeCandidates(root);
	if (candidates.length === 0) return;
	const wanted = new Map<string, Element[]>();
	for (const { code, path } of candidates) {
		const verdict = lookupVerdict(environmentId, path);
		if (verdict === true) decorateCode(code, path);
		else if (verdict === undefined) {
			const codes = wanted.get(path);
			if (codes === undefined) wanted.set(path, [code]);
			else codes.push(code);
		}
		// verdict === false: verified missing, stays plain.
	}
	if (wanted.size === 0) return;
	const paths = Array.from(wanted.keys());
	const results = await checkPaths(paths, environmentId, exists);
	for (const [path, verified] of results) {
		if (!verified) continue;
		for (const code of wanted.get(path) ?? []) {
			// The await let React replace these nodes; decorating a detached
			// element is invisible, so only paint elements still in the tree.
			if (!code.isConnected) continue;
			decorateCode(code, path);
		}
	}
}

async function checkPaths(
	paths: string[],
	environmentId: string,
	exists: PathExistenceChecker,
): Promise<Map<string, boolean>> {
	let map: Map<string, boolean> | null = null;
	try {
		map = await exists(paths);
	} catch {
		// No verdicts reached; cache a failure timestamp so the scan loop
		// does not hammer the server on every frame while it is down.
		for (const path of paths) {
			verdicts.set(verdictKey(environmentId, path), Date.now());
		}
		return new Map();
	}
	const results = new Map<string, boolean>();
	for (const path of paths) {
		const verdict = map.get(path) === true;
		results.set(path, verdict);
		verdicts.set(verdictKey(environmentId, path), verdict);
	}
	if (verdicts.size > VERDICT_CACHE_CAP) verdicts.clear();
	return results;
}