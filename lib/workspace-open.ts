// Workspace-open plumbing for the thread pane header's open menu.
//
// bb's own thread header opens the workspace through the local host
// daemon (127.0.0.1:<port>): it lists the installed apps that can open a
// path ("workspace-open-targets") and asks the daemon to open one
// ("open-in-target"). The plugin SDK exposes neither endpoint, but the
// plugin server runs inside the bb server process on the same machine, so
// it can speak to the daemon over loopback itself and serve the pane over
// the plugin RPC. Doing it server-side also keeps the feature working for
// a remote browser session: the daemon opens apps where the workspace
// lives, not where the browser runs.
//
// Only workspaces on THIS machine are offered: the daemon is the local
// one, so a thread whose environment lives on another enrolled host gets
// an explicit "unavailable" verdict instead of a silently wrong open.
import { z } from "zod";

/** The capabilities the daemon reports per open target. */
export interface WorkspaceOpenTargetCapabilities {
	openDirectory: boolean;
	openFile: boolean;
	openFileAtLine: boolean;
	openFileAtColumn: boolean | null;
}

export interface WorkspaceOpenTargetIcon {
	/** "builtin" | "data-url" | "symbol" per the host-daemon contract. */
	kind: string;
	/** Extra fields pass through untouched (e.g. dataUrl, name). */
	[key: string]: unknown;
}

export interface WorkspaceOpenTarget {
	id: string;
	label: string;
	/** "editor" | "file-manager" | "terminal" | "default-app" | "native-app" | null */
	kind: string | null;
	icon: WorkspaceOpenTargetIcon | null;
	capabilities: WorkspaceOpenTargetCapabilities;
}

export interface WorkspaceOpenState {
	status: "available" | "unavailable";
	/** Why the menu is unavailable; null when available. */
	reason: string | null;
	root: string | null;
	targets: WorkspaceOpenTarget[];
}

export interface HostDaemonProbe {
	port: number;
	hostId: string;
}

export interface WorkspaceOpenFetchDeps {
	fetchImpl: typeof fetch;
	/** Per-request timeout; the daemon can be slow on first app discovery. */
	timeoutMs?: number;
}

const daemonStatusSchema = z.object({
	hostId: z.string().min(1),
});

const daemonCapabilitiesSchema = z.object({
	openDirectory: z.boolean(),
	openFile: z.boolean(),
	openFileAtLine: z.boolean(),
	openFileAtColumn: z.boolean().nullish(),
});

const daemonTargetSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	kind: z.string().nullish(),
	icon: z
		.object({ kind: z.string() })
		.passthrough()
		.nullish(),
	capabilities: daemonCapabilitiesSchema,
});

const daemonTargetsResponseSchema = z.object({
	targets: z.array(daemonTargetSchema),
});

const daemonErrorSchema = z.object({ message: z.string().min(1) });

/** Ports to probe: the configured daemon port first, then any extra helper ports, deduped. */
export function daemonPortsFromSystemConfig(config: {
	hostDaemonPort?: number | null;
	localHelperPorts?: readonly number[] | null;
}): number[] {
	const ports: number[] = [];
	for (const port of [config.hostDaemonPort, ...(config.localHelperPorts ?? [])]) {
		if (typeof port !== "number" || !Number.isInteger(port) || port <= 0) continue;
		if (!ports.includes(port)) ports.push(port);
	}
	return ports;
}

