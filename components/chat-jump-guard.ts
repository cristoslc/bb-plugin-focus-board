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
// symptom from the plugin side: the reader's position is recorded at each
// gesture's pointerdown (before any commit in the sequence can write), and
// when a left click later passes through the transcript body, the guard
// arms on that pre-jump position and — if the transcript ends up pinned at
// the bottom within the guard window — restores it. Arming on the
// pointerdown record instead of the click-time read is what makes the
// guard work at all: the shell's clamp commits during the pointerdown
// edge, so by the click the fresh read is already past the write
// (adversarial round thr_cexdxfbnaj, run nat4).
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

/** Real scroll moves that big in one event mean a displacement or its
 * correction is in flight — not settled reading state. */
const JUMP_SUPPRESS_THRESHOLD = 300;
/** How long a detected jump keeps arming suppressed. */
const SUPPRESS_MS = 3000;

export function createChatClickJumpGuard(
	getChatRoot: () => ParentNode | null,
): ChatClickJumpGuard {
	let armed: Armed | null = null;
	/** The scroller's position recorded when the CURRENT input sequence
	 * started: a window-level pointerdown capture runs before any commit
	 * can write, so this value is the race-proof pre-jump position and the
	 * click's protected baseline (the shell's jump fires in this sequence's
	 * commit, and its scroll event is delivered after the arming handler —
	 * see the probe runs d11/d12/d14/d15 and the nat4 refutation run). */
	let startedAt: { el: HTMLElement; top: number } | null = null;
	const pointerDownListener = (event: Event) => {
		const root = getChatRoot();
		if (root === null) {
			startedAt = null;
			return;
		}
		const target = event.target;
		if (!(target instanceof Element)) return;
		const state = readScroller(root, target);
		if (state === null) {
			startedAt = null;
			return;
		}
		startedAt = { el: state.el, top: state.top };
	};
	if (typeof window !== "undefined" && typeof document !== "undefined") {
		window.addEventListener("pointerdown", pointerDownListener, { capture: true, passive: true });
	}
	/** Settled-position observer for the degraded fallback (clicks with no
	 * pointer event, which have no pointerdown baseline): a passive scroll
	 * listener (per scroller, re-attached when the pane remounts) that
	 * records the last seen position and, when the position moves >=300px
	 * in one event, suppresses arming for a window (a yank, or the shell's
	 * own self-correction, is in flight; reverting through either would
	 * fight the shell or cement a displacement — bug seen live in run
	 * d10). Real clicks never reach this: their pointerdown baseline is
	 * race-proof on its own, so no always-on listener runs in production. */
	let tracker: { scroller: HTMLElement; top: number | null; suppressUntil: number; remove: () => void } | null = null;

	const ensureTracker = (scroller: HTMLElement) => {
		if (tracker !== null && tracker.scroller === scroller && tracker.scroller.isConnected) return;
		tracker?.remove();
		const listener = () => {
			const now = performance.now();
			const top = scroller.scrollTop;
			const settled = tracker?.top ?? null;
			if (settled !== null && Math.abs(top - settled) >= JUMP_SUPPRESS_THRESHOLD) {
				if (tracker) tracker.suppressUntil = now + SUPPRESS_MS;
			}
			if (tracker) tracker.top = top;
		};
		scroller.addEventListener("scroll", listener, { passive: true });
		tracker = {
			scroller,
			top: scroller.scrollTop,
			suppressUntil: 0,
			remove: () => {
				scroller.removeEventListener("scroll", listener);
			},
		};
	};

	const disposeListenerCleanup = () => {
		tracker?.remove();
		tracker = null;
		if (typeof window !== "undefined") {
			window.removeEventListener("pointerdown", pointerDownListener, { capture: true } as EventListenerOptions);
		}
	};

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
		// *down* from the protected baseline landing effectively at max.
		// Reader scrolls that never reached the bottom are left alone.
		if (top > baseline && top >= max - AT_BOTTOM_SLACK) {
			restore({ el, baseline });
		}
	};

	/** Open the guard window on `el`: snapshot `baseline` (the position a
	 * bogus clamp-to-bottom would be reverted to) and check across the
	 * window's ticks. */
	const arm = (el: HTMLElement, baseline: number) => {
		disarm();
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
		// The protected baseline is this input sequence's pointerdown record
		// when the click belongs to one: the record was taken at the
		// gesture's first event, before any commit in the sequence could
		// write, so it is the reader's true position at gesture start even
		// when the shell's jump has already clamped the view by arm time.
		if (startedAt !== null && startedAt.el === state.el) {
			// Arm on the record's scroll-back: the bug's write moves the
			// view DOWN from the recorded position to the bottom. The fresh
			// read plays no part — it is already past the write (nat4).
			if (state.max - startedAt.top < MIN_PROTECTED_OFFSET) return;
			arm(state.el, startedAt.top);
			return;
		}
		// Degraded fallback for clicks with no pointer event for this
		// scroller (synthetic/programmatic clicks, or a pane remounted
		// mid-sequence): arm on the fresh read, gated by the settled-view
		// refusals. Those refusals cannot see through an in-sequence jump
		// (the fresh read may already be past the write — why the fallback
		// never fires for real clicks), but they keep the guard off the
		// shell's own corrections in flows that never produced a
		// pointerdown record. The old pointerdown-divergence refusal is not
		// reproduced here: it required a matching pointerdown record, and
		// such a record routes to the baseline branch above.
		if (state.max - state.top < MIN_PROTECTED_OFFSET) return;
		ensureTracker(state.el);
		if (tracker !== null && performance.now() < tracker.suppressUntil) return;
		arm(state.el, state.top);
	};

	return { onChatClickCapture, dispose: () => { disarm(); disposeListenerCleanup(); } };
}