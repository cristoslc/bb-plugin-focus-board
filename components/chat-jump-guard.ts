// Defensive click guard for the host scroll-manager jump bug.
//
// Reported symptom: clicking in the chat transcript (near the bottom, above
// the composer) sometimes yanks it back to the newest message — "jumps up a
// half-page or so". Root cause, verified against the host bundle (see
// docs/chat-click-jump-2026-09-29.md): bb's page-shell `bottom-anchor`
// scroll manager behind `ThreadChat` keeps a pending scroll-anchor capture
// from the older-rows preload; its restore layout effect runs after every
// React commit, mixes a live-applied scrollTop with a stale captured
// scrollHeight, overshoots, and the clamp lands the reader at the bottom.
//
// `ThreadChat` is a host runtime component and the SDK exposes no way to
// inspect or clear that pending capture, so this module paints over the
// symptom from the plugin side: when a left click passes through the
// transcript body while the reader is meaningfully scrolled up, it
// snapshots the scroll position and, if the transcript ends up pinned at
// the bottom within the guard window, restores the snapshot.
//
// Deliberately NOT guarded (those scrolls on click are intended):
// - the host's "Scroll to latest event" pill;
// - anything inside the composer (sending legitimately re-pins the feed and
//   appends a message).
// The guard also disarms itself when a reader scroll *gesture* arrives
// (wheel, touch, scroll keys): reverting those would fight the reader
// rather than the bug.
//
// Scope note: the host bug can also fire without a click (any commit, e.g.
// a streaming message, while a stale capture is pending) — this guard only
// covers the click path that was reported. Delete this module once bb
// ships the page-shell fix.

/** The transcript scroller's marker class from bb's page shell. */
const SCROLLER_CLASS = "thread-scrollbar";

/** The host's "jump to the newest message" pill button. */
const SCROLL_PILL_SELECTOR = `[aria-label="Scroll to latest event"]`;

/** Composer containers; clicks here may legitimately re-pin the feed. */
const COMPOSER_SELECTOR = `[data-app-composer], [data-promptbox-shell]`;

/** The host manager treats anything within 4px of the bottom as pinned. */
const AT_BOTTOM_SLACK = 4;

/** Only protect a reader who has scrolled meaningfully up. A smaller
 * revert is indistinguishable from a legitimate re-pin (focusing an
 * inline editor can bring the caret into view), and the reported "half a
 * page" symptom is never that small. */
const MIN_PROTECTED_OFFSET = 96;

/** Check ticks spread across the guard window. The first lands right
 * after the click's commit (the bogus apply is synchronous in React's
 * layout effects); later ticks cover slower settles (smooth scrolling,
 * late commits). */
const CHECK_DELAY_MS = 50;
const CHECK_COUNT = 4; // guard window: 200ms

/** Scroll keys that disarm the guard: the reader is taking over. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export interface ChatClickJumpGuard {
	/** Call from the chat body's onClickCapture. Never claims the click.
	 * Accepts React's synthetic (and native) MouseEvent structurally. */
	onChatClickCapture(event: { button: number; target: EventTarget | null }): void;
	dispose(): void;
}

interface Armed {
	el: HTMLElement;
	baseline: number;
	timers: number[];
	removeListeners: () => void;
}

function readScrollState(el: HTMLElement): { el: HTMLElement; top: number; max: number } | null {
	const max = el.scrollHeight - el.clientHeight;
	// Not scrollable — nothing to guard (also keeps stub roots in tests out).
	if (max <= 0) return null;
	return { el, top: el.scrollTop, max };
}

