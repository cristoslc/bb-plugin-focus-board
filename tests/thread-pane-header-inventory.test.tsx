// @vitest-environment jsdom
// The pane header's affordance inventory, the contract behind the native
// header restyle of 2026-11-20: every action the header offered the day it
// was restyled to bb's native chrome row (48px row of 28px ghost icon
// buttons, overflow menu carrying the read toggle) must remain reachable in
// EVERY surface shape — one click or one click + one menu entry, never
// gone. A future restyle that quietly drops one of these fails here.
//
// Desktop (side-by-side pane and the squeezed panel sheet alike use the
// desktop branch when the window itself is wide): title rename, ✨
// autotitle, done toggle, read toggle, pin, snooze, new child thread,
// archive, workspace open + its dropdown, maximize, close.
// Compact (phone sheet): back replaces… nothing, and full screen joins the
// menu; the read toggle stays a one-tap primary there.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import { snoozeMenuActions } from "../lib/snooze";

const noop = () => {};
const onMaximize = vi.fn();

type RpcCall = (method: string, args?: unknown) => Promise<unknown>;
const rpcCallMock = vi.fn<RpcCall>().mockImplementation(async (method: string) => {
	if (method === "workspace_open_targets") {
		return {
			status: "available",
			reason: null,
			root: "/repo",
			targets: [
				{
					id: "vscode",
					label: "VS Code",
					kind: "editor",
					icon: null,
					capabilities: {
						openDirectory: true,
						openFile: true,
						openFileAtLine: true,
						openFileAtColumn: true,
					},
				},
				{
					id: "finder",
					label: "Finder",
					kind: "file-manager",
					icon: null,
					capabilities: { openDirectory: true, openFile: true, openFileAtLine: false, openFileAtColumn: false },
				},
				{
					id: "iterm",
					label: "iTerm",
					kind: "terminal",
					icon: null,
					capabilities: { openDirectory: true, openFile: false, openFileAtLine: false, openFileAtColumn: false },
				},
			],
		};
	}
	return { existence: {} };
});

vi.mock("@get-bb/plugin-sdk/app", () => ({
	ThreadChat: (): ReactNode => null,
	useSdk: () => ({ threads: { get: async () => ({}) } }),
	useRpc: () => ({ call: rpcCallMock }),
	useBbNavigate: () => ({ toThread: noop }),
	useSettings: () => ({ values: undefined, isLoading: false }),
}));

afterEach(cleanup);

function openMenu() {
	fireEvent.click(screen.getByRole("button", { name: "More thread actions" }));
	return screen.getByRole("menu", { name: "More thread actions" });
}

function openWorkspaceDropdown() {
	fireEvent.click(screen.getByRole("button", { name: "More places to open" }));
	return screen.getByRole("menu");
}

/** Assert EVERY affordance is reachable at one width, and exercise each
 *  trigger once. */
