// Debug-mode scroll instrumentation for the thread pane's embedded chat.
//
// Purpose: discriminating the click-jump displacement candidates without
// ad-hoc monkey-patching (docs/chat-click-jump-2026-09-29.md, update
// 2026-09-30). While the developer setting is on, the pane attaches a
// session to the transcript scroller that records:
//   - every programmatic scrollTop WRITE with `new Error().stack`,
//     flagged when it overshoots the scroller's live scrollHeight (the
//     shape the 2026-09-29 captures showed: writes ~2x the real max that
//     Chrome then clamps back);
//   - every scroll event, wheel / touch / pointer-intent event;
//   - 1 Hz geometry samples, because growth and shrink commits can move
//     content over time with no write — the sampled timeline is what
//     makes each write's delta context readable after the fact.
// Entries go to a bounded ring buffer (console-logged as they land) and
// are exportable as text; the pane header grows a copy-log button while
// a session is attached, and a window handle is installed for automation
// (`__focusBoardScrollDebug.dump()`).
//
// Strictly a developer tool: attach only when the setting is on; detach
// restores the original scrollTop descriptor and removes all listeners.
/** Bounded log; 800 entries ≈ many minutes of streaming-scroll activity. */
const RING_CAP = 800;

const STACK_LINES = 5;
const STACK_MAX = 360;

function fmtStack(): string {
	return (new Error().stack ?? "")
		.split("\n")
		.slice(2, 2 + STACK_LINES)
		.map((line) => line.trim().replace(/:\d+:\d+\)?$/, "").replace(/https?:\/\/[^)]*?assets\//, ""))
		.filter(Boolean)
		.join(" | ")
		.slice(0, STACK_MAX);
}

export type ScrollDebugKind =
	| "note"
	| "write"
	| "scroll"
	| "wheel"
	| "touchstart"
	| "pointerdown"
	| "pointerup"
	| "geometry";

export interface ScrollDebugEntry {
	/** ms since the session attached */
	t: number;
	kind: ScrollDebugKind;
	/** scrollTop after the write/scroll/sample */
	top?: number;
	/** scrollHeight at the moment */
	sh?: number;
	/** clientHeight at the moment */
	ch?: number;
	/** wheel only */
	dy?: number;
	/** write only: true when a write exceeds the live scrollHeight (the bogus-restore shape) */
	overshoot?: boolean;
	/** pointer events only: target element tag */
	target?: string;
	/** write only */
	stack?: string;
	note?: string;
}

export interface AttachedScrollDebug {
	/** Ordered entries so far (newest last). */
	entries(): readonly ScrollDebugEntry[];
	/** Full log as text, for clipboard/console export. */
	dump(): string;
	detach(): void;
}

interface Timer {
	setInterval(cb: () => void, ms: number): number;
	clearInterval(id: number): void;
}

export function attachScrollDebug(
	scroller: HTMLElement,
	note: string,
	win: Timer & EventTarget | null = typeof window === "undefined" ? null : (window as unknown as Timer & EventTarget),
): AttachedScrollDebug {
	if (win === null) {
		throw new Error("attachScrollDebug requires a window");
	}
	const t0 = performance.now();
	const entries: ScrollDebugEntry[] = [];
	const push = (entry: Omit<ScrollDebugEntry, "t"> & { t?: number }, withStack = false) => {
		const full: ScrollDebugEntry = {
			...entry,
			...(withStack ? { stack: fmtStack() } : {}),
			t: Math.round(performance.now() - t0),
		};
		if (entries.length >= RING_CAP) entries.shift();
		entries.push(full);
		console.debug(
			`[focus-board:scroll-debug ${full.t}ms]`,
			full.kind,
			full.top ?? "",
			full.overshoot ? "OVERSHOOT" : "",
		);
		return full;
	};

	// Read helper: the wrapped descriptor hides the native one, so all
	// positions go through the saved getters.
	const desc =
		Object.getOwnPropertyDescriptor(scroller, "scrollTop") ??
		Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
	const readTop = (): number => (desc !== null && desc !== undefined && desc.get !== undefined ? desc.get.call(scroller) : scroller.scrollTop);

	// Wrap the scrollTop setter, recording BEFORE applying so the
	// pre-clamp value is what gets logged (Chrome clamps an overshoot on
	// apply, and the read-back would hide the arithmetic).
	if (desc !== undefined && desc.set !== undefined) {
		Object.defineProperty(scroller, "scrollTop", {
			configurable: true,
			get() {
				return desc.get!.call(scroller);
			},
			set(v: number) {
				const sh = scroller.scrollHeight;
				const ch = scroller.clientHeight;
				push(
					{
						kind: "write",
						top: Math.round(v),
						sh: Math.round(sh),
						ch: Math.round(ch),
						overshoot: sh > 0 && v > sh,
					},
					true,
				);
				desc.set!.call(scroller, v);
			},
		});
	}

	const listeners: Array<{ target: EventTarget; type: string; listener: EventListener }> = [];
	const on = (target: EventTarget, type: string, listener: EventListener, capture = false) => {
		target.addEventListener(type, listener, { passive: true, capture });
		listeners.push({ target, type, listener });
	};

	on(scroller, "scroll", () => {
		push({
			kind: "scroll",
			top: Math.round(readTop()),
			sh: Math.round(scroller.scrollHeight),
			ch: Math.round(scroller.clientHeight),
		});
	});
	on(scroller, "wheel", (event) => {
		push({ kind: "wheel", dy: (event as WheelEvent).deltaY });
	});
	on(scroller, "touchstart", () => {
		push({ kind: "touchstart" });
	});
	// Window-level pointer intent: the module opens its gesture window on
	// pointerdown and closes it on window pointerup, so both ends are data.
	on(win, "pointerdown", (event) => {
		push({
			kind: "pointerdown",
			target: (event.target as HTMLElement | null)?.tagName ?? "",
		});
	});
	on(win, "pointerup", () => {
		push({ kind: "pointerup" });
	});

	// 1 Hz geometry sampler (growth/shrink commits, no-write context).
	const sampler: number = win.setInterval(() => {
		push({
			kind: "geometry",
			top: Math.round(readTop()),
			sh: Math.round(scroller.scrollHeight),
			ch: Math.round(scroller.clientHeight),
		});
	}, 1000);

	const dump = (): string =>
		[
			`# focus-board scroll debug — ${note} — ${entries.length} entries`,
			...entries.map((e) => JSON.stringify(e)),
		].join("\n");

	return {
		entries: () => entries.slice(),
		dump,
		detach: () => {
			win.clearInterval(sampler);
			if (desc !== undefined && desc.set !== undefined) {
				Object.defineProperty(scroller, "scrollTop", desc);
			}
			for (const { target, type, listener } of listeners) {
				target.removeEventListener(type, listener);
			}
			entries.length = 0;
		},
	};
}