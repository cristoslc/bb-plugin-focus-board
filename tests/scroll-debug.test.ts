// @vitest-environment jsdom
// The developer scroll-instrumentation session (components/scroll-debug.ts):
// while the debug setting is on, the pane attaches a bounded logging session
// to the transcript scroller — writes with stacks (flagged on overshoot),
// event stream, 1 Hz geometry samples — and detach restores the original
// scrollTop descriptor and removes everything. These tests drive it with
// stubbed scroll geometry (jsdom has no layout) and fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachScrollDebug, type AttachedScrollDebug } from "../components/scroll-debug";

type ScrollerHarness = {
	el: HTMLDivElement;
	scrollTo: (top: number) => void;
	geometry: { scrollHeight: number; clientHeight: number; sh: number };
};

function makeScroller({
	max = 3000,
	clientHeight = 500,
}: { max?: number; clientHeight?: number } = {}): ScrollerHarness {
	const el = document.createElement("div");
	const geometry = {
		scrollHeight: max + clientHeight,
		clientHeight,
	};
	Object.defineProperty(el, "scrollHeight", {
		configurable: true,
		get: () => geometry.scrollHeight,
	});
	Object.defineProperty(el, "clientHeight", {
		configurable: true,
		get: () => geometry.clientHeight,
	});
	let scrollTop = 0;
	Object.defineProperty(el, "scrollTop", {
		configurable: true,
		get: () => scrollTop,
		set: (value) => {
			scrollTop = value;
		},
	});
	return { el, geometry, scrollTo: (top: number) => { scrollTop = top; } };
}

describe("scroll debug session", () => {
	const consoleSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
	let scroller: ScrollerHarness;
	let session: AttachedScrollDebug | null = null;

	beforeEach(() => {
		document.body.replaceChildren();
		scroller = makeScroller();
		document.body.append(scroller.el);
	});

	afterEach(() => {
		try {
			session?.detach();
		} finally {
			session = null;
		}
		vi.clearAllTimers();
	});

	it("records writes with stacks and flags overshoots before the clamp", () => {
		session = attachScrollDebug(scroller.el, "test-note");
		// The bogus restore shape: a write past the live scrollHeight.
		scroller.el.scrollTop = 6000;
		// A normal in-range write.
		scroller.el.scrollTop = 1200;
		const entries = session.entries().filter((e) => e.kind === "write");
		expect(entries).toHaveLength(2);
		expect(entries[0].top).toBe(6000);
		expect(entries[0].overshoot).toBe(true);
		expect((entries[0].stack ?? "").length).toBeGreaterThan(0);
		expect(entries[1].overshoot).toBe(false);
		// The write applied through the original descriptor (no clamping of
		// state: the stub keeps the value verbatim, and reads hide nothing).
		expect(scroller.el.scrollTop).toBe(1200);
	});

	it("records the event stream and 1 Hz geometry samples", () => {
		vi.useFakeTimers();
		session = attachScrollDebug(scroller.el, "test-note");
		scroller.el.dispatchEvent(new WheelEvent("wheel", { deltaY: -240 }));
		scroller.el.dispatchEvent(new Event("scroll"));
		document.body.dispatchEvent(new Event("pointerdown"));
		document.body.dispatchEvent(new Event("pointerup"));
		vi.advanceTimersByTime(2000); // two geometry samples
		const kinds = session.entries().map((e) => e.kind);
		expect(kinds.filter((k) => k === "wheel")).toHaveLength(1);
		expect(kinds.filter((k) => k === "geometry")).toHaveLength(2);
		// The scroll event sampled the geometry.
		expect(session.entries().find((e) => e.kind === "scroll")?.sh).toBe(3500);
	});

	it("detach restores the original descriptor and empties the log", () => {
		const before = Object.getOwnPropertyDescriptor(scroller.el, "scrollTop");
		session = attachScrollDebug(scroller.el, "test-note");
		session.detach();
		const after = Object.getOwnPropertyDescriptor(scroller.el, "scrollTop");
		expect(after?.get).toBe(before?.get);
		// Writes still work after detach and log nothing.
		consoleSpy.mockClear();
		scroller.el.scrollTop = 100;
		expect(session.entries()).toHaveLength(0);
		expect(consoleSpy).not.toHaveBeenCalled();
	});

	it("dumps readable text with the note and capped entries", () => {
		session = attachScrollDebug(scroller.el, "pane thread thr_test");
		scroller.el.scrollTop = 400;
		const dump = session.dump();
		expect(dump).toContain("pane thread thr_test");
		expect(dump).toContain('"kind":"write"');
		expect(dump).toContain('"t":');
	});
});