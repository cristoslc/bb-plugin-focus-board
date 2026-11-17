// DOM decoration for reference tokens written by agents into chat messages.
//
// A composer-sent prompt carries structured mention resources, so the host
// renders pills for it everywhere — but tokens the agent writes ("support
// @project:proj_7yr4yefs4k calls", "packaging thread: @thread:thr_x is now
// active") are plain markdown text. The host's shared markdown renderer
// autolinks only raw `@thread:` tokens, and paints a chip for one only when
// the message carries mention metadata; without it the rendered
// `bb-thread-mention` element stays an EMPTY inline custom element and the
// token vanishes from view altogether. Raw `@project:` tokens are not
// autolinked anywhere: in bb's main thread view and in this pane they stay
// dead text (issue #161).
//
// Like decorate-inline-code, this module paints parity onto the rendered
// DOM of the pane's embedded ThreadChat, because the pane cannot re-render
// the host's markdown:
//
// - A serialized token — the full `@thread:thr_…` / `@project:proj_…` form
//   or the bare id form agents abbreviate to (`@thr_…` / `@proj_…`), with an
//   optional `#msg=N` fragment swallowed — becomes a button carrying the
//   target's display label (the raw id when the caller's labeler does not
//   know it yet).
// - The host's OWN empty `bb-thread-mention` elements (the renderer-less
//   autolink shape) are repainted the same way from their thread-id
//   attribute. A mention whose renderer IS wired — a chip the host already
//   filled — is left untouched.
//
// The chips carry no navigation themselves: they are marked with
// `data-focus-board-ref-*` attributes the pane's click-capture handler
// reads (`decoratedReferencePaneTarget`) and routes — opening the thread in
// the pane, or in bb's main thread view / project page for targets the
// board does not list. Paint-and-refresh is idempotent, so the pane's
// existing MutationObserver scan can call this on every frame without
// duplicating chips; a label resolved after a chip was painted fills in on
// the next scan. Labels only ever land as text nodes — a title coming from
// an agent- or operator-named thread can never parse as markup.
/** The kind of target a reference token names: a bb thread or a bb project. */
export type ReferenceKind = "thread" | "project";

/** The target a painted chip (or token) points at. */
export interface PaneReferenceTarget {
	kind: ReferenceKind;
	id: string;
	/** The swallowed `#msg=N` fragment; null when the token had none. */
	messageSeq: number | null;
}

/** Read-only label lookup the caller wires from its current thread and
 *  project rows. A null verdict paints the chip with the raw id and fills
 *  in on a later scan once the rows know the target. */
export interface ReferenceLabeler {
	threadLabel(threadId: string): string | null;
	projectLabel(projectId: string): string | null;
}

/** What a surface hands the decorator: the labeler plus the route a claimed
 *  chip click takes. Absent = no decoration at all (the surface stays as
 *  the host rendered it). */
export interface ReferenceMentions {
	labels: ReferenceLabeler;
	onOpen(reference: PaneReferenceTarget): void;
}

/** Marks a painted chip; the value names the target kind. `bb-thread-mention`
 *  elements repainted from the empty-host shape carry it too. */
export const REFERENCE_KIND_FLAG = "data-focus-board-ref-kind";

/** The chip's resolved target id (the thread or project id). */
export const REFERENCE_ID_FLAG = "data-focus-board-ref-id";

/** The swallowed `#msg=N` fragment of a thread token, when it had one. */
export const REFERENCE_SEQ_FLAG = "data-focus-board-ref-seq";

/** The label text currently painted on the chip; the refresh pass compares
 *  against it so a label that already resolved is never rewritten. */
export const REFERENCE_PAINTED_LABEL_FLAG = "data-focus-board-ref-painted-label";

/** Marks the chip's label span inside the chip element. */
const REFERENCE_LABEL_SPAN_FLAG = "data-focus-board-ref-label-span";

/** The serialized token shapes the agent writes: the full `@thread:thr_…` /
 *  `@project:proj_…` forms and the bare id forms (`@thr_…` / `@proj_…`) it
 *  abbreviates to, dispatched by the id prefix. The `#msg=N` fragment is
 *  only meaningful for thread tokens; it is swallowed for either kind so a
 *  converted token never leaves one dangling. The full form stands first in
 *  the alternation so a fully-written token never converts as its id half. */
