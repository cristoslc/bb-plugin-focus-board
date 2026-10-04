// The autotitle diagnostic CLI: `bb focus-board autotitle availability`
// reports the exact state the fallback modal shows (thread-model
// availability, selected service, bridge-classified menu) and
// `autotitle probe` runs the hidden thread-model probe end-to-end. Both
// exist because the browser modal cannot be observed from the outside;
// the CLI is the live-truth surface.
import { afterEach, describe, expect, it } from "vitest";
import type { FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { setup } from "./helpers/autotitle-fake-host";

afterEach(async () => {});

describe("bb focus-board autotitle availability", () => {
  it("prints an available thread model and the selected service", async () => {
    const { harness } = await setup({
      selection: { mode: "service", pluginId: "openrouter-inference", serviceId: "default" },
      services: [
        {
          pluginId: "openrouter-inference",
          id: "default",
          displayName: "OpenRouter",
          automaticRank: 1,
          status: { ready: true },
          tasks: ["thread-title"],
        },
      ],
    });
    const result = await harness.behavior.runCli([
      "autotitle",
      "availability",
      "thr_x",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("available");
    expect(result.stdout).toContain("openrouter-inference");
    expect(result.stdout).toContain("OpenRouter");
  });

  it("names the blocker only when no chain can spawn: no pair, provider, or project", async () => {
    // executionOptions:null with a project is now the inherit chain
    // (available); the genuine refusal needs a bare row.
    const { harness } = await setup({
      executionOptions: null,
      threadRow: { id: "thr_x", status: "idle" },
    });
    const result = await harness.behavior.runCli([
      "autotitle",
      "availability",
      "thr_x",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("not available");
    expect(result.stdout).toMatch(/no resolved provider\/model/i);
  });

  it("the inherit chain reports available even without a resolved pair", async () => {
    const { harness } = await setup({ executionOptions: null });
    const result = await harness.behavior.runCli([
      "autotitle",
      "availability",
      "thr_x",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/thread model probe: available/);
  });

  it("emits the full machine-readable menu with --json", async () => {
    const { harness } = await setup({
      selection: { mode: "service", pluginId: "openrouter-inference", serviceId: "default" },
      services: [
        {
          pluginId: "openrouter-inference",
          id: "default",
          displayName: "OpenRouter",
          automaticRank: 1,
          status: { ready: true },
          tasks: ["thread-title"],
        },
      ],
    });
    const result = await harness.behavior.runCli([
      "autotitle",
      "availability",
      "thr_x",
      "--json",
    ]);
    const menu = JSON.parse(result.stdout) as {
      selected: unknown;
      threadModel: { available: boolean };
      services: Array<{ pluginId: string; bridge: boolean }>;
    };
    expect(menu.threadModel.available).toBe(true);
    expect(menu.selected).toEqual({
      pluginId: "openrouter-inference",
      serviceId: "default",
    });
    expect(menu.services[0]?.bridge).toBe(true);
  });
});

describe("bb focus-board autotitle probe", () => {
  it("runs the hidden thread-model probe and prints the title", async () => {
    const { harness } = await setup({});
    const result = await harness.behavior.runCli(["autotitle", "probe", "thr_x"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Login redirect loop fix");
  });

  it("probes on the inherit chain when no pair resolves", async () => {
    const { harness } = await setup({ executionOptions: null });
    const result = await harness.behavior.runCli(["autotitle", "probe", "thr_x"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Login redirect loop fix");
  });

  it("fails loud with the availability reason when no chain can spawn", async () => {
    const { harness } = await setup({
      executionOptions: null,
      threadRow: { id: "thr_x", status: "idle" },
    });
    const result = await harness.behavior.runCli(["autotitle", "probe", "thr_x"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/no resolved provider\/model to probe with/);
  });
});