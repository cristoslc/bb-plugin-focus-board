// @vitest-environment jsdom
// The chat click-jump guard (components/chat-jump-guard.ts): bb's page-shell
// scroll manager behind the pane's embedded ThreadChat has a pending-capture
// bug that clamps the transcript to the bottom right after a click while it
// is scrolled up (docs/chat-click-jump-2026-09-29.md). The guard snapshots
// the scroll position on transcript clicks and reverts such a clamp within
// its window, so these tests drive the real click/timer flow and control
// scroll measurements through stubbed scroll geometry — jsdom has no layout
// of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatClickJumpGuard } from "../components/chat-jump-guard";

type Guard = ReturnType<typeof createChatClickJumpGuard>;

interface ScrollerHarness {
	el: HTMLDivElement;
	/** Simulate a second actor (the buggy host restore) moving scrollTop. */
	scrollTo: (top: number) => void;
	geometry: { scrollHeight: number; clientHeight: number };
}

/**
 * A scroller div with the page-shell marker class and stubbed layout
 * geometry; scrollTop is a plain backing property (jsdom would clamp or
 * ignore it without a layout).
 */
function makeScroller({
	max = 3000,
	clientHeight = 500,
	top = 2500,
}: { max?: number; clientHeight?: number; top?: number } = {}): ScrollerHarness {
	const el = document.createElement("div");
	el.className = "thread-scrollbar";
	const geometry = { scrollHeight: max + clientHeight, clientHeight };
	let scrollTop = top;
	Object.defineProperty(el, "scrollHeight", {
		configurable: true,
		get: () => geometry.scrollHeight,
	});
	Object.defineProperty(el, "clientHeight", {
		configurable: true,
		get: () => geometry.clientHeight,
	});
	Object.defineProperty(el, "scrollTop", {
		configurable: true,
		get: () => scrollTop,
		set: (value) => {
			scrollTop = value;
		},
	});
	return {
		el,
		geometry,
		scrollTo: (value: number) => {
			scrollTop = value;
		},
	};
}

function leftClickOn(el: Element) {
	el.dispatchEvent(new MouseEvent("click", { button: 0, bubbles: true }));
}

describe("chat click-jump guard", () => {
	let container: HTMLDivElement;
  	let scroller: ScrollerHarness;
	let guard: Guard;
	const wheelEvents: WheelEvent[] = [];

	// Mirror the pane integration: the host's click-capture handler on the
	// chat body forwards every click into the guard before claiming them.
	const forwardClick = (event: MouseEvent) => guard.onChatClickCapture(event);

	beforeEach(() => {
		vi.useFakeTimers();
		container = document.createElement("div");
		document.body.append(container);
		// Reader sits 500px above the bottom of a 3500px transcript.
		scroller = makeScroller();
		container.append(scroller.el);
		scroller.el.addEventListener(
			"wheel",
			(event) => wheelEvents.push(event),
			true,
		);
		wheelEvents.length = 0;
		guard = createChatClickJumpGuard(() => container);
		document.addEventListener("click", forwardClick, true);
	});

	afterEach(() => {
		guard.dispose();
		document.removeEventListener("click", forwardClick, true);
		vi.clearAllTimers();
		vi.useRealTimers();
		container.remove();
	});

	it("reverts a clamp-to-bottom that lands within the guard window", () => {
		leftClickOn(scroller.el);
		// The buggy host restore clamps to the bottom on the click's commit.
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(50);
		expect(scroller.el.scrollTop).toBe(2500);
		// The revert walks the host's own disengage path: an untrusted wheel
		// event (deltaY negative) precedes the scrollTop write.
		expect(wheelEvents).toHaveLength(1);
		expect(wheelEvents[0].deltaY).toBeLessThan(0);
	});

	it("leaves the scroll alone when no clamp happens", () => {
		leftClickOn(scroller.el);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(2500);
		expect(wheelEvents).toHaveLength(0);
	});

	it("does not revert a downward reader scroll that stops short of the bottom", () => {
		leftClickOn(scroller.el);
		scroller.scrollTo(2800); // 200px short of max 3000
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(2800);
		expect(wheelEvents).toHaveLength(0);
	});

	it("does not arm when the click target is the scroll-to-latest pill", () => {
		const pill = document.createElement("button");
		pill.setAttribute("aria-label", "Scroll to latest event");
		scroller.el.append(pill);
		leftClickOn(pill);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(0);
	});

	it("does not arm when the click target is inside the composer", () => {
		const composer = document.createElement("div");
		composer.setAttribute("data-app-composer", "");
		container.append(composer);
		leftClickOn(composer);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(0);
	});

	it("does not arm below the protected scroll-back offset", () => {
		scroller.scrollTo(2950); // 50px up: below the 96px protected offset
		leftClickOn(scroller.el);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(0);
	});

	it("acts also when the click lands on blank transcript space", () => {
		const blank = document.createElement("div");
		scroller.el.append(blank);
		leftClickOn(blank);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(50);
		expect(scroller.el.scrollTop).toBe(2500);
	});

	it("does not arm for non-left clicks", () => {
		scroller.el.dispatchEvent(
			new MouseEvent("click", { button: 2, bubbles: true }),
		);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(0);
	});

	it("does not arm when the reader is already at the bottom", () => {
		scroller.scrollTo(3000);
		leftClickOn(scroller.el);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(0);
	});

	it("disarms when a reader wheel gesture arrives in the window", () => {
		leftClickOn(scroller.el);
		scroller.el.dispatchEvent(new WheelEvent("wheel", { deltaY: -300 }));
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		// An untrusted wheel does not move the scroll, but it cancels the
		// guard window, so the clamp afterward stays.
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(1);
	});

	it("disarms on reader scroll keys", () => {
		leftClickOn(scroller.el);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "PageUp", bubbles: true }),
		);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
	});

	it("a newer click re-arms with the newer baseline", () => {
		leftClickOn(scroller.el);
		scroller.scrollTo(2600); // reader keeps scrolling up between clicks
		leftClickOn(scroller.el);
		scroller.scrollTo(3000);
		vi.advanceTimersByTime(50);
		expect(scroller.el.scrollTop).toBe(2600);
	});

	it("dispose closes the guard window", () => {
		leftClickOn(scroller.el);
		scroller.scrollTo(3000);
		guard.dispose();
		vi.advanceTimersByTime(200);
		expect(scroller.el.scrollTop).toBe(3000);
		expect(wheelEvents).toHaveLength(0);
	});

	it("ignores roots without a scrollable transcript scroller", () => {
		const empty = document.createElement("div");
		document.body.append(empty);
		const other = createChatClickJumpGuard(() => empty);
		// Rebind the forwarding (and afterEach disposal) to this guard.
		guard = other;
		try {
			leftClickOn(scroller.el);
			// The guard bound to the rootless chain never armed, so a later
			// clamp stays put.
			scroller.scrollTo(3000);
			vi.advanceTimersByTime(200);
			expect(scroller.el.scrollTop).toBe(3000);
		} finally {
			other.dispose();
			empty.remove();
		}
	});
});