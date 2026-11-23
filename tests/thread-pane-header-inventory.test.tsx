// @vitest-environment jsdom
// The pane header's affordance inventory, the contract behind the native
// header restyle of 2026-11-20 and the header unification of 2026-11-23:
// every action the header offers the reader must remain reachable in EVERY
// surface shape — one click or one click + one menu entry, never gone. A
// future restyle that quietly drops one of these fails here.
//
// Desktop (side-by-side pane and the squeezed panel sheet alike use the
// desktop branch when the window itself is wide): title rename, ✨
// autotitle, the Focus Board control's Done / Snooze / New child thread
// rows, read toggle, pin, archive, workspace open + its dropdown, maximize,
// close.
// Compact (phone sheet): back, the same Focus Board control (Done reachable
// through its menu), full screen joining the overflow, and the read toggle
// staying a one-tap primary.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

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

/** The ⋯ overflow: bb's own thread actions on every surface. */
function openMenu() {
	fireEvent.click(screen.getByRole("button", { name: "More thread actions" }));
	return screen.getByRole("menu", { name: "More thread actions" });
}

/** The Focus Board control: the board's three actions, shared with bb's own
 *  thread page. */
function openBoardMenu() {
	fireEvent.click(screen.getByRole("button", { name: "Focus Board thread menu" }));
	return screen.getByRole("menu", { name: "Focus Board thread menu" });
}

function openWorkspaceDropdown() {
	fireEvent.click(screen.getByRole("button", { name: "More places to open" }));
	return screen.getByRole("menu");
}

/** Assert EVERY affordance is reachable at one width, and exercise each
 *  trigger once. */
describe("thread pane header affordance inventory", () => {
	it("desktop: rename, autotitle, done, snooze, new child, read, pin, archive, workspace, maximize, close", async () => {
		const onToggleDone = vi.fn();
		const onOpenSnoozePicker = vi.fn();
		const onNewChildThread = vi.fn();
		const onToggleUnread = vi.fn();
		const onTogglePinned = vi.fn();
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
					isDone: false,
					onToggleDone,
					onToggleArchived: noop,
					onTogglePinned,
					onToggleUnread,
					onRename,
					onMaximize,
					onClose: noop,
					escStopsRunningThread: false,
					onOpenSnoozePicker,
					onNewChildThread,
				}),
			),
		);
		// Title rename (click the title opens the inline editor with its ✨
		// control; the same surface on every width).
		fireEvent.click(screen.getByTitle("Rename thread"));
		expect(screen.getByRole("textbox", { name: "Thread title" })).toBeTruthy();
		expect(screen.getByLabelText("Auto-rename from the thread prompt")).toBeTruthy();

		// The Focus Board control: Done, Snooze, New child thread — the same
		// three rows bb's own thread page carries.
		openBoardMenu();
		expect(
			Array.from(
				screen
					.getByRole("menu", { name: "Focus Board thread menu" })
					.querySelectorAll('[role="menuitem"], [role="menuitemradio"]'),
			).map((row) => row.textContent),
		).toEqual(["Mark Done", "Snooze…", "New child thread…"]);
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
		expect(onToggleDone).toHaveBeenCalledWith(true);
		openBoardMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "Snooze…" }));
		expect(onOpenSnoozePicker).toHaveBeenCalledTimes(1);
		openBoardMenu();
		fireEvent.click(screen.getByRole("menuitem", { name: "New child thread…" }));
		expect(onNewChildThread).toHaveBeenCalledTimes(1);

		// The ⋯ overflow: bb's own actions, the ones its thread page keeps
		// there.
		openMenu();
		expect(screen.getByRole("menuitem", { name: "Mark Unread" })).toBeTruthy();
		const pin = screen.getByRole("menuitem", { name: "Pin" });
		fireEvent.click(pin);
		expect(onTogglePinned).toHaveBeenCalledTimes(1);
		openMenu();
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

	it("compact: back, the board control, one-tap read primary, overflow, workspace, close — and Full Screen in the overflow", async () => {
		const onToggleDone = vi.fn();
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
					onToggleDone,
					onToggleArchived: noop,
					onTogglePinned: noop,
					onToggleUnread: noop,
					onRename: async () => {},
					onMaximize,
					onClose: noop,
					escStopsRunningThread: false,
					onOpenSnoozePicker: noop,
					onNewChildThread: noop,
				}),
			),
		);
		expect(screen.getByRole("button", { name: "Back to board" })).toBeTruthy();
		// Done stays reachable on the phone: the mark's menu, one tap away.
		openBoardMenu();
		fireEvent.click(screen.getByRole("menuitemradio", { name: "Mark Done" }));
		expect(onToggleDone).toHaveBeenCalledWith(true);
		// One-tap read primary (the pane's phone affordance, kept).
		expect(
			screen.getByRole("button", { name: "Mark thread unread" }),
		).toBeTruthy();
		const menu = openMenu();
		const labels = Array.from(menu.querySelectorAll("[role='menuitem']")).map(
			(item) => item.textContent,
		);
		expect(labels).toEqual(["Pin", "Mark Unread", "Archive", "Full Screen"]);
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

	it("an archived thread's pane still reaches pin's only exit through the overflow", () => {
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