function readScroller(
	root: ParentNode,
	target: EventTarget | null,
): { el: HTMLElement; top: number; max: number } | null {
	if (typeof document === "undefined") return null;
	const marked = root.querySelector<HTMLElement>(`.${SCROLLER_CLASS}`);
	if (marked !== null && marked.isConnected) return readScrollState(marked);
	// Fallback: the marker class is upstream's, so an upstream rename before
	// the host fix lands (this module is deletion-scheduled, not permanent)
	// would otherwise silence the guard. Walk up from the click target inside
	// the chat body and take the first real scroll container. Only ancestors
	// of the click qualify: a bare root scan would risk grabbing the
	// composer's own autoscrolling draft area instead of the transcript.
	if (!(target instanceof Element)) return null;
	for (
		let node = target.parentElement;
		node !== null && node !== root;
		node = node.parentElement
	) {
		const overflowY = typeof getComputedStyle === "function" ? getComputedStyle(node).overflowY : null;
		if (overflowY === "auto" || overflowY === "scroll") {
			const state = readScrollState(node);
			if (state !== null) return state;
		}
	}
	return null;
}

export function createChatClickJumpGuard(
	getChatRoot: () => ParentNode | null,
): ChatClickJumpGuard {
	let armed: Armed | null = null;

	const disarm = () => {
		if (armed === null) return;
		for (const timer of armed.timers) window.clearTimeout(timer);
		armed.removeListeners();
		armed = null;
	};

	/**
	 * Reverting the bogus write alone is not enough: the host manager still
	 * believes it is pinned to the bottom, and its ResizeObserver path
	 * re-clamps to the bottom on the next layout resize whenever it believes
	 * that. Its own gesture path is what disengages the pin: it listens for
	 * wheel/touch and opens a ~1s window (plus a pointer-down flag) during
	 * which a scroll event disengages instead of re-pinning. A dispatched
	 * (untrusted) wheel event invokes those listeners without the browser
	 * itself scrolling, so dispatch one right before the revert write — the
	 * write's scroll event then lands inside that window.
	 */
	const restore = (armed: { el: HTMLElement; baseline: number }) => {
		const { el, baseline } = armed;
		if (typeof WheelEvent !== "undefined") {
			try {
				el.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
			} catch {
				// Environments that reject the construction: without the gesture
				// window the revert may be re-pinned over later, which is no
				// worse than not reverting.
			}
		}
		el.scrollTop = baseline;
	};

	const check = (el: HTMLElement, baseline: number) => {
		const max = el.scrollHeight - el.clientHeight;
		const top = el.scrollTop;
		disarm();
		// The bug's write clamps to the bottom, so it shows up as a move
		// *down* from the click-time position landing effectively at max.
		// Reader scrolls that never reached the bottom are left alone.
		if (top > baseline && top >= max - AT_BOTTOM_SLACK) {
			restore({ el, baseline });
		}
	};

	const onChatClickCapture = (event: { button: number; target: EventTarget | null }) => {
		if (event.button !== 0) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		// Intended scroll-clicks (scroll pill, composer submit) are not the bug.
		if (
			target.closest(SCROLL_PILL_SELECTOR) !== null ||
			target.closest(COMPOSER_SELECTOR) !== null
		) {
			return;
		}
		const root = getChatRoot();
		if (root === null) return;
		const state = readScroller(root, event.target);
		if (state === null) return;
		// No scroll-back means the bug has nothing to yank past; arm only
		// when the reader is meaningfully scrolled up.
		if (state.max - state.top < MIN_PROTECTED_OFFSET) return;
		disarm();
		const { el, top: baseline } = state;
		const removeListeners: Array<() => void> = [];
		for (const type of ["wheel", "touchstart"] as const) {
			const listener = () => disarm();
			el.addEventListener(type, listener, { passive: true });
			removeListeners.push(() => el.removeEventListener(type, listener));
		}
		const keyListener = (event: KeyboardEvent) => {
			if (SCROLL_KEYS.has(event.key)) disarm();
		};
		document.addEventListener("keydown", keyListener, { capture: true });
		removeListeners.push(() =>
			document.removeEventListener("keydown", keyListener, { capture: true }),
		);
		armed = {
			el,
			baseline,
			timers: [],
			removeListeners: () => {
				for (const remove of removeListeners) remove();
			},
		};
		for (let i = 1; i <= CHECK_COUNT; i++) {
			armed.timers.push(
				window.setTimeout(() => check(el, baseline), CHECK_DELAY_MS * i),
			);
		}
	};

	return { onChatClickCapture, dispose: disarm };
}