describe("thread pane header affordance inventory", () => {
	it("desktop: rename, autotitle, done, read, pin, snooze, new child, archive, workspace, maximize, close", async () => {
		let done = false;
		const onToggleUnread = vi.fn();
		const onTogglePinned = vi.fn();
		const openPicker = vi.fn();
		const onRename = vi.fn(async () => {});
		render(
			createElement(
				CompactViewportOverrideProvider,
				{ isCompactViewport: false },
				createElement(ThreadPane, {
					thread: {
						id: "thr_test",
						displayTitle: "Test thread",
						status: "idle",
						isUnread: false,
						isPinned: false,
					},
					isArchived: false,
					isDone: done,
					onToggleDone: (next) => {
						done = next;
					},
					onToggleArchived: noop,
					onTogglePinned,
					onToggleUnread,
					onRename,
					onMaximize,
					onClose: noop,
					escStopsRunningThread: false,
					onNewChildThread: noop,
					snoozeMenuItems: snoozeMenuActions({
						snoozed: false,
						clearSnooze: noop,
						openPicker,
					}),
				}),
			),
		);
		// Title rename (click the title opens the inline editor with its ✨
		// control; the same surface on every width).
		fireEvent.click(screen.getByTitle("Rename thread"));
		expect(screen.getByRole("textbox", { name: "Thread title" })).toBeTruthy();
		expect(screen.getByLabelText("Auto-rename from the thread prompt")).toBeTruthy();

		// Done toggle: one click, in the header.
		fireEvent.click(screen.getByRole("button", { name: "Mark done" }));

		// The overflow menu: read, done, pin, snooze, new child, archive.
		openMenu();
		expect(screen.getByRole("menuitem", { name: "Mark Unread" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "Mark Done" })).toBeTruthy();
		const pin = screen.getByRole("menuitem", { name: "Pin" });
		fireEvent.click(pin);
		expect(onTogglePinned).toHaveBeenCalledTimes(1);
		openMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Snooze…" }));
		expect(openPicker).toHaveBeenCalledTimes(1);
		openMenu();
		expect(screen.getByRole("menuitem", { name: "New child thread…" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
		fireEvent.click(screen.getByRole("menuitem", { name: "Mark Unread" }));
		expect(onToggleUnread).toHaveBeenCalledTimes(1);

		// Workspace open: the primary control and its dropdown (the targets
		// resolve in an effect, so await them).
		await screen.findByRole("button", { name: "Open workspace in VS Code" });
		openWorkspaceDropdown();
		for (const label of [
			"Open in editor",
			"Open in file explorer",
			"Open in terminal",
			"Maximize pane",
			"Open in browser",
			"Copy thread link",
		]) {
			await screen.findByRole("menuitem", { name: label });
		}

		// Maximize (the standalone ghost the native header carries; the
		// dropdown entry's own maximize is workspace-open's own test).
		fireEvent.click(screen.getByRole("button", { name: "Maximize pane" }));
		expect(onMaximize).toHaveBeenCalledTimes(1);
		// Close.
		expect(screen.getByRole("button", { name: "Close thread pane" })).toBeTruthy();
	});

	it("compact: back, done, one-tap read primary, menu, workspace, close — and Full Screen in the menu", async () => {
		render(
			createElement(
				CompactViewportOverrideProvider,
				{ isCompactViewport: true },
				createElement(ThreadPane, {
					thread: {
						id: "thr_test",
						displayTitle: "Test thread",
						status: "idle",
						isUnread: false,
						isPinned: false,
					},
					isArchived: false,
					isDone: false,
					onToggleDone: noop,
					onToggleArchived: noop,
					onTogglePinned: noop,
					onToggleUnread: noop,
					onRename: async () => {},
					onMaximize,
					onClose: noop,
					escStopsRunningThread: false,
					onNewChildThread: noop,
					snoozeMenuItems: snoozeMenuActions({
						snoozed: false,
						clearSnooze: noop,
						openPicker: noop,
					}),
				}),
			),
		);
		expect(screen.getByRole("button", { name: "Back to board" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
		// One-tap read primary (the pane's phone affordance, kept).
		expect(
			screen.getByRole("button", { name: "Mark thread unread" }),
		).toBeTruthy();
		const menu = openMenu();
		const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map(
			(item) => item.textContent,
		);
		expect(labels).toEqual([
			"Mark Done",
			"Pin",
			"Mark Unread",
			"Snooze…",
			"New child thread…",
			"Archive",
			"Full Screen",
		]);
		// Close the overflow before opening the workspace dropdown, or two
		// role=menu trees are on screen at once.
		fireEvent.click(screen.getByRole("button", { name: "More thread actions" }));
		await screen.findByRole("button", { name: "Open workspace in VS Code" });
		openWorkspaceDropdown();
		await screen.findByRole("menuitem", { name: "Maximize pane" });
		expect(screen.getByRole("menuitem", { name: "Open in browser" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "Copy thread link" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Close thread pane" })).toBeTruthy();
	});

	it("an archived thread's pane still reaches pin's only exit through the menu", () => {
		render(
			createElement(
				CompactViewportOverrideProvider,
				{ isCompactViewport: false },
				createElement(ThreadPane, {
					thread: {
						id: "thr_test",
						displayTitle: "Test thread",
						status: "idle",
						isUnread: false,
						isPinned: false,
					},
					isArchived: true,
					isDone: false,
					onToggleDone: noop,
					onToggleArchived: noop,
					onTogglePinned: noop,
					onToggleUnread: noop,
					onRename: async () => {},
					onMaximize: noop,
					onClose: noop,
					escStopsRunningThread: false,
				}),
			),
		);
		openMenu();
		expect(screen.getByRole("menuitem", { name: "Unarchive" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Unpin" })).toBeNull();
	});
});
