// @vitest-environment jsdom
// lib/host-capabilities: the gate the operator ruled for (dec_kyuduwmr8w7g)
// instead of raising `engines.bb`. bb 0.49.0 grew the local file surface the
// pane's compensations were written for, so the plugin reads the host version
// once and switches those compensations off above 0.49.0. The unknown state
// is deliberately the LACKING set: until (or unless) the version arrives,
// every compensation runs exactly as it does on 0.43.
//
// bb 0.50.0 is the second line the same read serves: a one-pane window carries
// a layout to split from 0.50 up (measured on 0.50.1), so the card click asks
// the host's opener there and opens the board's own pane only on a version
// KNOWN to be older. That verdict is the one place the module does NOT give an
// unknown host the lacking answer, and it says why.
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

const LACKS = {
	gluesLinkGlyph: false,
	routesLocalFileLinks: false,
	composerCreatesProjects: false,
};
const OWNS = {
	gluesLinkGlyph: true,
	routesLocalFileLinks: true,
	composerCreatesProjects: true,
};
/** Before the read lands, and after a read that failed: every file
 *  compensation on, and the one-pane click still asking. */
const UNKNOWN = { ...LACKS, splitsFromOnePane: "unknown" };

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
		expect(hostCapabilitiesFor("0.49.0")).toEqual({ ...OWNS, splitsFromOnePane: "no" });
		expect(hostCapabilitiesFor("0.49.0-dev")).toEqual({ ...OWNS, splitsFromOnePane: "no" });
		expect(hostCapabilitiesFor("0.50.0")).toEqual({ ...OWNS, splitsFromOnePane: "yes" });
	});

	it("keeps every compensation on below 0.49.0", () => {
		expect(hostCapabilitiesFor("0.43.0")).toEqual({ ...LACKS, splitsFromOnePane: "no" });
		expect(hostCapabilitiesFor("0.43.4")).toEqual({ ...LACKS, splitsFromOnePane: "no" });
		expect(hostCapabilitiesFor("0.48.1")).toEqual({ ...LACKS, splitsFromOnePane: "no" });
	});

	it("treats an unreadable version as a host without the surface", () => {
		// Conservative on purpose for the file surfaces: an older host
		// regressing is worse than a newer host running one redundant
		// decoration.
		expect(hostCapabilitiesFor("nightly")).toEqual(UNKNOWN);
		expect(hostCapabilitiesFor(null)).toEqual(UNKNOWN);
	});
});

// The one-pane split verdict (HOST_SINGLE_PANE_SPLIT_VERSION): the click asks
// the host's opener for a split on 0.50 and later, and opens the board's own
// pane on a version KNOWN to be older. An unknown version keeps the ask, the
// module's one deviation from "unknown means lacking", because skipping the
// ask on a host that could split costs the feature while asking on a host that
// cannot costs one navigation the dance already repairs.
describe("splitsFromOnePane", () => {
	const verdict = (raw: string | null | undefined) =>
		hostCapabilitiesFor(raw).splitsFromOnePane;

	it("is yes from 0.50.0 up", () => {
		expect(verdict("0.50.0")).toBe("yes");
		expect(verdict("0.50.1")).toBe("yes");
		expect(verdict("0.51.0")).toBe("yes");
		expect(verdict("1.0.0")).toBe("yes");
	});

	it("is no on the last version below 0.50", () => {
		expect(verdict("0.49.9")).toBe("no");
		expect(verdict("0.49.0")).toBe("no");
		expect(verdict("0.43.4")).toBe("no");
		expect(verdict("0.48.99")).toBe("no");
	});

	it("does not let a suffix decide the comparison", () => {
		// A -dev or +build build of 0.50.0 carries 0.50.0's renderer.
		expect(verdict("0.50.0-dev")).toBe("yes");
		expect(verdict("0.50.0-nightly.20261101")).toBe("yes");
		expect(verdict("0.50.0+build.7")).toBe("yes");
		expect(verdict("v0.50.0")).toBe("yes");
		expect(verdict("0.49.9-dev")).toBe("no");
		expect(verdict("0.49.0+build.7")).toBe("no");
	});

	it("is unknown, not no, when the version cannot be read", () => {
		// The unknown direction here is the REVERSE of the file surfaces':
		// the click keeps asking, so a 0.50 host whose read failed still gets
		// the split beside the board.
		expect(verdict("nightly")).toBe("unknown");
		expect(verdict("")).toBe("unknown");
		expect(verdict("0.50")).toBe("unknown");
		expect(verdict(null)).toBe("unknown");
		expect(verdict(undefined)).toBe("unknown");
	});
});

describe("the capability store", () => {
	it("starts conservative and settles on the read", async () => {
		expect(hostCapabilitiesSettled()).toBe(false);
		// Every compensation on, and the one-pane click still asking.
		expect(hostCapabilities()).toEqual(UNKNOWN);

		const listener = vi.fn();
		subscribeHostCapabilities(listener);
		await resolveHostCapabilities(async () => "0.49.0");

		expect(hostCapabilitiesSettled()).toBe(true);
		expect(hostCapabilities()).toEqual({ ...OWNS, splitsFromOnePane: "no" });
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
		expect(hostCapabilities()).toEqual({ ...LACKS, splitsFromOnePane: "no" });
	});

	it("logs a failed read loudly and keeps every compensation on", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const caps = await resolveHostCapabilities(async () => {
			throw new Error("rpc refused");
		});
		// The unknown host: compensations on AND the ask kept (unlike the
		// file surfaces, the one-pane verdict does not fall back to "old").
		expect(caps).toEqual(UNKNOWN);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("bb version");
		// Settled, so no mount retries the failing read on every render.
		expect(hostCapabilitiesSettled()).toBe(true);
		expect(hostVersion()).toBeNull();
	});

	it("resolves the content script's wait whichever way the read went", async () => {
		const waiting = waitForHostCapabilities();
		await resolveHostCapabilities(async () => "0.49.0");
		await expect(waiting).resolves.toEqual({ ...OWNS, splitsFromOnePane: "no" });

		resetHostCapabilitiesForTests();
		const waitingAfterFailure = waitForHostCapabilities();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		await resolveHostCapabilities(async () => {
			throw new Error("offline");
		});
		await expect(waitingAfterFailure).resolves.toEqual(UNKNOWN);
	});
});
