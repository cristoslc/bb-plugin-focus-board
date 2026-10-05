// @vitest-environment jsdom
// The thread pane header's open control: an icon that opens the thread's
// workspace in the preferred editor plus a dropdown with the other
// destinations (file explorer, terminal, new window, copy link). It replaces
// the debug-only bug button, which is gone entirely — the scroll-debug log
// stays console-only even with the debug setting on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";

type RpcCall = (method: string, args?: unknown) => Promise<unknown>;

const { rpcCallMock, toThreadMock } = vi.hoisted(() => ({
	rpcCallMock: vi.fn<RpcCall>(() => async () => ({})),
	toThreadMock: vi.fn(),
}));

let settingsValues: Record<string, string | number | boolean> | undefined;

vi.mock("@get-bb/plugin-sdk/app", () => ({
	ThreadChat: (): ReactNode => null,
	useSdk: () => ({
		threads: {
			get: async () => ({ environmentId: null }),
			events: { list: async () => ({ events: [] }) },
			interactions: { list: async () => ({ interactions: [] }) },
			stop: async () => ({}),
		},
		subscribe: () => () => {},
	}),
	useRpc: () => ({ call: rpcCallMock }),
	useBbNavigate: () => ({ toThread: toThreadMock }),
	useSettings: () => ({ values: settingsValues, isLoading: false }),
}));

vi.mock("../components/autotitle-fallback-modal", () => ({
	AutotitleFallbackModal: (): ReactNode => null,
}));

vi.mock("../components/pending-interaction-card", () => ({
	PendingInteractionCard: (): ReactNode => null,
}));

vi.mock("../components/decided-questions-card", () => ({
	DecidedQuestionsCard: (): ReactNode => null,
}));

afterEach(cleanup);

function defaultRpc(method: string): unknown {
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
					capabilities: {
						openDirectory: true,
						openFile: false,
						openFileAtLine: false,
						openFileAtColumn: null,
					},
				},
				{
					id: "terminal-app",
					label: "Terminal",
					kind: "terminal",
					icon: null,
					capabilities: {
						openDirectory: true,
						openFile: false,
						openFileAtLine: false,
						openFileAtColumn: null,
					},
				},
			],
		};
	}
	if (method === "workspace_open_in_target") return { ok: true, message: null };
	return {};
}

beforeEach(() => {
	settingsValues = undefined;
	rpcCallMock.mockReset();
	rpcCallMock.mockImplementation(async (method: string) => defaultRpc(method));
	window.localStorage.clear();
});

function renderPane() {
	const onMaximize = vi.fn();
	render(
		createElement(ThreadPane, {
			thread: {
				id: "thr_1",
				displayTitle: "Demo thread",
				status: "idle",
				isUnread: false,
				isPinned: false,
				href: "/threads/thr_1",
			},
			isArchived: false,
			isDone: false,
			onToggleDone: () => {},
			onToggleArchived: () => {},
			onTogglePinned: () => {},
			onToggleUnread: () => {},
			onRename: async () => {},
			onMaximize,
			onClose: () => {},
			escStopsRunningThread: true,
		}),
	);
	return { onMaximize };
}

describe("pane header debug button removal", () => {
	it("never renders the copy-scroll-debug bug button, even with the setting on", () => {
		settingsValues = { scrollDebugInstrumentation: true };
		renderPane();
		expect(
			screen.queryByRole("button", { name: /copy pane scroll debug log/i }),
		).toBeNull();
	});
});

describe("pane header chrome", () => {
	it("the desktop header has no standalone full-screen button", () => {
		renderPane();
		expect(
			screen.queryByRole("button", { name: /open thread full screen/i }),
		).toBeNull();
	});

	it("the actions menu reads as an ellipsis, not a floating caret", () => {
		renderPane();
		const trigger = screen.getByRole("button", { name: "More thread actions" });
		expect(trigger.querySelector('[data-icon="More"]')).not.toBeNull();
		expect(trigger.querySelector('[data-icon="ChevronDown"]')).toBeNull();
	});
});

