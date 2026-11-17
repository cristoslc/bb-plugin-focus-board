// Which host surfaces this plugin still has to compensate for.
//
// The audit in docs/tech-debt/host-workaround-audit-2026-11-16.md found six
// compensations that bb 0.49.0 made obsolete and that a 0.43 through 0.48
// host still needs: the pane's inline-code file links, its relative-link
// rescue, the click capture for both, the ExternalLink glyph glue, and the
// New Thread dialog's own New project button with its folder-picker flow.
// The operator ruled against raising `engines.bb`, so the compensations stay
// in the tree and switch themselves off on a host that already owns the
// surface (dec_kyuduwmr8w7g).
//
// The gate reads the host's own version over the `host_version` RPC. bb
// serves the renderer, so the server's version is the version of the build
// whose DOM this plugin decorates, in every deployment (desktop app, web tab,
// remote client).
//
// The unknown state is deliberately the LACKING set. Until the version
// lands, and if it never lands, the plugin behaves exactly as it does on
// 0.43: every compensation runs. That direction cannot regress an older host,
// and the window is one RPC round trip after the board mounts. A failed read
// is logged rather than swallowed: a silent failure here would look like a
// working host that quietly never switches over.

/** The bb release that grew the surfaces below (bb CHANGELOG 0.49.0). */
export const HOST_LOCAL_FILE_SURFACE_VERSION = "0.49.0";

export interface HostCapabilities {
	/** bb fuses the link glyph with the link's last character itself. */
	gluesLinkGlyph: boolean;
	/** bb routes inline-code and relative markdown links in a plugin chat. */
	routesLocalFileLinks: boolean;
	/** bb's plugin new-thread composer offers New project. */
	composerCreatesProjects: boolean;
}

const HOST_OWNS_LOCAL_FILE_SURFACE: HostCapabilities = {
	gluesLinkGlyph: true,
	routesLocalFileLinks: true,
	composerCreatesProjects: true,
};

const HOST_LACKS_LOCAL_FILE_SURFACE: HostCapabilities = {
	gluesLinkGlyph: false,
	routesLocalFileLinks: false,
	composerCreatesProjects: false,
};

/**
 * Parse a host version into its numeric triple, or null when it is not a
 * version this plugin can reason about. Accepts the shapes bb reports:
 * `0.49.0`, `v0.49.0`, `0.49.0-dev`, `0.49.0-nightly.20261101`, and
 * `0.50.0+build.7`. The suffix never decides the comparison: a `-dev` build
 * of 0.49.0 carries 0.49.0's renderer, so it counts as 0.49.0.
 */
export function parseHostVersion(raw: string | null | undefined): [number, number, number] | null {
	if (typeof raw !== "string") return null;
	const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(raw.trim());
	if (match === null) return null;
	const [major, minor, patch] = [match[1], match[2], match[3]].map((part) => Number(part));
	if (![major, minor, patch].every((part) => Number.isSafeInteger(part))) return null;
	return [major as number, minor as number, patch as number];
}

/** True when `version` is at or above `floor`, both as numeric triples. */
export function versionAtLeast(
	version: [number, number, number],
	floor: [number, number, number],
): boolean {
	for (let index = 0; index < 3; index += 1) {
		const mine = version[index] ?? 0;
		const theirs = floor[index] ?? 0;
		if (mine !== theirs) return mine > theirs;
	}
	return true;
}

/** The capability set for a host version, or the lacking set when unknown. */
export function hostCapabilitiesFor(raw: string | null | undefined): HostCapabilities {
	const version = parseHostVersion(raw);
	const floor = parseHostVersion(HOST_LOCAL_FILE_SURFACE_VERSION);
	if (version === null || floor === null) return HOST_LACKS_LOCAL_FILE_SURFACE;
	return versionAtLeast(version, floor)
		? HOST_OWNS_LOCAL_FILE_SURFACE
		: HOST_LACKS_LOCAL_FILE_SURFACE;
}

let capabilities: HostCapabilities = HOST_LACKS_LOCAL_FILE_SURFACE;
let resolvedVersion: string | null = null;
let settled = false;
let inflight: Promise<HostCapabilities> | null = null;
const listeners = new Set<() => void>();
let settleWaiters: Array<(next: HostCapabilities) => void> = [];

function publish(next: HostCapabilities, version: string | null): void {
	capabilities = next;
	resolvedVersion = version;
	settled = true;
	for (const listener of listeners) listener();
	const waiters = settleWaiters;
	settleWaiters = [];
	for (const waiter of waiters) waiter(next);
}

/** The capability set right now. Conservative until `resolve` settles. */
export function hostCapabilities(): HostCapabilities {
	return capabilities;
}

/** The host version that produced the current set, or null while unknown. */
export function hostVersion(): string | null {
	return resolvedVersion;
}

/** True once a version has been read (or a read has failed). */
export function hostCapabilitiesSettled(): boolean {
	return settled;
}

/**
 * Read the host version once and publish the capability set it implies.
 * Safe to call from every mount: the first caller starts the read, the rest
 * join it, and a settled store answers without another round trip.
 */
export function resolveHostCapabilities(
	readVersion: () => Promise<string>,
): Promise<HostCapabilities> {
	if (settled) return Promise.resolve(capabilities);
	if (inflight !== null) return inflight;
	inflight = readVersion()
		.then((version) => {
			publish(hostCapabilitiesFor(version), version);
			return capabilities;
		})
		.catch((error: unknown) => {
			// Fail loud, then keep working: an unreadable version is a real
			// problem (the gate can never switch over), so it is logged with
			// the reason. The set stays the lacking one, which is what every
			// host this plugin supports did before 0.49.0.
			console.warn(
				"[focus-board] could not read the bb version; keeping every host compensation on",
				error,
			);
			publish(HOST_LACKS_LOCAL_FILE_SURFACE, null);
			return capabilities;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

/** Subscribe to capability changes; returns the unsubscribe. */
export function subscribeHostCapabilities(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Resolve once the store has settled, whichever way it went. The content
 * script's installer waits on this: it has no RPC of its own, and the pane
 * it decorates cannot exist before the board mounts and starts the read.
 */
export function waitForHostCapabilities(): Promise<HostCapabilities> {
	if (settled) return Promise.resolve(capabilities);
	return new Promise((resolve) => {
		settleWaiters.push(resolve);
	});
}

/** Test seam: forget the resolved host so a suite can drive another one. */
export function resetHostCapabilitiesForTests(): void {
	capabilities = HOST_LACKS_LOCAL_FILE_SURFACE;
	resolvedVersion = null;
	settled = false;
	inflight = null;
	listeners.clear();
	settleWaiters = [];
}
