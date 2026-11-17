// @vitest-environment jsdom
// lib/host-capabilities: the gate the operator ruled for (dec_kyuduwmr8w7g)
// instead of raising `engines.bb`. bb 0.49.0 grew the local file surface the
// pane's compensations were written for, so the plugin reads the host version
// once and switches those compensations off above 0.49.0. The unknown state
// is deliberately the LACKING set: until (or unless) the version arrives,
// every compensation runs exactly as it does on 0.43.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	hostCapabilities,
	hostCapabilitiesFor,
	hostCapabilitiesSettled,
	hostVersion,
	parseHostVersion,
	resetHostCapabilitiesForTests,
	resolveHostCapabilities,
	subscribeHostCapabilities,
	versionAtLeast,
	waitForHostCapabilities,
} from "../lib/host-capabilities";

const LACKS = { gluesLinkGlyph: false, routesLocalFileLinks: false, composerCreatesProjects: false };
const OWNS = { gluesLinkGlyph: true, routesLocalFileLinks: true, composerCreatesProjects: true };

afterEach(() => {
	resetHostCapabilitiesForTests();
	vi.restoreAllMocks();
});

describe("parseHostVersion", () => {
	it("reads the shapes bb reports", () => {
		expect(parseHostVersion("0.49.0")).toEqual([0, 49, 0]);
		expect(parseHostVersion("v0.43.4")).toEqual([0, 43, 4]);
		expect(parseHostVersion("0.49.0-dev")).toEqual([0, 49, 0]);
		expect(parseHostVersion("0.49.0-nightly.20261101")).toEqual([0, 49, 0]);
		expect(parseHostVersion("0.50.0+build.7")).toEqual([0, 50, 0]);
		expect(parseHostVersion(" 1.2.3 ")).toEqual([1, 2, 3]);
	});

	it("refuses anything it cannot compare", () => {
		expect(parseHostVersion(null)).toBeNull();
		expect(parseHostVersion(undefined)).toBeNull();
		expect(parseHostVersion("")).toBeNull();
		expect(parseHostVersion("nightly")).toBeNull();
		expect(parseHostVersion("0.49")).toBeNull();
		expect(parseHostVersion("0.49.0.1")).toEqual([0, 49, 0]);
	});
});

describe("versionAtLeast", () => {
	it("compares numerically, not lexically", () => {
		expect(versionAtLeast([0, 49, 0], [0, 49, 0])).toBe(true);
		expect(versionAtLeast([0, 50, 0], [0, 49, 0])).toBe(true);
		expect(versionAtLeast([0, 48, 99], [0, 49, 0])).toBe(false);
		expect(versionAtLeast([0, 100, 0], [0, 49, 0])).toBe(true);
		expect(versionAtLeast([1, 0, 0], [0, 49, 0])).toBe(true);
	});
});

describe("hostCapabilitiesFor", () => {
	it("hands the compensation back to the host on 0.49.0 and later", () => {
		expect(hostCapabilitiesFor("0.49.0")).toEqual(OWNS);
		expect(hostCapabilitiesFor("0.49.0-dev")).toEqual(OWNS);
		expect(hostCapabilitiesFor("0.50.0")).toEqual(OWNS);
	});

	it("keeps every compensation on below 0.49.0", () => {
		expect(hostCapabilitiesFor("0.43.0")).toEqual(LACKS);
		expect(hostCapabilitiesFor("0.43.4")).toEqual(LACKS);
		expect(hostCapabilitiesFor("0.48.1")).toEqual(LACKS);
	});

	it("treats an unreadable version as a host without the surface", () => {
		// Conservative on purpose: an older host regressing is worse than a
		// newer host running one redundant decoration.
		expect(hostCapabilitiesFor("nightly")).toEqual(LACKS);
		expect(hostCapabilitiesFor(null)).toEqual(LACKS);
	});
});

describe("the capability store", () => {
	it("starts conservative and settles on the read", async () => {
		expect(hostCapabilitiesSettled()).toBe(false);
		expect(hostCapabilities()).toEqual(LACKS);

		const listener = vi.fn();
		subscribeHostCapabilities(listener);
		await resolveHostCapabilities(async () => "0.49.0");

		expect(hostCapabilitiesSettled()).toBe(true);
		expect(hostCapabilities()).toEqual(OWNS);
		expect(hostVersion()).toBe("0.49.0");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("reads the version once, however many mounts ask", async () => {
		const read = vi.fn(async () => "0.48.1");
		await Promise.all([
			resolveHostCapabilities(read),
			resolveHostCapabilities(read),
			resolveHostCapabilities(read),
		]);
		expect(read).toHaveBeenCalledTimes(1);
		// A settled store answers without another round trip.
		await resolveHostCapabilities(read);
		expect(read).toHaveBeenCalledTimes(1);
		expect(hostCapabilities()).toEqual(LACKS);
	});

	it("logs a failed read loudly and keeps every compensation on", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const caps = await resolveHostCapabilities(async () => {
			throw new Error("rpc refused");
		});
		expect(caps).toEqual(LACKS);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("bb version");
		// Settled, so no mount retries the failing read on every render.
		expect(hostCapabilitiesSettled()).toBe(true);
		expect(hostVersion()).toBeNull();
	});

	it("resolves the content script's wait whichever way the read went", async () => {
		const waiting = waitForHostCapabilities();
		await resolveHostCapabilities(async () => "0.49.0");
		await expect(waiting).resolves.toEqual(OWNS);

		resetHostCapabilitiesForTests();
		const waitingAfterFailure = waitForHostCapabilities();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await resolveHostCapabilities(async () => {
			throw new Error("offline");
		});
		await expect(waitingAfterFailure).resolves.toEqual(LACKS);
	});
});