describe("pane header workspace-open menu", () => {
	it("renders no open button when the workspace open state is unavailable", () => {
		rpcCallMock.mockImplementation(async (method: string) =>
			method === "workspace_open_targets"
				? { status: "unavailable", reason: "Local host daemon is unavailable.", root: null, targets: [] }
				: defaultRpc(method),
		);
		renderPane();
		expect(screen.queryByRole("button", { name: /open workspace/i })).toBeNull();
	});

	it("renders the open button with the preferred editor as the primary action", async () => {
		renderPane();
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: /open workspace in vs code/i }),
			).toBeTruthy(),
		);
	});

	it("the primary icon matches the primary action's kind — a code glyph for the editor", async () => {
		renderPane();
		const primary = await screen.findByRole("button", {
			name: /open workspace in vs code/i,
		});
		// The primary action opens the EDITOR, so the glyph is the code icon;
		// the folder glyph stays on the file-explorer entry in the dropdown.
		expect(primary.querySelector('[data-icon="Code"]')).not.toBeNull();
		expect(primary.querySelector('[data-icon="FolderOpen"]')).toBeNull();
	});

	it("a file-manager primary (no editor installed) keeps the folder glyph", async () => {
		rpcCallMock.mockImplementation(async (method: string) => {
			if (method !== "workspace_open_targets") return defaultRpc(method);
			const available = defaultRpc(method) as {
				targets: Array<{ kind: string | null }>;
			};
			return {
				...available,
				targets: available.targets.filter((target) => target.kind !== "editor"),
			};
		});
		renderPane();
		const primary = await screen.findByRole("button", {
			name: /open workspace in finder/i,
		});
		expect(primary.querySelector('[data-icon="FolderOpen"]')).not.toBeNull();
		expect(primary.querySelector('[data-icon="Code"]')).toBeNull();
	});

	it("the dropdown lists editor, file explorer, terminal, new window, and copy link", async () => {
		renderPane();
		const primaryProbe = await screen.findByRole("button", {
			name: /open workspace in vs code/i,
		});
		expect(primaryProbe).toBeTruthy();
		const trigger = await screen.findByRole("button", {
			name: /more places to open/i,
		});
		fireEvent.click(trigger);
		for (const label of [
			"Open in editor",
			"Open in file explorer",
			"Open in terminal",
			"Open in new window",
			"Copy thread link",
		]) {
			expect(screen.getByRole("menuitem", { name: label })).toBeTruthy();
		}
	});

	it("primary click asks the daemon-backed RPC to open the workspace in the editor", async () => {
		renderPane();
		const primary = await screen.findByRole("button", {
			name: /open workspace in vs code/i,
		});
		fireEvent.click(primary);
		await waitFor(() =>
			expect(rpcCallMock).toHaveBeenCalledWith("workspace_open_in_target", {
				threadId: "thr_1",
				targetId: "vscode",
			}),
		);
	});

	it("the file explorer entry opens the file-manager target", async () => {
		renderPane();
		fireEvent.click(
			await screen.findByRole("button", { name: /more places to open/i }),
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Open in file explorer" }));
		await waitFor(() =>
			expect(rpcCallMock).toHaveBeenCalledWith("workspace_open_in_target", {
				threadId: "thr_1",
				targetId: "finder",
			}),
		);
	});

	it("Open in new window opens the thread href detached with noopener", async () => {
		const openSpy = vi
			.spyOn(window, "open")
			.mockImplementation(() => null);
		try {
			renderPane();
			fireEvent.click(
				await screen.findByRole("button", { name: /more places to open/i }),
			);
			fireEvent.click(
				screen.getByRole("menuitem", { name: "Open in new window" }),
			);
			expect(openSpy).toHaveBeenCalledWith(
				`${window.location.origin}/threads/thr_1`,
				"_blank",
				"noopener",
			);
		} finally {
			openSpy.mockRestore();
		}
	});

	it("Copy thread link writes the absolute thread URL to the clipboard", async () => {
		const writeText = vi.fn(async () => {});
		Object.assign(navigator, { clipboard: { writeText } });
		try {
			renderPane();
			fireEvent.click(
				await screen.findByRole("button", { name: /more places to open/i }),
			);
			fireEvent.click(
				screen.getByRole("menuitem", { name: "Copy thread link" }),
			);
			await waitFor(() =>
				expect(writeText).toHaveBeenCalledWith(
					`${window.location.origin}/threads/thr_1`,
				),
			);
		} finally {
			// Nothing to restore: the clipboard stub dies with this jsdom window.
		}
	});

	it("the dropdown offers Maximize pane just before Open in new window, and maximizes on click", async () => {
		const { onMaximize } = renderPane();
		fireEvent.click(
			await screen.findByRole("button", { name: /more places to open/i }),
		);
		const maximize = screen.getByRole("menuitem", { name: "Maximize pane" });
		const newWindow = screen.getByRole("menuitem", {
			name: "Open in new window",
		});
		// bb's own term, sitting next to the other thread destinations.
		expect(
			maximize.compareDocumentPosition(newWindow) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		fireEvent.click(maximize);
		expect(onMaximize).toHaveBeenCalledTimes(1);
	});

	it("the open control reads 'Open in editor' on a wide pane, icon-only at the default width", async () => {
		renderPane();
		const primary = await screen.findByRole("button", {
			name: /open workspace in vs code/i,
		});
		expect(primary.textContent).not.toContain("Open in editor");

		cleanup();
		window.localStorage.setItem("focus-board:paneWidth", "700");
		renderPane();
		const labeled = await screen.findByRole("button", {
			name: /open workspace in vs code/i,
		});
		expect(labeled.textContent).toContain("Open in editor");
	});

	it("a failed open keeps the menu open and shows the daemon's message", async () => {
		rpcCallMock.mockImplementation(async (method: string) => {
			if (method === "workspace_open_in_target") {
				throw new Error("app is gone");
			}
			return defaultRpc(method);
		});
		renderPane();
		const primary = await screen.findByRole("button", {
			name: /open workspace in vs code/i,
		});
		fireEvent.click(primary);
		await waitFor(() =>
			expect(screen.getByText(/app is gone/)).toBeTruthy(),
		);
	});
});