async function fetchJson(
	url: string,
	deps: WorkspaceOpenFetchDeps,
	init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
	const timeoutMs = deps.timeoutMs ?? 5_000;
	const response = await deps.fetchImpl(url, {
		...init,
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await response.text();
	let body: unknown = null;
	if (text !== "") {
		try {
			body = JSON.parse(text);
		} catch {
			body = null;
		}
	}
	return { status: response.status, body };
}

function daemonError(
	status: number,
	body: unknown,
	fallback: string,
): Error {
	const parsed = daemonErrorSchema.safeParse(body);
	return new Error(parsed.success ? parsed.data.message : `${fallback} (HTTP ${status})`);
}

/**
 * Probe the loopback daemon ports and return the first that answers
 * `/status` with a hostId. Null when none does (daemon down, or the bb
 * server runs on a different machine than this plugin server — in which
 * case no local open is meaningful anyway).
 */
export async function probeLocalDaemon(
	ports: readonly number[],
	deps: WorkspaceOpenFetchDeps,
): Promise<HostDaemonProbe | null> {
	for (const port of ports) {
		try {
			const { status, body } = await fetchJson(
				`http://127.0.0.1:${port}/status`,
				deps,
			);
			if (status !== 200) continue;
			const parsed = daemonStatusSchema.safeParse(body);
			if (!parsed.success) continue;
			return { port, hostId: parsed.data.hostId };
		} catch {
			// Unreachable port — try the next one.
		}
	}
	return null;
}

/**
 * List the workspace-open targets the daemon knows for `root`, keeping
 * only the ones that can open a directory (the menu opens the workspace
 * folder, never a lone file).
 */
export async function fetchWorkspaceOpenTargets(
	port: number,
	root: string,
	deps: WorkspaceOpenFetchDeps,
): Promise<WorkspaceOpenTarget[]> {
	const { status, body } = await fetchJson(
		`http://127.0.0.1:${port}/workspace-open-targets?path=${encodeURIComponent(root)}`,
		deps,
	);
	if (status !== 200) {
		throw daemonError(status, body, "Workspace open target discovery failed");
	}
	const parsed = daemonTargetsResponseSchema.parse(body);
	return parsed.targets.flatMap((target) => {
		if (target.capabilities.openDirectory !== true) return [];
		return [
			{
				id: target.id,
				label: target.label,
				kind: target.kind ?? null,
				icon: (target.icon as WorkspaceOpenTargetIcon | null | undefined) ?? null,
				capabilities: {
					openDirectory: true,
					openFile: target.capabilities.openFile,
					openFileAtLine: target.capabilities.openFileAtLine,
					openFileAtColumn: target.capabilities.openFileAtColumn ?? null,
				},
			},
		];
	});
}

/** Ask the daemon to open the workspace folder in one of its targets. */
export async function openWorkspaceInTarget(
	port: number,
	root: string,
	targetId: string,
	deps: WorkspaceOpenFetchDeps,
): Promise<void> {
	const { status, body } = await fetchJson(
		`http://127.0.0.1:${port}/open-in-target`,
		deps,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				context: { kind: "local" },
				path: root,
				targetId,
				lineNumber: null,
				columnNumber: null,
			}),
		},
	);
	if (status < 200 || status >= 300) {
		throw daemonError(status, body, "Failed to open workspace");
	}
}

/** A tiny per-root cache: first-time app discovery on the daemon takes seconds. */
export interface WorkspaceOpenTargetsCache {
	get(key: string): WorkspaceOpenTarget[] | null;
	set(key: string, targets: WorkspaceOpenTarget[]): void;
}

export function createWorkspaceOpenTargetsCache(ttlMs: number): WorkspaceOpenTargetsCache {
	const entries = new Map<string, { at: number; targets: WorkspaceOpenTarget[] }>();
	return {
		get(key) {
			const entry = entries.get(key);
			if (entry === undefined) return null;
			if (Date.now() - entry.at > ttlMs) {
				entries.delete(key);
				return null;
			}
			return entry.targets;
		},
		set(key, targets) {
			entries.set(key, { at: Date.now(), targets });
		},
	};
}

/**
 * Resolve everything the pane's open menu needs in one call: whether a
 * local open is possible at all, and which directory-capable apps exist.
 * Every "no" carries a human reason — the menu is only rendered when the
 * verdict is available, so the reason doubles as the operator-facing
 * explanation (and the RPC test surface).
 */
export async function resolveWorkspaceOpenState(args: {
	root: string | null;
	environmentHostId: string;
	systemConfig: {
		hostDaemonPort?: number | null;
		localHelperPorts?: readonly number[] | null;
	};
	deps: WorkspaceOpenFetchDeps;
	targetsCache?: WorkspaceOpenTargetsCache | null;
}): Promise<WorkspaceOpenState> {
	const { root, environmentHostId, systemConfig, deps, targetsCache } = args;
	if (root === null) {
		return {
			status: "unavailable",
			reason: "This thread has no workspace to open.",
			root: null,
			targets: [],
		};
	}
	const probe = await probeLocalDaemon(daemonPortsFromSystemConfig(systemConfig), deps);
	if (probe === null) {
		return {
			status: "unavailable",
			reason: "Local host daemon is unavailable.",
			root,
			targets: [],
		};
	}
	if (probe.hostId !== environmentHostId) {
		return {
			status: "unavailable",
			reason: "This thread's workspace lives on a different host, so it cannot be opened here.",
			root,
			targets: [],
		};
	}
	const cacheKey = `${probe.hostId}:${root}`;
	const cached = targetsCache?.get(cacheKey) ?? null;
	const targets =
		cached ?? (await fetchWorkspaceOpenTargets(probe.port, root, deps));
	if (cached === null) targetsCache?.set(cacheKey, targets);
	return { status: "available", reason: null, root, targets };
}
