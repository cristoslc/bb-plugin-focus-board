// @vitest-environment jsdom
// The pane's 0.44-era local-file rescue, gated on the host version
// (lib/host-capabilities; dec_kyuduwmr8w7g). Two halves stand down on bb
// 0.49.0, which routes both itself: the inline-code existence decoration and
// the click capture that reopened relative hrefs against the workspace. On a
// 0.43 through 0.48 host both still run, which is the case this file pins
// hardest: the gate must not quietly disable the rescue where it is needed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";
import {
	resetHostCapabilitiesForTests,
	resolveHostCapabilities,
} from "../lib/host-capabilities";

const rpcCalls: string[] = [];
const threadLookups: string[] = [];

vi.mock("@get-bb/plugin-sdk/app", () => ({
	// A transcript that carries both shapes the pane rescues: an inline code
	// span naming a workspace file, and a markdown link with a relative href.
	ThreadChat: (): ReactNode => (
		<div>
			<p>
				The map lives in <code>docs/erd.md</code>.
			</p>
			<p>
				<a href="docs/erd.md">the map</a>
			</p>
		</div>
	),
	useSdk: () => ({
		threads: {
			get: async (args: { threadId: string }) => {
				threadLookups.push(args.threadId);
				return { environmentId: "env_1" };
			},
		},
	}),
	useRpc: () => ({
		call: async (method: string) => {
			rpcCalls.push(method);
			if (method === "workspace_files_exist") {
				return { existence: { "docs/erd.md": true } };
			}
			return {};
		},
	}),
	useBbNavigate: () => ({
		toThread: () => {},
		experimental_openFilePreview: () => true,
	}),
	useSettings: () => ({ values: undefined, isLoading: false }),
}));

const noop = () => {};

beforeEach(() => {
	rpcCalls.length = 0;
	threadLookups.length = 0;
});

afterEach(() => {
	cleanup();
	resetHostCapabilitiesForTests();
});

function renderPane() {
	return render(
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
					href: "/threads/thr_test",
				},
				isArchived: false,
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
}

describe("the pane on a host that routes local files itself", () => {
	it("does not decorate inline code and asks the workspace nothing", async () => {
		await resolveHostCapabilities(async () => "0.49.0");
		const view = renderPane();
		const code = view.getByText("docs/erd.md", { selector: "code" });
		// Let the decoration effect's observer fire and settle.
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(code.hasAttribute("data-focus-board-path-link")).toBe(false);
		expect(rpcCalls).not.toContain("workspace_files_exist");
		// No workspace resolution was needed either: the effect returns before
		// it asks the SDK for the thread's environment.
		expect(threadLookups).toHaveLength(0);
	});

	it("leaves a relative markdown link to the host", async () => {
		await resolveHostCapabilities(async () => "0.49.0");
		const view = renderPane();
		await new Promise((resolve) => setTimeout(resolve, 60));
		threadLookups.length = 0;
		const link = view.getByText("the map");
		const notPrevented = fireEvent.click(link);
		expect(notPrevented).toBe(true);
		expect(threadLookups).toHaveLength(0);
	});
});

describe("the pane on a host without the surface", () => {
	it("decorates a verified inline-code path", async () => {
		await resolveHostCapabilities(async () => "0.48.1");
		const view = renderPane();
		const code = view.getByText("docs/erd.md", { selector: "code" });
		await waitFor(() => {
			expect(code.getAttribute("data-focus-board-path-link")).toBe("docs/erd.md");
		});
		expect(rpcCalls).toContain("workspace_files_exist");
	});

	it("still claims a relative markdown link", async () => {
		await resolveHostCapabilities(async () => "0.48.1");
		const view = renderPane();
		// The verdict cache may answer from the case above, so the settled
		// signal here is the decoration, not another RPC.
		const code = view.getByText("docs/erd.md", { selector: "code" });
		await waitFor(() => {
			expect(code.hasAttribute("data-focus-board-path-link")).toBe(true);
		});
		threadLookups.length = 0;
		const link = view.getByText("the map");
		const notPrevented = fireEvent.click(link);
		expect(notPrevented).toBe(false);
		expect(threadLookups).toEqual(["thr_test"]);
	});
});
