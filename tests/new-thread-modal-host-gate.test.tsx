// @vitest-environment jsdom
// The New Thread dialog's own New project button, gated on the host version
// (lib/host-capabilities; dec_kyuduwmr8w7g; entry 8 of the host-workaround
// audit). bb 0.49.0 hands `createProject` to its own plugin composer, whose
// project picker grows a New project row, so the dialog stops drawing a
// second one there. Below 0.49 the host has no such capability and this
// button is the only way to create a project while composing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { NewThreadModal } from "../components/new-thread-modal";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import {
	resetHostCapabilitiesForTests,
	resolveHostCapabilities,
} from "../lib/host-capabilities";

const REQUEST = {
	projectId: "proj_1",
	environment: { type: "project-default" },
	input: [],
} as unknown as NewThreadRequest;

vi.mock("@get-bb/plugin-sdk/app", () => ({
	// A stub composer: the gate is about which controls the dialog adds
	// around it, not about the host composer itself.
	experimental_NewThreadComposer: (): ReactNode =>
		createElement("button", { type: "button" }, "Stub composer submit"),
	useSdk: () => ({ threads: { spawn: async () => ({ id: "thr_new", projectId: "proj_1" }) } }),
	useRpc: () => ({ call: async () => ({ version: "0.49.0" }) }),
}));

const noop = () => {};

afterEach(() => {
	cleanup();
	resetHostCapabilitiesForTests();
});

function renderModal(overrides: { onCreateProject?: (name: string) => Promise<{ id: string }> }) {
	return render(
		createElement(NewThreadModal, {
			open: true,
			onOpenChange: noop,
			onSpawned: noop,
			onMaximize: noop,
			...overrides,
		}),
	);
}

const createProject = async () => ({ id: "proj_new" });

describe("the dialog's New project control against the host version", () => {
	it("stays out of the way on 0.49.0, where the host composer offers it", async () => {
		await resolveHostCapabilities(async () => "0.49.0");
		const view = renderModal({ onCreateProject: createProject });
		expect(view.queryByLabelText("New project")).toBeNull();
		expect(view.queryByText("Stub composer submit")).not.toBeNull();
	});

	it("draws it on a host below 0.49", async () => {
		await resolveHostCapabilities(async () => "0.48.1");
		const view = renderModal({ onCreateProject: createProject });
		expect(view.queryByLabelText("New project")).not.toBeNull();
	});

	it("draws nothing when the app hands no create path at all", async () => {
		await resolveHostCapabilities(async () => "0.48.1");
		const view = renderModal({});
		expect(view.queryByLabelText("New project")).toBeNull();
	});
});
