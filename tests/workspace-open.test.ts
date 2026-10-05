// The thread pane's workspace-open menu needs to reach the local host
// daemon: it lists which installed apps can open the thread's workspace
// folder, and asks the daemon to open it. lib/workspace-open.ts owns the
// daemon conversation; these tests pin its contract (port discovery, probe,
// target filtering, open call, and every unavailable verdict).
import { describe, expect, it, vi } from "vitest";
import {
	daemonPortsFromSystemConfig,
	fetchWorkspaceOpenTargets,
	openWorkspaceInTarget,
	probeLocalDaemon,
	resolveWorkspaceOpenState,
} from "../lib/workspace-open";
import type { WorkspaceOpenFetchDeps } from "../lib/workspace-open";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function depsWith(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): WorkspaceOpenFetchDeps {
	const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
		handler(String(url), init),
	) as unknown as typeof fetch;
	return { fetchImpl };
}

const SYSTEM_CONFIG = { hostDaemonPort: 38887, localHelperPorts: [38887, 40001] };

const DAEMON_TARGETS = {
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
			id: "files-only-app",
			label: "Viewer",
			kind: "editor",
			icon: null,
			capabilities: {
				openDirectory: false,
				openFile: true,
				openFileAtLine: true,
				openFileAtColumn: null,
			},
		},
	],
};

describe("daemonPortsFromSystemConfig", () => {
	it("puts the configured daemon port first, dedupes helper ports, drops junk", () => {
		expect(
			daemonPortsFromSystemConfig({
				hostDaemonPort: 38887,
				localHelperPorts: [40001, 38887],
			}),
		).toEqual([38887, 40001]);
	});

	it("survives a config without any ports", () => {
		expect(daemonPortsFromSystemConfig({})).toEqual([]);
		expect(
			daemonPortsFromSystemConfig({ hostDaemonPort: null, localHelperPorts: null }),
		).toEqual([]);
	});
});

describe("probeLocalDaemon", () => {
	it("returns the first port whose /status answers with a hostId", async () => {
		const deps = depsWith((url) => {
			if (url === "http://127.0.0.1:40001/status") {
				return jsonResponse({ hostId: "host_local", platform: "darwin" });
			}
			return new Response("nope", { status: 404 });
		});
		expect(await probeLocalDaemon([38887, 40001], deps)).toEqual({
			port: 40001,
			hostId: "host_local",
		});
	});

	it("returns null when no port answers", async () => {
		const deps = depsWith(() => {
			throw new Error("connection refused");
		});
		expect(await probeLocalDaemon([38887], deps)).toBeNull();
	});

	it("returns null when /status answers without a hostId", async () => {
		const deps = depsWith(() => jsonResponse({ unexpected: true }));
		expect(await probeLocalDaemon([38887], deps)).toBeNull();
	});
});

describe("fetchWorkspaceOpenTargets", () => {
	it("requests the workspace path and keeps only directory-capable targets", async () => {
		const deps = depsWith((url) => {
			expect(url).toBe(
				"http://127.0.0.1:38887/workspace-open-targets?path=%2Frepo",
			);
			return jsonResponse(DAEMON_TARGETS);
		});
		const targets = await fetchWorkspaceOpenTargets(38887, "/repo", deps);
		expect(targets.map((target) => target.id)).toEqual(["vscode", "finder"]);
	});

	it("throws with the daemon's message on failure", async () => {
		const deps = depsWith(() => jsonResponse({ message: "discovery exploded" }, 500));
		await expect(
			fetchWorkspaceOpenTargets(38887, "/repo", deps),
		).rejects.toThrow("discovery exploded");
	});
});

describe("openWorkspaceInTarget", () => {
	it("POSTs the local-context open request to the daemon", async () => {
		let capturedInit: RequestInit | null = null;
		const deps = depsWith((url, init) => {
			expect(url).toBe("http://127.0.0.1:38887/open-in-target");
			capturedInit = init ?? null;
			return jsonResponse({ ok: true });
		});
		await openWorkspaceInTarget(38887, "/repo", "vscode", deps);
		const init = capturedInit as RequestInit | null;
		expect(init?.method).toBe("POST");
		expect(JSON.parse(String(init?.body))).toEqual({
			context: { kind: "local" },
			path: "/repo",
			targetId: "vscode",
			lineNumber: null,
			columnNumber: null,
		});
	});

	it("rejects with the daemon's error message when the open fails", async () => {
		const deps = depsWith(() => jsonResponse({ message: "app is gone" }, 500));
		await expect(
			openWorkspaceInTarget(38887, "/repo", "vscode", deps),
		).rejects.toThrow("app is gone");
	});
});

describe("resolveWorkspaceOpenState", () => {
	it("reports unavailable when the thread has no workspace", async () => {
		const deps = depsWith(() => {
			throw new Error("should not be called");
		});
		const state = await resolveWorkspaceOpenState({
			root: null,
			environmentHostId: "host_local",
			systemConfig: SYSTEM_CONFIG,
			deps,
		});
		expect(state.status).toBe("unavailable");
		expect(state.reason).toMatch(/no workspace/i);
		expect(state.targets).toEqual([]);
	});

	it("reports unavailable when the local daemon is unreachable", async () => {
		const deps = depsWith(() => {
			throw new Error("connection refused");
		});
		const state = await resolveWorkspaceOpenState({
			root: "/repo",
			environmentHostId: "host_local",
			systemConfig: SYSTEM_CONFIG,
			deps,
		});
		expect(state.status).toBe("unavailable");
		expect(state.reason).toMatch(/daemon/i);
	});

	it("reports unavailable when the workspace lives on another host", async () => {
		const deps = depsWith((url) => {
			if (String(url).endsWith("/status")) {
				return jsonResponse({ hostId: "host_local", platform: "darwin" });
			}
			return jsonResponse({ targets: [] });
		});
		const state = await resolveWorkspaceOpenState({
			root: "/repo",
			environmentHostId: "host_remote",
			systemConfig: SYSTEM_CONFIG,
			deps,
		});
		expect(state.status).toBe("unavailable");
		expect(state.reason).toMatch(/different host/i);
	});

	it("returns directory-capable targets when the workspace is on this host", async () => {
		const deps = depsWith((url) => {
			if (String(url).endsWith("/status")) {
				return jsonResponse({ hostId: "host_local", platform: "darwin" });
			}
			return jsonResponse(DAEMON_TARGETS);
		});
		const state = await resolveWorkspaceOpenState({
			root: "/repo",
			environmentHostId: "host_local",
			systemConfig: SYSTEM_CONFIG,
			deps,
		});
		expect(state.status).toBe("available");
		expect(state.root).toBe("/repo");
		expect(state.reason).toBeNull();
		expect(state.targets.map((target) => target.id)).toEqual([
			"vscode",
			"finder",
		]);
	});

	it("reuses a cached target list instead of rediscovering apps twice", async () => {
		let discoveryCalls = 0;
		const deps = depsWith((url) => {
			if (String(url).endsWith("/status")) {
				return jsonResponse({ hostId: "host_local", platform: "darwin" });
			}
			discoveryCalls += 1;
			return jsonResponse(DAEMON_TARGETS);
		});
		const cache = new Map<string, unknown>();
		const args = {
			root: "/repo",
			environmentHostId: "host_local",
			systemConfig: SYSTEM_CONFIG,
			deps,
		};
		await resolveWorkspaceOpenState({ ...args, targetsCache: cache });
		await resolveWorkspaceOpenState({ ...args, targetsCache: cache });
		expect(discoveryCalls).toBe(1);
	});
});