const TOKEN = /@(thread|project):([A-Za-z0-9_-]+)(?:#msg=(0|[1-9]\d*))?|@(thr|proj)_([A-Za-z0-9_-]+)(?:#msg=(0|[1-9]\d*))?/gu;

const THREAD_ID_PREFIX = "thr_";
const PROJECT_ID_PREFIX = "proj_";

/** The chip's accessible name and the pane's tooltip are one spelling. The
 *  full string is load bearing: tests/manual/uat-pane-reference-chips.yaml
 *  clicks each chip by this exact aria-label, so a prefix rewording (or a
 *  glued CamelCase form the screen reader will not split) must not drift —
 *  a wording change updates that suite's click_aria entries in the same
 *  commit. */
function chipAriaLabel(target: PaneReferenceTarget, label: string): string {
	return `${target.kind === "thread" ? "Open thread" : "Open project"} ${label}`;
}

/** The thread chip icon: a 12px speech bubble sized to the host's composer
 *  pills. scripts/security-gates.mjs allows an innerHTML sink only through
 *  one all-caps _ICON constant on the right side — keep the SVG wholly
 *  inside this constant, assign it at its sink sites in one statement
 *  each, and register a new kind's icon the same way with the approving
 *  review named in the gate. */
const THREAD_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

/** The project chip icon: a 12px folder, same gates rule as THREAD_ICON. */
const PROJECT_ICON =
	'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>';

/** The swallowed `#msg=N` fragment's number, or null: absent, empty (the
 *  DOM attribute spelling of "none"), or not an integer all read as none. */
function parseMessageSeq(raw: string | null): number | null {
	if (raw === null || raw === "") return null;
	const parsed = Number(raw);
	return Number.isInteger(parsed) ? parsed : null;
}

/** A token's parsed target, or null when the serialized form is malformed
 *  (a mismatched kind/id prefix stays literal text — fail-safe over
 *  converting something the agent never meant). Dispatches on the match's
 *  shape: a full-form match carries the kind word in group 1, a bare-form
 *  match carries the id prefix in group 4. */
function targetFromMatch(match: RegExpExecArray): PaneReferenceTarget | null {
	if (match[2] !== undefined) {
		return targetFromToken(match[1]!, match[2]!, match[3]);
	}
	return targetFromToken(match[4] === "thr" ? "thread" : "project", `${match[4]}_${match[5]}`, match[6]);
}

/** A full-form token's parsed target, or null on a kind/id mismatch. */
function targetFromToken(kind: string, id: string, seq: string | undefined): PaneReferenceTarget | null {
	const expectedPrefix = kind === "thread" ? THREAD_ID_PREFIX : PROJECT_ID_PREFIX;
	if (!id.startsWith(expectedPrefix)) return null;
	return {
		kind: kind === "thread" ? "thread" : "project",
		id,
		messageSeq: parseMessageSeq(seq ?? null),
	};
}

/** The first serialized reference token in `text`, or null when none parses.
 *  Reads the same grammar as the decorator, for destinations that carry the
 *  token instead of a rendered chip: bb links an agent-written `@thread:…`
 *  into a percent-encoded `file://` href under the thread's workspace root,
 *  and the pane's click capture parses that decoded destination here before
 *  the host's file-preview fallback can claim it (the "File not found."
 *  regression, 2026-11-17). Malformed tokens — an id under the wrong prefix —
 *  return null so the caller can keep the click inert rather than routing
 *  it anywhere. */
export function mentionReferenceInText(text: string): PaneReferenceTarget | null {
	const probe = new RegExp(TOKEN.source, "u");
	const match = probe.exec(text);
	return match === null ? null : targetFromMatch(match);
}

/** The loosest mention shape: a thread or project token's opening, whatever
 *  its id parses to. A destination matching this must never fall through to
 *  a file preview even when `mentionReferenceInText` refuses it; the click
 *  ends inert instead. `#msg=N` is swallowed like the decorator swallows it. */
const MENTION_SHAPE =
	/@(?:thread|project):[A-Za-z0-9_-]*(?:#msg=\d+)?|@(?:thr|proj)_[A-Za-z0-9_-]*(?:#msg=\d+)?/u;

/** True when `text` carries a mention token shape, parseable or not. */
export function mentionShaped(text: string): boolean {
	return MENTION_SHAPE.test(text);
}

/** The chip a click landed on (or is part of), read back as its target —
 *  what the pane's click-capture handler routes. */
export function decoratedReferencePaneTarget(
	element: Element | null,
): PaneReferenceTarget | null {
	if (element === null) return null;
	const chip = element.closest(`[${REFERENCE_KIND_FLAG}]`);
	if (chip === null) return null;
	const kind = chip.getAttribute(REFERENCE_KIND_FLAG);
	const id = chip.getAttribute(REFERENCE_ID_FLAG);
	if (id === null || id === "" || (kind !== "thread" && kind !== "project")) {
		return null;
	}
	const seqRaw = chip.getAttribute(REFERENCE_SEQ_FLAG);
	return {
		kind,
		id,
		messageSeq: parseMessageSeq(seqRaw),
	};
}

/** The chip's display label: the caller's resolved name, or the raw id when
 *  it does not know the target (yet — the refresh pass fills it in). */
function labelFor(labels: ReferenceLabeler, target: PaneReferenceTarget): string {
	const resolved =
		target.kind === "thread"
			? labels.threadLabel(target.id)
			: labels.projectLabel(target.id);
	return resolved ?? target.id;
}

/** Subtrees the decorator never touches: the host's own links and filled
 *  chips own their content, code blocks quote references as literal
 *  examples, and our own chips are the idempotence mark. */
function claimedByOtherSurface(node: Node): boolean {
	return (
		node.parentElement?.closest(
			"a[href], pre, bb-thread-mention, [data-focus-board-ref-kind]",
		) !== null
	);
}

function createChip(
	doc: Document,
	target: PaneReferenceTarget,
	label: string,
): HTMLButtonElement {
	const chip = doc.createElement("button");
	chip.type = "button";
	chip.setAttribute(REFERENCE_KIND_FLAG, target.kind);
	chip.setAttribute(REFERENCE_ID_FLAG, target.id);
	if (target.messageSeq !== null) {
		chip.setAttribute(REFERENCE_SEQ_FLAG, String(target.messageSeq));
	}
	// The host's composer pills read the same way: a small muted rounded
	// pill, icon plus truncated label.
	chip.className =
		"inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-md bg-muted/70 px-1 py-0.5 text-xs font-normal text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
	chip.title = target.kind === "thread" ? "Open thread" : "Open project";
	chip.setAttribute("aria-label", chipAriaLabel(target, label));
	const icon = doc.createElement("span");
	icon.className = "shrink-0";
	icon.setAttribute("aria-hidden", "true");
	// One all-caps constant per assignment (see scripts/security-gates.mjs's
	// icon-sink allowlist): the two kinds share no mutable icon string.
	if (target.kind === "thread") {
		icon.innerHTML = THREAD_ICON;
	} else {
		icon.innerHTML = PROJECT_ICON;
	}
	const labelSpan = doc.createElement("span");
	labelSpan.className = "min-w-0 truncate";
	labelSpan.setAttribute(REFERENCE_LABEL_SPAN_FLAG, "");
	labelSpan.textContent = label;
	chip.setAttribute(REFERENCE_PAINTED_LABEL_FLAG, label);
	chip.appendChild(icon);
	chip.appendChild(labelSpan);
	return chip;
}

/**
 * Paint the reference chips under `root` and refresh already-painted
 * labels. Idempotent: converted tokens are chips (skipped tokens), and a
 * chip whose label has not changed is never rewritten, so the pane's
 * per-mutation scan can call this on every frame. `labels` comes from the
 * board's current thread and project rows; an unknown target paints the raw
 * id and fills in when the rows catch up.
 */
export function decorateReferenceMentions(
	root: ParentNode,
	labels: ReferenceLabeler,
): void {
	// The tokenizer compiles once per call: TOKEN declares the pattern
	// source, but its `g` state is per-call (probe and splitter are two
	// state styles over the same source).
	const tokenProbe = new RegExp(TOKEN.source, "u");
	const tokenSplitter = () => new RegExp(TOKEN.source, "gu");
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const nodes: Text[] = [];
	let node: Node | null;
	while ((node = walker.nextNode()) !== null) {
		if (claimedByOtherSurface(node)) continue;
		if (!tokenProbe.test(node.nodeValue ?? "")) continue;
		nodes.push(node as Text);
	}
	for (const text of nodes) {
		const parent = text.parentElement;
		if (parent === null) continue;
		const doc = text.ownerDocument;
		if (doc === null) continue;
		const fragment = doc.createDocumentFragment();
		const token = tokenSplitter();
		let last = 0;
		let match: RegExpExecArray | null;
		while ((match = token.exec(text.data)) !== null) {
			const target = targetFromMatch(match);
			if (target === null) continue;
			if (match.index > last) {
				fragment.appendChild(doc.createTextNode(text.data.slice(last, match.index)));
			}
			fragment.appendChild(createChip(doc, target, labelFor(labels, target)));
			last = match.index + match[0].length;
		}
		if (last === 0) continue; // only malformed tokens: leave the node alone
		if (last < text.data.length) {
			fragment.appendChild(doc.createTextNode(text.data.slice(last)));
		}
		text.replaceWith(fragment);
	}

	// The host's renderer-less autolink shape: an empty element that swallows
	// the token from view. Repaint content inside it and mark it with the
	// same attributes the click handler routes (the click handler claims the
	// element itself; the accessor reads the attributes by name, so the
	// unknown custom element works exactly like a painted button).
	for (const host of Array.from(root.querySelectorAll<HTMLElement>("bb-thread-mention"))) {
		if ((host.textContent ?? "") !== "") continue; // the host filled it in
		const id = genericAttributeValue(host, "datathreadid");
		if (id === null || !id.startsWith(THREAD_ID_PREFIX)) continue;
		const seqRaw = genericAttributeValue(host, "datamessageseq");
		const doc = host.ownerDocument;
		if (doc === null) continue;
		const target: PaneReferenceTarget = {
			kind: "thread",
			id,
			messageSeq: parseMessageSeq(seqRaw),
		};
		host.setAttribute(REFERENCE_KIND_FLAG, "thread");
		host.setAttribute(REFERENCE_ID_FLAG, id);
		if (target.messageSeq !== null) {
			host.setAttribute(REFERENCE_SEQ_FLAG, String(target.messageSeq));
		}
		host.title = "Open thread";
		const label = labelFor(labels, target);
		host.setAttribute("aria-label", chipAriaLabel(target, label));
		// The repainted element must match the painted button's reach: focus
		// goes to it with Tab and Enter/Space drive the pane's keyboard
		// capture (thread-pane.tsx's keydown handler claims chips by role).
		host.tabIndex = 0;
		host.setAttribute("role", "button");
		host.style.display = "inline-flex";
		host.setAttribute(REFERENCE_PAINTED_LABEL_FLAG, label);
		const icon = doc.createElement("span");
		icon.className = "shrink-0";
		icon.setAttribute("aria-hidden", "true");
		icon.innerHTML = THREAD_ICON;
		const labelSpan = doc.createElement("span");
		labelSpan.setAttribute(REFERENCE_LABEL_SPAN_FLAG, "");
		labelSpan.textContent = label;
		host.replaceChildren(icon, labelSpan);
	}

	// Refresh pass: a chip painted with a fallback label fills in once the
	// caller's rows resolve the target. Only a real change rewrites the span,
	// so the repaint loop settles instead of mutating every frame.
	for (const chip of Array.from(
		root.querySelectorAll<HTMLElement>(`[${REFERENCE_KIND_FLAG}]`),
	)) {
		const target = decoratedReferencePaneTarget(chip);
		if (target === null) continue;
		const label = labelFor(labels, target);
		if (chip.getAttribute(REFERENCE_PAINTED_LABEL_FLAG) === label) continue;
		const span = chip.querySelector(`[${REFERENCE_LABEL_SPAN_FLAG}]`);
		if (span === null) continue;
		span.textContent = label;
		chip.setAttribute(REFERENCE_PAINTED_LABEL_FLAG, label);
	}
}

/** The host emits the mention element's data attributes through different
 *  renderers; the DOM spelling varies (hyphenated, camel, or all-lowercase).
 *  Match by name shape, not one exact spelling. */
function genericAttributeValue(element: Element, wanted: string): string | null {
	for (const attribute of Array.from(element.attributes)) {
		if (attribute.name.toLowerCase().replace(/-/gu, "") === wanted) {
			return attribute.value;
		}
	}
	return null;
}